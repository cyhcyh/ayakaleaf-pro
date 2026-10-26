export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const cjk = (text.match(/[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g) || []).length;
  return cjk + Math.ceil((text.length - cjk) / 3);
}

export function messageCost(message) {
  return 16 + (message.parts || []).reduce((sum, part) => {
    if (part.type === 'file' || part.type === 'tool-render_pdf_page') return sum + 1500;
    return sum + estimateTokens(part);
  }, 0);
}

export function turns(messages) {
  const groups = [];
  for (const message of messages) {
    if (message.role === 'user' || !groups.length) groups.push([]);
    groups.at(-1).push(message);
  }
  return groups;
}

// Protect complete turns, so a tool call is never separated from its result.
export function splitForCompression(messages, protectFirst, protectLast) {
  const groups = turns(messages);
  let first = 0, count = 0;
  while (first < groups.length - 1 && count < protectFirst) count += groups[first++].length;
  let last = groups.length, tail = 0;
  while (last > first && (tail < protectLast || last === groups.length)) tail += groups[--last].length;
  return { head: groups.slice(0, first).flat(), foldable: groups.slice(first, last), tail: groups.slice(last).flat() };
}
