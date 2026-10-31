import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextManager } from '../app/src/personal-ai/ContextManager.mjs';
import { createContextMeter } from '../app/src/personal-ai/ContextUsage.mjs';
import { projectContext, contextUnits } from '../shared/context-checkpoint.mjs';
import { mergeSessionContext } from '../shared/session-context.mjs';
import { createToolCallLimit } from '../app/src/ToolCallLimit.mjs';

const user = (id, text = '请继续检查论文，修改仍需确认。') => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const assistant = (id, text) => ({ id, role: 'assistant', parts: [{ type: 'text', text }] });
const step = (id, text = '已核对相关结论。'.repeat(12)) => [{ type: 'step-start' },
  { type: 'tool-get_lines', toolCallId: id, state: 'output-available', input: { path: 'main.tex', start: 1, end: 3 }, output: { lines: text } }];
function manager(messages, options = {}) {
  return createContextManager({ messages, system: 'Writing assistant.', tools: {}, modelKey: 'model-a',
    policy: { enabled: true, threshold: .85, protectFirst: 3, protectLast: 30 }, window: 6000, reserve: 500,
    summarize: async () => '已检查前面的内容，继续当前任务。待确认修改尚未应用。', ...options });
}

test('long dialogue automatically relaxes protected message counts without deleting display history', async () => {
  const raw = Array.from({ length: 12 }, (_, n) => [user('u' + n), assistant('a' + n, '历史材料与审阅发现。'.repeat(150))]).flat();
  const before = JSON.stringify(raw);
  const engine = manager(raw);
  const result = await engine.prepare();
  assert.ok(result.summary);
  assert.ok(result.messages.length < raw.length);
  assert.equal(JSON.stringify(raw), before);
  assert.ok(result.messages.some(m => m.id === 'u11'));
  assert.equal(result.messages.at(-1).id, 'a11');
});

test('one large turn compacts completed steps and keeps parallel calls/results together', async () => {
  const raw = [user('u'), { id: 'a', role: 'assistant', parts: Array.from({ length: 80 }, (_, n) => [
    ...step('call-' + n), { type: 'tool-get_lines', toolCallId: 'parallel-' + n, state: 'output-available', input: { path: 'other.tex', start: 1, end: 1 }, output: '并行结果。'.repeat(20) },
  ]).flat() }];
  const engine = manager(raw);
  const result = await engine.prepare();
  assert.ok(engine.checkpoint.partial.parts > 0);
  const calls = result.messages.at(-1).parts.filter(part => part.toolCallId).map(part => part.toolCallId);
  assert.ok(calls.includes('call-79') && calls.includes('parallel-79'));
  for (let n = 0; n < 80; n++) assert.equal(calls.includes('call-' + n), calls.includes('parallel-' + n));
  assert.equal(result.messages[0].id, 'u');
  assert.equal(createToolCallLimit(raw, 160).exhausted(), true);
});

test('partial checkpoint survives reload, excludes covered steps and retains newly appended steps', async () => {
  const raw = [user('u'), { id: 'a', role: 'assistant', parts: Array.from({ length: 70 }, (_, n) => step('call-' + n)).flat() }];
  const engine = manager(raw);
  await engine.prepare();
  const checkpoint = structuredClone(engine.checkpoint);
  const appended = structuredClone(raw);
  appended[1].parts.push(...step('new-call'));
  const stored = appended.map((message, order) => ({ message, order }));
  const restored = mergeSessionContext(stored, [], 0, checkpoint);
  assert.equal(restored[0].id, 'u');
  assert.ok(restored.at(-1).parts.some(p => p.toolCallId === 'new-call'));
  assert.ok(!restored.at(-1).parts.some(p => p.toolCallId === 'call-0'));
});

test('unfinished tool groups are never summarized or detached', async () => {
  const pending = { type: 'tool-propose_edit', toolCallId: 'pending', state: 'input-available', input: { path: 'main.tex' } };
  const raw = [user('old'), assistant('old-a', '旧历史。'.repeat(2500)), user('u'), { id: 'a', role: 'assistant', parts: [
    { type: 'step-start' }, pending, ...step('complete'), ...step('newest'),
  ] }];
  const result = await manager(raw).prepare();
  assert.ok(result.messages.at(-1).parts.some(p => p.toolCallId === 'pending' && p.state === 'input-available'));
  assert.equal(contextUnits(result.messages).find(unit => unit.parts.some(p => p.toolCallId === 'pending')).complete, false);
});

test('old bulky reads are pruned without a summarizer call, latest read is kept', async () => {
  let summaries = 0;
  const raw = [user('u'), { id: 'a', role: 'assistant', parts: [...step('old', '长文件正文。'.repeat(3000)), ...step('latest', '当前需要的正文。')] }];
  const engine = manager(raw, { summarize: async () => { summaries++; return 'summary'; } });
  const result = await engine.prepare();
  assert.equal(summaries, 0);
  assert.equal(result.messages.at(-1).parts.find(p => p.toolCallId === 'old').output.contextOmitted, true);
  assert.deepEqual(result.messages.at(-1).parts.find(p => p.toolCallId === 'latest').output, raw[1].parts.at(-1).output);
  assert.deepEqual(projectContext(raw, engine.checkpoint), result.messages);
});

