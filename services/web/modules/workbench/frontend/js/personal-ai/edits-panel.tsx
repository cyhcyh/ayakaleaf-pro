import { ui } from '@modules/site-settings/frontend/js/ui'
import { useEffect, useState, type CSSProperties } from 'react'
import { wordDiff } from '../agent/apply-edit'
import type { EditRecord } from './edits-store'
import { editStateNames } from './edit-proposal'
import MaterialIcon from '@/shared/components/material-icon'

export default function EditCard({ item, focused, busy, canWrite, onLocate, onAct, onResize, onHover, onLeave, style, position, line }: {
  item: EditRecord; focused: boolean; busy: boolean; canWrite: boolean; onLocate: () => void;
  onAct: (action: 'accept' | 'reject' | 'undo' | 'reapply' | 'reconcile') => void; onResize?: () => void;
  style?: CSSProperties; position?: number; line?: number; onHover: () => void; onLeave: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { if (!focused) setExpanded(false) }, [focused])
  const disabled = !canWrite || busy
  const lineNumber = line ?? item.input.startLine
  return <article className={`pa-edit-card review-panel-entry ${focused ? 'focused review-panel-entry-selected' : ''}`} data-edit-id={item.id} data-pos={position} style={style}
    onMouseEnter={onHover} onMouseLeave={onLeave} onFocus={onHover} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onLeave() }}>
    <header><button className="pa-edit-location" onClick={onLocate} title={ui("{0} · 第 {1} 行", [item.input.path, lineNumber])} aria-label={ui("定位到 {0} 第 {1} 行", [item.input.path, lineNumber])}>
      <MaterialIcon type="description" /><span className="pa-edit-filename">{item.input.path.split('/').at(-1)}</span><span className="pa-edit-line">{ui("{0} 行", [lineNumber])}</span>
    </button><span className={`pa-edit-status ${item.state}`}>{editStateNames[item.state]}</span></header>
    {item.input.reason && <p>{item.input.reason}</p>}
    <details open={expanded} onToggle={event => { setExpanded(event.currentTarget.open); onResize?.() }}><summary>{ui("查看差异")}</summary>
      {expanded && <pre className="pa-edit-diff">{wordDiff(item.input.oldText, item.input.newText).map((part, index) => part.added ? <ins key={index}>{part.value}</ins> : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</pre>}
    </details>
    <div className="pa-edit-actions">
      {item.operation ? <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onAct('reconcile')}>{ui("核对上次操作")}</button> : <>
        {item.state === 'pending' && <><button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onAct('reject')}>{ui("拒绝")}</button><button className="btn btn-primary btn-sm" disabled={disabled} onClick={() => onAct('accept')}>{ui("接受")}</button></>}
        {item.state === 'accepted' && <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onAct('undo')}>{ui("撤销")}</button>}
        {item.state === 'undone' && <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onAct('reapply')}>{ui("重新应用")}</button>}
      </>}
    </div>
  </article>
}
