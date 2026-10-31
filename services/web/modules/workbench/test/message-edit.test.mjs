import test from 'node:test';
import assert from 'node:assert/strict';
import { messageBody, splitUserText, replaceUserText, contextAfterEdit } from '../shared/message-content.mjs';
import { projectContext, contextUnits } from '../shared/context-checkpoint.mjs';
import { createContextMeter } from '../app/src/personal-ai/ContextUsage.mjs';
import { draftText } from '../shared/chat-turn.mjs';

const user = (id, text) => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const assistant = (id, text) => ({ id, role: 'assistant', parts: [{ type: 'text', text }] });
const rows = [user('u1', 'First'), assistant('a1', 'Answer'), user('u2', 'Second'), assistant('a2', 'Later')].map((message, order) => ({ message, order }));

test('copying user text excludes references and editor snapshots, preserving Markdown and math', () => {
  const body = '请检查 **结论**，保留 $x^2$。\n\n```latex\n\\alpha\n```';
  const draft = { text: body, references: [{ id: 'pdf', name: 'reference.pdf' }], context: { path: 'main.tex', selection: [{ fromLine: 2, toLine: 3, content: 'Private selection' }] } };
  assert.equal(messageBody(user('u', draftText(draft))), body);
  assert.deepEqual(splitUserText(body), { text: body, context: '' });
});

test('copying an assistant answer excludes thinking and tool results and preserves multiple text parts', () => {
  const message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'Private thought' }, { type: 'text', text: 'Answer $x$' },
    { type: 'tool-get_lines', output: 'Hidden file content' }, { type: 'text', text: '```tex\n\\beta\n```' }] };
  assert.equal(messageBody(message), 'Answer $x$\n\n```tex\n\\beta\n```');
});

test('editing preserves reference metadata, original editor context, images and message id', () => {
  const text = draftText({ text: 'Original', references: [{ id: 'pdf', name: 'ref.pdf' }], context: { path: 'old.tex', selection: [{ fromLine: 1, toLine: 1, content: 'Old selection' }] } });
  const original = { ...user('u', text), parts: [{ type: 'text', text }, { type: 'file', filename: 'plot.png', mediaType: 'image/png', url: 'data:image/png;base64,YQ==' }] };
  const before = JSON.stringify(original);
  const edited = replaceUserText(original, 'Rewritten\nwith two lines');
  assert.equal(edited.id, original.id);
  assert.equal(messageBody(edited), 'Rewritten\nwith two lines');
  assert.equal(splitUserText(edited.parts[0].text).context, splitUserText(text).context);
  assert.deepEqual(edited.parts[1], original.parts[1]);
  assert.equal(JSON.stringify(original), before);
});

test('attachment-only messages and multiple text parts can be edited without duplicating the new text', () => {
  const image = { type: 'file', url: 'data:image/png;base64,YQ==', mediaType: 'image/png' };
  assert.equal(messageBody(replaceUserText({ id: 'u', role: 'user', parts: [image] }, 'Caption')), 'Caption');
  const original = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'One' }, image, { type: 'text', text: 'Two\n\n<editor-context>\nOpen file: old.tex\n</editor-context>' }] };
  const edited = replaceUserText(original, 'New');
  assert.equal(messageBody(edited), 'New');
  assert.equal(edited.parts.filter(part => part.type === 'text').length, 1);
  assert.equal(edited.parts[1], image);
  assert.ok(edited.parts[0].text.includes('Open file: old.tex'));
});

test('editing after a summary retains its valid prefix, resets usage and removes deleted tool metadata', () => {
  const checkpoint = { summary: 'First answer', upToMessageId: 'a1', protectedFirstIds: ['u1'], prunedToolCallIds: ['deleted'] };
  const state = { checkpoint, usage: { anchor: { tokens: 999 }, estimates: [{ key: 'u1:0', tokens: 1 }, { key: 'u2:0', tokens: 2 }, { key: 'a2:0:input', tokens: 3 }] } };
  const next = contextAfterEdit(rows, 2, state);
  assert.equal(next.checkpoint.summary, checkpoint.summary);
  assert.deepEqual(next.checkpoint.prunedToolCallIds, []);
  assert.equal(next.usage.anchor, null);
  assert.deepEqual(next.usage.estimates, [{ key: 'u1:0', tokens: 1 }]);
  const kept = [rows[0].message, rows[1].message, replaceUserText(rows[2].message, 'Edited')];
  assert.deepEqual(projectContext(kept, next.checkpoint).map(message => message.id), ['u1', 'u2']);
});

test('editing a covered or protected message invalidates the entire summary, including partial checkpoints', () => {
  for (const partial of [undefined, { parts: 1 }]) {
    const checkpoint = { summary: 'Covered', upToMessageId: 'a2', protectedFirstIds: ['u1'], ...(partial && { partial }) };
    assert.equal(contextAfterEdit(rows, 0, { checkpoint }).checkpoint, null);
    assert.equal(contextAfterEdit(rows, 2, undefined, checkpoint).checkpoint, null);
  }
  assert.equal(contextAfterEdit(rows, 2, { checkpoint: { summary: 'Missing boundary', upToMessageId: 'missing' } }).checkpoint, null);
});

test('an explicitly cleared server checkpoint overrides a stale autosaved summary on later edits', () => {
  const stale = { summary: 'No longer valid', upToMessageId: 'a1' };
  assert.equal(contextAfterEdit(rows, 2, { checkpoint: null }, stale).checkpoint, null);
});

test('prune-only checkpoints retain complete tool pairs that precede the edited turn', () => {
  const call = { type: 'tool-get_lines', toolCallId: 'kept', input: { path: 'main.tex' }, output: 'Old file', state: 'output-available' };
  const full = structuredClone(rows);
  full[1].message.parts.push(call);
  const checkpoint = { summary: '', upToMessageId: '', prunedToolCallIds: ['kept', 'removed'] };
  const next = contextAfterEdit(full, 2, { checkpoint });
  assert.deepEqual(next.checkpoint.prunedToolCallIds, ['kept']);
  const projected = projectContext(full.slice(0, 3).map(row => row.message), next.checkpoint);
  const unit = contextUnits(projected).find(unit => unit.parts.some(part => part.toolCallId === 'kept'));
  assert.ok(unit.complete);
  assert.ok(unit.parts.find(part => part.toolCallId === 'kept').output.contextOmitted);
});

test('an edited message cannot reuse the old provider anchor even when its replacement has equal length', () => {
  const meter = createContextMeter();
  const old = [user('u', 'ABCD')];
  meter.observe(old, { inputTokens: 5000, outputTokens: 100 }, 'model');
  const saved = contextAfterEdit([{ order: 0, message: old[0] }], 0, { usage: meter.snapshot(old) });
  const restored = createContextMeter(saved.usage);
  assert.ok(restored.measure([user('u', 'WXYZ')], 10, 'model') < 100);
});
