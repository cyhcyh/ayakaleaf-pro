import assert from 'node:assert/strict'
import test from 'node:test'
import { streamText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { codexModel } from '../app/src/personal-ai/CodexModel.mjs'
import { CLIENT_TOOLS, convertWorkbenchMessages } from '../app/src/WorkbenchTools.mjs'
import { encodeEditFailure } from '../shared/edit-recovery.mjs'
import { createContextMeter } from '../app/src/personal-ai/ContextUsage.mjs'

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

test('Codex response usage can establish and restore a personal context anchor', async () => {
  const model = codexModel({ baseURL: 'https://chatgpt.com/backend-api/codex', apiKey: 'fixture-only' }, async () => events({
    type: 'message', id: 'msg_usage', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }],
  }, 'Done'))('gpt-5.4')
  const result = streamText({ model, prompt: 'Continue.' })
  assert.equal(await result.text, 'Done')
  const messages = [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Continue.' }] },
    { id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'Done' }] }]
  const meter = createContextMeter()
  meter.observe(messages, await result.totalUsage, 'codex')
  assert.equal(meter.measure(messages, 1000, 'codex'), 8)
  const restored = createContextMeter(structuredClone(meter.snapshot(messages)))
  assert.equal(restored.measure(structuredClone(messages), 1000, 'codex'), 8)
})

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

test('Codex accepts null optional edit fields without requiring a placeholder UUID', async () => {
  let received
  const input = { path: 'main.tex', startLine: 1, endLine: 1, oldText: 'Source.', newText: 'Draft.', replacesEditId: null, keepSeparate: null }
  const model = codexModel({ baseURL: 'https://chatgpt.com/backend-api/codex', apiKey: 'fixture-only' }, async () => events({
    type: 'function_call', id: 'fc_edit', call_id: 'call_edit', name: 'propose_edit', arguments: JSON.stringify(input), status: 'completed',
  }))('gpt-5.4')
  const result = streamText({ model, prompt: 'Suggest a new edit.', tools: { propose_edit: {
    ...CLIENT_TOOLS.propose_edit, execute: async value => { received = value; return { queued: true } },
  } }, stopWhen: stepCountIs(1) })
  await result.text
  assert.deepEqual(received, input)
})

test('Codex stateless replay preserves actionable edit failure codes and valid tool arguments', async () => {
  const input = { path: 'main.tex', startLine: 1, endLine: 1, oldText: 'Source.', newText: 'Draft.', replacesEditId: '00000000-0000-0000-0000-000000000000' }
  const messages = await convertWorkbenchMessages([
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Continue the old suggestion.' }] },
    { id: 'assistant', role: 'assistant', parts: [{ type: 'tool-propose_edit', toolCallId: 'call_edit', input, state: 'output-error',
      errorText: encodeEditFailure({ code: 'edit_target_not_found', message: 'Find the suggestion first.', details: { action: 'find_edit_suggestions' } }) }] },
  ])
  const model = codexModel({ baseURL: 'https://chatgpt.com/backend-api/codex', apiKey: 'fixture-only' }, async (_, init) => {
    const body = JSON.parse(init.body)
    assert.ok(body.input.some(item => item.type === 'function_call' && JSON.parse(item.arguments).oldText === input.oldText))
    assert.ok(body.input.some(item => item.type === 'function_call_output' && item.output.includes('edit_target_not_found') && item.output.includes('find_edit_suggestions')))
    return events({ type: 'message', id: 'msg_recover', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Find the suggestion.', annotations: [] }] }, 'Find the suggestion.')
  })('gpt-5.4')
  assert.equal(await streamText({ model, messages, tools: CLIENT_TOOLS }).text, 'Find the suggestion.')
})
