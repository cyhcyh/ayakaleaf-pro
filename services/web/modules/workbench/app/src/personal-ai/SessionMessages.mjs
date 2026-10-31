import { z } from 'zod';
import { collection } from './ProfileStore.mjs';
import { restoredMessage, mergeSessionContext } from '../../../shared/session-context.mjs';

const missing = () => Object.assign(new Error('会话不存在或已被删除'), { status: 404 });
export const checkpointSchema = z.object({ summary: z.string().max(500000), upToMessageId: z.string().max(150), protectedFirstIds: z.array(z.string().max(150)).max(500).optional(),
  partial: z.object({ parts: z.number().int().min(0).max(5000) }).optional(),
  prunedToolCallIds: z.array(z.string().max(200)).max(10000).optional() });
export const messageOffsetSchema = z.coerce.number().int().min(0).max(1000000);
export async function sessionRow(userId, projectId, id) {
  id = z.string().uuid().parse(id);
  projectId = z.string().regex(/^[a-f0-9]{24}$/).parse(projectId);
  const row = await (await collection('Sessions')).findOne({ _id: id, userId: String(userId), projectId, deleted: false });
  if (!row) throw missing();
  return row;
}

export async function messagesPage(userId, projectId, id, before) {
  await sessionRow(userId, projectId, id);
  const store = await collection('Messages');
  const filter = { sessionId: id, userId: String(userId), projectId, ...(before !== undefined && { order: { $lt: before } }) };
  // A page starts at a user turn, so tool calls/results remain together.
  const turns = await store.find({ ...filter, 'message.role': 'user' }, { projection: { order: 1 } }).sort({ order: -1 }).limit(20).toArray();
  const start = turns.length === 20 ? turns.at(-1).order : 0;
  const rows = await store.find({ ...filter, order: { $gte: start, ...(before !== undefined && { $lt: before }) } }).sort({ order: 1, _id: 1 }).toArray();
  const offset = rows[0]?.order || 0;
  const older = offset > 0 && await store.findOne({ sessionId: id, userId: String(userId), projectId, order: { $lt: offset } }, { projection: { _id: 1 } });
  return { messages: rows.map(row => restoredMessage(row.message)), messageOffset: offset, olderBefore: older ? offset : null };
}

export async function prepareSessionContext(userId, projectId, input) {
  const id = z.string().uuid().parse(input.id);
  const row = await sessionRow(userId, projectId, id);
  const offset = messageOffsetSchema.parse(input.messageOffset);
  const incoming = z.array(z.object({ id: z.string().min(1).max(150), role: z.enum(['user', 'assistant', 'system']), parts: z.array(z.object({ type: z.string() }).passthrough()) }).passthrough()).parse(input.messages);
  if (new Set(incoming.map(message => message.id)).size !== incoming.length) throw new Error('消息 ID 重复，请重新打开会话');
  const checkpoint = row.contextState?.checkpoint || (input.compaction ? checkpointSchema.parse(input.compaction) : row.summary);
  const store = await collection('Messages');
  const filter = { sessionId: id, userId: String(userId), projectId };
  const cutoff = checkpoint?.upToMessageId && await store.findOne({ ...filter, 'message.id': checkpoint.upToMessageId }, { projection: { order: 1 } });
  // Keep the raw current turn for the tool-call budget and stream continuation.
  const lastUser = cutoff && await store.findOne({ ...filter, 'message.role': 'user' }, { sort: { order: -1 }, projection: { order: 1 } });
  const rows = await store.find({ ...filter, ...(cutoff && { $or: [{ order: { $gte: Math.min(cutoff.order, lastUser?.order ?? cutoff.order) } }, { 'message.id': { $in: checkpoint.protectedFirstIds || [] } }] }) }).sort({ order: 1 }).toArray();
  const rawMessages = mergeSessionContext(rows, incoming, offset, null);
  return { messages: mergeSessionContext(rows, incoming, offset, checkpoint), rawMessages, contextState: row.contextState,
    summary: checkpoint?.summary, compaction: checkpoint || undefined, binding: input.binding === undefined ? row.binding || null : input.binding };
}
