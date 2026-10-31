// A checkpoint changes model input only. Display/history messages stay intact.
export function projectContext(messages, checkpoint) {
  if (!checkpoint) return messages;
  const cutoff = checkpoint.upToMessageId
    ? messages.findIndex(message => message.id === checkpoint.upToMessageId) : -1;
  if (checkpoint.upToMessageId && cutoff < 0) throw new Error('会话摘要对应的消息不存在，请重新打开会话');
  const protectedIds = new Set(checkpoint.protectedFirstIds || []);
  const pruned = new Set(checkpoint.prunedToolCallIds || []);
  return messages.flatMap((message, index) => {
    const partial = index === cutoff && checkpoint.partial;
    if (index <= cutoff && !partial && !protectedIds.has(message.id)) return [];
    const offset = partial ? partial.parts : 0;
    if (offset > message.parts.length) throw new Error('会话摘要对应的步骤已变化，请重新打开会话');
    const parts = message.parts.slice(offset).map(part => pruned.has(part.toolCallId) ? {
      ...part, output: { contextOmitted: true,
        source: part.input?.path || part.input?.url || part.type,
        note: 'Older tool output omitted to save context. Read the source again for exact content.' },
    } : part);
    return parts.length ? [{ ...message, parts, contextPartOffset: offset }] : [];
  });
}

export const isContextTool = part => part.type?.startsWith('tool-') || part.type === 'dynamic-tool';
export const isCompletedTool = part => isContextTool(part) && ['output-available', 'output-error', 'output-denied'].includes(part.state);

// SDK step-start markers delimit parallel tool groups. Every tool's input and
// result live in the same UI part, and a whole step is always moved together.
export function contextUnits(messages) {
  return messages.flatMap(message => {
    const offset = message.contextPartOffset || 0;
    if (message.role !== 'assistant') return [{ message, start: offset, end: offset + message.parts.length, parts: message.parts, complete: true }];
    const result = [];
    const marked = message.parts.some(part => part.type === 'step-start');
    let start = 0;
    const push = end => {
      const parts = message.parts.slice(start, end);
      if (parts.some(part => part.type !== 'step-start')) result.push({ message, start: offset + start, end: offset + end, parts,
        complete: parts.every(part => !isContextTool(part) || isCompletedTool(part)) });
      start = end;
    };
    message.parts.forEach((part, index) => {
      if (part.type === 'step-start' && index > start) push(index);
      // Older histories may predate SDK step markers. Each completed tool UI
      // part still contains its own call/result, and is an atomic boundary.
      if (!marked && isCompletedTool(part)) push(index + 1);
    });
    push(message.parts.length);
    return result;
  });
}

export function checkpointAfter(messages, previous, selected, summary) {
  const boundary = selected.at(-1);
  const at = messages.findIndex(message => message.id === boundary.message.id);
  const removed = new Set(selected.filter(unit => unit.end === unit.message.parts.length + (unit.message.contextPartOffset || 0))
    .map(unit => unit.message.id));
  const protectedFirstIds = messages.slice(0, at).filter(message => !removed.has(message.id)).map(message => message.id);
  return { summary, upToMessageId: boundary.message.id, protectedFirstIds,
    ...(boundary.message.role === 'assistant' && { partial: { parts: boundary.end } }),
    ...(previous?.prunedToolCallIds?.length && { prunedToolCallIds: previous.prunedToolCallIds }) };
}
