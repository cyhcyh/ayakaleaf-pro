// Restored history is readable evidence, never an instruction to resume a tool.
export function restoredMessage(message) {
  return { ...message, parts: message.parts.map(part => {
    if ((part.type?.startsWith('tool-') || part.type === 'dynamic-tool') && !['output-available', 'output-error', 'output-denied'].includes(part.state))
      return { ...part, state: 'output-error', errorText: '上次会话在此处中断，恢复记录未执行该操作。需要时请重新发起。' };
    return part;
  }) };
}

export function mergeSessionContext(stored, incoming, offset, checkpoint) {
  const rows = new Map(stored.map(row => [row.message.id, { order: row.order, message: restoredMessage(row.message) }]));
  incoming.forEach((message, index) => rows.set(message.id, { order: rows.get(message.id)?.order ?? offset + index, message }));
  const cutoff = checkpoint ? rows.get(checkpoint.upToMessageId)?.order : undefined;
  if (checkpoint && cutoff === undefined) throw new Error('会话摘要对应的消息不存在，请重新打开会话');
  const protectedIds = new Set(checkpoint?.protectedFirstIds || []);
  return [...rows.values()].sort((a, b) => a.order - b.order)
    .filter(row => cutoff === undefined || row.order > cutoff || protectedIds.has(row.message.id)).map(row => row.message);
}
