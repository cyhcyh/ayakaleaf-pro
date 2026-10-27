import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSessionContext, restoredMessage } from '../shared/session-context.mjs';
import { translationPopupPosition } from '../shared/selection-position.mjs';

const text = (id, value = id) => ({ id, role: 'user', parts: [{ type: 'text', text: value }] });
test('paged display does not truncate model context or duplicate a restored tail', () => {
  const stored = Array.from({ length: 100 }, (_, order) => ({ order, message: text(`m${order}`) }));
  const incoming = [text('m98'), text('m99', 'updated last tool result'), text('new')];
  const merged = mergeSessionContext(stored, incoming, 98, null);
  assert.equal(merged.length, 101);
  assert.equal(merged[0].id, 'm0');
  assert.equal(merged.at(-2).parts[0].text, 'updated last tool result');
  assert.equal(merged.at(-1).id, 'new');
});
test('summary checkpoints retain protected head messages and new unsaved turns', () => {
  const stored = Array.from({ length: 100 }, (_, order) => ({ order, message: text(`m${order}`) }));
  const result = mergeSessionContext(stored, [text('m98'), text('m99'), text('new')], 98,
    { upToMessageId: 'm97', protectedFirstIds: ['m0', 'm1'] });
  assert.deepEqual(result.map(message => message.id), ['m0', 'm1', 'm98', 'm99', 'new']);
  assert.throws(() => mergeSessionContext(stored, [], 0, { upToMessageId: 'missing' }), /摘要/);
});
test('restored interrupted tools remain inert while live tool results supersede them', () => {
  const interrupted = { id: 'tool', role: 'assistant', parts: [{ type: 'tool-get_file', state: 'input-available', input: { path: 'main.tex' } }] };
  assert.equal(restoredMessage(interrupted).parts[0].state, 'output-error');
  assert.equal(interrupted.parts[0].state, 'input-available');
  const live = { ...interrupted, parts: [{ ...interrupted.parts[0], state: 'output-available', output: 'complete' }] };
  assert.equal(mergeSessionContext([{ order: 2, message: interrupted }], [live], 2, null)[0].parts[0].state, 'output-available');
});
test('translation popovers fit the viewport for long results, edge selections and small windows', () => {
  for (const [width, height] of [[1280, 720], [800, 500], [375, 300]]) for (const anchor of [{ x: 50, y: 30 }, { x: width - 10, y: height - 20 }]) {
    const p = translationPopupPosition(anchor, width, height, 10000);
    assert.ok(p.top >= 12 && p.left >= 12);
    assert.ok(p.top + p.maxHeight <= height - 12);
    assert.ok(p.left + Math.min(370, width - 24) <= width - 12);
  }
  assert.equal(translationPopupPosition({ x: 200, y: 100 }, 1280, 720, 200).top, 124);
});
