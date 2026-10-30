import crypto from 'node:crypto';
import { z } from 'zod';
import { collection } from './ProfileStore.mjs';
import { readDoc } from '../../../../mcp-server/app/src/FileTools.mjs';
import { anchorMatches, locateAnchoredEdit, locateEdit, makeAnchor } from '../../../shared/edit-anchor.mjs';
import { projectWrite } from './WorkspaceLifecycle.mjs';
import { sameEditTarget, legacyEditGroups } from '../../../shared/edit-successors.mjs';
import { editConflict } from '../../../shared/edit-recovery.mjs';

export const proposalSchema = z.object({
  chatId: z.string().uuid(), toolCallId: z.string().min(1).max(150),
  input: z.object({ path: z.string().min(1).max(1000), startLine: z.number().int().min(1), endLine: z.number().int().min(1),
    oldText: z.string().max(100000), newText: z.string().max(100000), reason: z.string().max(5000).optional(),
    replacesEditId: z.string().max(150).nullable().optional(), keepSeparate: z.boolean().nullable().optional() }),
});
const anchorSchema = z.object({ before: z.string().max(100000), after: z.string().max(100000), prefix: z.string().max(60), suffix: z.string().max(60), atStart: z.boolean(), atEnd: z.boolean() });
const scope = (userId, projectId) => ({ userId: String(userId), projectId });
const conflict = message => Object.assign(new Error(message), { status: 409 });
const visible = ({ _id, userId, ...row }) => row;

export async function listEdits(userId, projectId, chatId) {
  const store = await collection('Edits');
  let rows = await store.find({ ...scope(userId, projectId), state: { $ne: 'superseded' }, ...(chatId && { chatId }) }).sort({ createdAt: -1 }).limit(500).toArray();
  const groups = legacyEditGroups(rows), contents = new Map();
  for (const group of groups) {
    const latest = group[0], path = latest.input.path;
    if (!contents.has(path)) contents.set(path, await readDoc(projectId, path).then(row => row.content).catch(() => null));
    const content = contents.get(path);
    if (content === null || !group.slice(1).every(row => sameEditTarget(content, row, latest.input))) continue;
    await projectWrite(projectId, async session => {
      const live = await store.find({ _id: { $in: group.map(row => row._id) }, state: 'pending', operation: null }, { session }).toArray();
      if (live.length !== group.length) return;
      await store.updateMany({ _id: { $in: group.slice(1).map(row => row._id) }, state: 'pending', operation: null },
        { $set: { state: 'superseded', supersededBy: latest.id, updatedAt: new Date() }, $inc: { revision: 1 } }, { session });
    });
  }
  if (groups.length) rows = await store.find({ ...scope(userId, projectId), state: { $ne: 'superseded' }, ...(chatId && { chatId }) }).sort({ createdAt: -1 }).limit(500).toArray();
  return rows.sort((a, b) => new Date(b.positionedAt || b.createdAt) - new Date(a.positionedAt || a.createdAt)).map(visible);
}

async function getEdit(userId, projectId, id) {
  const row = await (await collection('Edits')).findOne({ ...scope(userId, projectId), id });
  if (!row) throw Object.assign(new Error('修改建议不存在或无权访问'), { status: 404 });
  return row;
}
export async function loadEdit(userId, projectId, id) { return visible(await getEdit(userId, projectId, id)); }

export async function findEditSuggestions(userId, projectId, chatId, { path, quote }) {
  const rows = await (await collection('Edits')).find({ ...scope(userId, projectId), state: 'pending', 'input.path': path })
    .sort({ updatedAt: -1 }).limit(500).toArray();
  const matches = quote ? rows.filter(row => row.input.oldText === quote || row.input.oldText.includes(quote) || quote.includes(row.input.oldText) && row.input.oldText) : rows;
  return { items: matches.slice(0, 12).map(row => ({ id: row.id, sameConversation: row.chatId === chatId, state: row.state,
    path: row.input.path, startLine: row.input.startLine, endLine: row.input.endLine,
    oldText: row.input.oldText.slice(0, 1500), newText: row.input.newText.slice(0, 1500),
    truncated: row.input.oldText.length > 1500 || row.input.newText.length > 1500,
    reason: row.input.reason?.slice(0, 500), busy: Boolean(row.operation) })), moreAvailable: matches.length > 12 };
}

