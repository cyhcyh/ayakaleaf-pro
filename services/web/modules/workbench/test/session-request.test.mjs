import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonBytes, pendingSessionMessages, sameSavedMessage, CHAT_REQUEST_BYTES } from '../shared/session-request.mjs';
import { mergeSessionContext } from '../shared/session-context.mjs';
import { interruptTools } from '../shared/chat-turn.mjs';
import { convertToModelMessages } from 'ai';

const user = (id, text = 'Question') => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const assistant = (id, parts = [{ type: 'text', text: 'Answer' }]) => ({ id, role: 'assistant', parts });
const saved = messages => new Map(messages.map(message => [message.id, message]));

test('saved image history exceeding the HTTP limit is restored from a small contiguous delta', () => {
  const history = Array.from({ length: 6 }, (_, i) => [
    { ...user(`u${i}`), parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,' + 'A'.repeat(2300000) }] }, assistant(`a${i}`),
  ]).flat();
  const next = user('next');
  const messages = [...interruptTools(history), next];
  assert.ok(jsonBytes(messages) > 12 * 1024 * 1024);
  const request = pendingSessionMessages(messages, saved(history), 40);
  assert.deepEqual(request.messages, [next]);
  assert.equal(request.messageOffset, 52);
  assert.ok(jsonBytes(request) < CHAT_REQUEST_BYTES);
  const rows = history.map((message, order) => ({ message, order: order + 40 }));
  assert.deepEqual(mergeSessionContext(rows, request.messages, request.messageOffset, null).map(m => m.id), [...history, next].map(m => m.id));
});

test('a changed tool result keeps the entire suffix, with correct order and paired call/result', async () => {
  const call = { type: 'tool-read_file', toolCallId: 'read', state: 'input-available', input: { path: 'main.tex' } };
  const history = [user('u1'), assistant('a1', [call]), user('u2')];
  const output = { ...history[1], parts: [{ ...call, state: 'output-available', output: 'Fresh file content' }] };
  const current = [history[0], output, history[2], assistant('a2')];
  const request = pendingSessionMessages(current, saved(history), 20);
  assert.equal(request.messageOffset, 21);
  assert.deepEqual(request.messages, current.slice(1));
  const restored = mergeSessionContext(history.map((message, order) => ({ message, order: order + 20 })), request.messages, request.messageOffset, null);
  assert.equal(restored[1].parts[0].state, 'output-available');
  const model = await convertToModelMessages(restored);
  assert.equal(model.find(m => m.role === 'tool').content[0].toolCallId, 'read');
});

test('even a saved final assistant overrides interrupted-tool restoration', () => {
  const history = [user('u'), assistant('a', [{ type: 'tool-read_file', toolCallId: 'call', state: 'input-available', input: { path: 'main.tex' } }])];
  const request = pendingSessionMessages(history, saved(history), 0);
  assert.deepEqual(request.messages, [history[1]]);
  const restored = mergeSessionContext(history.map((message, order) => ({ message, order })), request.messages, request.messageOffset, null);
  assert.equal(restored.at(-1).parts[0].state, 'input-available');
});

test('unknown or changed messages are never skipped and shallow copies do not serialize old parts', () => {
  const first = user('first'), second = user('second');
  const copy = { ...first, parts: [...first.parts] };
  assert.ok(sameSavedMessage(copy, first));
  assert.ok(!sameSavedMessage({ ...copy, metadata: { changed: true } }, first));
  assert.ok(!sameSavedMessage({ ...copy, parts: [{ type: 'text', text: 'Edited' }] }, first));
  assert.deepEqual(pendingSessionMessages([copy, second], new Map(), 9), { messages: [copy, second], messageOffset: 9 });
  assert.equal(first.parts[0].text, 'Question');
});

test('summary projection and protected first messages behave the same with delta transport', () => {
  const history = [user('u1'), assistant('a1'), user('u2'), assistant('a2')];
  const next = user('u3');
  const rows = history.map((message, order) => ({ message, order }));
  const checkpoint = { summary: 'First turn', upToMessageId: 'a1', protectedFirstIds: ['u1'] };
  const request = pendingSessionMessages([...history, next], saved(history), 0);
  assert.deepEqual(mergeSessionContext(rows, request.messages, request.messageOffset, checkpoint), mergeSessionContext(rows, [...history, next], 0, checkpoint));
});
