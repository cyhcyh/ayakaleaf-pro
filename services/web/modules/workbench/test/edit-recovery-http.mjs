import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { Session } from './http-session.mjs';

const fixture = JSON.parse(await fs.readFile(process.env.PERSONAL_AI_RECOVERY_FIXTURE, 'utf8'));
const client = new Session();
await client.request('/login'); await client.request('/login', { email: fixture.email, password: fixture.password }); await client.request('/project');
const projectId = (await client.request('/project/new', { projectName: 'Edit recovery verification', template: 'blank' })).json.project_id;
const create = async project => (await client.request('/personal-ai/sessions', { projectId: project || projectId })).json;
const old = await create(), current = await create();
const input = { path: 'main.tex', startLine: 1, endLine: 1, oldText: '\\documentclass{article}', newText: '\\documentclass{article}\n% Initial draft' };
const propose = async (chatId, value, expected = 200, project = projectId) => (await client.request('/personal-ai/edits', { projectId: project, chatId, toolCallId: randomUUID(), input: value }, expected)).json;
const checks = [];
const original = await propose(old.id, input);
async function discover(session, project = projectId) {
  const result = await client.request('/workbench/chat', { projectId: project, id: session.id, enabledTools: [], messages: [
    { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: '[REPAIR:DISCOVER]' }] },
  ] });
  const events = result.text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  return events.find(event => event.type === 'tool-output-available' && Array.isArray(event.output?.items))?.output;
}
let found = await discover(current);
assert.ok(found.items.some(row => row.id === original.id && !row.sameConversation));
assert.ok(!JSON.stringify(found).includes('userId'));
checks.push('the model can discover real pending IDs from earlier conversations in the same project');

const independent = await propose(current.id, { ...input, replacesEditId: null, keepSeparate: null });
assert.deepEqual(independent.replaces, []);
const revised = await propose(current.id, { ...input, replacesEditId: original.id, newText: input.oldText + '\n% Cross-session continuation' });
assert.deepEqual(revised.replaces, [original.id]);
assert.equal(revised.originChatId, old.id);
let listed = (await client.request(`/personal-ai/edits?projectId=${projectId}`)).json.items;
assert.ok(listed.some(row => row.id === revised.id));
assert.ok(listed.some(row => row.id === independent.id));
assert.ok(!listed.some(row => row.id === original.id));
const ambiguous = await propose(current.id, input, 409);
assert.equal(ambiguous.code, 'edit_target_ambiguous');
checks.push('explicit continuation updates the old card while a separate current-conversation suggestion remains independent; null optional fields work');

for (const id of ['00000000-0000-0000-0000-000000000000', randomUUID(), 'not-a-valid-id', '']) {
  const failure = await propose(current.id, { ...input, replacesEditId: id }, 409);
  assert.equal(failure.code, 'edit_target_not_found');
  assert.equal(failure.details.action, 'find_edit_suggestions');
}
const superseded = await propose(current.id, { ...input, replacesEditId: original.id }, 409);
assert.equal(superseded.code, 'edit_superseded'); assert.equal(superseded.details.latestEditId, revised.id);
const staleSource = await propose(current.id, { ...input, oldText: 'This is not in the source.', replacesEditId: revised.id }, 409);
assert.equal(staleSource.code, 'edit_source_changed');
const unrelated = await propose(current.id, { ...input, oldText: '\\begin{document}', newText: '% Different location', replacesEditId: revised.id }, 409);
assert.equal(unrelated.code, 'edit_target_mismatch');
const rejected = (await client.request(`/personal-ai/edits/${independent.id}/begin`, { projectId, revision: independent.revision, action: 'reject' })).json;
assert.equal(rejected.state, 'rejected');
assert.equal((await propose(current.id, { ...input, replacesEditId: independent.id }, 409)).code, 'edit_not_pending');
checks.push('nil, malformed, empty and unknown IDs have actionable errors; superseded IDs identify the latest suggestion; stale source and processed cards are distinguished');

const foreignProject = (await client.request('/project/new', { projectName: 'Other edit scope', template: 'blank' })).json.project_id;
const foreignSession = await create(foreignProject);
const foreign = await propose(foreignSession.id, input, 200, foreignProject);
assert.equal((await propose(current.id, { ...input, replacesEditId: foreign.id }, 409)).code, 'edit_target_not_found');
found = await discover(current);
assert.ok(!found.items.some(row => row.id === foreign.id));
const bob = new Session(), email = `recovery-${randomUUID()}@localhost.test`, password = `Verify!${randomBytes(12).toString('hex')}`;
await bob.request('/login'); await bob.request('/register', { email, password }); await bob.request('/login'); await bob.request('/login', { email, password }); await bob.request('/project');
await bob.request('/personal-ai/edits', { projectId, chatId: current.id, toolCallId: randomUUID(), input: { ...input, replacesEditId: revised.id } }, 403);
checks.push('discovery and explicit replacement never cross project or account boundaries');

await client.request('/personal-ai/sessions/delete', { projectId, ids: [old.id] });
const latest = await propose(current.id, { ...input, replacesEditId: revised.id, newText: input.oldText + '\n% Later continuation' });
assert.deepEqual(latest.replaces, [revised.id]);
assert.equal(latest.originChatId, old.id);
assert.equal((await propose(current.id, { ...input, replacesEditId: original.id }, 409)).details.latestEditId, latest.id);
assert.ok(!(await client.request(`/personal-ai/edits?projectId=${projectId}`)).json.items.some(row => row.id === revised.id));
checks.push('continuation remains valid after the origin conversation is deleted, while processed records stay preserved');
console.log(JSON.stringify({ passed: true, checks }, null, 2));
