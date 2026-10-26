import { useEffect, useRef } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useEdits } from './edits-store'
import { useEditActions } from './use-edit-actions'
import { pendingEditsField, setPendingEdits } from './edit-decorations'
import './style.scss'

export default function EditDecorationSync() {
  const { projectId } = useProjectContext()
  const { view } = useEditorViewContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  const state = useEdits(projectId)
  const actions = useEditActions()
  const live = useRef(actions)
  live.current = actions
  const path = currentDocumentId ? pathInFolder(currentDocumentId) : null
  useEffect(() => {
    if (!view || !view.state.field(pendingEditsField, false)) return
    view.dispatch({ effects: setPendingEdits.of(state.items.filter(item => item.state === 'pending' && item.input.path === path)) })
  }, [view, path, state.items])
  useEffect(() => {
    const act = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail?.id) return
      if (detail.action === 'locate') live.current.locate(detail.id).catch(() => {})
      else if (['accept', 'reject'].includes(detail.action)) live.current.act(detail.id, detail.action).catch(() => {})
    }
    window.addEventListener('personal-ai:edit-action', act)
    return () => window.removeEventListener('personal-ai:edit-action', act)
  }, [])
  return null
}
