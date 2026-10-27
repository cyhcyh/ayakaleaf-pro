import { useEffect, useState, type CSSProperties } from 'react'
import { wordDiff } from '../agent/apply-edit'
import type { EditRecord } from './edits-store'
import { editStateNames } from './edit-proposal'

export default function EditCard({ item, focused, busy, canWrite, onLocate, onAct, onResize, style, position, top }: {
  item: EditRecord; focused: boolean; busy: boolean; canWrite: boolean; onLocate: () => void;
  onAct: (action: 'accept' | 'reject' | 'undo' | 'reapply' | 'reconcile') => void; onResize?: () => void;
  style?: CSSProperties; position?: number; top?: number
}) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { if (!focused) setExpanded(false) }, [focused])
  const disabled = !canWrite || busy
  return <article className={`pa-edit-card review-panel-entry ${focused ? 'focused review-panel-entry-selected' : ''}`} data-edit-id={item.id} data-pos={position} data-top={top} style={style}>
    <header><button className="pa-edit-location" onClick={onLocate}>{item.input.path} · 第 {item.input.startLine} 行</button><span className={`pa-edit-status ${item.state}`}>{editStateNames[item.state]}</span></header>
    {item.input.reason && <p>{item.input.reason}</p>}
    <details open={expanded} onToggle={event => { setExpanded(event.currentTarget.open); onResize?.() }}><summary>查看差异</summary>
      {expanded && <pre className="pa-edit-diff">{wordDiff(item.input.oldText, item.input.newText).map((part, index) => part.added ? <ins key={index}>{part.value}</ins> : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</pre>}
    </details>
    <div className="pa-edit-actions">
      {item.operation ? <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onAct('reconcile')}>核对上次操作</button> : <>
        {item.state === 'pending' && <><button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onAct('reject')}>拒绝</button><button className="btn btn-primary btn-sm" disabled={disabled} onClick={() => onAct('accept')}>接受</button></>}
        {item.state === 'accepted' && <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onAct('undo')}>撤销</button>}
        {item.state === 'undone' && <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onAct('reapply')}>重新应用</button>}
      </>}
    </div>
  </article>
}