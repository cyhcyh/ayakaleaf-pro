import { ui } from '@modules/site-settings/frontend/js/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { api, type Binding } from './api'
import type { QueuedMessage } from '../chat/draft'
import { sessionSaved } from './history-events'

export type Summary = { summary: string; upToMessageId: string; protectedFirstIds?: string[]; partial?: { parts: number }; prunedToolCallIds?: string[] }
export type MessagePage = { messages: UIMessage[]; messageOffset: number; olderBefore: number | null }
export type SavedSession = MessagePage & { id: string; projectId: string; title: string; revision: number; summary: Summary | null; binding: Binding | null; outbox?: QueuedMessage[] }
export type SessionItem = { id: string; title: string; updatedAt: string; revision: number; snippet?: string }

export function useSessionAutosave(initial: SavedSession | undefined, projectId: string, messages: UIMessage[], summary: Summary | null, streaming: boolean, binding: Binding | null, outbox: QueuedMessage[], outboxRef: { current: QueuedMessage[] }) {
  const latest = useRef({ messages, summary, binding })
  latest.current = { messages, summary, binding }
  const revision = useRef(initial?.revision || 0)
  const snapshots = useRef(new Map(initial?.messages.map(message => [message.id, message]) || []))
  const savedSummary = useRef(JSON.stringify(initial?.summary || null))
  const savedBinding = useRef(JSON.stringify(initial?.binding || null))
  const savedOutbox = useRef(outbox)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const queue = useRef<Promise<void>>(Promise.resolve())
  const alive = useRef(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const flush = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const save = async () => {
      if (!initial) return
      const current = latest.current
      const changed = current.messages.map((message, order) => ({ message, order: order + (initial.messageOffset || 0) }))
        .filter(item => snapshots.current.get(item.message.id) !== item.message).map(item => ({ ...item, snapshot: JSON.stringify(item.message) }))
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
          if (size > 9 * 1024 * 1024) throw new Error(ui("单条消息内容过大，请减少本条图片或工具输出后重试"))
          if (batch.length && (bytes + size > 9 * 1024 * 1024 || batch.length >= 100)) { batches.push(batch); batch = []; bytes = 0 }
          batch.push(item); bytes += size
        }
        if (batch.length) batches.push(batch)
        if (!batches.length && !queueChanged) batches.push([])
        for (const batch of batches) {
          const result = await api<{ revision: number }>(`/sessions/${initial.id}/save`, { projectId, revision: revision.current,
            messages: batch.map(({ snapshot, ...item }) => item), summary: current.summary, binding: current.binding })
          revision.current = result.revision
          batch.forEach(item => snapshots.current.set(item.message.id, item.message))
          savedSummary.current = summaryText
          savedBinding.current = bindingText
        }
        // Queue attachments can be large. Send them separately from message
        // batches to stay below the existing request-size limit.
        if (queueChanged) {
          const result = await api<{ revision: number }>(`/sessions/${initial.id}/save`, { projectId, revision: revision.current,
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
    const work = queue.current.catch(() => {}).then(save)
    queue.current = work
    return work
  }, [initial?.id, projectId, outboxRef])
  const flushRef = useRef(flush)
  flushRef.current = flush
  const rename = useCallback((title: string) => {
    if (!initial) return Promise.resolve()
    // Renaming increments the same revision as autosave. Serialize it with
    // streaming saves rather than restarting or reloading a live conversation.
    const work = queue.current.catch(() => {}).then(async () => {
      const result = await api<{ revision: number }>(`/sessions/${initial.id}/rename`, { projectId, title })
      revision.current = result.revision
      sessionSaved(projectId)
    })
    queue.current = work
    return work
  }, [initial?.id, projectId])
  useEffect(() => {
    if (!initial || timer.current) return
    timer.current = setTimeout(() => { timer.current = undefined; flush().catch(() => {}) }, streaming ? 1500 : 300)
  }, [messages, summary, binding, outbox, streaming, initial?.id, flush])
  useEffect(() => {
    alive.current = true
    const unload = (event: BeforeUnloadEvent) => {
      if (!initial) return
      const dirty = latest.current.messages.some(message => snapshots.current.get(message.id) !== message)
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
  }, [initial?.id])
  return { flush, rename, saving, error }
}
