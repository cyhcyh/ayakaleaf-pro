import test from 'node:test';
import assert from 'node:assert/strict';
import { offscreenEditTargets, layoutEditCards, revealEditDelta, groupEditsByFile } from '../shared/edit-panel-layout.mjs';
const card = (id, top, height = 100) => ({ id, top, height });

test('empty filters and a zero-height viewport have no navigation targets', () => {
  assert.deepEqual(offscreenEditTargets([], 100, 600), { above: null, below: null });
  assert.deepEqual(offscreenEditTargets([card('a', 0)], 100, 100), { above: null, below: null });
});
test('a fully or partly visible card hides both directions, including a card spanning the whole viewport', () => {
  for (const visible of [card('visible', 200), card('partial-top', 1), card('partial-bottom', 599), card('large', 0, 800)]) {
    assert.deepEqual(offscreenEditTargets([card('above', -300), visible, card('below', 900)], 100, 600), { above: null, below: null });
  }
});
test('both directions choose the nearest outside card, independent of creation/list order', () => {
  const cards = [card('far-below', 1000), card('near-above', -30), card('near-below', 650), card('far-above', -500)];
  assert.deepEqual(offscreenEditTargets(cards, 100, 600), { above: 'near-above', below: 'near-below' });
});
test('cards just outside the unobscured viewport are navigable in only their own direction', () => {
  assert.deepEqual(offscreenEditTargets([card('top', 0)], 100, 600), { above: 'top', below: null });
  assert.deepEqual(offscreenEditTargets([card('bottom', 600)], 100, 600), { above: null, below: 'bottom' });
});
test('each status filter produces its own target and accepting a card changes only its applicable filter', () => {
  const pending = [card('pending-top', -200), card('pending-bottom', 900)];
  const done = [card('accepted', 200)];
  assert.deepEqual(offscreenEditTargets(pending, 100, 600), { above: 'pending-top', below: 'pending-bottom' });
  assert.deepEqual(offscreenEditTargets(done, 100, 600), { above: null, below: null });
  assert.deepEqual(offscreenEditTargets([...pending, ...done], 100, 600), { above: null, below: null });
});
test('navigation follows laid-out card positions, then disappears after revealing the target below the toolbar', () => {
  const cards = [card('one', 45, 180), card('two', 55, 180), card('three', 65, 180)];
  const layout = layoutEditCards(cards, 'three', 44);
  const bounds = cards.map(item => ({ ...item, top: layout.positions.get(item.id) }));
  const result = offscreenEditTargets(bounds, 700, 1100);
  assert.equal(result.above, 'three');
  const target = bounds[2];
  const delta = revealEditDelta(target.top, target.height, 700, 1100);
  assert.deepEqual(offscreenEditTargets(bounds.map(item => ({ ...item, top: item.top - delta })), 700, 1100), { above: null, below: null });
});

test('overview groups filtered records by full path, counts only that filter, and orders each file by source line', () => {
  const items = [
    { id: 'one', state: 'pending', input: { path: 'b/main.tex', startLine: 30 } },
    { id: 'two', state: 'accepted', input: { path: 'a/main.tex', startLine: 10 } },
    { id: 'three', state: 'pending', input: { path: 'b/main.tex', startLine: 2 } },
  ];
  const snapshot = JSON.stringify(items);
  const groups = groupEditsByFile(items);
  assert.deepEqual(groups.map(group => group.path), ['a/main.tex', 'b/main.tex']);
  assert.deepEqual(groups[1].items.map(item => item.id), ['three', 'one']);
  assert.deepEqual(groupEditsByFile(items.filter(item => item.state === 'accepted')).map(group => group.items.length), [1]);
  assert.equal(JSON.stringify(items), snapshot);
  assert.deepEqual(groupEditsByFile([]), []);
});
