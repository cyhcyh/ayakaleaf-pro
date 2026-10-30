import { locateAnchoredEdit, locateEdit } from './edit-anchor.mjs';

export function sameEditTarget(content, previous, next, allowOverlap = false) {
  if (previous.state !== 'pending' || previous.operation || previous.input.path !== next.path) return false;
  try {
    const before = locateAnchoredEdit(content, previous.input.oldText, previous.input.startLine, previous.proposalAnchor);
    const after = locateEdit(content, next.oldText, next.startLine);
    if (before === after && previous.input.oldText === next.oldText) return true;
    if (!allowOverlap) return false;
    const endBefore = before + previous.input.oldText.length, endAfter = after + next.oldText.length;
    return Math.max(before, after) < Math.min(endBefore, endAfter)
      || (before === endBefore && before >= after && before <= endAfter)
      || (after === endAfter && after >= before && after <= endBefore);
  } catch { return false; }
}

// Legacy duplicates must have a reliable, identical source anchor. Line
// numbers alone cannot distinguish a revision from an unrelated suggestion.
export function legacyEditGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.state !== 'pending' || row.operation || row.input.keepSeparate || !row.proposalAnchor) continue;
    const { prefix, suffix, atStart, atEnd } = row.proposalAnchor;
    const key = JSON.stringify([row.originChatId || row.chatId, row.input.path, row.input.oldText, prefix, suffix, atStart, atEnd]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].filter(group => group.length > 1)
    .map(group => group.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
}
