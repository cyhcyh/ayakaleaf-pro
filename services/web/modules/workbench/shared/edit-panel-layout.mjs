// Match the native review gutter's source order and spacing, while keeping
// layout state local to the AI panel (the review panel has its own selection).
export function layoutEditCards(cards, focusedId, minimumTop = 44) {
  const positions = new Map();
  if (!cards.length) return { positions, bottom: minimumTop };
  let active = cards.findIndex(card => card.id === focusedId);
  if (active < 0) active = 0;
  const topOf = card => Math.max(minimumTop, card.top);
  const anchor = topOf(cards[active]);
  positions.set(cards[active].id, anchor);
  let limit = anchor;
  for (let i = active - 1; i >= 0; i--) {
    const top = Math.min(topOf(cards[i]), limit - cards[i].height - 4);
    positions.set(cards[i].id, top);
    limit = top;
  }
  // Dense suggestions may push the preceding cards above the scrollable area.
  // Move the group down before placing the remaining cards so every card stays
  // reachable below the filter bar, including after expansion or navigation.
  const shift = Math.max(0, minimumTop - positions.get(cards[0].id));
  if (shift) {
    for (const [id, top] of positions) positions.set(id, top + shift);
  }
  limit = positions.get(cards[active].id) + cards[active].height;
  for (let i = active + 1; i < cards.length; i++) {
    const top = Math.max(topOf(cards[i]), limit + 4);
    positions.set(cards[i].id, top);
    limit = top + cards[i].height;
  }
  return { positions, bottom: limit };
}

export function revealEditDelta(cardTop, cardHeight, visibleTop, visibleBottom) {
  if (cardTop < visibleTop || cardHeight > visibleBottom - visibleTop) return cardTop - visibleTop;
  return Math.max(0, cardTop + cardHeight - visibleBottom);
}

// Match review-panel navigation: any visible part of a card hides both
// buttons. Callers pass only cards from the active file/status filter.
export function offscreenEditTargets(cards, visibleTop, visibleBottom) {
  const none = { above: null, below: null };
  if (visibleBottom <= visibleTop) return none;
  let above, below;
  for (const card of cards) {
    const bottom = card.top + card.height;
    if (bottom > visibleTop && card.top < visibleBottom) return none;
    if (bottom <= visibleTop && (!above || bottom > above.top + above.height)) above = card;
    if (card.top >= visibleBottom && (!below || card.top < below.top)) below = card;
  }
  return { above: above?.id ?? null, below: below?.id ?? null };
}

export function groupEditsByFile(items) {
  const files = new Map();
  for (const item of items) {
    const path = item.input.path;
    if (!files.has(path)) files.set(path, []);
    files.get(path).push(item);
  }
  return [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, entries]) => ({ path,
    items: entries.sort((a, b) => a.input.startLine - b.input.startLine) }));
}
