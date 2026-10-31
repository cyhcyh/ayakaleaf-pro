import { ui } from '@modules/site-settings/frontend/js/ui'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { UIMessage } from 'ai'
import type { Respond } from '../agent/tools'
import type { Summary } from '../personal-ai/session-state'
import MessageView from './message-view'

export default function ConversationMessages({ messages, streaming, respond, summary, hasOlder, loadingOlder, historyError, loadOlder }: {
  messages: UIMessage[]; streaming: boolean; respond: Respond; summary: Summary | null;
  hasOlder: boolean; loadingOlder: boolean; historyError: string; loadOlder: () => Promise<void>
}) {
  const box = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const pendingAnchor = useRef<{ id: string; top: number } | null>(null)
  const virtual = useVirtualizer({ count: messages.length, getScrollElement: () => box.current, getItemKey: index => messages[index].id,
    estimateSize: () => 160, overscan: 4, paddingStart: 36, paddingEnd: 8 })
  const total = virtual.getTotalSize()
  const firstId = messages[0]?.id
  const older = useCallback(async () => {
    if (!hasOlder || loadingOlder || pendingAnchor.current) return
    const element = box.current
    if (!element) return
    const top = element.getBoundingClientRect().top
    const entry = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(item => item.getBoundingClientRect().bottom > top)
    if (entry) pendingAnchor.current = { id: entry.dataset.messageId!, top: entry.getBoundingClientRect().top - top }
    following.current = false
    try { await loadOlder() } catch { pendingAnchor.current = null }
  }, [hasOlder, loadingOlder, loadOlder])
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current
    if (!anchor) return
    const index = messages.findIndex(message => message.id === anchor.id)
    if (index < 0) return
    virtual.scrollToIndex(index, { align: 'start' })
    const frame = requestAnimationFrame(() => {
      const element = box.current
      const target = element?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`)
      if (target && element) element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.top
      pendingAnchor.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [firstId])
  useLayoutEffect(() => {
    if (!following.current || pendingAnchor.current || !messages.length) return
    const frame = requestAnimationFrame(() => virtual.scrollToIndex(messages.length - 1, { align: 'end' }))
    return () => cancelAnimationFrame(frame)
  }, [messages, total])
  return <div ref={box} className="pa-conversation-scroll" aria-label={ui("会话消息")} onScroll={() => {
    const element = box.current!
    if (pendingAnchor.current) return
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
    if (element.scrollTop < 100 && !following.current && !historyError) older().catch(() => {})
  }}>
    <div className="pa-conversation-space" style={{ height: total }}>
      <div className="pa-conversation-history">
        {historyError ? <button className="pa-text-action" onClick={() => older().catch(() => {})}>{ui("读取失败，重试")}</button>
          : hasOlder ? <button className="pa-text-action" disabled={loadingOlder} onClick={() => older().catch(() => {})}>{loadingOlder ? ui("正在读取…") : ui("加载更早消息")}</button> : <span>{ui("已到会话开头")}</span>}
      </div>
      {virtual.getVirtualItems().map(item => {
        const message = messages[item.index]
        return <div key={item.key} ref={virtual.measureElement} data-index={item.index} data-message-id={message.id} className="pa-conversation-message" style={{ transform: `translateY(${item.start}px)` }}>
          <MessageView message={message} streaming={streaming && item.index === messages.length - 1} respond={respond} />
          {message.id === summary?.upToMessageId && <p className="pa-compaction-marker">{summary.partial ? ui("此前部分步骤已整理为摘要，完整记录仍可查看。") : ui("以上对话已整理为摘要，完整记录仍可查看。")}</p>}
        </div>
      })}
    </div>
  </div>
}
