import { ui } from '@modules/site-settings/frontend/js/ui'
import { useId, type ReactNode } from 'react'
import Setting from '@/features/ide-settings/components/setting'
import ToggleSetting from '@/features/ide-settings/components/toggle-setting'
import type { Binding, Compression, Profile } from './api'
import { ModelPicker, ThinkingControls, effortNames, useModelInfo } from './model-controls'
import { contextBudget, summaryBudget } from '../../../shared/compression-budget.mjs'

export function BindingFields({ profile, value, onChange, primary = false, flat = false }: {
  profile: Profile; value: Binding; onChange: (value: Partial<Binding>) => void; primary?: boolean; flat?: boolean
}) {
  const connections = profile.connections.filter(c => c.kind !== 'google')
  const effective = value.connectionId ? value : profile.bindings.chat
  const connection = connections.find(c => c.id === effective.connectionId)
  const connectionId = useId(), modelId = useId()
  const inherited = !value.connectionId && !primary
    ? connection ? `${connection.name} · ${effective.model} · ${effortNames[effective.reasoningEffort || 'auto']}` : profile.siteDefault ? ui("站点预设 · {0}", [profile.siteDefault.model]) : ui("请先配置 AI 助手。")
    : undefined
  const field = (id: string, label: string, control: ReactNode, description?: string) => flat
    ? <Setting controlId={id} label={label} description={description}>{control}</Setting>
    : <div className="pa-field"><label htmlFor={id}>{label}</label>{control}</div>
  return <>
    {field(connectionId, ui("连接"), <select id={connectionId} className="form-select form-control" value={value.connectionId} onChange={event => onChange({ connectionId: event.target.value, model: '', thinking: 'auto', reasoningEffort: 'auto' })}>
      <option value="">{primary ? profile.siteDefault ? ui("使用站点预设 · {0}", [profile.siteDefault.model]) : ui("请选择连接") : ui("沿用 AI 助手")}</option>
      {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>, flat ? inherited : undefined)}
    {field(modelId, flat ? ui("压缩模型") : ui("模型"), <ModelPicker controlId={modelId} label={flat ? ui("压缩模型") : ui("功能模型")} value={effective.model || profile.siteDefault?.model || ''} models={connection?.catalog?.models || []}
      disabled={!value.connectionId} onChange={model => onChange({ model, thinking: 'auto', reasoningEffort: 'auto' })} />)}
    <ThinkingControls profile={profile} value={value.connectionId ? value : { ...effective, connectionId: '' }} onChange={onChange} flat={flat} />
    {!flat && inherited && <p className="pa-muted pa-control-note">{inherited}</p>}
  </>
}

function BudgetSetting({ label, value, actual, reported, max, onChange }: { label: string; value: number; actual: number; reported?: number; max: number; onChange: (value: number) => void }) {
  const id = useId()
  const source = value ? ui("手动设置") : reported ? ui("模型数据") : ui("默认值")
  return <Setting controlId={id} label={label} description={`${source} · tokens${value && value > actual ? ui("，实际不超过 {0}", [actual.toLocaleString()]) : ''}`}>
    <div className="pa-budget-control"><input id={id} className="form-control" type="number" aria-label={label} min={0} max={max} step={1} value={value || actual} onChange={event => onChange(Number(event.target.value))} />
      {value > 0 && <button type="button" className="pa-text-action" onClick={() => onChange(0)}>{ui("自动")}</button>}
    </div>
  </Setting>
}

export function CompressionSettings({ profile, onProfile }: { profile: Profile; onProfile: (profile: Profile) => void }) {
  const policy = profile.compression
  const set = (values: Partial<Compression>) => onProfile({ ...profile, compression: { ...policy, ...values } })
  const chat = useModelInfo(profile, profile.bindings.chat)
  const summary = useModelInfo(profile, profile.bindings.compression.connectionId ? profile.bindings.compression : profile.bindings.chat)
  const window = contextBudget(policy.contextWindow, chat?.contextWindow || 0)
  const summaryWindow = contextBudget(policy.summaryContextWindow, summary?.contextWindow || 0)
  const output = summaryBudget(policy, window, summaryWindow, summary?.outputLimit || 0)
  const number = (key: keyof Compression, label: string, min: number, max: number, description?: string, percent = false) => <Setting controlId={`pa-compression-${key}`} label={label} description={description}>
    <div className={percent ? 'pa-number-unit' : 'pa-budget-control'}><input id={`pa-compression-${key}`} className="form-control" type="number" aria-label={label} min={min} max={max} step="1"
      value={percent ? Math.round(Number(policy[key]) * 100) : Number(policy[key])} onChange={event => set({ [key]: Number(event.target.value) / (percent ? 100 : 1) })} />{percent && <span>%</span>}</div>
  </Setting>
  return <div className="pa-native-settings">
    <ToggleSetting id="pa-auto-compression" label={ui("自动压缩")} description={ui("整理较早的对话，完整记录仍可查看。")} checked={policy.enabled} onChange={enabled => set({ enabled })} />
    <BindingFields profile={profile} value={profile.bindings.compression} flat onChange={changes => onProfile({ ...profile, bindings: { ...profile.bindings, compression: { ...profile.bindings.compression, ...changes } } })} />
    {number('threshold', ui("触发阈值"), 10, 95, ui("达到上下文预算的此比例时压缩。"), true)}
    {number('targetRatio', ui("摘要目标比例"), 1, 80, ui("摘要占上下文容量的目标比例。"), true)}
    <details className="pa-advanced"><summary>{ui("高级设置")}</summary>
      <BudgetSetting label={ui("助手上下文容量")} value={policy.contextWindow} actual={window} reported={chat?.contextWindow} max={2000000} onChange={contextWindow => set({ contextWindow })} />
      <BudgetSetting label={ui("压缩模型上下文容量")} value={policy.summaryContextWindow} actual={summaryWindow} reported={summary?.contextWindow} max={2000000} onChange={summaryContextWindow => set({ summaryContextWindow })} />
      <BudgetSetting label={ui("摘要长度上限")} value={policy.summaryMaxTokens} actual={output} reported={summary?.outputLimit} max={100000} onChange={summaryMaxTokens => set({ summaryMaxTokens })} />
      {number('protectLast', ui("保留最近消息"), 1, 500, ui("优先保留这些消息，空间不足时自动整理较早内容。工具调用和结果一起处理。"))}
      {number('protectFirst', ui("保留开头消息"), 0, 100, ui("优先保留开头消息，空间不足时纳入摘要。"))}
    </details>
  </div>
}