test('summary failure preserves checkpoint and raw history and does not loop', async () => {
  const raw = [user('old'), assistant('a', '不可丢失的旧内容。'.repeat(2500)), user('u')];
  let calls = 0;
  const engine = manager(raw, { summarize: async () => { calls++; throw new Error('temporary failure'); } });
  await assert.rejects(engine.prepare(), /temporary failure/);
  assert.equal(engine.checkpoint, null);
  assert.equal(engine.messages, raw);
  assert.equal(calls, 1);
});

test('oversized latest material yields a specific error instead of infinite compaction', async () => {
  const engine = manager([user('u', '超大材料。'.repeat(2500))]);
  await assert.rejects(engine.prepare(), /分段读取/);
});

test('actual usage anchor adds only new messages and unpriced tool results, never counts reply twice', () => {
  const messages = [user('u'), { id: 'a', role: 'assistant', parts: step('call') }];
  const meter = createContextMeter();
  meter.observe(messages, { inputTokens: 1000, outputTokens: 100 }, 'model-a', ['call']);
  const value = meter.measure(messages, 20, 'model-a');
  assert.ok(value > 1100 && value < 1400);
  const appended = [...messages, user('u2', '继续。')];
  assert.ok(meter.measure(appended, 20, 'model-a') > value);
  assert.equal(meter.measure(messages, 20, 'model-a'), value);
  const restored = createContextMeter(structuredClone(meter.snapshot(messages)));
  assert.equal(restored.measure(messages, 20, 'model-a'), value);
});

test('same-length earlier edits and model/system changes invalidate actual usage', () => {
  const original = [user('u', 'abcdef')];
  const meter = createContextMeter();
  meter.observe(original, { inputTokens: 12000, outputTokens: 500 }, 'model-a');
  assert.equal(meter.measure(original, 20, 'model-a'), 12500);
  assert.ok(meter.measure([user('u', 'uvwxyz')], 20, 'model-a') < 100);
  assert.ok(meter.measure(original, 20, 'model-b') < 100);
});

test('missing provider usage reuses cached part estimates after persistence', () => {
  const messages = [user('u', '中文材料。'.repeat(20000))];
  const meter = createContextMeter();
  const initial = meter.measure(messages, 20, 'a');
  meter.observe(messages, {}, 'a');
  const saved = meter.snapshot(messages);
  let estimated = 0;
  const restored = createContextMeter(structuredClone(saved), value => { estimated += value.length; return value.length; });
  assert.equal(restored.measure(structuredClone(messages), 20, 'a'), initial);
  assert.equal(estimated, 0);
  restored.measure([...structuredClone(messages), user('new', '新增内容')], 20, 'a');
  assert.ok(estimated > 0 && estimated < 200);
});

test('independent managers keep usage, summaries and progress isolated', async () => {
  const a = manager([user('a-old'), assistant('a', '用户甲的材料。'.repeat(2500)), user('a-new')]);
  const b = manager([user('b-new', '用户乙的消息')]);
  const [left, right] = await Promise.all([a.prepare(), b.prepare()]);
  assert.ok(left.summary);
  assert.equal(right.summary, undefined);
  assert.equal(b.checkpoint, null);
});

test('legacy complete-message checkpoints still project correctly', () => {
  const raw = [user('u1'), assistant('a1', 'old'), user('u2')];
  assert.deepEqual(projectContext(raw, { summary: 'old summary', upToMessageId: 'a1', protectedFirstIds: ['u1'] }).map(m => m.id), ['u1', 'u2']);
});

test('legacy assistant histories without step markers still compact atomic call/result parts', async () => {
  const raw = [user('u'), { id: 'a', role: 'assistant', parts: Array.from({ length: 90 }, (_, n) => step('call-' + n).slice(1)).flat() }];
  const result = await manager(raw).prepare();
  assert.ok(result.summary);
  assert.ok(result.messages.at(-1).parts.some(p => p.toolCallId === 'call-89'));
  assert.ok(result.messages.at(-1).parts.every(p => !p.toolCallId || p.state === 'output-available'));
});

test('stopping during a summary cannot publish a late checkpoint', async () => {
  const controller = new AbortController();
  let saved = 0;
  const engine = manager([user('old'), assistant('a', '旧内容。'.repeat(3000)), user('new')], {
    signal: controller.signal, persist: async () => { saved++; }, summarize: async () => { controller.abort(); return 'late summary'; },
  });
  await assert.rejects(engine.prepare());
  assert.equal(saved, 0);
  assert.equal(engine.checkpoint, null);
});