async function replacementTarget(store, userId, projectId, id, session) {
  const previous = await store.findOne({ ...scope(userId, projectId), id }, { session });
  if (!previous) throw editConflict('edit_target_not_found', '要续改的建议不存在，请先查找待确认建议并使用返回的 ID', { action: 'find_edit_suggestions' });
  if (previous.supersededBy) {
    let latest = previous;
    const visited = new Set([previous.id]);
    while (latest.supersededBy && !visited.has(latest.supersededBy)) {
      visited.add(latest.supersededBy);
      const next = await store.findOne({ ...scope(userId, projectId), id: latest.supersededBy }, { session });
      if (!next) break;
      latest = next;
    }
    throw editConflict('edit_superseded', '这条建议已有新版，请核对最新版后再修改',
      { action: 'find_edit_suggestions', latestEditId: latest.id, state: latest.state });
  }
  if (previous.state !== 'pending') throw editConflict('edit_not_pending', '这条建议已处理，请根据当前正文生成新建议', { action: 'read_source', state: previous.state });
  if (previous.operation) throw editConflict('edit_in_progress', '这条建议正在处理，请等待操作完成后再试', { action: 'wait' });
  return previous;
}

export async function proposeEdit(userId, projectId, body) {
  const input = proposalSchema.parse(body);
  // Optional fields can arrive as null from providers with strict tool schemas.
  if (input.input.replacesEditId === null) delete input.input.replacesEditId;
  if (input.input.keepSeparate === null) delete input.input.keepSeparate;
  if (input.input.oldText === input.input.newText) throw new Error('修改前后内容相同');
  const _id = `${userId}:${projectId}:${input.chatId}:${input.toolCallId}`;
  const store = await collection('Edits');
  const existing = await store.findOne({ _id });
  if (existing) {
    if (JSON.stringify(existing.input) !== JSON.stringify(input.input)) throw conflict('同一工具调用已生成不同建议，请重新发起');
    return visible(existing);
  }
  const { content } = await readDoc(projectId, input.input.path);
  let at;
  try { at = locateEdit(content, input.input.oldText, input.input.startLine); }
  catch { throw editConflict('edit_source_changed', '正文已变化或无法唯一定位，请重新读取原文后再修改', { action: 'read_source', path: input.input.path }); }
  const proposalAnchor = makeAnchor(content, at, input.input.oldText, input.input.newText);
  await projectWrite(projectId, async session => {
    if (await (await collection('Sessions')).findOne({ _id: input.chatId, ...scope(userId, projectId), deleted: true }, { session })) throw conflict('会话已删除，请新建会话');
    if (await store.findOne({ _id }, { session })) return;
    const pending = await store.find({ ...scope(userId, projectId), chatId: input.chatId, 'input.path': input.input.path,
      state: 'pending', operation: null }, { session }).sort({ createdAt: -1 }).toArray();
    let replaced = [];
    if (input.input.replacesEditId !== undefined) {
      const previous = await replacementTarget(store, userId, projectId, input.input.replacesEditId, session);
      if (previous.input.path !== input.input.path) throw editConflict('edit_target_mismatch', '旧建议属于另一个文件，请核对要续改的建议', { action: 'find_edit_suggestions' });
      try { locateAnchoredEdit(content, previous.input.oldText, previous.input.startLine, previous.proposalAnchor); }
      catch { throw editConflict('edit_source_changed', '旧建议对应的原文已变化，请重新读取正文并核对修改位置', { action: 'read_source', path: input.input.path }); }
      if (!sameEditTarget(content, previous, input.input, true)) throw editConflict('edit_target_mismatch', '本次修改与旧建议不在同一处正文，请重新核对', { action: 'find_edit_suggestions' });
      replaced = [previous];
    } else if (!input.input.keepSeparate) {
      replaced = pending.filter(row => !row.input.keepSeparate && sameEditTarget(content, row, input.input));
      if (new Set(replaced.map(row => row.originChatId || row.chatId)).size > 1)
        throw editConflict('edit_target_ambiguous', '这里有多条独立建议，请先查找并明确要续改哪一条', { action: 'find_edit_suggestions' });
    }
    const id = crypto.randomUUID();
    const first = replaced.at(-1);
    await store.updateOne({ _id }, { $setOnInsert: { _id, ...scope(userId, projectId), ...input,
      id, originChatId: first?.originChatId || first?.chatId || input.chatId,
      replaces: replaced.map(row => row.id), ...(first && { positionedAt: first.positionedAt || first.createdAt }),
      proposalAnchor, state: 'pending', revision: 0, createdAt: new Date(), updatedAt: new Date(), operation: null } }, { upsert: true, session });
    if (replaced.length) await store.updateMany({ _id: { $in: replaced.map(row => row._id) }, state: 'pending', operation: null },
      { $set: { state: 'superseded', supersededBy: id, updatedAt: new Date() }, $inc: { revision: 1 } }, { session });
  });
  const row = await store.findOne({ _id });
  if (JSON.stringify(row.input) !== JSON.stringify(input.input)) throw conflict('同一工具调用已生成不同建议，请重新发起');
  return visible(row);
}

