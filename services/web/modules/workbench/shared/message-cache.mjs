// Live state and the history browser each keep about one page/16 MiB.
// Whole turns, visible content and unsaved/live work may exceed this soft budget.
export const CACHE_TURNS = 20;
export const CACHE_BYTES = 16 * 1024 * 1024;
export const PAGE_BYTES = 8 * 1024 * 1024;
const sizes = new WeakMap();
export function messageBytes(message, known) {
  if (known !== undefined) sizes.set(message, known);
  if (!sizes.has(message)) sizes.set(message, new TextEncoder().encode(JSON.stringify(message)).byteLength);
  return sizes.get(message);
}

export function messageTurns(messages) {
  const turns = [];
  messages.forEach((message, index) => {
    if (!turns.length || message.role === 'user') turns.push({ start: index, end: index, bytes: 0 });
    const turn = turns.at(-1);
    turn.end = index + 1;
    turn.bytes += messageBytes(message);
  });
  return turns;
}

// A contiguous window preserves the global message offsets used by autosave.
/**
 * @param {any[]} messages
 * @param {number} offset
 * @param {{direction?: 'older' | 'newer', keepIds?: string[], maxTurns?: number, maxBytes?: number}} [options]
 */
export function trimMessageWindow(messages, offset, { direction = 'older', keepIds = [], maxTurns = CACHE_TURNS, maxBytes = CACHE_BYTES } = {}) {
  const turns = messageTurns(messages);
  if (!turns.length) return { messages, messageOffset: offset, removedBefore: false, removedAfter: false };
  const pinned = new Set(keepIds);
  const indices = turns.flatMap((turn, i) => messages.slice(turn.start, turn.end).some(message => pinned.has(message.id)) ? [i] : []);
  let first = indices.length ? indices[0] : direction === 'older' ? 0 : turns.length - 1;
  let last = indices.length ? indices.at(-1) : first;
  let bytes = turns.slice(first, last + 1).reduce((total, turn) => total + turn.bytes, 0);
  const add = side => {
    const next = side === 'older' ? first - 1 : last + 1;
    if (next < 0 || next >= turns.length || last - first + 1 >= maxTurns || bytes + turns[next].bytes > maxBytes) return false;
    bytes += turns[next].bytes;
    if (side === 'older') first = next; else last = next;
    return true;
  };
  while (add(direction)) { /* Fill towards the user's navigation first. */ }
  while (add(direction === 'older' ? 'newer' : 'older')) { /* Keep nearby content. */ }
  const start = turns[first].start, end = turns[last].end;
  return { messages: start === 0 && end === messages.length ? messages : messages.slice(start, end),
    messageOffset: offset + start, removedBefore: start > 0, removedAfter: end < messages.length };
}

export function mergeMessagePages(first, second) {
  const rows = new Map();
  for (const page of [first, second]) page.messages.forEach((message, index) => rows.set(message.id, { message, order: page.messageOffset + index }));
  const ordered = [...rows.values()].sort((a, b) => a.order - b.order);
  return { messages: ordered.map(row => row.message), messageOffset: ordered[0]?.order ?? first.messageOffset };
}

// Read whole turns from a Mongo cursor without materializing the entire history.
export async function collectMessagePage(cursor, direction, { maxTurns = CACHE_TURNS, maxBytes = PAGE_BYTES } = {}) {
  const page = [];
  let turn = [], turnBytes = 0, bytes = 0, count = 0;
  const finish = () => {
    if (!turn.length) return true;
    if (page.length && (count >= maxTurns || bytes + turnBytes > maxBytes)) return false;
    page.push(...turn); bytes += turnBytes; count++;
    turn = []; turnBytes = 0;
    return true;
  };
  for await (const row of cursor) {
    if (direction === 1 && row.message.role === 'user' && !finish()) break;
    if (direction === 1 && !turn.length && count >= maxTurns) break;
    turn.push(row); turnBytes += messageBytes(row.message);
    if (direction === -1 && row.message.role === 'user') {
      if (!finish() || count >= maxTurns || bytes >= maxBytes) break;
    }
  }
  // The rejected turn is deliberately left for the next page.
  if (turn.length && (!page.length || count < maxTurns && bytes + turnBytes <= maxBytes)) finish();
  return direction === -1 ? page.reverse() : page;
}
