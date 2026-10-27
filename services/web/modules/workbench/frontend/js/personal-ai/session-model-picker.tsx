import { ui } from '@modules/site-settings/frontend/js/ui'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { api, type Binding, type Profile } from './api'
import { ModelPicker, ThinkingControls, effortNames } from './model-controls'

export default function SessionModelPicker({ value, onChange, disabled, onManage }: {
  value: Binding | null; onChange: (value: Binding | null) => void; disabled: boolean; onManage: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Binding>({ connectionId: '', model: '', thinking: 'auto', reasoningEffort: 'auto' })
  const [position, setPosition] = useState({ left: 0, bottom: 0, maxHeight: 500 })
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const abort = new AbortController()
    api<Profile>('/settings', undefined, abort.signal).then(setProfile).catch(error => { if (!abort.signal.aborted) setError(error.message) })
    const changed = (event: Event) => setProfile((event as CustomEvent<Profile>).detail)
    window.addEventListener('personal-ai:settings', changed)
    return () => { abort.abort(); window.removeEventListener('personal-ai:settings', changed) }
  }, [])
  useEffect(() => {
    if (!open) return
    const hide = (event: Event) => { if (!popup.current?.contains(event.target as Node) && !root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', hide)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', hide)
    return () => { document.removeEventListener('pointerdown', hide); document.removeEventListener('keydown', escape); window.removeEventListener('resize', hide) }
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const effective = value || profile?.bindings.chat
  const connection = profile?.connections.find(item => item.id === draft.connectionId)
  const label = effective?.model ? ui("模型：{0} · {1}", [effective.model, effortNames[effective.reasoningEffort || 'auto']]) : ui("选择本会话模型")
  const toggle = () => {
    if (open) { setOpen(false); return }
    const rect = root.current!.getBoundingClientRect()
    setPosition({ left: Math.max(12, Math.min(rect.right - 300, window.innerWidth - 312)), bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(100, rect.top - 20) })
    setDraft(value || profile?.bindings.chat || { connectionId: '', model: '', thinking: 'auto', reasoningEffort: 'auto' })
    setOpen(true)
  }
  return <div ref={root} className="pa-session-model">
    <OLTooltip id="assistant-session-model" description={label} overlayProps={{ placement: 'top' }}>
      <OLIconButton icon="neurology" variant="ghost" size="sm" accessibilityLabel={ui("选择本会话模型")} disabled={disabled} onClick={toggle} aria-expanded={open} />
    </OLTooltip>
    {open && createPortal(<div ref={popup} className="pa-session-model-popover" role="dialog" aria-label={ui("本会话模型")} style={position}>
      <header><span>{ui("本会话模型")}</span><button type="button" className="pa-text-action" aria-label={ui("关闭模型选择")} onClick={() => setOpen(false)}>×</button></header>
      {profile ? <>
        <div className="pa-field"><label htmlFor="pa-session-connection">{ui("连接")}</label><select id="pa-session-connection" className="form-control form-select" value={draft.connectionId}
          onChange={event => setDraft({ connectionId: event.target.value, model: '', thinking: 'auto', reasoningEffort: 'auto' })}>
          <option value="">{ui("请选择连接")}</option>{profile.connections.filter(item => item.kind !== 'google').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></div>
        <div className="pa-field"><label htmlFor="pa-session-model">{ui("模型")}</label><ModelPicker controlId="pa-session-model" label={ui("本会话模型")} value={draft.model} models={connection?.catalog?.models || []} disabled={!draft.connectionId}
          onChange={model => setDraft({ ...draft, model, thinking: 'auto', reasoningEffort: 'auto' })} /></div>
        <ThinkingControls profile={profile} value={draft} showNote={false} onChange={change => setDraft({ ...draft, ...change })} />
        <div className="pa-session-model-actions"><button className="pa-text-action" onClick={() => { onChange(null); setOpen(false) }}>{ui("沿用默认")}</button><button className="btn btn-primary btn-sm" disabled={!draft.connectionId || !draft.model.trim()} onClick={() => { onChange(draft); setOpen(false) }}>{ui("完成")}</button></div>
      </> : <p className={error ? 'pa-inline-error' : 'pa-muted'}>{error || ui("正在读取模型连接…")}</p>}
      <footer><button className="pa-text-action" onClick={() => { setOpen(false); onManage() }}>{ui("管理模型连接")}</button></footer>
    </div>, document.body)}
  </div>
}
