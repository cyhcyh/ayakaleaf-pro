import test from 'node:test';
import assert from 'node:assert/strict';
import { Virtualizer } from '@tanstack/react-virtual';
import { measureConversationRows } from '../shared/conversation-measurements.mjs';

test('surviving long rows recover their measured heights immediately after cache eviction', () => {
  const virtual = new Virtualizer({ count: 3, getScrollElement: () => null, estimateSize: () => 160,
    scrollToFn() {}, observeElementRect() {}, observeElementOffset() {} });
  let heights = [1331, 108, 302];
  const rows = heights.map((height, index) => ({ dataset: { index: String(index), messageId: `message-${index}` }, getBoundingClientRect: () => ({ height: heights[index] }) }));
  const root = { querySelectorAll: () => rows };
  measureConversationRows(virtual, root);
  assert.equal(virtual.getTotalSize(), 1741);
  // The nodes keep their size and identity, so ResizeObserver need not fire.
  virtual.measure();
  assert.equal(virtual.getTotalSize(), 480);
  measureConversationRows(virtual, root);
  assert.equal(virtual.getTotalSize(), 1741);
  heights = [1661, 108, 302];
  measureConversationRows(virtual, root, 'message-0');
  assert.equal(virtual.getTotalSize(), 2071);
});

test('streamed text measures only its active mounted row and ignores an offscreen reply', () => {
  const measured = [], read = [];
  const virtual = { getTotalSize() {}, resizeItem(index, size) { measured.push([index, size]); } };
  const root = { querySelectorAll: () => ['old', 'active', 'other'].map((id, index) => ({ dataset: { index: String(index), messageId: id },
    getBoundingClientRect() { read.push(id); return { height: 302 + index }; } })) };
  measureConversationRows(virtual, root, 'active');
  assert.deepEqual(read, ['active']);
  assert.deepEqual(measured, [[1, 303]]);
  measureConversationRows(virtual, root, 'offscreen');
  assert.deepEqual(read, ['active']);
});

test('cached heights follow stable message ids across a page shift, including an unmounted long row', () => {
  let ids = ['older', 'long', 'tail'];
  const heights = new Map();
  const remember = (id, height) => heights.set(id, height);
  const virtual = new Virtualizer({ count: ids.length, getItemKey: index => ids[index], getScrollElement: () => null,
    estimateSize: index => heights.get(ids[index]) || 160, scrollToFn() {}, observeElementRect() {}, observeElementOffset() {} });
  measureConversationRows(virtual, { querySelectorAll: () => [{ dataset: { index: '1', messageId: 'long' }, getBoundingClientRect: () => ({ height: 12000 }) }] }, undefined, remember);
  assert.equal(heights.get('long'), 12000);
  ids = ['newer', 'older', 'long'];
  virtual.measure();
  assert.equal(virtual.getTotalSize(), 12320);
  // Pruning to the current page never retains a transcript or a full history.
  for (const id of heights.keys()) if (!ids.includes(id)) heights.delete(id);
  assert.equal(heights.size, 1);
});
