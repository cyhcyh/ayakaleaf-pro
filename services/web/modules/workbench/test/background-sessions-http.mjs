// Synthetic accounts on the isolated 39080 stack only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { Session, base } from './http-session.mjs';

const fixture = JSON.parse(await fs.readFile(process.env.PERSONAL_AI_BACKGROUND_FIXTURE, 'utf8'));
const client = new Session();
await client.request('/login');
await client.request('/login', { email: fixture.email, password: fixture.password });
await client.request('/project');
const projectId = (await client.request('/project/new', { projectName: 'Background session verification', template: 'blank' })).json.project_id;
const checks = [];
const create = async () => (await client.request('/personal-ai/sessions', { projectId })).json;
const a = await create(), b = await create();
const review = (await client.request('/personal-ai/reviews/approve', { projectId, chatId: a.id, scope: '*', focus: 'Check proof.' })).json;
await client.request(`/personal-ai/sessions/${b.id}/activate`, { projectId });
await client.request(`/personal-ai/sessions/${a.id}/activate`, { projectId });
await client.request('/personal-ai/reviews/check', { projectId, chatId: a.id, reviewId: review.reviewId, path: 'main.tex' });
let revision = (await client.request(`/personal-ai/sessions/${a.id}/rename`, { projectId, title: 'Still working' })).json.revision;
assert.equal(revision, 1);
revision = (await client.request(`/personal-ai/sessions/${a.id}/save`, { projectId, revision, messages: [] })).json.revision;
await client.request('/personal-ai/reviews/check', { projectId, chatId: a.id, reviewId: review.reviewId, path: 'main.tex' });
checks.push('activation and renaming keep review approval valid; returned rename revision permits the next save');

const sourceReply = await client.request('/workbench/chat', { projectId, id: a.id, messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: '[TEST:PROJECTFILE]' }] }], enabledTools: [] });
const frames = sourceReply.text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
const source = frames.find(frame => frame.type === 'tool-output-available' && frame.output?.name === 'main.tex')?.output.text;
assert.ok(source);
const quote = source.split('\n')[0];
const input = { path: 'main.tex', startLine: 1, endLine: 1, oldText: quote, newText: quote + '\n% First draft', reason: 'First draft.' };
const propose = async (chatId, value, toolCallId = randomUUID()) => (await client.request('/personal-ai/edits', { projectId, chatId, toolCallId, input: value })).json;
const first = await propose(a.id, input);
const secondInput = { ...input, newText: quote + '\n% Improved draft', reason: 'Improved draft.' };
const secondCall = randomUUID();
const second = await propose(a.id, secondInput, secondCall);
assert.deepEqual(second.replaces, [first.id]);
assert.equal(second.positionedAt, first.createdAt);
assert.equal((await client.request(`/personal-ai/edits/${first.id}?projectId=${projectId}`)).json.state, 'superseded');
await client.request(`/personal-ai/edits/${first.id}/begin`, { projectId, revision: first.revision, action: 'reject' }, 409);
const replay = await propose(a.id, secondInput, secondCall);
assert.equal(replay.id, second.id);
let listed = (await client.request(`/personal-ai/edits?projectId=${projectId}`)).json.items;
assert.ok(listed.some(row => row.id === second.id));
assert.ok(!listed.some(row => row.id === first.id));
checks.push('a revised passage has one visible pending card; old calls remain readable and cannot be applied; tool replay is idempotent');

const alternative = await propose(a.id, { ...input, keepSeparate: true, newText: quote + '\n% Separate alternative' });
const otherChat = await propose(b.id, input);
const third = await propose(a.id, { ...input, replacesEditId: second.id, newText: quote + '\n% Final draft' });
assert.deepEqual(third.replaces, [second.id]);
listed = (await client.request(`/personal-ai/edits?projectId=${projectId}`)).json.items;
assert.ok([alternative.id, otherChat.id, third.id].every(id => listed.some(row => row.id === id)));
const cross = await propose(a.id, { ...input, replacesEditId: otherChat.id });
assert.deepEqual(cross.replaces, [otherChat.id]);
assert.equal((await client.request(`/personal-ai/edits/${otherChat.id}?projectId=${projectId}`)).json.state, 'superseded');
await client.request('/personal-ai/edits', { projectId, chatId: a.id, toolCallId: randomUUID(), input: { ...input, replacesEditId: alternative.id, oldText: '\\begin{document}', newText: '% Unrelated' } }, 409);
checks.push('explicit alternatives remain independent; an explicit cross-conversation continuation replaces only its target and rejects unrelated passages');

