import { useEffect, useState } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useProjectContext } from '@/shared/context/project-context'
import { wordDiff } from '../agent/apply-edit'
import { refreshEdits, updateEdits, useEdits } from './edits-store'
import { useEditActions } from './use-edit-actions'
import { editStateNames } from './edit-proposal'
import './style.scss'

export default function AiEditsPanel() {
  const { projectId } = useProjectContext()
  const state = useEdits(projectId)
  const [filter, setFilter] = useState('all')
  const { locate, act, canWrite } = useEditActions()
  const focusedState = state.items.find(item => item.id === state.focusId)?.state
  useEffect(() => { if (state.focusId) setFilter('all') }, [state.focusId, focusedState])
  const pending = state.items.filter(item => item.state === 'pending').length
  const items = state.items.filter(item => filter === 'all' || (filter === 'pending' ? item.state === 'pending' : item.state !== 'pending'))
  const apply = (id: string, action: 'accept' | 'reject' | 'undo' | 'reapply' | 'reconcile') => act(id, action).catch(() => {})
  return <div className="pa-edits-workspace">
    <RailPanelHeader title="AI 修改" />
    <div className="pa-edits-toolbar">
      <p className="pa-muted">{pending} 项待处理</p>
      <div className="pa-edits-filters" role="group" aria-label="筛选 AI 修改">
        {([['all', '全部'], ['pending', '待确认'], ['done', '已处理']] as const).map(([value, name]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{name}</button>)}
      </div>
    </div>
    <div className="pa-edits-panel">
      {state.error && <div className="pa-inline-error" role="alert">{state.error}<button className="pa-text-action" onClick={() => refreshEdits(projectId).catch(() => {})}>刷新记录</button></div>}
      {!items.length && <div className="pa-edits-empty"><p>{state.loading ? '正在读取修改…' : '暂无修改建议'}</p><span>可以让 AI 助手帮你修改论文。</span></div>}
      {items.map(item => <article key={item.id} className={`pa-edit-card ${state.focusId === item.id ? 'focused' : ''}`}>
        <header><button className="pa-edit-location" onClick={() => locate(item.id).catch(error => updateEdits(projectId, { error: error.message }))}>{item.input.path} · 第 {item.input.startLine} 行</button><span className={`pa-edit-status ${item.state}`}>{editStateNames[item.state]}</span></header>
        {item.input.reason && <p>{item.input.reason}</p>}
        <details open={state.focusId === item.id || item.state === 'pending'}><summary>查看差异</summary><pre className="pa-edit-diff">{wordDiff(item.input.oldText, item.input.newText).map((part, index) => part.added ? <ins key={index}>{part.value}</ins> : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</pre></details>
        <div className="pa-edit-actions">
          {item.operation ? <button className="btn btn-secondary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'reconcile')}>核对上次操作</button> : <>
            {item.state === 'pending' && <><button className="btn btn-secondary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'reject')}>拒绝</button><button className="btn btn-primary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'accept')}>接受</button></>}
            {item.state === 'accepted' && <button className="btn btn-secondary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'undo')}>撤销</button>}
            {item.state === 'undone' && <button className="btn btn-secondary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'reapply')}>重新应用</button>}
          </>}
        </div>
      </article>)}
    </div>
  </div>
}
