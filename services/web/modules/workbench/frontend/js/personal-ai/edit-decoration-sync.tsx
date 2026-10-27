import { useEffect, useRef } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useEdits } from './edits-store'
import { useEditActions } from './use-edit-actions'
import { pendingEditsField, setPendingEdits, setFocusedEdit } from './edit-decorations'
import AnchoredEdits from './anchored-edits'
import { focusEdit } from './edits-store'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import './style.scss'

export default function EditDecorationSync() {
  const { projectId } = useProjectContext()
  const { openTab } = useRailContext()
  const { view } = useEditorViewContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { showVisual } = useEditorPropertiesContext()
  const { pathInFolder } = useFileTreePathContext()
  const state = useEdits(projectId)
  const actions = useEditActions()
  const live = useRef(actions)
  live.current = actions
  const path = currentDocumentId ? pathInFolder(currentDocumentId) : null
  useEffect(() => {
    if (!view) return
    // The native mode-switch effect reconfigures source-only extensions first.
    const frame = requestAnimationFrame(() => {
      if (view.state.field(pendingEditsField, false))
        view.dispatch({ effects: [setPendingEdits.of(state.items.filter(item => item.state === 'pending' && item.input.path === path)), setFocusedEdit.of(state.focusId)] })
    })
    return () => cancelAnimationFrame(frame)
  }, [view, path, state.items, state.focusId, showVisual])
  useEffect(() => {
    const act = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail?.id) return
      if (detail.action === 'focus') { focusEdit(projectId, detail.id); openTab('ai-modifications'); return }
      if (detail.action === 'locate') live.current.locate(detail.id).catch(() => {})
      else if (['accept', 'reject'].includes(detail.action)) live.current.act(detail.id, detail.action).catch(() => {})
    }
    window.addEventListener('personal-ai:edit-action', act)
    return () => window.removeEventListener('personal-ai:edit-action', act)
  }, [projectId, openTab])
  return <AnchoredEdits />
}
