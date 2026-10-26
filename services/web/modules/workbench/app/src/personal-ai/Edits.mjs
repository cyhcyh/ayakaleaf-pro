import crypto from 'node:crypto';
import { z } from 'zod';
import { collection } from './ProfileStore.mjs';
import { readDoc } from '../../../../mcp-server/app/src/FileTools.mjs';
import { anchorMatches, locateEdit, makeAnchor } from '../../../shared/edit-anchor.mjs';

export const proposalSchema = z.object({
  chatId: z.string().uuid(), toolCallId: z.string().min(1).max(150),
  input: z.object({ path: z.string().min(1).max(1000), startLine: z.number().int().min(1), endLine: z.number().int().min(1),
    oldText: z.string().max(100000), newText: z.string().max(100000), reason: z.string().max(5000).optional() }),
});
const anchorSchema = z.object({ before: z.string().max(100000), after: z.string().max(100000), prefix: z.string().max(60), suffix: z.string().max(60), atStart: z.boolean(), atEnd: z.boolean() });
const scope = (userId, projectId) => ({ userId: String(userId), projectId });
const conflict = message => Object.assign(new Error(message), { status: 409 });
const visible = ({ _id, userId, ...row }) => row;

export async function listEdits(userId, projectId, chatId) {
  const rows = await (await collection('Edits')).find({ ...scope(userId, projectId), ...(chatId && { chatId }) }).sort({ createdAt: -1 }).limit(500).toArray();
  return rows.map(visible);
}

async function getEdit(userId, projectId, id) {
  const row = await (await collection('Edits')).findOne({ ...scope(userId, projectId), id });
  if (!row) throw Object.assign(new Error('修改建议不存在或无权访问'), { status: 404 });
  return row;
}
export async function loadEdit(userId, projectId, id) { return visible(await getEdit(userId, projectId, id)); }

export async function proposeEdit(userId, projectId, body) {
  const input = proposalSchema.parse(body);
  if (input.input.oldText === input.input.newText) throw new Error('修改前后内容相同');
  const _id = `${userId}:${projectId}:${input.chatId}:${input.toolCallId}`;
  const store = await collection('Edits');
  const existing = await store.findOne({ _id });
  if (existing) {
    if (JSON.stringify(existing.input) !== JSON.stringify(input.input)) throw conflict('同一工具调用已生成不同建议，请重新发起');
    return visible(existing);
  }
  const { content } = await readDoc(projectId, input.input.path);
  const at = locateEdit(content, input.input.oldText, input.input.startLine);
  const proposalAnchor = makeAnchor(content, at, input.input.oldText, input.input.newText);
  await store.updateOne({ _id }, { $setOnInsert: { _id, ...scope(userId, projectId), ...input,
    id: crypto.randomUUID(), proposalAnchor, state: 'pending', revision: 0, createdAt: new Date(), updatedAt: new Date(), operation: null } }, { upsert: true });
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
    const result = await store.updateOne({ _id: row._id, revision: input.revision, operation: null }, { $set: { state: 'rejected', updatedAt: new Date() }, $inc: { revision: 1 } });
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
  const result = await store.updateOne({ _id: row._id, revision: input.revision, operation: null }, { $set: { operation }, $inc: { revision: 1 } });
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
  const result = await (await collection('Edits')).updateOne({ _id: row._id, 'operation.id': operationId },
    { $set: { state: after ? op.to : op.from, operation: null, updatedAt: new Date(), ...(after && { lastAnchor: op.anchor }) }, $inc: { revision: 1 } });
  if (!result.matchedCount) throw conflict('状态已更新，请重新加载');
  return visible(await getEdit(userId, projectId, id));
}
