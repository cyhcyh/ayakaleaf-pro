import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { Session } from './http-session.mjs';
import { makeAnchor } from '../shared/edit-anchor.mjs';

const fixturePath = process.env.PERSONAL_AI_V2_FIXTURE;
if (!fixturePath) throw new Error('Set PERSONAL_AI_V2_FIXTURE to the isolated fixture created by personal-ai-http.mjs');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const { projectId } = fixture;
const alice = new Session();
await alice.request('/login');
await alice.request('/login', { email: fixture.email, password: fixture.password });
await alice.request('/project');
const checks = [];

let profile = (await alice.request('/personal-ai/settings')).json;
assert.ok(profile.connections[0].catalog.models.length);
assert.ok(profile.compression.threshold >= .1 && profile.compression.threshold <= .95);
profile.bindings.chat = { ...profile.bindings.chat, thinking: 'on', reasoningEffort: 'high' };
profile.bindings.compression = { connectionId: 'local-fixture', model: 'fix-model', thinking: 'on', reasoningEffort: 'low' };
profile = (await alice.request('/personal-ai/settings', profile)).json;
assert.equal(profile.bindings.chat.reasoningEffort, 'high');
assert.equal(profile.bindings.compression.model, 'fix-model');
const invalid = structuredClone(profile); invalid.bindings.chat.reasoningEffort = 'ultra';
await alice.request('/personal-ai/settings', invalid, 400);
checks.push('persisted model catalog and capability-bound independent reasoning settings');

const current = (await alice.request(`/personal-ai/sessions/current?projectId=${projectId}`)).json;
let session = (await alice.request('/personal-ai/sessions', { projectId })).json;
let revision = session.revision;
const userMessage = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'A persistent research conversation' }] };
const pendingTool = { id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'tool-run_compile', toolCallId: 'interrupted-call', state: 'input-available', input: {} }] };
const summary = { summary: 'Historical context; not fresh approval.', upToMessageId: userMessage.id, protectedFirstIds: [userMessage.id] };
revision = (await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision,
  messages: [{ order: 0, message: userMessage }, { order: 1, message: pendingTool }], summary })).json.revision;
let restored = (await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}`)).json;
assert.equal(restored.messages[0].parts[0].text, userMessage.parts[0].text);
assert.equal(restored.messages[1].parts[0].state, 'output-error');
assert.equal(restored.summary.summary, summary.summary);
assert.equal((await alice.request(`/personal-ai/sessions/current?projectId=${projectId}`)).json.id, session.id);
await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision: 0, messages: [] }, 409);
await alice.request(`/personal-ai/sessions/${session.id}/rename`, { projectId, title: 'Proof notes' });
restored = (await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}`)).json;
assert.equal(restored.title, 'Proof notes');
const found = (await alice.request(`/personal-ai/sessions?projectId=${projectId}&q=Proof`)).json.items;
assert.equal(found.length, 1);
assert.equal(found[0].id, session.id);
checks.push('session persistence, summary restore, search, rename and revision conflicts');
checks.push('interrupted tool recovery never executes old actions');

