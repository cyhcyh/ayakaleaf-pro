import { ui } from '@modules/site-settings/frontend/js/ui'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { UIMessage } from 'ai'
import type { Respond } from '../agent/tools'
import type { Summary } from '../personal-ai/session-state'
import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MessageView from './message-view'
import type { HistoryAnchor, HistoryFocus, HistoryLoading } from './use-conversation-history'
import { measureConversationRows } from '../../../shared/conversation-measurements.mjs'
import useEditingVisibility from './use-editing-visibility'

export default function ConversationMessages({ messages, streaming, streamingMessageId, working, respond, summary,
  hasOlder, hasNewer, browsing, loading, historyError, loadOlder, loadNewer, retryHistory, onLatest, onReading, jumpVersion,
  editing, editBusy, editError, editingDisabled, resendDisabled, onEdit, onEditChange, onEditCancel, onResend, onEditingVisibility, focus, historyVersion = 0 }: {
  messages: UIMessage[]; streaming: boolean; streamingMessageId?: string; working: boolean; respond: Respond; summary: Summary | null
  hasOlder: boolean; hasNewer: boolean; browsing: boolean; loading: HistoryLoading; historyError: string
  loadOlder: (anchor?: HistoryAnchor) => Promise<void>; loadNewer: (anchor?: HistoryAnchor) => Promise<void>
  retryHistory: (anchor?: HistoryAnchor) => Promise<void>; onLatest: () => void; onReading: (anchor: HistoryAnchor) => void; jumpVersion: number
  editing?: { id: string; text: string } | null; editBusy?: boolean; editError?: string; editingDisabled?: boolean; resendDisabled?: boolean
  onEdit?: (message: UIMessage) => void; onEditChange?: (text: string) => void; onEditCancel?: () => void; onResend?: () => void
  onEditingVisibility?: (visible: boolean) => void; focus?: HistoryFocus | null
  historyVersion?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const pendingAnchor = useRef<(HistoryAnchor & { top: number; focus?: boolean }) | null>(null)
  const previousIds = useRef(new Set<string>())
  const previousScroll = useRef(0)
  const [showLatest, setShowLatest] = useState(false)
  const virtual = useVirtualizer({ count: messages.length, getScrollElement: () => box.current, getItemKey: index => messages[index].id,
    estimateSize: () => 160, overscan: 4, paddingStart: 36, paddingEnd: hasNewer ? 92 : 8 })
  const total = virtual.getTotalSize()
  const items = virtual.getVirtualItems()
  const editingMounted = Boolean(editing && items.some(item => messages[item.index]?.id === editing.id))
  useEditingVisibility(box, editing?.id, editingMounted, onEditingVisibility)
  const firstId = messages[0]?.id, lastId = messages.at(-1)?.id
  const captureAnchor = useCallback(() => {
    const element = box.current
    if (!element) return null
    const bounds = element.getBoundingClientRect()
    const visible = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).filter(item => {
      const rect = item.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    return visible.length ? { id: visible[0].dataset.messageId!, visibleIds: visible.map(item => item.dataset.messageId!), top: visible[0].getBoundingClientRect().top - bounds.top } : null
  }, [])
  const load = useCallback(async (direction: 'older' | 'newer' | 'retry') => {
    if (loading || pendingAnchor.current || direction === 'older' && !hasOlder || direction === 'newer' && !hasNewer) return
    pendingAnchor.current = captureAnchor()
    following.current = false
    try {
      if (direction === 'older') await loadOlder(pendingAnchor.current || undefined)
      else if (direction === 'newer') await loadNewer(pendingAnchor.current || undefined)
      else await retryHistory(pendingAnchor.current || undefined)
    } catch { pendingAnchor.current = null }
  }, [hasOlder, hasNewer, loading, loadOlder, loadNewer, retryHistory, captureAnchor])
  useLayoutEffect(() => {
    const ids = new Set(messages.map(message => message.id))
    if ([...previousIds.current].some(id => !ids.has(id))) {
      virtual.measure()
      measureConversationRows(virtual, box.current)
    }
    previousIds.current = ids
  }, [firstId, lastId])
  useLayoutEffect(() => {
    if (streamingMessageId) measureConversationRows(virtual, box.current, streamingMessageId)
  }, [messages, streamingMessageId])
  useLayoutEffect(() => {
    following.current = true
    pendingAnchor.current = null
    setShowLatest(false)
  }, [historyVersion, jumpVersion])
  useLayoutEffect(() => {
    if (editing) following.current = false
    else if (pendingAnchor.current?.focus) pendingAnchor.current = null
  }, [editing?.id])
  useLayoutEffect(() => {
    if (!focus) { if (pendingAnchor.current?.focus) pendingAnchor.current = null; return }
    following.current = false
    pendingAnchor.current = { id: focus.id, visibleIds: [focus.id], top: 12, focus: true }
    setShowLatest(true)
  }, [focus])
  useLayoutEffect(() => {
    if (hasNewer) { following.current = false; setShowLatest(true) }
  }, [hasNewer])
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current
    if (!anchor || loading) return
    const index = messages.findIndex(message => message.id === anchor.id)
    if (index < 0) { pendingAnchor.current = null; return }
    virtual.scrollToIndex(index, { align: 'start' })
    const frame = requestAnimationFrame(() => {
      const element = box.current
      const target = element?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`)
      if (target && element) element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.top
      if (anchor.focus) target?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
      if (element) previousScroll.current = element.scrollTop
      if (pendingAnchor.current === anchor) pendingAnchor.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, loading, focus])
  useLayoutEffect(() => {
    if (!following.current || pendingAnchor.current || !messages.length) return
    const frame = requestAnimationFrame(() => virtual.scrollToIndex(messages.length - 1, { align: 'end' }))
    return () => cancelAnimationFrame(frame)
  }, [messages, total, jumpVersion])
  const latest = () => {
    following.current = true
    pendingAnchor.current = null
    setShowLatest(false)
    onLatest()
  }
  return <div className="pa-conversation-view">
    <div ref={box} className="pa-conversation-scroll" aria-label={ui("会话消息")} onWheel={event => {
      const element = box.current!
      if (historyError || loading || pendingAnchor.current) return
      // At an edge the scroll offset does not change, so no scroll event is
      // emitted. Let another wheel gesture request the adjacent page.
      if (event.deltaY < 0 && element.scrollTop <= 1) load('older').catch(() => {})
      else if (event.deltaY > 0 && element.scrollHeight - element.scrollTop - element.clientHeight <= 1 && hasNewer) load('newer').catch(() => {})
    }} onScroll={() => {
      const element = box.current!
      if (pendingAnchor.current) return
      const delta = element.scrollTop - previousScroll.current
      previousScroll.current = element.scrollTop
      const bottom = element.scrollHeight - element.scrollTop - element.clientHeight
      following.current = bottom < 60 && !hasNewer
      setShowLatest(!following.current)
      if (!following.current && !browsing) {
        const anchor = captureAnchor()
        if (anchor) onReading(anchor)
      }
      if (following.current && browsing && !loading && !editing) latest()
      else if (!historyError && !loading) {
        if (delta < 0 && element.scrollTop < 100) load('older').catch(() => {})
        else if (delta > 0 && bottom < 100 && hasNewer) load('newer').catch(() => {})
      }
    }}>
      <div className="pa-conversation-space" style={{ height: total }}>
        <div className="pa-conversation-history">
          {historyError ? <button className="pa-text-action" onClick={() => load('retry').catch(() => {})}>{ui("读取失败，重试")}</button>
            : hasOlder ? <button className="pa-text-action" disabled={Boolean(loading)} onClick={() => load('older').catch(() => {})}>{loading === 'older' ? ui("正在读取…") : ui("加载更早消息")}</button> : <span>{ui("已到会话开头")}</span>}
        </div>
        {items.map(item => {
          const message = messages[item.index]
          return <div key={item.key} ref={virtual.measureElement} data-index={item.index} data-message-id={message.id} className="pa-conversation-message" style={{ transform: `translateY(${item.start}px)` }}>
            <MessageView message={message} streaming={streaming && message.id === streamingMessageId} respond={respond}
              editText={editing?.id === message.id ? editing.text : undefined} editBusy={editBusy} editError={editError}
              editingDisabled={editingDisabled} resendDisabled={resendDisabled} onEdit={onEdit} onEditChange={onEditChange} onEditCancel={onEditCancel} onResend={onResend} />
            {message.id === summary?.upToMessageId && <p className="pa-compaction-marker">{summary.partial ? ui("此前部分步骤已整理为摘要，完整记录仍可查看。") : ui("以上对话已整理为摘要，完整记录仍可查看。")}</p>}
          </div>
        })}
        {hasNewer && <div className="pa-conversation-history pa-conversation-newer"><button className="pa-text-action" disabled={Boolean(loading)} onClick={() => load('newer').catch(() => {})}>{loading === 'newer' ? ui("正在读取…") : ui("加载后续消息")}</button></div>}
      </div>
    </div>
    {showLatest && <OLTooltip id="assistant-return-latest" description={ui("回到最新")}><button type="button" className="pa-return-latest" aria-label={ui("回到最新")} onClick={latest}>{working ? <span className="spinner-border spinner-border-sm" aria-hidden="true" /> : <MaterialIcon type="arrow_downward" />}</button></OLTooltip>}
  </div>
}
