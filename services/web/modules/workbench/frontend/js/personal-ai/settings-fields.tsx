import { useId, type ReactNode } from 'react'
import type { Binding, Compression, Profile } from './api'
import { ModelPicker, ThinkingControls, effortNames } from './model-controls'

export function BindingFields({ profile, value, onChange, primary = false, flat = false }: {
  profile: Profile; value: Binding; onChange: (value: Partial<Binding>) => void; primary?: boolean; flat?: boolean
}) {
  const connections = profile.connections.filter(connection => connection.kind !== 'google')
  const effective = value.connectionId ? value : profile.bindings.chat
  const connection = connections.find(item => item.id === effective.connectionId)
  const connectionId = useId()
  return <>
    <div className={flat ? 'pa-flat-row' : 'pa-field'}>
      <label htmlFor={connectionId}>{flat ? '模型连接' : '连接'}</label>
      <select id={connectionId} className="form-select form-control" value={value.connectionId} onChange={event => onChange({ connectionId: event.target.value, model: '', thinking: 'auto', reasoningEffort: 'auto' })}>
        <option value="">{primary ? profile.siteDefault ? `使用站点预设 · ${profile.siteDefault.model}` : '请选择连接' : '沿用 AI 助手'}</option>
        {connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>
    <div className={flat ? 'pa-flat-row' : 'pa-field'}><span>{flat ? '压缩模型' : '模型'}</span>
      <ModelPicker label={flat ? '压缩模型' : '功能模型'} value={effective.model || profile.siteDefault?.model || ''} models={connection?.catalog?.models || []}
        disabled={!value.connectionId} onChange={model => onChange({ model, thinking: 'auto', reasoningEffort: 'auto' })} />
    </div>
    <ThinkingControls profile={profile} value={value.connectionId ? value : { ...effective, connectionId: '' }} onChange={onChange} flat={flat} />
    {!value.connectionId && !primary && <p className="pa-muted pa-control-note">{connection ? `实际使用：${connection.name} · ${effective.model} · ${effortNames[effective.reasoningEffort || 'auto']}` : profile.siteDefault ? `实际使用：站点预设 · ${profile.siteDefault.model}` : '请先配置 AI 助手，或为此功能选择独立连接。'}</p>}
  </>
}

function FormRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <div className="pa-flat-row"><div><span>{label}</span>{description && <small>{description}</small>}</div><div className="pa-flat-control">{children}</div></div>
}

export function CompressionSettings({ profile, onProfile }: { profile: Profile; onProfile: (profile: Profile) => void }) {
  const policy = profile.compression
  const set = (values: Partial<Compression>) => onProfile({ ...profile, compression: { ...policy, ...values } })
  const number = (key: keyof Compression, label: string, min: number, max: number, percent = false) => <input
    className="form-control" type="number" aria-label={label} min={min} max={max} step="1"
    value={Number(policy[key]) * (percent ? 100 : 1)} onChange={event => set({ [key]: Number(event.target.value) / (percent ? 100 : 1) })} />
  return <div className="pa-compression-settings">
    <h4 className="pa-section-title">压缩模型</h4>
    <FormRow label="启用自动压缩" description="达到阈值后整理早期对话，完整历史记录仍可回看。">
      <input type="checkbox" role="switch" aria-label="启用自动压缩" checked={policy.enabled} onChange={event => set({ enabled: event.target.checked })} />
    </FormRow>
    <BindingFields profile={profile} value={profile.bindings.compression} flat onChange={changes => onProfile({ ...profile, bindings: { ...profile.bindings, compression: { ...profile.bindings.compression, ...changes } } })} />
    <h4 className="pa-section-title">压缩策略</h4>
    <FormRow label="触发阈值" description="达到可用上下文预算的此比例时触发压缩。"><div className="pa-number-unit">{number('threshold', '触发阈值', 10, 95, true)}<span>%</span></div></FormRow>
    <FormRow label="摘要目标比例" description="摘要的目标预算占助手上下文容量的比例，应小于触发阈值。"><div className="pa-number-unit">{number('targetRatio', '摘要目标比例', 1, 80, true)}<span>%</span></div></FormRow>
    <details className="pa-advanced"><summary>高级设置 <small>上下文容量、保留消息数、摘要长度上限</small></summary>
      <FormRow label="助手上下文容量" description="单位 tokens。0 表示读取模型目录；无法识别时请填写。">{number('contextWindow', '助手上下文容量', 0, 2000000)}</FormRow>
      <FormRow label="压缩模型上下文容量" description="单位 tokens。0 表示读取模型目录。">{number('summaryContextWindow', '压缩模型上下文容量', 0, 2000000)}</FormRow>
      <FormRow label="保留最近消息" description="按完整对话轮次保留，避免拆开工具调用及其结果。">{number('protectLast', '保留最近消息', 1, 500)}</FormRow>
      <FormRow label="保留开头消息">{number('protectFirst', '保留开头消息', 0, 100)}</FormRow>
      <FormRow label="摘要长度上限" description="单位 tokens。0 表示按目标比例和模型能力自动计算。">{number('summaryMaxTokens', '摘要长度上限', 0, 100000)}</FormRow>
    </details>
  </div>
}
