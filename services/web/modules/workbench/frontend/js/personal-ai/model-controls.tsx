import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Setting from '@/features/ide-settings/components/setting'
import { api, type Binding, type ModelInfo, type Profile } from './api'

export function ModelPicker({ value, models, onChange, label = '模型', disabled = false, controlId }: {
  value: string; models: ModelInfo[]; onChange: (value: string) => void; label?: string; disabled?: boolean; controlId?: string
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 })
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [manual, setManual] = useState(false)
  const choices = models.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  useEffect(() => {
    if (!open || !root.current) return
    const bounds = root.current.querySelector('button')!.getBoundingClientRect()
    const below = window.innerHeight - bounds.bottom - 16
    const height = Math.min(280, Math.max(below, bounds.top - 16))
    setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - Math.max(240, bounds.width) - 8)), top: below >= height ? bounds.bottom + 4 : bounds.top - height - 4, width: Math.max(240, bounds.width), maxHeight: height })
    input.current?.focus()
    const closeOnScroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    const close = () => setOpen(false)
    document.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)
    return () => { document.removeEventListener('scroll', closeOnScroll, true); window.removeEventListener('resize', close) }
  }, [open])
  const choose = (model: string) => { onChange(model); setOpen(false); setQuery(''); setActive(0) }
  return <div className="pa-model-picker" ref={root}>
    <button id={controlId} type="button" className="form-control pa-picker-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => { setOpen(!open); setQuery(''); setActive(0); requestAnimationFrame(() => input.current?.focus()) }}>
      <span>{models.find(model => model.id === value)?.name || value || '选择模型…'}</span><span aria-hidden>⌄</span>
    </button>
    {open && createPortal(<div className="pa-picker-menu" ref={menu} style={position}>
      <input ref={input} className="form-control" aria-label={`搜索${label}`} placeholder="搜索模型名称或 ID" value={query} onChange={event => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))) }
          if (event.key === 'Enter' && choices[active]) { event.preventDefault(); choose(choices[active].id) }
        }} />
      <div role="listbox" id={id} aria-label={`${label}列表`}>
        {!choices.length && <p className="pa-muted m-2">{models.length ? '没有匹配的模型' : '请先获取可用模型，或手动输入模型 ID'}</p>}
        {choices.map((model, index) => <button type="button" role="option" aria-selected={model.id === value} key={model.id} className={index === active ? 'active' : ''}
          onMouseEnter={() => setActive(index)} onClick={() => choose(model.id)}><span>{model.name}</span>{model.name !== model.id && <small>{model.id}</small>}{model.id === value && <span aria-hidden>✓</span>}</button>)}
      </div>
    </div>, root.current?.closest('.focus-trap-container, [role="dialog"]') || document.body)}
    <button type="button" className="pa-text-action" disabled={disabled} aria-expanded={manual} onClick={() => setManual(!manual)}>手动输入模型 ID</button>
    {manual && <input className="form-control mt-1" aria-label={`${label}手动 ID`} value={value} placeholder="输入服务支持的模型 ID" disabled={disabled} onChange={event => onChange(event.target.value)} />}
  </div>
}

export const thinkingNames: Record<string, string> = { auto: '模型默认', on: '开启思考', off: '关闭思考' }
export const effortNames: Record<string, string> = { auto: '模型默认', none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高', ultra: '极高' }
const capabilities = new Map<string, Promise<ModelInfo>>()

export function useModelInfo(profile: Profile, value: Binding) {
  const connection = profile.connections.find(c => c.id === value.connectionId)
  const cached = connection?.catalog?.models.find(model => model.id === value.model)
  const [info, setInfo] = useState<ModelInfo | null>(cached || null)
  useEffect(() => {
    if (cached) { setInfo(cached); return }
    setInfo(null)
    if (!connection || !value.model.trim()) return
    let live = true
    const key = `${connection.id}:${connection.credentialRevision}:${connection.catalog?.updatedAt}:${value.model}`
    if (!capabilities.has(key)) capabilities.set(key, api(`/connections/${connection.id}/capabilities`, { model: value.model }).catch(error => { capabilities.delete(key); throw error }))
    capabilities.get(key)!.then(data => { if (live) setInfo(data) }).catch(() => {})
    return () => { live = false }
  }, [connection?.id, connection?.credentialRevision, connection?.catalog?.updatedAt, value.model, cached])
  return info
}

export function ThinkingControls({ profile, value, onChange, flat = false, showNote = true }: { profile: Profile; value: Binding; onChange: (value: Partial<Binding>) => void; flat?: boolean; showNote?: boolean }) {
  const modeId = useId(), effortId = useId()
  const info = useModelInfo(profile, value)
  const inherited = !value.connectionId
  const mode = value.thinking || 'auto'
  const effort = value.reasoningEffort || 'auto'
  const modeControl = <select id={modeId} className="form-select form-control" aria-label="思考模式" disabled={inherited || !info} value={mode} onChange={event => onChange({ thinking: event.target.value, reasoningEffort: 'auto' })}>
        {[...new Set(['auto', ...(info?.thinkingModes || []), mode])].map(item => <option key={item} value={item} disabled={item !== 'auto' && !info?.thinkingModes.includes(item)}>{thinkingNames[item] || item}</option>)}
      </select>
  const effortControl = <select id={effortId} className="form-select form-control" aria-label="推理强度" disabled={inherited || !info?.reasoningEfforts.length || mode === 'off'} value={effort} onChange={event => onChange({ reasoningEffort: event.target.value })}>
        {[...new Set(['auto', ...(info?.reasoningEfforts || []), effort])].map(item => <option key={item} value={item} disabled={item !== 'auto' && (!info?.reasoningEfforts.includes(item) || (mode === 'on' && item === 'none'))}>{effortNames[item] || item}</option>)}
      </select>
  return <>
    {flat ? <><Setting controlId={modeId} label="思考模式" description={undefined}>{modeControl}</Setting><Setting controlId={effortId} label="推理强度" description={undefined}>{effortControl}</Setting></>
      : <><div className="pa-field"><label htmlFor={modeId}>思考模式</label>{modeControl}</div><div className="pa-field"><label htmlFor={effortId}>推理强度</label>{effortControl}</div></>}
    {showNote && !flat && value.model && info?.source === 'unknown' && <p className="pa-muted pa-control-note">未获取到思考参数，使用模型默认值。</p>}
  </>
}