const transitions = { accept: ['pending', 'accepted'], undo: ['accepted', 'undone'], reapply: ['undone', 'accepted'] };

export async function beginEdit(userId, projectId, id, body) {
  const input = z.object({ revision: z.number().int(), action: z.enum(['accept', 'reject', 'undo', 'reapply']), anchor: anchorSchema.optional() }).parse(body);
  const row = await getEdit(userId, projectId, id);
  if (row.revision !== input.revision || row.operation) throw conflict('修改状态已变化，或上次操作尚待核对，请刷新记录');
  const store = await collection('Edits');
  if (input.action === 'reject') {
    if (row.state !== 'pending') throw conflict('只有待确认建议可以拒绝');
    const result = await projectWrite(projectId, session => store.updateOne({ _id: row._id, revision: input.revision, state: 'pending', operation: null }, { $set: { state: 'rejected', updatedAt: new Date() }, $inc: { revision: 1 } }, { session }));
    if (!result.matchedCount) throw conflict('修改状态已更新，请重试');
    return visible(await getEdit(userId, projectId, id));
  }
  const [from, to] = transitions[input.action];
  if (row.state !== from || !input.anchor) throw conflict('当前状态无法执行该操作');
  const before = input.action === 'undo' ? row.input.newText : row.input.oldText;
  const after = input.action === 'undo' ? row.input.oldText : row.input.newText;
  if (input.anchor.before !== before || input.anchor.after !== after) throw new Error('修改内容与原建议不一致');
  const { content } = await readDoc(projectId, row.input.path);
  if (!anchorMatches(content, input.anchor, 'before')) throw conflict('该处正文或相邻上下文已变化，请重新定位修改');
  const operation = { id: crypto.randomUUID(), action: input.action, from, to, anchor: input.anchor, startedAt: new Date() };
  const result = await projectWrite(projectId, session => store.updateOne({ _id: row._id, revision: input.revision, operation: null }, { $set: { operation }, $inc: { revision: 1 } }, { session }));
  if (!result.matchedCount) throw conflict('另一个页面正在处理此建议，请刷新记录');
  return visible(await getEdit(userId, projectId, id));
}

// Both normal completion and reconnect recovery verify the actual project text.
// A lost HTTP response never causes an edit to be replayed automatically.
export async function reconcileEdit(userId, projectId, id, operationId) {
  const row = await getEdit(userId, projectId, id);
  const op = row.operation;
  if (!op || op.id !== operationId) throw conflict('操作已结束，请刷新记录');
  const { content } = await readDoc(projectId, row.input.path);
  const before = anchorMatches(content, op.anchor, 'before');
  const after = anchorMatches(content, op.anchor, 'after');
  if (before === after) throw conflict('当前内容无法安全核对，请保留记录并查看原文差异');
  const store = await collection('Edits');
  const result = await projectWrite(projectId, session => store.updateOne({ _id: row._id, 'operation.id': operationId },
    { $set: { state: after ? op.to : op.from, operation: null, updatedAt: new Date(), ...(after && { lastAnchor: op.anchor }) }, $inc: { revision: 1 } }, { session }));
  if (!result.matchedCount) throw conflict('状态已更新，请重新加载');
  return visible(await getEdit(userId, projectId, id));
}
