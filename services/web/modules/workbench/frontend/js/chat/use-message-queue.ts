import { useCallback, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { ui } from '@modules/site-settings/frontend/js/ui'
import type { Draft, DraftContext, QueuedMessage } from './draft'

export default function useMessageQueue(initial: QueuedMessage[] = []) {
  const [items, setItems] = useState(initial)
  const current = useRef(items)
  const [paused, setPaused] = useState(initial.length > 0)
  const pausedRef = useRef(paused)
  const [editing, setEditing] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const update = useCallback((next: QueuedMessage[]) => {
    if (next.length > 100 || new TextEncoder().encode(JSON.stringify(next)).byteLength > 9 * 1024 * 1024)
      throw new Error(ui("待发送内容过大，请减少附件后重试。"))
    current.current = next
    setItems(next)
  }, [])
  const pause = useCallback((value = true) => {
    pausedRef.current = value
    setPaused(value)
  }, [])
  const enqueue = useCallback((draft: Draft, context: DraftContext) => {
    const item = { ...draft, context: draft.context || context, id: uuid() }
    update([...current.current, item])
    return item
  }, [update])
  const remove = useCallback((id: string) => update(current.current.filter(item => item.id !== id)), [update])
  const edit = useCallback((id: string | null) => {
    editingRef.current = id
    setEditing(id)
  }, [])
  const save = useCallback((id: string, draft: Draft) => {
    update(current.current.map(item => item.id === id ? { ...item, ...draft, id, context: item.context } : item))
    edit(null)
  }, [update, edit])
  return { items, current, paused, pausedRef, editing, editingRef, enqueue, remove, edit, save, pause }
}
