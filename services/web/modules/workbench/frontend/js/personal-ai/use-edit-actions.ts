import { ui } from '@modules/site-settings/frontend/js/ui'
import { useRef } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { locateAnchoredEdit, makeAnchor, anchorMatches } from '../../../shared/edit-anchor.mjs'
import { wordDiff } from '../agent/apply-edit'
import { api } from './api'
import { editSnapshot, ensureEdit, focusEdit, putEdit, updateEdits, type EditRecord } from './edits-store'

export function useEditActions() {
  const { projectId } = useProjectContext()
  const { findEntityByPath } = useFileTreePathContext()
  const { openDoc, openDocs } = useEditorManagerContext()
  const { currentDocument } = useEditorOpenDocContext()
  const { view } = useEditorViewContext()
  const permissions = usePermissionsContext()
  const { openTab } = useRailContext()
  const live = useRef({ currentDocument, view })
  live.current = { currentDocument, view }
  const open = async (record: EditRecord) => {
    const found = findEntityByPath(record.input.path)
    if (!found || found.type !== 'doc') throw new Error(ui("原项目文件不存在，请检查文件路径"))
    await openDoc(found.entity as any)
    const until = Date.now() + 5000
    while (Date.now() < until) {
      const state = live.current
      if (state.view && state.currentDocument?.doc_id === found.entity._id && state.currentDocument.cm6?.view === state.view) return state.view
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    throw new Error(ui("编辑器尚未加载该文件，请稍后重试"))
  }
  const locate = async (id: string) => {
    const record = await ensureEdit(projectId, id)
    focusEdit(projectId, id)
    openTab('ai-modifications')
    const editor = await open(record)
    const before = ['accepted'].includes(record.state) ? record.input.newText : record.input.oldText
    const at = locateAnchoredEdit(editor.state.doc.toString(), before, record.input.startLine, record.lastAnchor || record.proposalAnchor)
    editor.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: 'center' }) })
    editor.focus()
  }
  const act = async (id: string, action: 'accept' | 'reject' | 'undo' | 'reapply' | 'reconcile') => {
    if (!permissions.write) throw new Error(ui("当前项目权限不允许修改正文"))
    if (editSnapshot(projectId).busy.includes(id)) return
    updateEdits(projectId, { busy: [...editSnapshot(projectId).busy, id], error: '' })
    let operation: EditRecord['operation'] = null
    try {
      const record = await ensureEdit(projectId, id)
      if (action === 'reconcile') {
        if (!record.operation) return
        const result = await api<EditRecord>(`/edits/${id}/reconcile`, { projectId, operationId: record.operation.id })
        putEdit(projectId, result)
        return
      }
      if (action === 'reject') {
        putEdit(projectId, await api<EditRecord>(`/edits/${id}/begin`, { projectId, revision: record.revision, action }))
        return
      }
      const editor = await open(record)
      await openDocs.awaitBufferedOps(AbortSignal.timeout(10000))
      const before = action === 'undo' ? record.input.newText : record.input.oldText
      const after = action === 'undo' ? record.input.oldText : record.input.newText
      const content = editor.state.doc.toString()
      const position = locateAnchoredEdit(content, before, record.input.startLine, record.lastAnchor || record.proposalAnchor)
      const anchor = makeAnchor(content, position, before, after)
      const prepared = await api<EditRecord>(`/edits/${id}/begin`, { projectId, revision: record.revision, action, anchor })
      operation = prepared.operation
      putEdit(projectId, prepared)
      const now = editor.state.doc.toString()
      if (!anchorMatches(now, anchor, 'before')) throw new Error(ui("等待确认期间该处正文发生变化，已停止修改，请重新核对"))
      const at = now.indexOf(anchor.prefix + before + anchor.suffix) + anchor.prefix.length
      const changes = []
      let cursor = at
      for (const part of wordDiff(before, after)) {
        if (part.added) changes.push({ from: cursor, insert: part.value })
        else { if (part.removed) changes.push({ from: cursor, to: cursor + part.value.length }); cursor += part.value.length }
      }
      editor.dispatch({ changes, annotations: isolateHistory.of('full'), userEvent: 'input', effects: EditorView.scrollIntoView(at, { y: 'center' }) })
      await openDocs.awaitBufferedOps(AbortSignal.timeout(10000))
      putEdit(projectId, await api<EditRecord>(`/edits/${id}/reconcile`, { projectId, operationId: operation!.id }))
      focusEdit(projectId, id)
      openTab('ai-modifications')
    } catch (error) {
      if (operation) {
        try { putEdit(projectId, await api<EditRecord>(`/edits/${id}/reconcile`, { projectId, operationId: operation.id })) } catch { /* The explicit reconcile action remains available. */ }
      }
      updateEdits(projectId, { error: (error as Error).message })
      throw error
    } finally { updateEdits(projectId, { busy: editSnapshot(projectId).busy.filter(item => item !== id) }) }
  }
  return { locate, act, canWrite: permissions.write }
}
