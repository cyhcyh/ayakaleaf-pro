import { ui } from '@modules/site-settings/frontend/js/ui'
import { api, apiResponse } from './api'
import { translationFrames } from '../../../shared/translation-stream.mjs'

export type Translation = { translatedText: string; source: string }
export async function translateSelection(input: { text: string; provider: string; target: string }, signal: AbortSignal, onText: (text: string) => void): Promise<Translation> {
  if (input.provider !== 'llm') return api<Translation>('/translate', input, signal)
  const response = await apiResponse('/translate/stream', input, signal)
  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error ? ui(result.error) : ui("请求失败（HTTP {0}）", [response.status]))
  }
  if (!response.body) throw new Error(ui("翻译连接未返回数据，请重试"))
  const reader = response.body.getReader(), decoder = new TextDecoder(), frames = translationFrames()
  try {
    while (true) {
      const { value, done } = await reader.read()
      for (const frame of frames(decoder.decode(value, { stream: !done }))) {
        signal.throwIfAborted()
        if (frame.type === 'error') throw new Error(ui(frame.error))
        if (frame.type === 'delta') onText(frame.text)
        if (frame.type === 'done') return frame.result
      }
      if (done) throw new Error(ui("翻译连接已断开，请重试"))
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
