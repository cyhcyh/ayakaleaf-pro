import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useTabsContext } from '@/features/ide-react/context/tabs-context'
import { useAreTabsEnabled } from '@/features/ide-react/hooks/use-are-tabs-enabled'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useCodeMirrorStateContext, useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useReviewPanelStyles } from '@/features/review-panel/hooks/use-review-panel-styles'
import { positionItems } from '@/features/review-panel/utils/position-items'
import useEventListener from '@/shared/hooks/use-event-listener'
import { locateAnchoredEdit } from '../../../shared/edit-anchor.mjs'
import { refreshEdits, updateEdits, useEdits } from './edits-store'
import { useEditActions } from './use-edit-actions'
import EditCard from './edits-panel'

export default function AnchoredEdits() {
  const rail = useRailContext()
  const layout = useLayoutContext()
  const open = rail.isOpen && rail.selectedTab === 'ai-modifications' && !layout.focusMode && layout.view === 'editor'
  return open ? <OpenEdits /> : null
}

function OpenEdits() {
  const view = useCodeMirrorViewContext(), cmState = useCodeMirrorStateContext()
  const { projectId } = useProjectContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  const { headerSlot } = useTabsContext()
  const tabsEnabled = useAreTabsEnabled()
  const style = useReviewPanelStyles()
  const state = useEdits(projectId)
  const actions = useEditActions()
  const path = currentDocumentId ? pathInFolder(currentDocumentId) : null
  const [filter, setFilter] = useState('pending')
  const [overview, setOverview] = useState(false)
  const [positions, setPositions] = useState(new Map<string, number>())
  const entries = useRef<HTMLDivElement>(null)
  const pending = state.items.filter(item => item.state === 'pending').length
  const items = state.items.filter(item => filter === 'all' || (filter === 'pending' ? item.state === 'pending' : item.state !== 'pending'))
  const focusedState = state.items.find(item => item.id === state.focusId)?.state
  useEffect(() => { if (state.focusId) setFilter('all') }, [state.focusId, focusedState])
  const located = useMemo(() => {
    const content = cmState.doc.toString()
    return items.filter(item => item.input.path === path).flatMap(item => {
      try { return [{ item, at: locateAnchoredEdit(content, item.state === 'accepted' ? item.input.newText : item.input.oldText,
        item.input.startLine, item.lastAnchor || item.proposalAnchor) }] } catch { return [] }
    }).sort((a, b) => a.at - b.at)
  }, [state.items, filter, path, cmState.doc])
  const reposition = useCallback(() => {
    if (entries.current && currentDocumentId && !overview) positionItems(entries.current, undefined, currentDocumentId)
  }, [currentDocumentId, overview])
  const measure = useCallback(() => {
    if (overview) return
    view.requestMeasure({ key: 'personal-ai-edit-positions', read(editor) {
      const contentTop = editor.contentDOM.getBoundingClientRect().top
      return new Map(located.map(({ item, at }) => [item.id, Math.max(42, (editor.coordsAtPos(at)?.top ?? contentTop + editor.lineBlockAt(at).top) - contentTop)]))
    }, write(next) {
      setPositions(current => next.size === current.size && [...next].every(([id, top]) => current.get(id) === top) ? current : next)
      reposition()
    } })
  }, [view, located, overview, reposition])
  useEffect(measure, [measure, cmState])
  useEventListener('editor:geometry-change', measure)
  useEventListener('editor:viewport-changed', measure)
  useEffect(() => {
    if (!entries.current || overview) return
    const observer = new ResizeObserver(reposition)
    entries.current.querySelectorAll('.pa-edit-card').forEach(item => observer.observe(item))
    reposition()
    return () => observer.disconnect()
  }, [positions, state.focusId, overview, reposition])
  const fail = (error: Error) => updateEdits(projectId, { error: error.message })
  const card = (item: typeof state.items[number], at?: number) => <EditCard key={item.id} item={item} focused={state.focusId === item.id}
    canWrite={actions.canWrite} busy={state.busy.includes(item.id)} onLocate={() => actions.locate(item.id).catch(fail)}
    onAct={action => actions.act(item.id, action).catch(() => {})} onResize={reposition} position={at} top={positions.get(item.id)}
    style={at === undefined ? undefined : { position: 'absolute', visibility: positions.has(item.id) ? 'visible' : 'hidden' }} />
  const header = <div className="review-panel-header"><RailPanelHeader title="AI 修改" actions={<span className="pa-edit-count">{pending} 项待确认</span>} /></div>
  return <>
    {tabsEnabled && headerSlot && createPortal(header, headerSlot)}
    {createPortal(<div className={`pa-edits-anchored ${overview ? 'pa-edits-overview' : ''}`} style={style} role="region" aria-label="AI 修改面板">
      <div className="pa-edits-anchor-inner">
        {(!tabsEnabled || !headerSlot) && header}
        <div className="pa-edits-anchor-toolbar"><div className="pa-edits-filters" role="group" aria-label="筛选 AI 修改">
          {([['all', '全部'], ['pending', '待确认'], ['done', '已处理']] as const).map(([value, name]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{name}</button>)}
        </div></div>
        {state.error && <div className="pa-anchored-error" role="alert">{state.error}<button className="pa-text-action" onClick={() => refreshEdits(projectId).catch(() => {})}>刷新记录</button></div>}
        {overview ? <div className="pa-edits-overview-items">{items.map(item => card(item))}{!items.length && <p className="pa-muted p-3">暂无修改建议。</p>}</div>
          : <div ref={entries} className="pa-edits-anchor-entries">
            {located.map(({ item, at }) => card(item, at))}
            {!located.length && <div className="pa-edits-empty"><p>{state.loading ? '正在读取修改…' : '当前文件没有可定位的修改'}</p><button className="pa-text-action" onClick={() => setOverview(true)}>查看全部文件</button></div>}
          </div>}
        <div className="pa-edits-anchor-footer" role="group" aria-label="修改范围"><button aria-pressed={!overview} onClick={() => setOverview(false)}>当前文件</button><button aria-pressed={overview} onClick={() => setOverview(true)}>全部文件</button></div>
      </div>
    </div>, view.scrollDOM)}
  </>
}
