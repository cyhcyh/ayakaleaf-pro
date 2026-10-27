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
  limit = anchor + cards[active].height;
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
