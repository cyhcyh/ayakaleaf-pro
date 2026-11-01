import { ui } from '@modules/site-settings/frontend/js/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { api, type Binding } from './api'
import type { QueuedMessage } from '../chat/draft'
import { sessionSaved } from './history-events'
import { CHAT_REQUEST_BYTES, jsonBytes, pendingSessionMessages, sameSavedMessage } from '../../../shared/session-request.mjs'
import { messageBytes, trimMessageWindow } from '../../../shared/message-cache.mjs'

export type Summary = { summary: string; upToMessageId: string; protectedFirstIds?: string[]; partial?: { parts: number }; prunedToolCallIds?: string[] }
export type MessagePage = { messages: UIMessage[]; messageOffset: number; olderBefore: number | null; messageEnd?: number; newerAfter?: number | null; historyVersion?: number }
export type SavedSession = MessagePage & { id: string; projectId: string; title: string; revision: number; historyVersion?: number; summary: Summary | null; binding: Binding | null; outbox?: QueuedMessage[] }
export type SessionItem = { id: string; title: string; updatedAt: string; revision: number; snippet?: string }

export function useSessionAutosave(initial: SavedSession | undefined, projectId: string, messages: UIMessage[], summary: Summary | null, streaming: boolean, binding: Binding | null, outbox: QueuedMessage[], outboxRef: { current: QueuedMessage[] }, position: { current: { messageOffset: number; historyVersion: number } }) {
  const sessionId = initial?.id
  const latest = useRef({ messages, summary, binding })
  latest.current = { messages, summary, binding }
  const revision = useRef(initial?.revision || 0)
  const snapshots = useRef(new Map<string, UIMessage>())
  const seeded = useRef(false)
  if (!seeded.current) {
    snapshots.current = new Map(initial?.messages.map(message => [message.id, message]) || [])
    seeded.current = true
  }
  const savedSummary = useRef(JSON.stringify(initial?.summary || null))
  const savedBinding = useRef(JSON.stringify(initial?.binding || null))
  const savedOutbox = useRef(outbox)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const queue = useRef<Promise<void>>(Promise.resolve())
  const alive = useRef(true)
  const rewriting = useRef(false)
  const pendingWrites = useRef(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const flush = useCallback((requestMessages?: UIMessage[]) => {
    clearTimeout(timer.current)
    timer.current = undefined
    const requestPosition = requestMessages && { ...position.current }
    const save = async () => {
      if (!sessionId || rewriting.current) return
      if (requestPosition && (requestPosition.messageOffset !== position.current.messageOffset || requestPosition.historyVersion !== position.current.historyVersion))
        throw new DOMException('Conversation changed before saving the request.', 'AbortError')
      // The SDK may prepare a request before React renders its newest user
      // message/tool result. Save that exact snapshot when shrinking a request.
      const current = requestMessages ? { ...latest.current, messages: requestMessages } : latest.current
      const changed = current.messages.map((message, order) => ({ message, order: order + position.current.messageOffset }))
        .filter(item => !sameSavedMessage(item.message, snapshots.current.get(item.message.id))).map(item => ({ ...item, snapshot: JSON.stringify(item.message) }))
      const summaryText = JSON.stringify(current.summary)
      const bindingText = JSON.stringify(current.binding)
      const queued = outboxRef.current
      const queueChanged = savedOutbox.current !== queued
      if (!changed.length && savedSummary.current === summaryText && savedBinding.current === bindingText && !queueChanged) return
      if (alive.current) { setSaving(true); setError('') }
      try {
        // Incremental message writes keep long conversations below request and
        // document size limits. The server commits each batch atomically.
        const batches: typeof changed[] = []
        let batch: typeof changed = [], bytes = 0
        for (const item of changed) {
          const size = new TextEncoder().encode(item.snapshot).byteLength
          messageBytes(item.message, size)
          if (size > 9 * 1024 * 1024) throw new Error(ui("单条消息内容过大，请减少本条图片或工具输出后重试"))
          if (batch.length && (bytes + size > 9 * 1024 * 1024 || batch.length >= 100)) { batches.push(batch); batch = []; bytes = 0 }
          batch.push(item); bytes += size
        }
        if (batch.length) batches.push(batch)
        if (!batches.length && !queueChanged) batches.push([])
        for (const batch of batches) {
          const result = await api<{ revision: number }>(`/sessions/${sessionId}/save`, { projectId, revision: revision.current, historyVersion: position.current.historyVersion,
            messages: batch.map(({ snapshot, ...item }) => item), summary: current.summary, binding: current.binding })
          revision.current = result.revision
          batch.forEach(item => snapshots.current.set(item.message.id, item.message))
          savedSummary.current = summaryText
          savedBinding.current = bindingText
        }
        // Queue attachments can be large. Send them separately from message
        // batches to stay below the existing request-size limit.
        if (queueChanged) {
          const result = await api<{ revision: number }>(`/sessions/${sessionId}/save`, { projectId, revision: revision.current, historyVersion: position.current.historyVersion,
            messages: [], summary: current.summary, binding: current.binding, outbox: queued })
          revision.current = result.revision
          savedOutbox.current = queued
          savedSummary.current = summaryText
          savedBinding.current = bindingText
        }
        sessionSaved(projectId)
      } catch (error) {
        if (alive.current) setError((error as Error).message)
        throw error
      } finally { if (alive.current) setSaving(false) }
    }
    pendingWrites.current++
    const work = queue.current.catch(() => {}).then(save).finally(() => { pendingWrites.current-- })
    queue.current = work
    return work
  }, [sessionId, projectId, outboxRef, position])
  const retainTail = useCallback((current: UIMessage[]) => {
    // Called only between complete turns. Never rebase a write or SDK stream
    // while it is using the old absolute offsets.
    if (!sessionId || rewriting.current || pendingWrites.current || latest.current.messages !== current) return null
    const trimmed = trimMessageWindow(current, position.current.messageOffset, { direction: 'newer' })
    if (!trimmed.removedBefore) return null
    const removed = trimmed.messageOffset - position.current.messageOffset
    if (current.slice(0, removed).some(message => !sameSavedMessage(message, snapshots.current.get(message.id)))) return null
    const kept = trimmed.messages as UIMessage[]
    position.current = { ...position.current, messageOffset: trimmed.messageOffset }
    latest.current = { ...latest.current, messages: kept }
    const ids = new Set(kept.map(message => message.id))
    for (const id of snapshots.current.keys()) if (!ids.has(id)) snapshots.current.delete(id)
    return kept
  }, [sessionId, position])
  const prepareRequest = useCallback(async (body: Record<string, unknown>, requestMessages: UIMessage[], isCurrent: () => boolean) => {
    const origin = { ...position.current }
    const build = () => ({ ...body, ...pendingSessionMessages(requestMessages, snapshots.current, origin.messageOffset), historyVersion: origin.historyVersion })
    const checkCurrent = () => {
      if (!isCurrent() || rewriting.current || origin.messageOffset !== position.current.messageOffset || origin.historyVersion !== position.current.historyVersion)
        throw new DOMException('Conversation changed before sending the request.', 'AbortError')
    }
    checkCurrent()
    let request = build()
    let bytes = jsonBytes(request)
    if (bytes > CHAT_REQUEST_BYTES) {
      await flush(requestMessages)
      checkCurrent()
      request = build()
      bytes = jsonBytes(request)
    }
    if (bytes > CHAT_REQUEST_BYTES)
      throw new Error(ui("AI 请求内容过大，请减少本条附件或文字后重试。"))
    return request
  }, [flush, position])
  const flushRef = useRef(flush)
  flushRef.current = flush
  const rename = useCallback((title: string) => {
    if (!sessionId) return Promise.resolve()
    // Renaming increments the same revision as autosave. Serialize it with
    // streaming saves rather than restarting or reloading a live conversation.
    const work = queue.current.catch(() => {}).then(async () => {
      const result = await api<{ revision: number }>(`/sessions/${sessionId}/rename`, { projectId, title })
      revision.current = result.revision
      sessionSaved(projectId)
    })
    queue.current = work
    return work
  }, [sessionId, projectId])
  const editMessage = useCallback(async (messageId: string, text: string) => {
    if (!sessionId || rewriting.current) throw new Error(ui("请等待当前操作结束后重试。"))
    clearTimeout(timer.current)
    timer.current = undefined
    rewriting.current = true
    const work = queue.current.catch(() => {}).then(async () => {
      const result = await api<SavedSession>(`/sessions/${sessionId}/edit-message`, { projectId, revision: revision.current,
        historyVersion: position.current.historyVersion, messageId, text })
      revision.current = result.revision
      position.current = { messageOffset: result.messageOffset, historyVersion: result.historyVersion || 0 }
      snapshots.current = new Map(result.messages.map(message => [message.id, message]))
      latest.current = { messages: result.messages, summary: result.summary, binding: result.binding }
      savedSummary.current = JSON.stringify(result.summary)
      savedBinding.current = JSON.stringify(result.binding)
      savedOutbox.current = outboxRef.current
      setError('')
      sessionSaved(projectId)
      return result
    })
    queue.current = work.then(() => {}, () => {})
    try { return await work } finally { rewriting.current = false }
  }, [sessionId, projectId, outboxRef, position])
  useEffect(() => {
    if (!sessionId || timer.current) return
    timer.current = setTimeout(() => { timer.current = undefined; flush().catch(() => {}) }, streaming ? 1500 : 300)
  }, [messages, summary, binding, outbox, streaming, sessionId, flush])
  useEffect(() => {
    alive.current = true
    const unload = (event: BeforeUnloadEvent) => {
      if (!sessionId) return
      const dirty = latest.current.messages.some(message => !sameSavedMessage(message, snapshots.current.get(message.id)))
        || savedSummary.current !== JSON.stringify(latest.current.summary) || savedBinding.current !== JSON.stringify(latest.current.binding)
        || savedOutbox.current !== outboxRef.current
      if (dirty) { flushRef.current().catch(() => {}); event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', unload)
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      window.removeEventListener('beforeunload', unload)
      flushRef.current().catch(() => {})
    }
  }, [sessionId])
  return { flush, prepareRequest, retainTail, rename, editMessage, saving, error }
}
