export function translationDotPosition(rectangle, width, height, obstacles = []) {
  const size = 24, gap = 8;
  let x = Math.max(gap, Math.min(rectangle.right - 6, width - size - gap));
  let y = Math.max(gap, Math.min(rectangle.bottom - 12, height - size - gap));
  for (const box of obstacles) {
    if (!box.width || !box.height) continue;
    if (x < box.right + gap && x + size > box.left - gap && y < box.bottom + gap && y + size > box.top - gap) {
      if (box.top - size - gap >= gap) y = box.top - size - gap;
      else if (box.left - size - gap >= gap) x = box.left - size - gap;
      else x = Math.min(width - size - gap, box.right + gap);
    }
  }
  return { x, y };
}