const longParts = Array.from({ length: 500 }, (_, index) => [
  { type: 'step-start' }, { type: 'tool-list_project_files', toolCallId: `budget-${index}`, state: 'output-available', input: {}, output: ['main.tex'] },
]).flat();
const user = { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Tool budget check.' }] };
const assistant = { id: randomUUID(), role: 'assistant', parts: longParts };
await client.request(`/personal-ai/sessions/${a.id}/save`, { projectId, revision, messages: [{ order: 0, message: user }, { order: 1, message: assistant }] });
await client.request('/workbench/chat', { projectId, id: a.id, sessionContext: true, messageOffset: 0, messages: [user, assistant], enabledTools: [] }, 409);
const below = { ...assistant, parts: longParts.slice(0, -2) };
// Isolate the call budget from the fixture model's small context window.
const profile = (await client.request('/personal-ai/settings')).json;
await client.request('/personal-ai/settings', { ...profile, compression: { ...profile.compression, enabled: false } });
try {
  const allowed = await client.request('/workbench/chat', { projectId, id: b.id, messages: [user, below], enabledTools: [] });
  assert.ok(!allowed.text.includes('"type":"error"'));
} finally {
  const latest = (await client.request('/personal-ai/settings')).json;
  await client.request('/personal-ai/settings', { ...latest, compression: profile.compression });
}
checks.push('500 calls fit saved history; default budget rejects call 501 while 499 calls still allow a model response');

await client.request('/personal-ai/sessions/delete', { projectId, ids: [a.id] });
await client.request(`/personal-ai/sessions/${a.id}/activate`, { projectId }, 404);
await client.request(`/personal-ai/sessions/${b.id}/activate`, { projectId });
await client.request(`/personal-ai/sessions/${a.id}/save`, { projectId, revision: 999, messages: [] }, 404);
await client.request('/personal-ai/edits', { projectId, chatId: a.id, toolCallId: randomUUID(), input }, 409);
listed = (await client.request(`/personal-ai/edits?projectId=${projectId}`)).json.items;
assert.ok(listed.some(row => row.id === third.id));
checks.push('selected deletion preserves other sessions and edit records, and blocks late saves, proposals and activation');

await client.request('/personal-ai/history/clear', { projectId, scope: 'project' });
await client.request(`/personal-ai/sessions/${b.id}/activate`, { projectId }, 404);
assert.equal((await client.request(`/personal-ai/sessions?projectId=${projectId}`)).json.items.length, 0);
assert.ok((await client.request(`/personal-ai/edits?projectId=${projectId}`)).json.items.length > 0);

// Live upstream requests must actually stop, not merely disappear from history.
async function stream(project, chatId) {
  const response = await fetch(base + '/workbench/chat', { method: 'POST', headers: {
    Cookie: [...client.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
    'Content-Type': 'application/json', 'X-Csrf-Token': client.csrf,
  }, body: JSON.stringify({ projectId: project, id: chatId, enabledTools: [], messages: [
    { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: '[QUEUE:SLOW] Scope isolation.' }] },
  ] }) });
  assert.equal(response.status, 200);
  const state = { ended: false };
  const done = response.text().finally(() => { state.ended = true });
  return { state, done };
}
async function stopped(run) {
  let timer;
  try { await Promise.race([run.done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Deleted conversation kept streaming')), 5000) })]) }
  finally { clearTimeout(timer) }
}
const otherProject = (await client.request('/project/new', { projectName: 'Background scope B', template: 'blank' })).json.project_id;
const liveA = await create(), liveB = await create();
const liveC = (await client.request('/personal-ai/sessions', { projectId: otherProject })).json;
const runA = await stream(projectId, liveA.id), runB = await stream(projectId, liveB.id), runC = await stream(otherProject, liveC.id);
await client.request('/personal-ai/sessions/delete', { projectId, ids: [liveA.id] });
await stopped(runA);
assert.equal(runB.state.ended, false); assert.equal(runC.state.ended, false);
await client.request('/personal-ai/history/clear', { projectId, scope: 'project' });
await stopped(runB); assert.equal(runC.state.ended, false);
await client.request('/personal-ai/history/clear', { projectId, scope: 'all' });
await stopped(runC);
checks.push('live model streams stop on selected deletion, project clear and all-project clear without stopping unrelated runs');
console.log(JSON.stringify({ passed: true, checks }, null, 2));
