import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_BYTES, collectMessagePage, messageBytes, trimMessageWindow, mergeMessagePages } from '../shared/message-cache.mjs';
import { mergeSessionContext } from '../shared/session-context.mjs';
const turn = n => [{ id: `u${n}`, role: 'user', parts: [{ type: 'text', text: `Question ${n}` }] },
  { id: `a${n}`, role: 'assistant', parts: [{ type: 'tool-get_lines', toolCallId: `call${n}`, state: 'output-available', input: { path: 'main.tex', start: 1, end: 1 }, output: { lines: [`Answer ${n}`] } }] }];
const history = n => Array.from({ length: n }, (_, n) => turn(n)).flat();
async function* cursor(rows) { yield* rows; }

test('live history is bounded by whole turns and retains absolute autosave offsets', () => {
  const messages = history(1000);
  const kept = trimMessageWindow(messages, 0, { direction: 'newer' });
  assert.equal(kept.messages.length, 40);
  assert.equal(kept.messageOffset, 1960);
  assert.equal(kept.messages[0].id, 'u980');
  assert.equal(kept.messages.at(-1).id, 'a999');
  assert.equal(messages.length, 2000);
  const rows = messages.map((message, order) => ({ message, order }));
  assert.equal(mergeSessionContext(rows, kept.messages, kept.messageOffset, null).length, 2000);
});

test('image and tool data enforce the byte budget even with few turns', () => {
  const messages = history(12);
  for (let at = 0; at < messages.length; at += 2) messages[at].parts.push({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024) });
  const kept = trimMessageWindow(messages, 100, { direction: 'newer' });
  assert.ok(kept.messages.reduce((bytes, m) => bytes + messageBytes(m), 0) <= CACHE_BYTES);
  assert.ok(kept.messages.length < 24);
  assert.equal(kept.messages[0].role, 'user');
  assert.equal(kept.messages.at(-1).id, 'a11');
});

test('paging preserves visible whole turns while releasing the far end in either direction', () => {
  const messages = history(60);
  for (const direction of ['older', 'newer']) {
    const kept = trimMessageWindow(messages, 0, { direction, keepIds: ['u30', 'a31'] });
    assert.ok(kept.messages.some(m => m.id === 'u30'));
    assert.ok(kept.messages.some(m => m.id === 'a31'));
    assert.equal(kept.messages.length, 40);
    assert.equal(kept.messages[0].role, 'user');
    assert.equal(kept.messages.at(-1).role, 'assistant');
  }
});

test('a protected large turn remains complete instead of discarding a tool call or result', () => {
  const messages = history(2);
  messages[3].parts[0].output = { lines: ['large'.repeat(1000)] };
  const kept = trimMessageWindow(messages, 0, { direction: 'newer', keepIds: ['a1'], maxBytes: 10 });
  assert.deepEqual(kept.messages.map(m => m.id), ['u1', 'a1']);
  assert.equal(kept.messages[1].parts[0].state, 'output-available');
});

test('both paging directions cover every message without cutting or repeating turns', async () => {
  const rows = history(65).map((message, order) => ({ message, order }));
  let before = rows.length, backward = [];
  while (before > 0) {
    const page = await collectMessagePage(cursor(rows.filter(r => r.order < before).reverse()), -1);
    assert.equal(page[0].message.role, 'user');
    assert.ok(page.length <= 40);
    backward = [...page, ...backward]; before = page[0].order;
  }
  assert.deepEqual(backward.map(r => r.order), rows.map(r => r.order));
  let after = -1, forward = [];
  while (after < rows.length - 1) {
    const page = await collectMessagePage(cursor(rows.filter(r => r.order > after)), 1);
    assert.equal(page[0].message.role, 'user');
    assert.ok(page.length <= 40);
    forward.push(...page); after = page.at(-1).order;
  }
  assert.deepEqual(forward.map(r => r.order), rows.map(r => r.order));
});

test('bounded page reading stops at the byte limit and retains one oversized whole turn', async () => {
  const rows = history(8).map((message, order) => ({ message, order }));
  for (const direction of [-1, 1]) {
    const ordered = direction === 1 ? rows : [...rows].reverse();
    const single = await collectMessagePage(cursor(ordered), direction, { maxBytes: 1 });
    assert.equal(single.length, 2);
    assert.equal(single[0].message.role, 'user');
    assert.equal(single[1].message.role, 'assistant');
  }
});

test('overlapping pages deduplicate by message id and newer live tool state wins', () => {
  const messages = history(3);
  const newer = { ...messages[3], parts: [{ type: 'text', text: 'Fresh live result' }] };
  const merged = mergeMessagePages({ messages: messages.slice(0, 4), messageOffset: 10 }, { messages: [messages[2], newer, ...messages.slice(4)], messageOffset: 12 });
  assert.deepEqual(merged.messages.map(m => m.id), messages.map(m => m.id));
  assert.equal(merged.messageOffset, 10);
  assert.equal(merged.messages[3], newer);
});
