import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySettings, validateSettings } from '../app/src/personal-ai/Pure.mjs';
import { modelMetadata, reasoningOptions } from '../app/src/personal-ai/ModelCapabilities.mjs';
import { locateEdit, makeAnchor, anchorMatches, locateAnchoredEdit } from '../shared/edit-anchor.mjs';
import { estimateTokens, splitForCompression } from '../shared/context-policy.mjs';
import { protectMath } from '../shared/math-protection.mjs';

test('existing personal settings acquire compression and reasoning defaults without losing bindings', () => {
  const legacy = emptySettings();
  delete legacy.compression; delete legacy.bindings.compression;
  legacy.connections = [{ id: 'gateway', kind: 'cloud', name: 'Gateway', baseURL: 'https://example.com/v1' }];
  legacy.bindings.chat = { connectionId: 'gateway', model: 'existing-alias' };
  const migrated = validateSettings(legacy);
  assert.equal(migrated.bindings.chat.model, 'existing-alias');
  assert.equal(migrated.bindings.chat.thinking, 'auto');
  assert.equal(migrated.compression.threshold, .85);
  assert.equal(migrated.bindings.compression.connectionId, '');
  migrated.compression.threshold = .3;
  migrated.compression.targetRatio = .5;
  assert.throws(() => validateSettings(migrated), /目标比例/);
});

test('service-reported reasoning levels override known defaults and cannot be silently exceeded', () => {
  const caps = modelMetadata({ slug: 'gpt-5.4', supported_reasoning_levels: [{ effort: 'low' }, { reasoning_effort: 'high' }], context_window: 64000 });
  assert.deepEqual(caps.reasoningEfforts, ['low', 'high']);
  assert.equal(caps.contextWindow, 64000);
  assert.equal(reasoningOptions({ thinking: 'on' }, caps), 'low');
  assert.throws(() => reasoningOptions({ thinking: 'off' }, caps), /思考模式/);
  assert.throws(() => reasoningOptions({ reasoningEffort: 'xhigh' }, caps), /推理强度/);
  assert.equal(reasoningOptions({}, modelMetadata({ id: 'private-alias' })), undefined);
  assert.throws(() => reasoningOptions({ thinking: 'on' }, modelMetadata({ id: 'private-alias' })), /思考模式/);
  assert.equal(modelMetadata({ id: 'hidden', show_in_picker: false }), null);
});

test('supported thinking-off uses none and thinking-on never sends none', () => {
  const caps = modelMetadata({ id: 'test', supported_reasoning_efforts: ['none', 'low', 'medium', 'high'] });
  assert.equal(reasoningOptions({ thinking: 'off', reasoningEffort: 'high' }, caps), 'none');
  assert.equal(reasoningOptions({ thinking: 'on' }, caps), 'medium');
  assert.throws(() => reasoningOptions({ thinking: 'on', reasoningEffort: 'none' }, caps));
});

test('compression protects whole first and recent turns including tool results', () => {
  const messages = [
    { id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant', parts: [{ type: 'tool-get_file' }] },
    { id: 'u2', role: 'user' }, { id: 'a2', role: 'assistant' },
    { id: 'u3', role: 'user' }, { id: 'a3', role: 'assistant' },
    { id: 'u4', role: 'user' }, { id: 'a4', role: 'assistant' },
  ];
  const split = splitForCompression(messages, 1, 1);
  assert.deepEqual(split.head.map(m => m.id), ['u1', 'a1']);
  assert.deepEqual(split.tail.map(m => m.id), ['u4', 'a4']);
  assert.deepEqual(split.foldable.flat().map(m => m.id), ['u2', 'a2', 'u3', 'a3']);
  assert.ok(estimateTokens('中文测试') > estimateTokens('test'));
});

test('edit anchors track moved text and reject undo over later changes', () => {
  const original = 'before\nold sentence\nafter';
  const at = locateEdit(original, 'old sentence', 2);
  const anchor = makeAnchor(original, at, 'old sentence', 'new sentence');
  assert.equal(anchorMatches(original, anchor, 'before'), true);
  assert.equal(anchorMatches(original.replace('old sentence', 'new sentence'), anchor, 'after'), true);
  assert.equal(anchorMatches(original.replace('old sentence', 'new user edit'), anchor, 'after'), false);
  assert.throws(() => locateEdit('same\nsame', 'same', 1), /多次/);
  assert.equal(locateAnchoredEdit('prefix\n' + original, 'old sentence', 2, anchor), 'prefix\nbefore\n'.length);
});

test('empty insertions and complete deletions use surrounding context rather than stale line numbers', () => {
  const anchor = makeAnchor('one\ntwo', 4, '', 'added\n');
  assert.equal(locateAnchoredEdit('one\ntwo', '', 99, anchor), 4);
  assert.throws(() => locateAnchoredEdit('one\nchanged', '', 2, anchor), /上下文/);
  const deletion = makeAnchor('all text', 0, 'all text', '');
  assert.equal(anchorMatches('', deletion, 'after'), true);
  const insertion = makeAnchor('', 0, '', 'new');
  assert.equal(anchorMatches('new', insertion, 'after'), true);
});

test('translation restores TeX exactly and detects missing formula placeholders', () => {
  const source = String.raw`Let $L=D-A$ and \(\lambda_2(L)\) be defined. $$x^2+y^2$$`;
  const value = protectMath(source, 'fixture');
  assert.ok(!value.text.includes('lambda'));
  assert.equal(value.restore(value.text.replace('Let', '设')), source.replace('Let', '设'));
  assert.throws(() => value.restore('a translation without tokens'), /公式标记/);
  const money = '$5 and $10';
  assert.equal(protectMath(money, 'money').text, money);
  const block = String.raw`before \begin{align}a&=b\\c&=d\end{align} after`;
  const protectedBlock = protectMath(block, 'block');
  assert.equal(protectedBlock.restore(protectedBlock.text), block);
});
