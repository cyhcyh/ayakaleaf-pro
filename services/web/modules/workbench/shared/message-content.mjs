// Stored user text also carries reference and editor snapshots. Message
// actions expose only the written text and preserve those snapshots on edit.
export function splitUserText(text) {
  const starts = ['<reference-attachments>', '<editor-context>'].map(tag => text.indexOf(tag)).filter(at => at >= 0);
  const at = starts.length ? Math.min(...starts) : text.length;
  return { text: text.slice(0, at).trimEnd(), context: text.slice(at) };
}

export function messageBody(message) {
  return (message.parts || []).filter(part => part.type === 'text').map(part =>
    message.role === 'user' ? splitUserText(part.text).text : part.text).join('\n\n');
}

export function replaceUserText(message, text) {
  const context = message.parts.filter(part => part.type === 'text').map(part => splitUserText(part.text).context).filter(Boolean).join('\n\n');
  const replacement = { type: 'text', text: text + (context ? '\n\n' + context : '') };
  let inserted = false;
  const parts = message.parts.flatMap(part => {
    if (part.type !== 'text') return [part];
    if (inserted) return [];
    inserted = true;
    return [replacement];
  });
  if (!inserted) parts.unshift(replacement);
  return { ...message, parts };
}

// A summary may contain anything through its boundary, including preferences
// from protected first messages. Editing at/before that boundary invalidates it.
export function contextAfterEdit(rows, targetOrder, state, summary) {
  let checkpoint = state ? state.checkpoint : summary || null;
  if (checkpoint?.upToMessageId) {
    const boundary = rows.find(row => row.message.id === checkpoint.upToMessageId);
    if (!boundary || targetOrder <= boundary.order) checkpoint = null;
  }
  const kept = rows.filter(row => row.order < targetOrder);
  const ids = new Set(kept.map(row => row.message.id));
  const calls = new Set(kept.flatMap(row => row.message.parts.map(part => part.toolCallId).filter(Boolean)));
  if (checkpoint) checkpoint = { ...checkpoint,
    ...(checkpoint.protectedFirstIds && { protectedFirstIds: checkpoint.protectedFirstIds.filter(id => ids.has(id)) }),
    ...(checkpoint.prunedToolCallIds && { prunedToolCallIds: checkpoint.prunedToolCallIds.filter(id => calls.has(id)) }),
  };
  return { version: 1, checkpoint, usage: { anchor: null,
    estimates: (state?.usage?.estimates || []).filter(entry => ids.has(entry.key.replace(/:(?:role|\d+)(?::input)?$/, ''))) } };
}
