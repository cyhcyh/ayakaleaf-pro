import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAnchor } from '../shared/edit-anchor.mjs';
import { sameEditTarget, legacyEditGroups } from '../shared/edit-successors.mjs';
import { registerChatRun, stopChatRuns } from '../app/src/personal-ai/ActiveChatRuns.mjs';

const content = 'Heading\nThe original paragraph.\nA different paragraph.\n';
const input = { path: 'main.tex', startLine: 2, endLine: 2, oldText: 'The original paragraph.', newText: 'Revised.' };
const record = (extra = {}) => ({ id: 'old', chatId: 'chat', state: 'pending', operation: null, input,
  createdAt: '2026-10-01T00:00:00Z', proposalAnchor: makeAnchor(content, 8, input.oldText, input.newText), ...extra });

test('a revision matches actual source and anchor, including moved line numbers', () => {
  assert.ok(sameEditTarget(content, record(), { ...input, newText: 'New revision.', startLine: 99 }));
  assert.ok(!sameEditTarget(content, record(), { ...input, oldText: 'A different paragraph.' }));
  assert.ok(!sameEditTarget(content.replace(input.oldText, 'User changed this.'), record(), input));
  assert.ok(!sameEditTarget(content, record({ state: 'accepted' }), input));
  assert.ok(!sameEditTarget(content, record({ operation: { id: 'busy' } }), input));
  assert.ok(!sameEditTarget(content, record(), { ...input, path: 'other.tex' }));
});

test('expanded or narrowed revisions require an explicit predecessor and must overlap', () => {
  const narrow = { ...input, oldText: 'original', newText: 'revised' };
  assert.ok(!sameEditTarget(content, record(), narrow));
  assert.ok(sameEditTarget(content, record(), narrow, true));
  assert.ok(!sameEditTarget(content, record(), { ...input, oldText: 'A different paragraph.' }, true));
});

test('insertion targets require unique source context', () => {
  const insert = { ...input, oldText: '', startLine: 2 };
  const previous = record({ input: insert, proposalAnchor: makeAnchor(content, 8, '', 'Added.') });
  assert.ok(sameEditTarget(content, previous, insert));
  assert.ok(!sameEditTarget(content, previous, { ...insert, startLine: 3 }));
});

test('legacy grouping keeps alternatives, separate conversations and uncertain locations', () => {
  const latest = record({ id: 'latest', createdAt: '2026-10-02T00:00:00Z', input: { ...input, newText: 'Latest.' } });
  const groups = legacyEditGroups([record(), latest, record({ id: 'alt', input: { ...input, keepSeparate: true } }),
    record({ chatId: 'other-chat' }), record({ proposalAnchor: undefined }), record({ state: 'accepted' })]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(row => row.id), ['latest', 'old']);
});

test('server cancellation is scoped by user, project and selected conversations', () => {
  const scopes = [['alice', 'p1', 'a'], ['alice', 'p1', 'b'], ['alice', 'p2', 'c'], ['bob', 'p1', 'd']];
  const controllers = scopes.map(() => new AbortController());
  const release = scopes.map((scope, at) => registerChatRun(...scope, controllers[at]));
  stopChatRuns('alice', 'p1', ['a']);
  assert.deepEqual(controllers.map(item => item.signal.aborted), [true, false, false, false]);
  stopChatRuns('alice', 'p1');
  assert.deepEqual(controllers.map(item => item.signal.aborted), [true, true, false, false]);
  stopChatRuns('alice');
  assert.deepEqual(controllers.map(item => item.signal.aborted), [true, true, true, false]);
  release.forEach(done => done());
  stopChatRuns('bob');
  assert.equal(controllers[3].signal.aborted, false);
});