const projectRead = await alice.request('/workbench/chat', { projectId, id: crypto.randomUUID(), messages: [{ id: 'read-project', role: 'user', parts: [{ type: 'text', text: '[TEST:PROJECTFILE]' }] }], enabledTools: [] });
const frames = projectRead.text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
const source = frames.find(frame => frame.type === 'tool-output-available' && frame.output?.name === 'main.tex')?.output.text;
assert.ok(source?.includes('\\section{Introduction}'), projectRead.text.slice(-1500));
const quote = '\\section{Introduction}';
const startLine = source.slice(0, source.indexOf(quote)).split('\n').length;
const proposalBody = { projectId, chatId: session.id, toolCallId: 'http-proposal', input: { path: 'main.tex', startLine, endLine: startLine, oldText: quote, newText: quote + '\nA proposed sentence.', reason: 'Clarify the research question.' } };
const proposal = (await alice.request('/personal-ai/edits', proposalBody)).json;
assert.equal((await alice.request('/personal-ai/edits', proposalBody)).json.id, proposal.id);
const prepared = (await alice.request(`/personal-ai/edits/${proposal.id}/begin`, { projectId, revision: proposal.revision, action: 'accept', anchor: makeAnchor(source, source.indexOf(quote), quote, proposal.input.newText) })).json;
await alice.request(`/personal-ai/edits/${proposal.id}/begin`, { projectId, revision: proposal.revision, action: 'accept', anchor: makeAnchor(source, source.indexOf(quote), quote, proposal.input.newText) }, 409);
const reconciled = (await alice.request(`/personal-ai/edits/${proposal.id}/reconcile`, { projectId, operationId: prepared.operation.id })).json;
assert.equal(reconciled.state, 'pending');
assert.equal(reconciled.operation, null);
const rejected = (await alice.request(`/personal-ai/edits/${proposal.id}/begin`, { projectId, revision: reconciled.revision, action: 'reject' })).json;
assert.equal(rejected.state, 'rejected');
await alice.request(`/personal-ai/edits/${proposal.id}/begin`, { projectId, revision: rejected.revision, action: 'undo', anchor: makeAnchor(source, source.indexOf(quote), quote, '') }, 409);
checks.push('idempotent proposal queue and concurrent-action rejection');
checks.push('interrupted edit reconciliation checks real source without applying changes');

await alice.request('/personal-ai/sessions/delete', { projectId, ids: [session.id, crypto.randomUUID()] }, 404);
assert.equal((await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}`)).json.title, 'Proof notes');
const other = (await alice.request('/personal-ai/sessions', { projectId })).json;
await alice.request('/personal-ai/sessions/delete', { projectId, ids: [session.id, other.id] });
await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}`, undefined, 404);
await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision: restored.revision, messages: [] }, 404);
assert.equal((await alice.request(`/personal-ai/edits/${proposal.id}?projectId=${projectId}`)).json.state, 'rejected');
checks.push('atomic batch deletion, no stale-save resurrection and independent project edit records');

const bob = new Session(), bobPassword = 'Verify!' + crypto.randomBytes(12).toString('hex');
const bobEmail = `v2-${crypto.randomUUID()}@localhost.test`;
await bob.request('/login');
await bob.request('/register', { email: bobEmail, password: bobPassword });
await bob.request('/login');
await bob.request('/login', { email: bobEmail, password: bobPassword });
await bob.request('/project');
await bob.request(`/personal-ai/sessions?projectId=${projectId}`, undefined, 403);
await bob.request(`/personal-ai/edits/${proposal.id}?projectId=${projectId}`, undefined, 403);
checks.push('history and edit-record authorization remains user/project scoped');

profile = (await alice.request('/personal-ai/settings')).json;
profile.compression = { ...profile.compression, contextWindow: 32000, summaryContextWindow: 32000, threshold: .8, targetRatio: .1, protectFirst: 1, protectLast: 2, summaryMaxTokens: 2000 };
profile = (await alice.request('/personal-ai/settings', profile)).json;
const longHistory = Array.from({ length: 40 }, (_, index) => [
  { id: `user-${index}`, role: 'user', parts: [{ type: 'text', text: `Research request ${index}: ` + 'Preserve the theorem assumptions and source references. '.repeat(22) }] },
  { id: `assistant-${index}`, role: 'assistant', parts: [{ type: 'text', text: `Research finding ${index}: ` + 'We should verify the evidence before proposing edits. '.repeat(22) }] },
]).flat();
longHistory.push({ id: 'latest-user', role: 'user', parts: [{ type: 'text', text: 'Continue discussing the paper.' }] });
const compressed = await alice.request('/workbench/chat', { projectId, id: current.id, messages: longHistory, enabledTools: [] });
const compaction = compressed.text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6))).find(frame => frame.type === 'data-compaction');
assert.ok(compaction?.data.summary.includes('论文'), compressed.text.slice(-1500));
assert.deepEqual(compaction.data.protectedFirstIds, ['user-0', 'assistant-0']);
assert.notEqual(compaction.data.upToMessageId, 'latest-user');
checks.push('configured independent compression model, protected turns and streamed summary checkpoint');
console.log(JSON.stringify({ passed: true, checks, projectId }, null, 2));
