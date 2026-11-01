import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import { api } from '../personal-ai/api'
import type { MessagePage } from '../personal-ai/session-state'
import { mergeMessagePages, trimMessageWindow } from '../../../shared/message-cache.mjs'
import { ui } from '@modules/site-settings/frontend/js/ui'

export type HistoryAnchor = { id: string; visibleIds: string[] }
export type HistoryAnchorSource = HistoryAnchor | (() => HistoryAnchor | null)
export type HistoryTarget = { id: string; order: number; historyVersion: number }
export type HistoryFocus = { id: string; sequence: number }
export type HistoryLoading = 'older' | 'newer' | 'locate' | null
type Direction = 'older' | 'newer'
type Window = MessagePage & { messageEnd: number; newerAfter: number | null }

// This cache is a reader only. It never replaces the SDK's messages, saves a
// history page, changes model context, or stops a running assistant.
export default function useConversationHistory(projectId: string, chatId: string, live: UIMessage[],
  position: { current: { messageOffset: number; historyVersion: number } }, signal: AbortSignal) {
  const [window, setWindow] = useState<Window | null>(null)
  const current = useRef<Window | null>(null)
  const liveRef = useRef({ messages: live, offset: position.current.messageOffset })
  liveRef.current = { messages: live, offset: position.current.messageOffset }
  const [loading, setLoading] = useState<HistoryLoading>(null)
  const [focus, setFocus] = useState<HistoryFocus | null>(null)
  const focusSequence = useRef(0)
  const locating = useRef<AbortController | null>(null)
  const [error, setError] = useState('')
  const [jumpVersion, setJumpVersion] = useState(0)
  const pending = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  const last = useRef<{ direction: Direction; anchor?: HistoryAnchorSource }>()
  const commit = useCallback((value: Window | null) => { current.current = value; setWindow(value) }, [])
  const observeReading = useCallback((anchor: HistoryAnchor) => {
    if (current.current) return
    const newest = liveRef.current
    const kept = trimMessageWindow(newest.messages, newest.offset, { direction: 'older', keepIds: anchor.visibleIds })
    const end = kept.messageOffset + kept.messages.length
    commit({ messages: kept.messages, messageOffset: kept.messageOffset, messageEnd: end,
      olderBefore: kept.messageOffset ? kept.messageOffset : null, newerAfter: kept.removedAfter ? end - 1 : null })
  }, [commit])
  const syncLive = useCallback((messages: UIMessage[]) => {
    const reader = current.current
    if (!reader) return
    const active = new Map(messages.map(message => [message.id, message]))
    let changed = false
    const updated = reader.messages.map(message => {
      const next = active.get(message.id) || message
      if (next !== message) changed = true
      return next
    })
    // Capture the final result before live state evicts this turn, so a reader
    // never falls back to the partial text it saw while that turn was running.
    if (changed) commit({ ...reader, messages: updated })
  }, [commit])
  const reset = useCallback(() => {
    epoch.current++
    pending.current?.abort()
    pending.current = null
    locating.current = null
    last.current = undefined
    commit(null); setFocus(null); setLoading(null); setError(''); setJumpVersion(value => value + 1)
  }, [commit])
  useEffect(() => () => { epoch.current++; pending.current?.abort() }, [])

  const targetFor = useCallback((id: string): HistoryTarget | null => {
    // A page request may commit its ref before React updates the old DOM's
    // click handler. Keep that handler tied to the page it actually rendered.
    const source = window || { messages: liveRef.current.messages, messageOffset: liveRef.current.offset }
    const index = source.messages.findIndex(message => message.id === id)
    return index < 0 ? null : { id, order: source.messageOffset + index, historyVersion: position.current.historyVersion }
  }, [window, position])
  const cancelLocate = useCallback(() => {
    const controller = locating.current
    if (controller) {
      epoch.current++
      controller.abort()
      if (pending.current === controller) { pending.current = null; setLoading(null) }
      locating.current = null
    }
    setFocus(null)
  }, [])
  const locate = useCallback(async (target: HistoryTarget) => {
    if (signal.aborted) return
    if (target.historyVersion !== position.current.historyVersion)
      throw new Error(ui('会话已在其他页面更新，请重新打开会话后继续'))
    const ticket = ++epoch.current
    pending.current?.abort()
    pending.current = null; locating.current = null
    last.current = undefined
    setLoading(null); setError(''); setFocus(null)
    const focusTarget = () => setFocus({ id: target.id, sequence: ++focusSequence.current })
    const matches = (page: Pick<MessagePage, 'messages' | 'messageOffset'>) => page.messages.findIndex(message => message.id === target.id) === target.order - page.messageOffset
      && target.order >= page.messageOffset
    if (current.current && matches(current.current)) { focusTarget(); return }
    const newest = liveRef.current
    const livePage = { messages: newest.messages, messageOffset: newest.offset }
    if (matches(livePage)) {
      const kept = trimMessageWindow(newest.messages, newest.offset, { direction: 'older', keepIds: [target.id] })
      const end = kept.messageOffset + kept.messages.length
      commit({ messages: kept.messages, messageOffset: kept.messageOffset, messageEnd: end,
        olderBefore: kept.messageOffset ? kept.messageOffset : null, newerAfter: kept.removedAfter ? end - 1 : null })
      focusTarget(); return
    }
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal.addEventListener('abort', cancel, { once: true })
    pending.current = controller; locating.current = controller
    setLoading('locate')
    try {
      // The existing indexed cursor reads one page ending at this user message,
      // including order zero. No intervening pages or extra history cache.
      const page = await api<MessagePage>(`/sessions/${chatId}/messages?projectId=${projectId}&before=${target.order + 1}&historyVersion=${target.historyVersion}`, undefined, controller.signal)
      if (controller.signal.aborted || ticket !== epoch.current || target.historyVersion !== position.current.historyVersion) return
      if (!matches(page)) throw new Error(ui('无法定位这条消息，请重新打开会话后重试。'))
      const end = page.messageOffset + page.messages.length
      commit({ ...page, messageEnd: end, newerAfter: page.newerAfter ?? (end < liveRef.current.offset + liveRef.current.messages.length ? end - 1 : null) })
      focusTarget()
    } catch (e) {
      if (!controller.signal.aborted && ticket === epoch.current) throw e
    } finally {
      signal.removeEventListener('abort', cancel)
      if (pending.current === controller) { pending.current = null; setLoading(null) }
      if (locating.current === controller) locating.current = null
    }
  }, [projectId, chatId, position, signal, commit])

  const load = useCallback(async (direction: Direction, anchor?: HistoryAnchorSource) => {
    if (pending.current || signal.aborted) return
    const newest = liveRef.current
    const base: Window = current.current || { messages: newest.messages, messageOffset: newest.offset,
      messageEnd: newest.offset + newest.messages.length, olderBefore: newest.offset ? newest.offset : null, newerAfter: null }
    if (direction === 'older' && base.olderBefore === null) return
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal.addEventListener('abort', cancel, { once: true })
    pending.current = controller
    const version = position.current.historyVersion, ticket = epoch.current
    const readAnchor = () => typeof anchor === 'function' ? anchor() : anchor
    const startedAt = readAnchor()
    last.current = { direction, anchor }
    setLoading(direction); setError('')
    try {
      let page: MessagePage
      // Recent messages may not be saved yet. Prefer live state when it
      // overlaps the reader rather than restoring an interrupted snapshot.
      if (direction === 'newer' && base.messageEnd >= newest.offset) {
        page = { messages: newest.messages, messageOffset: newest.offset, olderBefore: newest.offset || null, newerAfter: null }
      } else {
        const cursor = direction === 'older' ? `before=${base.messageOffset}` : `after=${base.messageEnd - 1}`
        page = await api<MessagePage>(`/sessions/${chatId}/messages?projectId=${projectId}&${cursor}&historyVersion=${version}`, undefined, controller.signal)
      }
      if (controller.signal.aborted || ticket !== epoch.current || version !== position.current.historyVersion) return
      // The user can keep scrolling while the page is in flight. Pin what is
      // visible now, before replacing the DOM/cache, rather than the old edge.
      const visible = readAnchor()
      if (!page.messages.length) {
        commit({ ...base, ...(direction === 'older' ? { olderBefore: null } : { newerAfter: null }) })
        return
      }
      const merged = mergeMessagePages(base, page)
      const existing = new Set(base.messages.map(message => message.id))
      const adjacent = direction === 'older' ? page.messages.findLast(message => !existing.has(message.id)) : page.messages.find(message => !existing.has(message.id))
      // A tall viewport can show a whole cached page. Still admit the nearest
      // new turn, rather than repeatedly fetching and immediately evicting it.
      const kept = trimMessageWindow(merged.messages, merged.messageOffset, { direction,
        keepIds: [...(visible?.visibleIds || []), ...(adjacent && startedAt?.id === visible?.id ? [adjacent.id] : [])] })
      const end = kept.messageOffset + kept.messages.length
      const older = kept.removedBefore || (direction === 'older' ? page.olderBefore !== null : base.olderBefore !== null)
      const newer = kept.removedAfter || (direction === 'newer' ? page.newerAfter != null : base.newerAfter !== null)
      commit({ messages: kept.messages, messageOffset: kept.messageOffset, messageEnd: end,
        olderBefore: older ? kept.messageOffset : null, newerAfter: newer ? end - 1 : null })
    } catch (e) {
      if (!controller.signal.aborted && ticket === epoch.current) { setError((e as Error).message); throw e }
    } finally {
      signal.removeEventListener('abort', cancel)
      if (pending.current === controller) { pending.current = null; setLoading(null) }
    }
  }, [projectId, chatId, position, signal, commit])

  const messages = useMemo(() => {
    if (!window) return live
    const active = new Map(live.map(message => [message.id, message]))
    const updated = window.messages.map(message => active.get(message.id) || message)
    return updated.every((message, index) => message === window.messages[index]) ? window.messages : updated
  }, [window, live])
  return { messages, reset, observeReading, syncLive, jumpVersion, focus, targetFor, locate, cancelLocate, locating: loading === 'locate', browsing: Boolean(window), error, loading,
    hasOlder: window ? window.olderBefore !== null : position.current.messageOffset > 0,
    hasNewer: Boolean(window && (window.newerAfter !== null || window.messageEnd < position.current.messageOffset + live.length)),
    loadOlder: useCallback((anchor?: HistoryAnchorSource) => load('older', anchor), [load]),
    loadNewer: useCallback((anchor?: HistoryAnchorSource) => load('newer', anchor), [load]),
    retry: useCallback((anchor?: HistoryAnchorSource) => last.current ? load(last.current.direction, anchor || last.current.anchor) : Promise.resolve(), [load]),
  }
}
