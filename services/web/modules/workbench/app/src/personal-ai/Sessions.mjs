import crypto from 'node:crypto';
import { z } from 'zod';
import Mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs';
import { collection } from './ProfileStore.mjs';

const message = z.object({
  order: z.number().int().min(0).max(1000000),
  message: z.object({ id: z.string().min(1).max(150), role: z.enum(['user', 'assistant', 'system']), parts: z.array(z.object({ type: z.string().min(1).max(100) }).passthrough()).max(300) }).passthrough()
    .refine(value => Buffer.byteLength(JSON.stringify(value)) <= 9 * 1024 * 1024, '单条消息内容过大'),
});
export const saveSessionSchema = z.object({
  revision: z.number().int().min(0),
  messages: z.array(message).max(500),
  summary: z.object({ summary: z.string().max(500000), upToMessageId: z.string().max(150), protectedFirstIds: z.array(z.string()).optional() }).nullable().optional(),
});
const missing = () => Object.assign(new Error('会话不存在或已被删除'), { status: 404 });
const conflict = () => Object.assign(new Error('会话已在其他页面更新，请重新打开会话后继续'), { status: 409 });
const scope = (userId, projectId) => ({ userId: String(userId), projectId, deleted: false });

export async function listSessions(userId, projectId, query = '', cursor) {
  const store = await collection('Sessions');
  const filter = scope(userId, projectId);
  if (query) filter.title = { $regex: query.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (cursor) {
    const value = z.object({ date: z.string().datetime(), id: z.string().uuid() }).parse(JSON.parse(cursor));
    filter.$or = [{ updatedAt: { $lt: new Date(value.date) } }, { updatedAt: new Date(value.date), _id: { $lt: value.id } }];
  }
  const found = await store.find(filter, { projection: { summary: 0, userId: 0, deleted: 0 } }).sort({ updatedAt: -1, _id: -1 }).limit(51).toArray();
  const items = found.slice(0, 50).map(({ _id, ...item }) => ({ id: _id, ...item }));
  const last = items.at(-1);
  return { items, next: found.length > 50 ? JSON.stringify({ date: last.updatedAt.toISOString(), id: last.id }) : null };
}

export async function createSession(userId, projectId) {
  const row = { _id: crypto.randomUUID(), ...scope(userId, projectId), title: '新会话', autoTitle: true,
    createdAt: new Date(), updatedAt: new Date(), revision: 0, summary: null };
  await (await collection('Sessions')).insertOne(row);
  await (await collection('ActiveSessions')).updateOne({ _id: `${userId}:${projectId}` }, { $set: { sessionId: row._id } }, { upsert: true });
  return { id: row._id, projectId, title: row.title, revision: 0, messages: [], summary: null };
}

export async function loadSession(userId, projectId, id) {
  const row = await (await collection('Sessions')).findOne({ _id: id, ...scope(userId, projectId) });
  if (!row) throw missing();
  await (await collection('ActiveSessions')).updateOne({ _id: `${userId}:${projectId}` }, { $set: { sessionId: id } }, { upsert: true });
  const messages = await (await collection('Messages')).find({ sessionId: id, userId: String(userId), projectId }).sort({ order: 1, _id: 1 }).toArray();
  // Loading never resumes interrupted tools or carries a review authorization.
  const restored = messages.map(({ message }) => ({ ...message, parts: message.parts.map(part => {
    if ((part.type?.startsWith('tool-') || part.type === 'dynamic-tool') && !['output-available', 'output-error', 'output-denied'].includes(part.state)) {
      return { ...part, state: 'output-error', errorText: '上次会话在此处中断，恢复记录未执行该操作。需要时请重新发起。' };
    }
    return part;
  }) }));
  return { id, projectId, title: row.title, revision: row.revision, messages: restored, summary: row.summary };
}

export async function saveSession(userId, projectId, id, body) {
  const input = saveSessionSchema.parse(body);
  const store = await collection('Sessions');
  const messages = await collection('Messages');
  const transaction = Mongoose.connection.getClient().startSession();
  try {
    return await transaction.withTransaction(async () => {
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
      }, $inc: { revision: 1 } }, { session: transaction });
      return { revision: input.revision + 1, title };
    });
  } finally { await transaction.endSession(); }
}

export async function currentSession(userId, projectId) {
  const active = await (await collection('ActiveSessions')).findOne({ _id: `${userId}:${projectId}` });
  const sessions = await collection('Sessions');
  const row = active && await sessions.findOne({ _id: active.sessionId, ...scope(userId, projectId) })
    || await sessions.findOne(scope(userId, projectId), { sort: { updatedAt: -1 } });
  return row ? await loadSession(userId, projectId, row._id) : await createSession(userId, projectId);
}

export async function renameSession(userId, projectId, id, title) {
  const result = await (await collection('Sessions')).updateOne({ _id: id, ...scope(userId, projectId) },
    { $set: { title: z.string().trim().min(1).max(100).parse(title), autoTitle: false, updatedAt: new Date() }, $inc: { revision: 1 } });
  if (!result.matchedCount) throw missing();
  return { ok: true };
}

export async function deleteSessions(userId, projectId, ids) {
  const identifiers = z.array(z.string().uuid()).min(1).max(100).parse(ids);
  const store = await collection('Sessions');
  const messages = await collection('Messages');
  const reviews = await collection('Reviews');
  const transaction = Mongoose.connection.getClient().startSession();
  try {
    return await transaction.withTransaction(async () => {
      const owned = await store.find({ _id: { $in: identifiers }, ...scope(userId, projectId) }, { session: transaction }).toArray();
      if (owned.length !== new Set(identifiers).size) throw missing();
      await store.updateMany({ _id: { $in: identifiers }, ...scope(userId, projectId) },
        { $set: { deleted: true, title: '', summary: null, updatedAt: new Date() }, $inc: { revision: 1 } }, { session: transaction });
      await messages.deleteMany({ sessionId: { $in: identifiers }, userId: String(userId), projectId }, { session: transaction });
      await reviews.updateMany({ chatId: { $in: identifiers }, userId: String(userId), projectId }, { $set: { stopped: true } }, { session: transaction });
      return { deleted: identifiers.length };
    });
  } finally { await transaction.endSession(); }
}
