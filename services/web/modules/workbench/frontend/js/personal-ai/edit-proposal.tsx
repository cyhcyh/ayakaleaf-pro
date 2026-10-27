import { useContext, useEffect, useState } from 'react'
import type { Respond } from '../agent/tools'
import type { EditPart } from '../chat/edit-proposal'
import { ReviewChatContext } from './review-tools'
import { api } from './api'
import { ensureEdit, putEdit, useEdits, type EditRecord } from './edits-store'
import { useEditActions } from './use-edit-actions'

export const editStateNames = { pending: '待确认', accepted: '已应用', rejected: '已拒绝', undone: '已撤销' }

export default function PersonalEditProposal({ part, respond }: { part: EditPart & { output?: { editId?: string } }; respond: Respond }) {
  const context = useContext(ReviewChatContext)!
  const state = useEdits(context.projectId)
  const [id, setId] = useState(part.output?.editId)
  const [error, setError] = useState('')
  const { locate } = useEditActions()
  const record = state.items.find(item => item.id === id)
  useEffect(() => {
    if (part.state !== 'input-available') return
    let active = true
    const abort = new AbortController()
    api<EditRecord>('/edits', { projectId: context.projectId, chatId: context.chatId, toolCallId: part.toolCallId, input: part.input }, abort.signal).then(result => {
      if (!active) return
      putEdit(context.projectId, result); setId(result.id)
      respond({ tool: 'propose_edit', toolCallId: part.toolCallId, output: { editId: result.id, state: result.state, queued: true, message: '建议已加入 AI 修改，用户接受后才会应用。' } })
    }).catch(error => {
      if (!active) return
      setError(error.message)
      respond({ tool: 'propose_edit', toolCallId: part.toolCallId, state: 'output-error', errorText: error.message })
    })
    return () => { active = false; abort.abort() }
  }, [part.toolCallId, part.state, context.projectId, context.chatId, respond])
  useEffect(() => {
    if (part.output?.editId) setId(part.output.editId)
  }, [part.output?.editId])
  useEffect(() => {
    if (id && !record) ensureEdit(context.projectId, id).catch(error => setError(error.message))
  }, [id, record?.id, context.projectId])
  return <div className="pa-chat-proposal">
    <div><strong>{part.input.path}</strong><span className="pa-edit-status">{record ? editStateNames[record.state] : '正在登记建议…'}</span></div>
    {part.input.reason && <p>{part.input.reason}</p>}
    {error && <p role="alert" className="pa-inline-error">{error}</p>}
    <button className="btn btn-secondary btn-sm" disabled={!id} onClick={() => id && locate(id).catch(error => setError(error.message))}>查看 AI 修改</button>
  </div>
}
