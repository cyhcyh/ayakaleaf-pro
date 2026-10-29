// Run only on the isolated 39080 stack with synthetic accounts and references.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { Session } from './http-session.mjs';

const fixture = JSON.parse(await fs.readFile(process.env.PERSONAL_AI_QUEUE_FIXTURE, 'utf8'));
const alice = new Session();
await alice.request('/login');
await alice.request('/login', { email: fixture.email, password: fixture.password });
await alice.request('/project');
const projectId = (await alice.request('/project/new', { projectName: 'Queue storage verification', template: 'blank' })).json.project_id;
const checks = [];
const context = { path: 'main.tex', selection: [{ fromLine: 1, toLine: 1, content: '\\documentclass{article}' }] };
const queued = () => ({ id: randomUUID(), text: 'Queued request', files: [], references: [], context });
const session = (await alice.request('/personal-ai/sessions', { projectId })).json;
assert.deepEqual(session.outbox, []);
const reference = (await alice.request('/personal-ai/references', { projectId, name: 'queue-reference.txt', mediaType: 'text/plain', data: Buffer.from('Queue reference').toString('base64') })).json;
const first = { ...queued(), references: [reference] }, second = queued();
let revision = (await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision: 0, messages: [], outbox: [first, second] })).json.revision;
let restored = (await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}&paged=true`)).json;
assert.deepEqual(restored.outbox, [first, second]);
const listed = (await alice.request(`/personal-ai/sessions?projectId=${projectId}`)).json.items.find(item => item.id === session.id);
assert.ok(listed);
assert.ok(!Object.hasOwn(listed, 'outbox'));
checks.push('queue-only conversations remain discoverable; references, order and editor context survive reopening without appearing in history list payloads');

await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision: 0, messages: [], outbox: [] }, 409);
revision = (await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision, messages: [] })).json.revision;
assert.deepEqual((await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}`)).json.outbox, [first, second]);
checks.push('legacy saves without a queue preserve it; concurrent stale writes cannot overwrite it');

const rows = Array.from({ length: 80 }, (_, at) => ({ order: at, message: { id: at === 0 ? first.id : randomUUID(), role: at % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: `Stored message ${at}` }] } }));
revision = (await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision, messages: rows })).json.revision;
restored = (await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}&paged=true`)).json;
assert.deepEqual(restored.outbox, [second]);
assert.ok(restored.messageOffset > 0);
assert.ok(!restored.messages.some(message => message.id === first.id));
checks.push('a delivered message is never restored into the queue, even when its history page is not loaded');

const bob = new Session();
const password = `Queue!${randomBytes(12).toString('hex')}`, email = `queue-${randomUUID()}@localhost.test`;
await bob.request('/login'); await bob.request('/register', { email, password });
await bob.request('/login'); await bob.request('/login', { email, password }); await bob.request('/project');
await bob.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}`, undefined, 403);
await bob.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision, messages: [], outbox: [] }, 403);
checks.push('queued messages and attachments remain user/project scoped');

await alice.request('/personal-ai/sessions/delete', { projectId, ids: [session.id] });
await alice.request(`/personal-ai/sessions/${session.id}?projectId=${projectId}`, undefined, 404);
await alice.request(`/personal-ai/sessions/${session.id}/save`, { projectId, revision, messages: [], outbox: [second] }, 404);
const current = (await alice.request('/personal-ai/sessions', { projectId })).json;
await alice.request(`/personal-ai/sessions/${current.id}/save`, { projectId, revision: 0, messages: [], outbox: [queued()] });
await alice.request('/personal-ai/history/clear', { projectId, scope: 'project' });
assert.deepEqual((await alice.request(`/personal-ai/sessions/current?projectId=${projectId}`)).json.outbox, []);
checks.push('deleting and clearing conversations also clears their queues; stale saves cannot revive deleted conversations');
console.log(JSON.stringify({ passed: true, checks }, null, 2));
