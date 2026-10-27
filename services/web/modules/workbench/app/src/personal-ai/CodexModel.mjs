import { createOpenAI } from '@ai-sdk/openai'

// Codex uses streamed Responses and requires a stateless conversation replay.
export function codexModel(config, transport = fetch) {
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    headers: config.headers,
    fetch: async (url, init) => {
      if (typeof init?.body === 'string') {
        const body = JSON.parse(init.body)
        const instructions = []
        body.input = body.input.filter(item => {
          if (!['system', 'developer'].includes(item.role)) return true
          instructions.push(typeof item.content === 'string'
            ? item.content
            : item.content.map(part => part.text || '').join('\n'))
          return false
        })
        body.instructions = [body.instructions, ...instructions].filter(Boolean).join('\n\n')
          || 'You are the writing and research assistant in Rogerleaf.'
        body.store = false
        if (config.reasoningEffort) body.reasoning = { ...body.reasoning, effort: config.reasoningEffort }
        delete body.max_output_tokens
        init = { ...init, body: JSON.stringify(body) }
      }
      return await transport(url, init)
    },
  })
  return model => provider.responses(model)
}
