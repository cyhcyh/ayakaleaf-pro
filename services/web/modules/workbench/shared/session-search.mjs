export function messageText(message) {
  if (!['user', 'assistant'].includes(message?.role)) return '';
  return (message.parts || []).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
}

export function searchSnippet(text, query) {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return '';
  const start = Math.max(0, index - 35), end = Math.min(text.length, index + query.length + 100);
  return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
}
