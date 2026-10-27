import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { Session } from './http-session.mjs';

const fixturePath = process.env.PERSONAL_AI_V2_FIXTURE;
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const alice = new Session();
await alice.request('/login'); await alice.request('/login', { email: fixture.email, password: fixture.password }); await alice.request('/project');
const projectId = (await alice.request('/project/new', { projectName: 'Long conversation verification', template: 'blank' })).json.project_id;
const session = (await alice.request('/personal-ai/sessions', { projectId })).json;
let revision = session.revision;
const checks = [];
const messages = Array.from({ length: 120 }, (_, turn) => [
  { id: `h-user-${turn}`, role: 'user', parts: [{ type: 'text', text: `[HISTORY:${turn}] 第 ${turn} 轮：请检查公式 $L=D-A$，并保留证明的前提。` }] },
  { id: `h-assistant-${turn}`, role: 'assistant', parts: [{ type: 'text', text: `第 ${turn} 轮结论：应核对图的定义、边集和引用。`.repeat(6) }] },
]).flat();
for (let start = 0; start < messages.length; start += 100) {
  revision = (await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision,
    messages: messages.slice(start, start + 100).map((message, i) => ({ message, order: start + i })) })).json.revision;
}
let page = (await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}&paged=true`)).json;
assert.equal(page.messages.length, 40); assert.equal(page.messageOffset, 200); assert.equal(page.olderBefore, 200);
let gathered = [...page.messages], before = page.olderBefore;
while (before !== null) {
  const earlier = (await alice.request(`/personal-ai/sessions/${session.id}/messages?projectId=${projectId}&before=${before}`)).json;
  assert.equal(earlier.messages[0].role, 'user'); assert.ok(earlier.messages.length <= 40);
  gathered = [...earlier.messages, ...gathered]; before = earlier.olderBefore;
}
assert.deepEqual(gathered, messages);
checks.push('120 complete turns paginate backwards without missing or duplicating messages');
const binding = { connectionId: 'local-fixture', model: 'fix-model', thinking: 'on', reasoningEffort: 'medium' };
revision = (await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision, messages: [], binding })).json.revision;
assert.deepEqual((await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}&paged=true`)).json.binding, binding);
const otherSession = (await alice.request('/personal-ai/sessions', { projectId })).json;
assert.equal(otherSession.binding, null);
let profile = (await alice.request('/personal-ai/settings')).json;
const profileBefore = JSON.stringify(profile.bindings);
profile.compression.enabled = false;
profile = (await alice.request('/personal-ai/settings', profile)).json;
const tail = [...page.messages, { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Continue the proof.' }] }];
const sent = await alice.request('/workbench/chat', { projectId, id: session.id, sessionContext: true, messageOffset: page.messageOffset,
  messages: tail, enabledTools: [] });
assert.ok(!sent.text.includes('"type":"error"'), sent.text.slice(-500));
assert.equal(JSON.stringify((await alice.request('/personal-ai/settings')).json.bindings), profileBefore);
const call = (await (await fetch('http://127.0.0.1:39001/debug')).json()).at(-1);
assert.equal(call.model, 'fix-model'); assert.equal(call.reasoningEffort, 'medium');
assert.ok(call.historyMarkers.includes('[HISTORY:0]')); assert.ok(call.historyMarkers.includes('[HISTORY:119]'));
assert.equal(call.historyMarkers.length, 120);
checks.push('session model and reasoning persist independently and hidden display pages still reach the model');
await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision, messages: [], binding: { ...binding, connectionId: 'not-owned' } }, 400);
await alice.request('/workbench/chat', { projectId, id: session.id, sessionContext: true, messageOffset: 200, binding: { ...binding, reasoningEffort: 'ultra' }, messages: tail }, 400);
await alice.request('/workbench/chat', { projectId: fixture.projectId, id: session.id, sessionContext: true, messageOffset: 200, messages: tail }, 404);
const bob = new Session(), bobPassword = 'Verify!' + crypto.randomBytes(12).toString('hex'), bobEmail = `v4-reader-${crypto.randomBytes(5).toString('hex')}@localhost.test`;
await bob.request('/login'); await bob.request('/register', { email: bobEmail, password: bobPassword });
await bob.request('/login'); await bob.request('/login', { email: bobEmail, password: bobPassword }); await bob.request('/project');
await bob.request(`/personal-ai/sessions/${session.id}/messages?projectId=${projectId}&before=200`, undefined, 403);
// A different project scope cannot retrieve the session, even for its owner.
await alice.request(`/personal-ai/sessions/${session.id}/messages?projectId=${fixture.projectId}&before=200`, undefined, 404);
checks.push('session and connection ownership, reasoning capabilities and project scopes are enforced');
const previousChatBinding = profile.bindings.chat;
profile = (await alice.request('/personal-ai/settings', { ...profile, bindings: { ...profile.bindings, chat: { connectionId: '', model: '' } } })).json;
assert.equal((await alice.request('/workbench/access')).json.allowed, false);
assert.equal((await alice.request('/workbench/access')).json.enabled, true);
try {
  const independent = await alice.request('/workbench/chat', { projectId, id: session.id, sessionContext: true, messageOffset: page.messageOffset, messages: tail });
  assert.ok(!independent.text.includes('"type":"error"'));
} finally { profile = (await alice.request('/personal-ai/settings', { ...profile, bindings: { ...profile.bindings, chat: previousChatBinding } })).json; }
checks.push('an authorized session can use its own connection without a global default model');
const cleared = (await alice.request('/personal-ai/sessions', { projectId })).json;
await alice.request('/personal-ai/sessions/delete', { projectId, ids: [cleared.id] });
await alice.request('/workbench/chat', { projectId, id: cleared.id, sessionContext: true, messageOffset: 0, messages: tail }, 404);
checks.push('cleared sessions reject delayed context reconstruction and model requests');
fixture.longProjectId = projectId; fixture.longSessionId = session.id;
await fs.writeFile(fixturePath, JSON.stringify(fixture));
console.log(JSON.stringify({ passed: true, checks, projectId, sessionId: session.id }, null, 2));
