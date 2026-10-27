import { ui } from '@modules/site-settings/frontend/js/ui'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { highlightRanges, clearHighlightRanges } from '@/features/source-editor/extensions/ranges'
import type { AnyOperation } from '../../../../../types/change'
import useEventListener from '@/shared/hooks/use-event-listener'
import { locateAnchoredEdit } from '../../../shared/edit-anchor.mjs'
import { layoutEditCards, revealEditDelta } from '../../../shared/edit-panel-layout.mjs'
import { focusEdit, refreshEdits, updateEdits, useEdits } from './edits-store'
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
  const [filter, setFilter] = useState(() => state.items.some(item => item.id === state.focusId && item.state !== 'pending') ? 'done' : 'pending')
  const [overview, setOverview] = useState(false)
  const entries = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const revealId = useRef<string | null>(null)
  const hovered = useRef<AnyOperation | null>(null)
  const pending = state.items.filter(item => item.state === 'pending').length
  const items = state.items.filter(item => filter === 'all' || (filter === 'pending' ? item.state === 'pending' : item.state !== 'pending'))
  const previousFocus = useRef(state.focusId)
  useEffect(() => {
    if (previousFocus.current === state.focusId) return
    previousFocus.current = state.focusId
    const item = state.items.find(item => item.id === state.focusId)
    // Explicit navigation from chat or source may target a different status.
    // Applying an action to the same card never changes the selected filter.
    if (item && filter !== 'all' && ((filter === 'pending') !== (item.state === 'pending'))) setFilter(item.state === 'pending' ? 'pending' : 'done')
  }, [state.focusId, state.items, filter])
  const located = useMemo(() => {
    const content = cmState.doc.toString()
    return items.filter(item => item.input.path === path).flatMap(item => {
      try { return [{ item, at: locateAnchoredEdit(content, item.state === 'accepted' ? item.input.newText : item.input.oldText,
        item.input.startLine, item.lastAnchor || item.proposalAnchor) }] } catch { return [] }
    }).sort((a, b) => a.at - b.at)
  }, [state.items, filter, path, cmState.doc])
  const reposition = useCallback(() => {
    if (!entries.current || !inner.current || overview) return
    view.requestMeasure({ key: 'personal-ai-edit-positions', read(editor) {
      if (!entries.current || !inner.current || editor.state.doc !== cmState.doc) return null
      const origin = entries.current.getBoundingClientRect().top
      const viewport = editor.scrollDOM.getBoundingClientRect()
      const header = (inner.current.querySelector('.review-panel-header') as HTMLElement | null)?.offsetHeight || 0
      const toolbar = (inner.current.querySelector('.pa-edits-anchor-toolbar') as HTMLElement).offsetHeight
      const footer = (inner.current.querySelector('.pa-edits-anchor-footer') as HTMLElement).offsetHeight
      const elements = new Map([...entries.current.querySelectorAll<HTMLElement>('.pa-edit-card')].map(element => [element.dataset.editId!, element]))
      const contentTop = editor.contentDOM.getBoundingClientRect().top
      const cards = located.flatMap(({ item, at }) => {
        const element = elements.get(item.id)
        return element ? [{ id: item.id, height: element.offsetHeight, top: (editor.coordsAtPos(at)?.top ?? contentTop + editor.lineBlockAt(at).top) - origin }] : []
      })
      const layout = layoutEditCards(cards, state.focusId, header + toolbar + 6)
      const selected = cards.find(card => card.id === revealId.current)
      return { elements, layout, height: Math.max(editor.contentDOM.clientHeight, layout.bottom + footer + 8),
        delta: selected ? revealEditDelta(origin + layout.positions.get(selected.id)!, selected.height, viewport.top + header + toolbar + 6, viewport.bottom - footer - 6) : 0 }
    }, write(next) {
      if (!next || !inner.current) return
      for (const [id, top] of next.layout.positions) {
        const element = next.elements.get(id)!
        element.style.top = `${top}px`
        element.style.visibility = 'visible'
      }
      inner.current.style.minHeight = `${next.height}px`
      if (revealId.current) {
        revealId.current = null
        if (next.delta) view.scrollDOM.scrollTop += next.delta
      }
    } })
  }, [view, located, overview, state.focusId, cmState.doc])
  const layoutRef = useRef(reposition)
  layoutRef.current = reposition
  useLayoutEffect(() => { if (overview) inner.current?.style.removeProperty('min-height') }, [overview])
  useEffect(reposition, [reposition, cmState])
  useEventListener('editor:geometry-change', reposition)
  useEventListener('editor:viewport-changed', reposition)
  useEffect(() => {
    if (!entries.current || overview) return
    const observer = new ResizeObserver(reposition)
    entries.current.querySelectorAll('.pa-edit-card').forEach(item => observer.observe(item))
    observer.observe(view.contentDOM)
    observer.observe(view.scrollDOM)
    view.scrollDOM.addEventListener('scroll', reposition, { passive: true })
    reposition()
    return () => { observer.disconnect(); view.scrollDOM.removeEventListener('scroll', reposition) }
  }, [overview, reposition, view])
  useEffect(() => {
    revealId.current = state.focusId
    layoutRef.current()
  }, [state.focusId])
  const clearHover = useCallback(() => {
    if (hovered.current) { view.dispatch(clearHighlightRanges(hovered.current)); hovered.current = null }
  }, [view])
  useEffect(() => clearHover, [clearHover, currentDocumentId])
  const hover = (item: typeof state.items[number]) => {
    clearHover()
    if (item.input.path !== path) return
    try {
      const text = item.state === 'accepted' ? item.input.newText : item.input.oldText
      const at = locateAnchoredEdit(cmState.doc.toString(), text, item.input.startLine, item.lastAnchor || item.proposalAnchor)
      const op = { p: at, i: text || cmState.doc.sliceString(at, Math.min(at + 1, cmState.doc.length)) }
      hovered.current = op
      view.dispatch(highlightRanges(op))
    } catch { /* A conflicting suggestion cannot highlight unrelated text. */ }
  }
  const fail = (error: Error) => updateEdits(projectId, { error: error.message })
  const card = (item: typeof state.items[number], at?: number) => {
    const position = at ?? located.find(entry => entry.item.id === item.id)?.at
    return <EditCard key={item.id} item={item} focused={state.focusId === item.id}
    line={position === undefined ? undefined : cmState.doc.lineAt(position).number}
    canWrite={actions.canWrite} busy={state.busy.includes(item.id)} onLocate={() => {
      actions.locate(item.id).then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        revealId.current = item.id
        layoutRef.current()
      }))).catch(fail)
    }} onHover={() => hover(item)} onLeave={clearHover}
    onAct={action => { clearHover(); focusEdit(projectId, item.id); actions.act(item.id, action).then(() => { revealId.current = item.id; layoutRef.current() }).catch(() => {}) }}
    onResize={() => { revealId.current = item.id; reposition() }} position={at}
    style={at === undefined ? undefined : { position: 'absolute', visibility: 'hidden' }} />
  }
  const header = <div className="review-panel-header"><RailPanelHeader title={ui("AI 修改")} actions={<span className="pa-edit-count">{pending}{ui(" 项待确认")}</span>} /></div>
  return <>
    {tabsEnabled && headerSlot && createPortal(header, headerSlot)}
    {createPortal(<div className={`pa-edits-anchored ${overview ? 'pa-edits-overview' : ''}`} style={style} role="region" aria-label={ui("AI 修改面板")}>
      <div ref={inner} className="pa-edits-anchor-inner">
        {(!tabsEnabled || !headerSlot) && header}
        <div className="pa-edits-anchor-toolbar"><div className="pa-edits-filters" role="group" aria-label={ui("筛选 AI 修改")}>
          {([['all', ui("全部")], ['pending', ui("待确认")], ['done', ui("已处理")]] as const).map(([value, name]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{name}</button>)}
        </div></div>
        {(state.error || (!overview && !located.length)) && <div className="pa-edits-anchor-status">
          {state.error && <div className="pa-anchored-error" role="alert">{state.error}<button className="pa-text-action" onClick={() => refreshEdits(projectId).catch(() => {})}>{ui("刷新记录")}</button></div>}
          {!overview && !located.length && <div className="pa-edits-empty"><p>{state.loading ? ui("正在读取修改…") : ui("当前文件没有可定位的修改")}</p><button className="pa-text-action" onClick={() => setOverview(true)}>{ui("查看全部文件")}</button></div>}
        </div>}
        {overview ? <div className="pa-edits-overview-items">{items.map(item => card(item))}{!items.length && <p className="pa-muted p-3">{ui("暂无修改建议。")}</p>}</div>
          : <div ref={entries} className="pa-edits-anchor-entries">
            {located.map(({ item, at }) => card(item, at))}
          </div>}
        <div className="pa-edits-anchor-footer" role="group" aria-label={ui("修改范围")}><button aria-pressed={!overview} onClick={() => setOverview(false)}>{ui("当前文件")}</button><button aria-pressed={overview} onClick={() => setOverview(true)}>{ui("全部文件")}</button></div>
      </div>
    </div>, view.scrollDOM)}
  </>
}
