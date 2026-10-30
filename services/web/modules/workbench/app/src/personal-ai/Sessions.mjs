import crypto from 'node:crypto';
import { z } from 'zod';
import Mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs';
import { collection } from './ProfileStore.mjs';
import { projectWrite } from './WorkspaceLifecycle.mjs';
import { messageText, searchSnippet } from '../../../shared/session-search.mjs';
import { restoredMessage } from '../../../shared/session-context.mjs';
import { messagesPage } from './SessionMessages.mjs';
import { validateSessionBinding } from './Runtime.mjs';
import { selectionSchema } from './Pure.mjs';
import { outboxSchema } from './QueueSchema.mjs';
import { stopChatRuns } from './ActiveChatRuns.mjs';

const message = z.object({
  order: z.number().int().min(0).max(1000000),
  message: z.object({ id: z.string().min(1).max(150), role: z.enum(['user', 'assistant', 'system']), parts: z.array(z.object({ type: z.string().min(1).max(100) }).passthrough()).max(5000) }).passthrough()
    .refine(value => Buffer.byteLength(JSON.stringify(value)) <= 9 * 1024 * 1024, '单条消息内容过大'),
});
export const saveSessionSchema = z.object({
  revision: z.number().int().min(0),
  messages: z.array(message).max(500),
  summary: z.object({ summary: z.string().max(500000), upToMessageId: z.string().max(150), protectedFirstIds: z.array(z.string()).optional() }).nullable().optional(),
  binding: selectionSchema.nullable().optional(),
  outbox: outboxSchema.optional(),
});
const missing = () => Object.assign(new Error('会话不存在或已被删除'), { status: 404 });
const conflict = () => Object.assign(new Error('会话已在其他页面更新，请重新打开会话后继续'), { status: 409 });
const scope = (userId, projectId) => ({ userId: String(userId), projectId, deleted: false });
// An empty current draft is ready for the next message, not a history entry.
const visibleHistory = { $or: [{ named: true }, { autoTitle: false }, { hasContent: true }, { hasQueued: true }] };

export async function listSessions(userId, projectId, query = '', cursor) {
  const store = await collection('Sessions');
  const filter = { ...scope(userId, projectId), $and: [visibleHistory] };
  if (cursor) {
    const value = z.object({ date: z.string().datetime(), id: z.string().uuid() }).parse(JSON.parse(cursor));
    filter.$or = [{ updatedAt: { $lt: new Date(value.date) } }, { updatedAt: new Date(value.date), _id: { $lt: value.id } }];
  }
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = { $regex: literal, $options: 'i' };
  const found = query ? await store.aggregate([
    { $match: filter },
    { $lookup: { from: 'personalAiMessages', let: { chat: '$_id' }, pipeline: [
      { $match: { userId: String(userId), projectId, $expr: { $eq: ['$sessionId', '$$chat'] },
        'message.role': { $in: ['user', 'assistant'] }, 'message.parts': { $elemMatch: { type: 'text', text: match } } } },
      { $sort: { order: 1 } }, { $limit: 1 }, { $project: { message: 1 } },
    ], as: 'hits' } },
    { $match: { $or: [{ title: match }, { 'hits.0': { $exists: true } }] } },
    { $sort: { updatedAt: -1, _id: -1 } }, { $limit: 51 },
    { $project: { summary: 0, userId: 0, deleted: 0, outbox: 0 } },
  ]).toArray() : await store.find(filter, { projection: { summary: 0, userId: 0, deleted: 0, outbox: 0 } }).sort({ updatedAt: -1, _id: -1 }).limit(51).toArray();
  const items = found.slice(0, 50).map(({ _id, hits, ...item }) => ({ id: _id, ...item,
    ...(hits?.[0] && { snippet: searchSnippet(messageText(hits[0].message), query) }),
  }));
  const last = items.at(-1);
  return { items, next: found.length > 50 ? JSON.stringify({ date: last.updatedAt.toISOString(), id: last.id }) : null };
}

