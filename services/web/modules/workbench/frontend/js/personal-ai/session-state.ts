import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { api } from './api'

export type Summary = { summary: string; upToMessageId: string; protectedFirstIds?: string[] }
export type SavedSession = { id: string; projectId: string; title: string; revision: number; messages: UIMessage[]; summary: Summary | null }
export type SessionItem = { id: string; title: string; updatedAt: string; revision: number }

export function useSessionAutosave(initial: SavedSession | undefined, projectId: string, messages: UIMessage[], summary: Summary | null, streaming: boolean) {
  const latest = useRef({ messages, summary })
  latest.current = { messages, summary }
  const revision = useRef(initial?.revision || 0)
  const snapshots = useRef(new Map(initial?.messages.map(message => [message.id, JSON.stringify(message)]) || []))
  const savedSummary = useRef(JSON.stringify(initial?.summary || null))
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
      const changed = current.messages.map((message, order) => ({ message, order, snapshot: JSON.stringify(message) }))
        .filter(item => snapshots.current.get(item.message.id) !== item.snapshot)
      const summaryText = JSON.stringify(current.summary)
      if (!changed.length && savedSummary.current === summaryText) return
      if (alive.current) { setSaving(true); setError('') }
      try {
        // Incremental message writes keep long conversations below request and
        // document size limits. The server commits each batch atomically.
        const batches: typeof changed[] = []
        let batch: typeof changed = [], bytes = 0
        for (const item of changed) {
          const size = new TextEncoder().encode(item.snapshot).byteLength
          if (size > 9 * 1024 * 1024) throw new Error('单条消息内容过大，请减少本条图片或工具输出后重试')
          if (batch.length && (bytes + size > 9 * 1024 * 1024 || batch.length >= 100)) { batches.push(batch); batch = []; bytes = 0 }
          batch.push(item); bytes += size
        }
        if (batch.length) batches.push(batch)
        if (!batches.length && savedSummary.current !== summaryText) batches.push([])
        for (const batch of batches) {
          const result = await api<{ revision: number }>(`/sessions/${initial.id}/save`, { projectId, revision: revision.current,
            messages: batch.map(({ snapshot, ...item }) => item), summary: current.summary })
          revision.current = result.revision
          batch.forEach(item => snapshots.current.set(item.message.id, item.snapshot))
          savedSummary.current = summaryText
        }
        window.dispatchEvent(new Event('personal-ai:sessions'))
      } catch (error) {
        if (alive.current) setError((error as Error).message)
        throw error
      } finally { if (alive.current) setSaving(false) }
    }
    const work = queue.current.catch(() => {}).then(save)
    queue.current = work
    return work
  }, [initial?.id, projectId])
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    if (!initial || timer.current) return
    timer.current = setTimeout(() => { timer.current = undefined; flush().catch(() => {}) }, streaming ? 1500 : 300)
  }, [messages, summary, streaming, initial?.id, flush])
  useEffect(() => {
    alive.current = true
    const unload = (event: BeforeUnloadEvent) => {
      if (!initial) return
      const dirty = latest.current.messages.some(message => snapshots.current.get(message.id) !== JSON.stringify(message))
        || savedSummary.current !== JSON.stringify(latest.current.summary)
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
  return { flush, saving, error }
}
