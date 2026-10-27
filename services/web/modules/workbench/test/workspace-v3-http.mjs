import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { Session } from './http-session.mjs';

const fixturePath = process.env.PERSONAL_AI_V3_FIXTURE;
if (!fixturePath) throw new Error('Use the isolated verification fixture');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const alice = new Session();
await alice.request('/login');
await alice.request('/login', { email: fixture.email, password: fixture.password });
await alice.request('/project');
const a = fixture.projectId;
const b = (await alice.request('/project/new', { projectName: 'History scope B', template: 'blank' })).json.project_id;
const lifecycle = (await alice.request('/project/new', { projectName: 'Lifecycle verification', template: 'blank' })).json.project_id;
const checks = [];
async function chat(client, projectId, title, text) {
  const session = (await client.request('/personal-ai/sessions', { projectId })).json;
  await client.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision: 0, messages: [
    { order: 0, message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] } },
    { order: 1, message: { id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text: 'Consider spectral robustness.' }, { type: 'tool-read_reference', state: 'output-available', toolCallId: 'search-exclusion', input: {}, output: { text: 'HiddenToolPayload' } }] } },
  ] });
  await client.request(`/personal-ai/sessions/${session.id}/rename`, { projectId, title });
  return (await client.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}`)).json;
}
const first = await chat(alice, a, 'Proof discussion', 'Check the exact formula $L=D-A$ and 中文原文.');
const second = await chat(alice, b, 'Other project', 'Project B notes.');
for (const query of ['Proof discussion', 'spectral', '$L=D-A$', '中文原文']) {
  const items = (await alice.request(`/personal-ai/sessions?projectId=${a}&q=${encodeURIComponent(query)}`)).json.items;
  assert.ok(items.some(item => item.id === first.id));
  if (query !== 'Proof discussion') assert.ok(items.find(item => item.id === first.id).snippet.includes(query));
}
for (const query of ['HiddenToolPayload', '.*', 'Project B notes'])
  assert.equal((await alice.request(`/personal-ai/sessions?projectId=${a}&q=${encodeURIComponent(query)}`)).json.items.length, 0);
checks.push('title and dialogue search, literal metacharacters, Chinese and snippets without tool payloads or cross-project results');

const bob = new Session(), password = `Verify!${crypto.randomBytes(12).toString('hex')}`, email = `history-${crypto.randomUUID()}@localhost.test`;
await bob.request('/login'); await bob.request('/register', { email, password });
await bob.request('/login'); await bob.request('/login', { email, password }); await bob.request('/project');
const bobProject = (await bob.request('/project/new', { projectName: 'Bob private history', template: 'blank' })).json.project_id;
const bobChat = await chat(bob, bobProject, 'Other account', 'Private dialogue.');
await bob.request(`/personal-ai/history/count?projectId=${a}&scope=all`, undefined, 403);
await bob.request('/personal-ai/history/clear', { projectId: a, scope: 'all' }, 403);
checks.push('history counts and clearing require current-project access and remain account scoped');

const profile = (await alice.request('/personal-ai/settings')).json;
const editsBefore = (await alice.request(`/personal-ai/edits?projectId=${a}`)).json.items.map(item => item.id).sort();
const upload = (await alice.request('/personal-ai/references', { projectId: a, name: 'retained-reference.txt', mediaType: 'text/plain', data: Buffer.from('Retained project reference.').toString('base64') })).json;
assert.ok((await alice.request(`/personal-ai/history/count?projectId=${a}&scope=project`)).json.count >= 1);
await alice.request('/personal-ai/history/clear', { projectId: a, scope: 'project' });
assert.equal((await alice.request(`/personal-ai/history/count?projectId=${a}&scope=project`)).json.count, 0);
await alice.request(`/personal-ai/sessions/${first.id}?projectId=${a}`, undefined, 404);
await alice.request(`/personal-ai/sessions/${first.id}/save`, { projectId: a, revision: first.revision, messages: [] }, 404);
assert.equal((await alice.request(`/personal-ai/sessions/${second.id}?projectId=${b}`)).json.title, 'Other project');
assert.deepEqual((await alice.request(`/personal-ai/edits?projectId=${a}`)).json.items.map(item => item.id).sort(), editsBefore);
assert.equal((await alice.request('/personal-ai/settings')).json.revision, profile.revision);
const draft = (await alice.request(`/personal-ai/sessions/current?projectId=${a}`)).json;
assert.equal((await alice.request(`/personal-ai/history/count?projectId=${a}&scope=project`)).json.count, 0);
assert.equal((await alice.request(`/personal-ai/sessions?projectId=${a}`)).json.items.length, 0);
await alice.request('/personal-ai/reviews/approve', { projectId: a, chatId: first.id, scope: '*', focus: 'stale approval' }, 409);
checks.push('current-project clear preserves other projects, connections and edit ledger; stale saves and approvals do not revive history; empty drafts stay out of history');

await chat(alice, a, 'After clear', 'A new conversation.');
await alice.request('/personal-ai/history/clear', { projectId: a, scope: 'all' });
assert.equal((await alice.request(`/personal-ai/history/count?projectId=${a}&scope=all`)).json.count, 0);
await alice.request(`/personal-ai/sessions/${second.id}?projectId=${b}`, undefined, 404);
assert.equal((await bob.request(`/personal-ai/sessions/${bobChat.id}?projectId=${bobProject}`)).json.title, 'Other account');
checks.push('all-project clear removes only the signed-in account history');

const lifecycleChat = await chat(alice, lifecycle, 'Lifecycle notes', 'Keep until permanent deletion.');
const lifecycleRef = (await alice.request('/personal-ai/references', { projectId: lifecycle, name: 'lifecycle.txt', mediaType: 'text/plain', data: Buffer.from('Lifecycle reference.').toString('base64') })).json;
await fs.writeFile(fixturePath, JSON.stringify({ ...fixture, secondaryProjectId: b, lifecycleProjectId: lifecycle, lifecycleChatId: lifecycleChat.id, lifecycleReferenceId: lifecycleRef.id, retainedReferenceId: upload.id, bobProject, bobChatId: bobChat.id, draftId: draft.id }));
console.log(JSON.stringify({ passed: true, checks, lifecycleProjectId: lifecycle }, null, 2));
