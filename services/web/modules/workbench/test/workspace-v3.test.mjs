import test from 'node:test';
import assert from 'node:assert/strict';
import { contextBudget, summaryBudget } from '../shared/compression-budget.mjs';
import { messageText, searchSnippet } from '../shared/session-search.mjs';
import { translationDotPosition } from '../shared/selection-position.mjs';

test('missing model limits use Papers-Go defaults and retain manual and model bounds', () => {
  assert.equal(contextBudget(0, 0), 256000);
  assert.equal(contextBudget(0, NaN), 256000);
  assert.equal(contextBudget(64000, 0), 64000);
  assert.equal(contextBudget(64000, 32000), 32000);
  const policy = { summaryMaxTokens: 0, targetRatio: .2 };
  assert.equal(summaryBudget(policy, 256000, 256000, 0), 8192);
  assert.equal(summaryBudget(policy, 256000, 256000, 4096), 4096);
  assert.equal(summaryBudget({ ...policy, summaryMaxTokens: 1000 }, 256000, 256000, 4096), 1000);
  assert.equal(summaryBudget(policy, 10000, 3000, 8192), 1000);
});

test('search previews include dialogue text and exclude tool payloads', () => {
  const value = messageText({ role: 'assistant', parts: [{ type: 'text', text: 'Check the Spectral Lemma and its assumptions.' }, { type: 'tool-read_reference', output: 'private tool payload' }] });
  assert.ok(searchSnippet(value, 'spectral lemma').includes('Spectral Lemma'));
  assert.equal(searchSnippet(value, 'private tool'), '');
  assert.equal(messageText({ role: 'system', parts: [{ type: 'text', text: 'system prompt' }] }), '');
  assert.equal(searchSnippet('这里包含中文原文。', '中文'), '这里包含中文原文。');
  assert.equal(searchSnippet('Read $L=D-A$ exactly.', '$L=D-A$'), 'Read $L=D-A$ exactly.');
});

test('translation dot moves up and stays clear of native comment menus and viewport edges', () => {
  const selection = { right: 390, bottom: 110 };
  const plain = translationDotPosition(selection, 1280, 720);
  assert.equal(plain.y, 98);
  const obstacle = { left: 370, right: 560, top: 94, bottom: 150, width: 190, height: 56 };
  const avoided = translationDotPosition(selection, 1280, 720, [obstacle]);
  assert.ok(avoided.y + 24 <= obstacle.top - 8);
  const edge = translationDotPosition({ right: 1280, bottom: 1 }, 1280, 720, [{ left: 1200, right: 1280, top: 0, bottom: 50, width: 80, height: 50 }]);
  assert.ok(edge.x >= 8 && edge.x + 24 <= 1280 - 8 && edge.y >= 8);
});
