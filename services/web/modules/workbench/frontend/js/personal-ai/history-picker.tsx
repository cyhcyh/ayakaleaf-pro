import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { api } from './api'
import type { SessionItem } from './session-state'
import './style.scss'

export default function HistoryPicker({ projectId, currentId, beforeChange, onSelect, onNew }: {
  projectId: string; currentId?: string; beforeChange: () => Promise<void>; onSelect: (id: string) => Promise<void>; onNew: (skipFlush?: boolean) => Promise<void>
}) {
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [items, setItems] = useState<SessionItem[]>([])
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [batch, setBatch] = useState(false)
  const [selected, setSelected] = useState(new Set<string>())
  const [deleting, setDeleting] = useState(false)
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async (next?: string | null, signal?: AbortSignal) => {
    const result = await api<{ items: SessionItem[]; next: string | null }>(`/sessions?projectId=${projectId}&q=${encodeURIComponent(query)}${next ? `&cursor=${encodeURIComponent(next)}` : ''}`, undefined, signal)
    setItems(previous => next ? [...previous, ...result.items] : result.items)
    setCursor(result.next)
  }
  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    const timer = setTimeout(() => load(null, abort.signal).catch(error => { if (!abort.signal.aborted) setError(error.message) }), 180)
    setSelected(new Set())
    return () => { clearTimeout(timer); abort.abort() }
  }, [open, query, projectId])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [open])
  const execute = async (work: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await work() } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next })
  return <>
    <OLTooltip id="assistant-history" description="历史会话" overlayProps={{ placement: 'bottom' }}>
    <OLIconButton ref={button} className="rail-panel-header-button-subdued" size="sm" icon="history" accessibilityLabel="历史会话" aria-expanded={open} aria-haspopup="dialog" onClick={() => {
      if (!open) { const rect = button.current!.getBoundingClientRect(); setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 388)), top: rect.bottom + 6 }); setError(''); setDeleting(false); setRename(null) }
      setOpen(!open)
    }} /></OLTooltip>
    {open && createPortal(<div ref={menu} className="pa-history-menu" role="dialog" aria-label="历史会话" style={position}>
      <header><div><strong>历史会话</strong><small>当前项目</small></div><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => execute(async () => { await onNew(); setOpen(false) })}>＋ 新建会话</button></header>
      <div className="pa-history-search"><input autoFocus className="form-control" aria-label="搜索会话" placeholder="搜索标题或对话内容" value={query} onChange={event => setQuery(event.target.value)} />
        <button className="btn btn-secondary btn-sm" aria-pressed={batch} onClick={() => { setBatch(!batch); setSelected(new Set()); setDeleting(false) }}>批量管理</button></div>
      {error && <p className="pa-inline-error" role="alert">{error}</p>}
      {rename && <form className="pa-history-rename" onSubmit={event => { event.preventDefault(); execute(async () => {
        if (rename.id === currentId) await beforeChange(); await api(`/sessions/${rename.id}/rename`, { projectId, title: rename.title });
        if (rename.id === currentId) await onSelect(rename.id)
        setRename(null); await load()
      }) }}><label>会话名称<input className="form-control" value={rename.title} maxLength={100} onChange={event => setRename({ ...rename, title: event.target.value })} /></label>
        <div className="pa-actions"><button className="btn btn-primary btn-sm" disabled={busy || !rename.title.trim()}>保存名称</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setRename(null)}>取消</button></div></form>}
      <div className="pa-history-list">
        {!items.length && <p className="pa-muted m-3">{query ? '没有匹配的会话' : '暂无历史会话'}</p>}
        {items.map(item => <div key={item.id} className={`pa-history-item ${item.id === currentId || selected.has(item.id) ? 'selected' : ''}`}>
          {batch && <input type="checkbox" aria-label={`选择会话 ${item.title}`} checked={selected.has(item.id)} onChange={() => toggle(item.id)} />}
          <button className="pa-history-select" disabled={busy} onClick={() => batch ? toggle(item.id) : execute(async () => { if (item.id !== currentId) await onSelect(item.id); setOpen(false) })}>
            <span>{item.title}</span>{item.snippet && <span className="pa-history-snippet">{item.snippet}</span>}<small>{new Date(item.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></button>
          {!batch && <details className="pa-session-actions"><summary aria-label={`管理会话 ${item.title}`}>⋮</summary><div>
            <button onClick={() => setRename({ id: item.id, title: item.title })}>重命名</button><button onClick={() => { setSelected(new Set([item.id])); setDeleting(true) }}>删除</button>
          </div></details>}
        </div>)}
        {cursor && <button className="pa-text-action d-block mx-auto my-2" disabled={busy} onClick={() => execute(() => load(cursor))}>加载更多会话</button>}
      </div>
      {deleting ? <footer className="pa-history-confirm"><p>删除所选 {selected.size} 个会话？项目正文、评论和 AI 修改记录会保留。</p><div className="pa-actions">
        <button className="btn btn-danger btn-sm" disabled={busy || !selected.size} onClick={() => execute(async () => {
          if (currentId && selected.has(currentId)) await beforeChange(); await api('/sessions/delete', { projectId, ids: [...selected] });
          if (currentId && selected.has(currentId)) await onNew(true)
          setSelected(new Set()); setDeleting(false); await load()
        })}>确认删除 {selected.size} 项</button><button className="btn btn-secondary btn-sm" onClick={() => setDeleting(false)}>取消</button></div></footer>
        : batch && <footer><span>已选 {selected.size} 项</span><button className="pa-text-action" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map(item => item.id)))}>{selected.size === items.length ? '取消选择' : '全选已显示'}</button><button className="btn btn-outline-danger btn-sm" disabled={!selected.size || selected.size > 100 || busy} onClick={() => setDeleting(true)}>删除所选</button></footer>}
    </div>, document.body)}
  </>
}
