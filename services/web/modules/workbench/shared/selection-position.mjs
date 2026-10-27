export function translationDotPosition(rectangle, width, height) {
  const size = 24, gap = 8;
  let x = Math.max(gap, Math.min(rectangle.right - 6, width - size - gap));
  let y = Math.max(gap, Math.min(rectangle.bottom + 1, height - size - gap));
  return { x, y };
}

export function translationPopupPosition(anchor, width, height, measuredHeight = 620) {
  const gap = 12, popupWidth = Math.min(370, Math.max(0, width - gap * 2));
  const maxHeight = Math.max(0, Math.min(620, height * .7, height - gap * 2));
  const popupHeight = Math.min(measuredHeight, maxHeight);
  const below = anchor.y + 24;
  const top = below + popupHeight <= height - gap ? below : anchor.y - popupHeight - 8;
  return { left: Math.max(gap, Math.min(anchor.x, width - popupWidth - gap)),
    top: Math.max(gap, Math.min(top, height - popupHeight - gap)), maxHeight };
}
