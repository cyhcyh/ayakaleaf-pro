const completed = new Set(['output-available', 'output-error', 'output-denied']);
const toolPart = part => part.type?.startsWith('tool-') || part.type === 'dynamic-tool';

export function waitingForReview(messages) {
  return messages.at(-1)?.role === 'assistant' && messages.at(-1).parts.some(part =>
    part.type === 'tool-request_review' && part.state === 'input-available');
}

// Keep completed results. Incomplete tool calls cannot be replayed to a model
// as successful work, or left without the result required by its protocol.
export function interruptTools(messages, note = 'Tool call stopped before execution.', reason = 'Stopped by the user. This operation did not return a completed result.') {
  return messages.map(message => {
    const parts = message.parts.flatMap(part => {
      // No tool ran while its JSON arguments were still arriving. Replaying
      // such a call would send a missing input/arguments field to the provider.
      if (toolPart(part) && (part.state === 'input-streaming' || part.state === 'output-error' && part.input === undefined)) return [];
      return [toolPart(part) && !completed.has(part.state)
        ? { ...part, state: 'output-error', errorText: reason } : part];
    });
    return { ...message, parts: message.role === 'assistant' && !parts.some(part => part.type !== 'step-start')
      ? [...parts, { type: 'text', text: note }] : parts };
  });
}

export function draftText(draft) {
  const references = draft.references?.length
    ? `\n\n<reference-attachments>\n${JSON.stringify(draft.references)}\n</reference-attachments>` : '';
  const context = draft.context;
  if (!context) return draft.text + references;
  const lines = ['<editor-context>', `Open file: ${context.path}`];
  for (const range of context.selection) lines.push(`Selected lines ${range.fromLine}-${range.toLine}:`, range.content);
  lines.push('</editor-context>');
  return `${draft.text}${references}\n\n${lines.join('\n')}`;
}
