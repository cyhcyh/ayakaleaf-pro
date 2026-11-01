// Cache eviction invalidates measured heights, but surviving DOM nodes do not
// remount or necessarily emit ResizeObserver events. Restore their real sizes
// before paint. Streaming only needs the active visible message measured.
export function measureConversationRows(virtual, root, activeId, remember) {
  if (!root) return;
  virtual.getTotalSize();
  for (const row of root.querySelectorAll('[data-message-id]')) {
    if (activeId !== undefined && row.dataset.messageId !== activeId) continue;
    const index = Number(row.dataset.index);
    if (!Number.isInteger(index) || index < 0) continue;
    const height = row.getBoundingClientRect().height;
    if (height > 0) {
      remember?.(row.dataset.messageId, height);
      virtual.resizeItem(index, height);
    }
  }
}
