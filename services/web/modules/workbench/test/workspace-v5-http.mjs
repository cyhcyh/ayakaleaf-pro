import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Session, base } from './http-session.mjs';
import { translationFrames } from '../shared/translation-stream.mjs';

const fixture = JSON.parse(await fs.readFile(process.env.PERSONAL_AI_V2_FIXTURE, 'utf8'));
const session = new Session();
await session.request('/login'); await session.request('/login', { email: fixture.email, password: fixture.password }); await session.request('/project');
const start = (text, signal) => fetch(base + '/personal-ai/translate/stream', { method: 'POST', signal, headers: {
  Cookie: [...session.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
  'Content-Type': 'application/json', 'X-Csrf-Token': session.csrf,
}, body: JSON.stringify({ text, provider: 'llm', target: 'zh-CN' }) });
const checks = [];
const response = await start('[TEST:STREAM_TRANSLATION] A graph has Laplacian $L=D-A$.');
assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
const reader = response.body.getReader(), decoder = new TextDecoder(), frames = translationFrames();
let text = '', count = 0, final;
while (true) {
  const part = await reader.read();
  if (part.done) break;
  for (const frame of frames(decoder.decode(part.value, { stream: true }))) {
    assert.notEqual(frame.type, 'error');
    if (frame.type === 'delta') { text += frame.text; count++; assert.ok(!text.includes('ZXQMATHTOKEN')); }
    if (frame.type === 'done') final = frame.result;
  }
}
assert.ok(count > 1); assert.equal(text, final.translatedText); assert.ok(text.includes('$L=D-A$'));
checks.push('authenticated translation streams several chunks through nginx and restores split formulas');
const failed = await start('[TEST:STREAM_ERROR] A long translation that fails after partial text.');
const failure = translationFrames()(await failed.text());
assert.ok(failure.some(frame => frame.type === 'delta' && frame.text));
assert.ok(failure.some(frame => frame.type === 'error'));
assert.ok(!failure.some(frame => frame.type === 'done'));
checks.push('upstream failures preserve partial text and report an error without a completion event');
const controller = new AbortController();
const cancelled = await start('[TEST:LONG_TRANSLATION] [TEST:STREAM_TRANSLATION] Long cancellation check.', controller.signal);
await cancelled.body.getReader().read(); controller.abort();
let call;
for (let i = 0; i < 30; i++) {
  call = (await (await fetch('http://127.0.0.1:39001/debug')).json()).at(-1);
  if (call.cancelled) break;
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert.equal(call.cancelled, true);
checks.push('closing the client connection cancels the upstream model stream');
await session.request('/personal-ai/translate/stream', { text: '', provider: 'llm' }, 400);
const unauthenticated = await fetch(base + '/personal-ai/translate/stream', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'test' }) });
assert.notEqual(unauthenticated.status, 200);
const legacy = (await session.request('/personal-ai/translate', { text: 'Graph theory', provider: 'llm', target: 'zh-CN' })).json;
assert.ok(legacy.translatedText.includes('超图'));
checks.push('login, input validation and the existing non-streaming translation endpoint remain effective');
console.log(JSON.stringify({ passed: true, checks }, null, 2));
