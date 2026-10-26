import { useEffect, useState, type ReactNode } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { wordDiff } from '../agent/apply-edit'
import { focusEdit, refreshEdits, useEdits } from './edits-store'
import { useEditActions } from './use-edit-actions'
import { editStateNames } from './edit-proposal'
import './style.scss'

export default function ReviewExtension({ children }: { children: ReactNode }) {
  const { projectId } = useProjectContext()
  const state = useEdits(projectId)
  const [active, setActive] = useState(false)
  const [filter, setFilter] = useState('pending')
  const { locate, act, canWrite } = useEditActions()
  const focusedState = state.items.find(item => item.id === state.focusId)?.state
  useEffect(() => { if (state.focusId) { setActive(true); setFilter('all') } }, [state.focusId, focusedState])
  const items = state.items.filter(item => filter === 'all' || (filter === 'pending' ? item.state === 'pending' : item.state !== 'pending'))
  const apply = (id: string, action: 'accept' | 'reject' | 'undo' | 'reapply' | 'reconcile') => act(id, action).catch(() => {})
  return <div className="pa-review-extension">
    <div className="pa-review-switch" role="tablist" aria-label="审阅类别">
      <button role="tab" aria-selected={!active} onClick={() => { setActive(false); focusEdit(projectId, null) }}>评论</button>
      <button role="tab" aria-selected={active} onClick={() => setActive(true)}>AI 修改 <span>{state.items.filter(item => item.state === 'pending').length}</span></button>
    </div>
    <div className="pa-original-review" hidden={active}>{children}</div>
    {active && <div className="pa-edits-panel">
      <div className="pa-edits-filters" role="group" aria-label="筛选 AI 修改">
        {([['all', '全部'], ['pending', '待确认'], ['done', '已处理']] as const).map(([value, name]) => <button className="btn btn-secondary btn-sm" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{name}</button>)}
      </div>
      <p className="pa-muted">接受后才修改正文；已应用的建议可在“已处理”中撤销。</p>
      {state.error && <div className="pa-inline-error" role="alert">{state.error}<button className="pa-text-action" onClick={() => refreshEdits(projectId).catch(() => {})}>刷新记录</button></div>}
      {!items.length && <p className="pa-muted text-center py-4">{state.loading ? '正在读取修改建议…' : '暂无符合条件的 AI 修改'}</p>}
      {items.map(item => <article key={item.id} className={`pa-edit-card ${state.focusId === item.id ? 'focused' : ''}`}>
        <header><button className="pa-text-action" onClick={() => locate(item.id).catch(() => {})}>{item.input.path} · 第 {item.input.startLine} 行</button><span className={`pa-edit-status ${item.state}`}>{editStateNames[item.state]}</span></header>
        {item.input.reason && <p>{item.input.reason}</p>}
        <details open={state.focusId === item.id || item.state === 'pending'}><summary>查看增删差异</summary><pre className="pa-edit-diff">{wordDiff(item.input.oldText, item.input.newText).map((part, index) => part.added ? <ins key={index}>{part.value}</ins> : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</pre></details>
        <div className="pa-edit-actions">
          {item.operation ? <button className="btn btn-secondary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'reconcile')}>核对上次操作</button> : <>
            {item.state === 'pending' && <><button className="btn btn-secondary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'reject')}>拒绝</button><button className="btn btn-primary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'accept')}>接受此处</button></>}
            {item.state === 'accepted' && <button className="btn btn-secondary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'undo')}>↶ 撤销此处</button>}
            {item.state === 'undone' && <button className="btn btn-secondary btn-sm" disabled={!canWrite || state.busy.includes(item.id)} onClick={() => apply(item.id, 'reapply')}>重新应用</button>}
          </>}
        </div>
      </article>)}
      <p className="pa-muted pt-2">撤销仅恢复这一项修改；正文有后续变化时需重新核对。</p>
    </div>}
  </div>
}