export async function createSession(userId, projectId) {
  const row = { _id: crypto.randomUUID(), ...scope(userId, projectId), title: '新会话', autoTitle: true,
    createdAt: new Date(), updatedAt: new Date(), revision: 0, summary: null };
  await projectWrite(projectId, async session => {
    await (await collection('Sessions')).insertOne(row, { session });
    await (await collection('ActiveSessions')).updateOne({ _id: `${userId}:${projectId}` }, { $set: { sessionId: row._id, userId: String(userId), projectId } }, { upsert: true, session });
  });
  return { id: row._id, projectId, title: row.title, revision: 0, messages: [], messageOffset: 0, olderBefore: null, summary: null, binding: null, outbox: [] };
}

export async function activateSession(userId, projectId, id) {
  await projectWrite(projectId, async session => {
    if (!await (await collection('Sessions')).findOne({ _id: id, ...scope(userId, projectId) }, { session })) throw missing();
    await (await collection('ActiveSessions')).updateOne({ _id: `${userId}:${projectId}` }, { $set: { sessionId: id, userId: String(userId), projectId } }, { upsert: true, session });
  });
  return { ok: true };
}

export async function loadSession(userId, projectId, id, paged = false) {
  const row = await (await collection('Sessions')).findOne({ _id: id, ...scope(userId, projectId) });
  if (!row) throw missing();
  await activateSession(userId, projectId, id);
  const page = paged ? await messagesPage(userId, projectId, id) : {
    messages: (await (await collection('Messages')).find({ sessionId: id, userId: String(userId), projectId }).sort({ order: 1, _id: 1 }).toArray()).map(row => restoredMessage(row.message)),
    messageOffset: 0, olderBefore: null,
  };
  // A user message and removal from the queue can be saved in different batches.
  // Its stable id prevents replay if a page closes between those batches.
  const outbox = row.outbox || [];
  const delivered = outbox.length ? await (await collection('Messages')).distinct('message.id', {
    sessionId: id, userId: String(userId), projectId, 'message.role': 'user', 'message.id': { $in: outbox.map(item => item.id) },
  }) : [];
  return { id, projectId, title: row.title, revision: row.revision, ...page, summary: row.summary, binding: row.binding || null,
    outbox: outbox.filter(item => !delivered.includes(item.id)) };
}

export async function saveSession(userId, projectId, id, body) {
  const input = saveSessionSchema.parse(body);
  if (input.binding) input.binding = await validateSessionBinding(userId, input.binding);
  const store = await collection('Sessions');
  const messages = await collection('Messages');
  return await projectWrite(projectId, async transaction => {
      const row = await store.findOne({ _id: id, ...scope(userId, projectId) }, { session: transaction });
      if (!row) throw missing();
      if (row.revision !== input.revision) throw conflict();
      const firstUser = input.messages.find(item => item.message.role === 'user');
      const title = row.autoTitle && !row.named && firstUser
        ? firstUser.message.parts.filter(p => p.type === 'text').map(p => String(p.text || '').split('<editor-context>')[0].split('<reference-attachments>')[0]).join(' ').trim().slice(0, 60) || row.title
        : row.title;
      if (input.messages.length) await messages.bulkWrite(input.messages.map(item => ({ updateOne: {
        filter: { _id: `${id}:${item.message.id}` }, update: { $set: { ...item, sessionId: id, userId: String(userId), projectId } }, upsert: true,
      } })), { session: transaction });
      await store.updateOne({ _id: id, revision: input.revision }, { $set: {
        updatedAt: new Date(), title, ...(firstUser && { named: true }), ...(input.summary !== undefined && { summary: input.summary }),
        ...(input.messages.length && { hasContent: true }),
        ...(input.binding !== undefined && { binding: input.binding }),
        ...(input.outbox !== undefined && { outbox: input.outbox, hasQueued: input.outbox.length > 0 }),
      }, $inc: { revision: 1 } }, { session: transaction });
      return { revision: input.revision + 1, title };
  });
}

