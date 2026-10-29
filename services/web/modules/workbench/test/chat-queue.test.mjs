import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { convertToModelMessages } from 'ai';
import { outboxSchema } from '../app/src/personal-ai/QueueSchema.mjs';
import { draftText, interruptTools, waitingForReview } from '../shared/chat-turn.mjs';
import { createToolCallLimit } from '../app/src/ToolCallLimit.mjs';
import { restoredMessage } from '../shared/session-context.mjs';

const context = { path: 'chapters/proof.tex', selection: [{ fromLine: 3, toLine: 4, content: 'Proof with $x^2$.' }] };
const queued = () => ({ id: randomUUID(), text: 'Check this proof', files: [], context });

test('queued messages retain selected source and reference ids until actually dispatched', () => {
  const item = { ...queued(), references: [{ id: randomUUID(), name: 'paper.pdf', mediaType: 'application/pdf' }] };
  assert.deepEqual(outboxSchema.parse([item]), [item]);
  const text = draftText(item);
  assert.ok(text.includes('Open file: chapters/proof.tex'));
  assert.ok(text.includes('Selected lines 3-4:\nProof with $x^2$.'));
  assert.ok(text.includes(item.references[0].id));
  assert.ok(!item.text.includes('editor-context'));
});

test('attachment-only messages are valid, while empty messages and duplicate ids are rejected', () => {
  const image = { type: 'file', mediaType: 'image/png', filename: 'formula.png', url: 'data:image/png;base64,aGVsbG8=' };
  assert.ok(outboxSchema.safeParse([{ ...queued(), text: '', files: [image] }]).success);
  assert.ok(outboxSchema.safeParse([{ ...queued(), text: '', references: [{ id: randomUUID(), name: 'source.pdf', mediaType: 'application/pdf' }] }]).success);
  assert.ok(!outboxSchema.safeParse([{ ...queued(), text: '  ' }]).success);
  const item = queued();
  assert.ok(!outboxSchema.safeParse([item, item]).success);
  assert.ok(!outboxSchema.safeParse([{ ...queued(), files: [{ ...image, url: 'http://private.test/image' }] }]).success);
});

test('queue schema bounds total size and keeps backward-compatible omitted queues', () => {
  assert.ok(outboxSchema.safeParse([]).success);
  assert.ok(!outboxSchema.safeParse(Array.from({ length: 101 }, queued)).success);
  assert.ok(!outboxSchema.safeParse(Array.from({ length: 50 }, () => ({ ...queued(), text: '中'.repeat(100000) }))).success);
});

test('steering closes partial calls without changing completed edits, comments or file creation', async () => {
  const messages = [{ id: 'assistant', role: 'assistant', parts: [
    { type: 'text', text: 'Already explained.' },
    { type: 'tool-new_file', toolCallId: 'created', state: 'output-available', input: { path: 'new.tex' }, output: null },
    { type: 'tool-propose_edit', toolCallId: 'proposed', state: 'output-available', input: { path: 'new.tex' }, output: { editId: 'pending', queued: true } },
    { type: 'tool-get_file', toolCallId: 'interrupted', state: 'input-available', input: { path: 'main.tex' } },
    { type: 'tool-get_lines', toolCallId: 'partial', state: 'input-streaming', input: undefined },
  ] }];
  const next = interruptTools(messages);
  assert.deepEqual(next[0].parts.slice(0, 3), messages[0].parts.slice(0, 3));
  assert.equal(next[0].parts[3].state, 'output-error');
  assert.equal(next[0].parts.some(part => part.toolCallId === 'partial'), false);
  assert.equal(messages[0].parts[3].state, 'input-available');
  await assert.doesNotReject(() => convertToModelMessages(next));
});

test('a partial-only message keeps its id and becomes readable text on steering and history restoration', async () => {
  const message = { id: 'partial-assistant', role: 'assistant', parts: [
    { type: 'step-start' }, { type: 'tool-get_file', toolCallId: 'incomplete', state: 'input-streaming' },
  ] };
  for (const next of [interruptTools([message])[0], restoredMessage(message)]) {
    assert.equal(next.id, message.id);
    assert.ok(next.parts.some(part => part.type === 'text'));
    const converted = await convertToModelMessages([next]);
    assert.ok(!JSON.stringify(converted).includes('tool-call'));
  }
});

test('review confirmation remains a waiting state, not an ordinary completed turn', () => {
  const messages = [{ role: 'assistant', parts: [{ type: 'tool-request_review', state: 'input-available' }] }];
  assert.ok(waitingForReview(messages));
  assert.ok(!waitingForReview(interruptTools(messages)));
  assert.ok(!waitingForReview([]));
});

test('100 tool calls share one budget across continuations and a new user turn starts a fresh budget', () => {
  const messages = [{ role: 'user', parts: [{ type: 'text', text: 'Review' }] }, { role: 'assistant', parts:
    Array.from({ length: 100 }, (_, at) => ({ type: 'tool-get_file', toolCallId: `call-${at}`, state: 'output-available' })) }];
  assert.ok(createToolCallLimit(messages.slice(0, 1), 100).exhausted() === false);
  assert.ok(createToolCallLimit(messages, 100).exhausted());
  assert.ok(!createToolCallLimit([...messages, { role: 'user', parts: [{ type: 'text', text: 'Continue' }] }], 100).exhausted());
});
