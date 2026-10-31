import { z } from 'zod';
import { collection } from './ProfileStore.mjs';
import { projectWrite } from './WorkspaceLifecycle.mjs';
import { stopChatRuns } from './ActiveChatRuns.mjs';
import { messagesPage } from './SessionMessages.mjs';
import { contextAfterEdit, replaceUserText } from '../../../shared/message-content.mjs';

const schema = z.object({ revision: z.number().int().min(0), historyVersion: z.number().int().min(0).default(0),
  messageId: z.string().min(1).max(150), text: z.string().max(500000) });
const conflict = () => Object.assign(new Error('会话已在其他页面更新，请重新打开会话后继续'), { status: 409 });

export async function editSessionMessage(userId, projectId, id, body) {
  const input = schema.parse(body);
  const filter = { sessionId: id, userId: String(userId), projectId };
  const state = await projectWrite(projectId, async transaction => {
    const sessions = await collection('Sessions'), messages = await collection('Messages');
    const row = await sessions.findOne({ _id: id, userId: String(userId), projectId, deleted: false }, { session: transaction });
    if (!row) throw Object.assign(new Error('会话不存在或已被删除'), { status: 404 });
    if (row.revision !== input.revision || (row.historyVersion || 0) !== input.historyVersion) throw conflict();
    const target = await messages.findOne({ ...filter, 'message.id': input.messageId }, { session: transaction });
    if (!target || target.message.role !== 'user') throw Object.assign(new Error('只能编辑自己发送的消息'), { status: 400 });
    // Boundaries/cache metadata need ids and tool ids, not copies of every
    // historical file output or image in this potentially long conversation.
    const rows = await messages.find(filter, { session: transaction,
      projection: { order: 1, 'message.id': 1, 'message.parts.toolCallId': 1 } }).sort({ order: 1 }).toArray();
    const message = replaceUserText(target.message, input.text);
    if (!input.text.trim() && !message.parts.some(part => part.type === 'file' || part.type === 'text' && part.text.includes('<reference-attachments>')))
      throw new Error('消息不能为空');
    if (Buffer.byteLength(JSON.stringify(message)) > 9 * 1024 * 1024) throw new Error('单条消息内容过大');
    const contextState = contextAfterEdit(rows, target.order, row.contextState, row.summary);
    stopChatRuns(userId, projectId, [id]);
    await messages.deleteMany({ ...filter, order: { $gt: target.order } }, { session: transaction });
    await messages.updateOne({ _id: target._id, ...filter }, { $set: { message } }, { session: transaction });
    await (await collection('Reviews')).updateMany({ userId: String(userId), projectId, chatId: id }, { $set: { stopped: true } }, { session: transaction });
    const historyVersion = (row.historyVersion || 0) + 1;
    await sessions.updateOne({ _id: id, revision: input.revision }, { $set: { summary: contextState.checkpoint, contextState, contextRunId: null,
      historyVersion, updatedAt: new Date() }, $inc: { revision: 1 } }, { session: transaction });
    return { title: row.title, revision: input.revision + 1, historyVersion, summary: contextState.checkpoint, binding: row.binding || null, outbox: row.outbox || [] };
  });
  stopChatRuns(userId, projectId, [id]);
  return { id, projectId, ...state, ...await messagesPage(userId, projectId, id) };
}
