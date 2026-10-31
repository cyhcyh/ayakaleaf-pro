import { interruptTools } from './chat-turn.mjs';
import { projectContext } from './context-checkpoint.mjs';

// Restored history is readable evidence, never an instruction to resume a tool.
export function restoredMessage(message) {
  return interruptTools([message], 'The previous turn stopped before the tool call was complete.',
    '上次会话在此处中断，恢复记录未执行该操作。需要时请重新发起。')[0];
}

export function mergeSessionContext(stored, incoming, offset, checkpoint) {
  const rows = new Map(stored.map(row => [row.message.id, { order: row.order, message: restoredMessage(row.message) }]));
  incoming.forEach((message, index) => rows.set(message.id, { order: rows.get(message.id)?.order ?? offset + index, message }));
  return projectContext([...rows.values()].sort((a, b) => a.order - b.order).map(row => row.message), checkpoint);
}