export async function currentSession(userId, projectId, paged = false) {
  const active = await (await collection('ActiveSessions')).findOne({ _id: `${userId}:${projectId}` });
  const sessions = await collection('Sessions');
  const row = active && await sessions.findOne({ _id: active.sessionId, ...scope(userId, projectId) })
    || await sessions.findOne(scope(userId, projectId), { sort: { updatedAt: -1 } });
  return row ? await loadSession(userId, projectId, row._id, paged) : await createSession(userId, projectId);
}

export async function renameSession(userId, projectId, id, title) {
  return await projectWrite(projectId, async session => {
  const result = await (await collection('Sessions')).updateOne({ _id: id, ...scope(userId, projectId) },
    { $set: { title: z.string().trim().min(1).max(100).parse(title), autoTitle: false, updatedAt: new Date() }, $inc: { revision: 1 } }, { session });
  if (!result.matchedCount) throw missing();
  const row = await (await collection('Sessions')).findOne({ _id: id, ...scope(userId, projectId) }, { session });
  return { ok: true, revision: row.revision };
  });
}

export const clearScopeSchema = z.enum(['project', 'all']);
const historyScope = (userId, projectId, range) => ({ userId: String(userId), ...(range === 'project' && { projectId }) });

export async function historyCount(userId, projectId, range) {
  return { count: await (await collection('Sessions')).countDocuments({ ...historyScope(userId, projectId, range), deleted: false, $and: [visibleHistory] }) };
}

export async function clearHistory(userId, projectId, range) {
  const filter = historyScope(userId, projectId, range);
  const session = Mongoose.connection.getClient().startSession();
  try {
    const result = await session.withTransaction(async () => {
      stopChatRuns(userId, range === 'project' ? projectId : undefined);
      const projects = await (await collection('Sessions')).distinct('projectId', filter, { session });
      await (await collection('ProjectState')).updateMany({ _id: { $in: projects } }, { $inc: { revision: 1 } }, { session });
      const result = await (await collection('Sessions')).updateMany({ ...filter, deleted: false },
        { $set: { deleted: true, title: '', summary: null, outbox: [], hasQueued: false, updatedAt: new Date() }, $inc: { revision: 1 } }, { session });
      await (await collection('Messages')).deleteMany(filter, { session });
      await (await collection('Reviews')).updateMany(filter, { $set: { stopped: true } }, { session });
      await (await collection('ActiveSessions')).deleteMany(range === 'project'
        ? { _id: `${userId}:${projectId}` }
        : { $or: [{ userId: String(userId) }, { _id: { $regex: `^${String(userId)}:` } }] }, { session });
      return { deleted: result.modifiedCount };
    });
    stopChatRuns(userId, range === 'project' ? projectId : undefined);
    return result;
  } finally { await session.endSession(); }
}

export async function deleteSessions(userId, projectId, ids) {
  const identifiers = z.array(z.string().uuid()).min(1).max(100).parse(ids);
  const store = await collection('Sessions');
  const messages = await collection('Messages');
  const reviews = await collection('Reviews');
  const result = await projectWrite(projectId, async transaction => {
      const owned = await store.find({ _id: { $in: identifiers }, ...scope(userId, projectId) }, { session: transaction }).toArray();
      if (owned.length !== new Set(identifiers).size) throw missing();
      stopChatRuns(userId, projectId, identifiers);
      await store.updateMany({ _id: { $in: identifiers }, ...scope(userId, projectId) },
        { $set: { deleted: true, title: '', summary: null, outbox: [], hasQueued: false, updatedAt: new Date() }, $inc: { revision: 1 } }, { session: transaction });
      await messages.deleteMany({ sessionId: { $in: identifiers }, userId: String(userId), projectId }, { session: transaction });
      await reviews.updateMany({ chatId: { $in: identifiers }, userId: String(userId), projectId }, { $set: { stopped: true } }, { session: transaction });
      return { deleted: identifiers.length };
  });
  stopChatRuns(userId, projectId, identifiers);
  return result;
}
