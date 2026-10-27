import assert from 'node:assert/strict'
import test from 'node:test'
import { streamText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { codexModel } from '../app/src/personal-ai/CodexModel.mjs'

function events(output, text = '') {
  const response = { id: 'resp_fixture', model: 'gpt-5.4', status: 'completed', output: [output], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } }
  const frames = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...output, ...(output.type === 'function_call' ? { arguments: '' } : { content: [] }) } },
    ...(text ? (Array.isArray(text) ? text : [text]).map(delta => ({ type: 'response.output_text.delta', item_id: output.id, output_index: 0, content_index: 0, delta })) : [
      { type: 'response.function_call_arguments.delta', item_id: output.id, output_index: 0, delta: output.arguments },
      { type: 'response.function_call_arguments.done', item_id: output.id, output_index: 0, arguments: output.arguments },
    ]),
    { type: 'response.output_item.done', output_index: 0, item: output },
    { type: 'response.completed', response },
  ]
  return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}

test('Codex streams text and replays tool results without stored response references', async () => {
  const calls = []
  let executed = false
  const model = codexModel({ baseURL: 'https://chatgpt.com/backend-api/codex', apiKey: 'fixture-only', reasoningEffort: 'high' }, async (url, init) => {
    assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/responses')
    const body = JSON.parse(init.body)
    calls.push(body)
    assert.equal(body.store, false)
    assert.equal(body.stream, true)
    assert.equal(body.reasoning.effort, 'high')
    assert.ok(body.instructions.includes('Review only after consent'))
    assert.equal(body.input.some(item => ['system', 'developer'].includes(item.role)), false)
    if (calls.length === 1) return events({ type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'inspect', arguments: '{"path":"main.tex"}', status: 'completed' })
    assert.ok(body.input.some(item => item.type === 'function_call_output' && item.call_id === 'call_fixture'))
    assert.equal(body.input.some(item => item.type === 'item_reference'), false)
    return events({ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }, 'Done')
  })('gpt-5.4')
  const result = streamText({
    model,
    system: 'Review only after consent',
    prompt: 'Inspect the file',
    providerOptions: { openai: { store: false } },
    tools: { inspect: tool({ inputSchema: z.object({ path: z.string() }), execute: async ({ path }) => { assert.equal(path, 'main.tex'); executed = true; return 'Read' } }) },
    stopWhen: stepCountIs(2),
  })
  assert.equal(await result.text, 'Done')
  assert.equal(executed, true)
  assert.equal(calls.length, 2)
})

test('Codex translation delivers successive text chunks including complete formula text', async () => {
  const pieces = ['这是', '译文 ', '$L=', 'D-A$'];
  const model = codexModel({ baseURL: 'https://chatgpt.com/backend-api/codex', apiKey: 'fixture-only' }, async () =>
    events({ type: 'message', id: 'msg_translation', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: pieces.join(''), annotations: [] }] }, pieces))('gpt-5.4');
  const response = streamText({ model, system: 'Translate the text', prompt: 'Graph Laplacian' });
  const received = [];
  for await (const text of response.textStream) received.push(text);
  assert.deepEqual(received, pieces);
});
