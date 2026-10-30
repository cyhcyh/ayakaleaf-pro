import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditRetryGuard, readEditFailure, encodeEditFailure, editConflict } from '../shared/edit-recovery.mjs';
import { legacyEditGroups } from '../shared/edit-successors.mjs';

test('edit conflict details survive tool history without exposing JSON in the UI message', () => {
  const failure = editConflict('edit_superseded', 'Check the latest suggestion.', { latestEditId: 'latest', action: 'find_edit_suggestions' });
  assert.equal(failure.status, 409);
  assert.deepEqual(readEditFailure(encodeEditFailure(failure)), { kind: 'edit_conflict', code: failure.code, message: failure.message, details: failure.details });
  for (const text of ['Old plain error', undefined, '{bad json}', '{}', '{"kind":"other"}']) assert.equal(readEditFailure(text), null);
});

test('a missing ID stops on its second failure, even if the model rewrites the draft', () => {
  const guard = createEditRetryGuard(), failure = { code: 'edit_target_not_found' };
  const input = { path: 'main.tex', replacesEditId: '00000000-0000-0000-0000-000000000000', oldText: 'Source.', newText: 'Draft.' };
  assert.equal(guard.failed(input, failure), false);
  assert.equal(guard.failed({ ...input, reason: 'Changed reason', newText: 'Another draft.' }, failure), true);
  assert.equal(guard.failed({ ...input, replacesEditId: 'real-id' }, failure), false);
  guard.reset();
  assert.equal(guard.failed(input, failure), false);
});

test('source corrections can recover while repeated stale source is bounded', () => {
  const guard = createEditRetryGuard(), failure = { code: 'edit_source_changed' };
  assert.equal(guard.failed({ path: 'main.tex', oldText: 'Old.' }, failure), false);
  assert.equal(guard.failed({ path: 'main.tex', oldText: 'Current.' }, failure), false);
  assert.equal(guard.failed({ path: 'main.tex', oldText: 'Old.', startLine: 99 }, failure), true);
  assert.equal(guard.failed({}, null), false);
  assert.equal(guard.failed({}, { code: 'network_error' }), false);
});

test('cross-conversation successors preserve independent suggestion origins during legacy folding', () => {
  const base = { state: 'pending', chatId: 'current', input: { path: 'main.tex', oldText: 'Source.' },
    proposalAnchor: { prefix: '', suffix: '\nNext', atStart: true, atEnd: false }, createdAt: new Date() };
  assert.equal(legacyEditGroups([{ ...base, originChatId: 'earlier' }, { ...base }]).length, 0);
  assert.equal(legacyEditGroups([{ ...base, originChatId: 'earlier' }, { ...base, originChatId: 'earlier' }]).length, 1);
});
