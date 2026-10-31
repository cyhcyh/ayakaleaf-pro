/**
 * One message of the chat. The user's own text without the editor context
 * that was sent along, the assistant's text, reasoning and tool calls.
 */
import { memo, useEffect, useId, useRef, useState } from 'react'
import { ui } from '@modules/site-settings/frontend/js/ui'
import { copyTextToClipboard } from '@/utils/clipboard'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import type { UIMessage } from 'ai'
import { TOOLS, type Respond } from '../agent/tools'
import Markdown from './markdown'
import Thinking from './thinking'
import ToolCard from './tool-card'
import { boxed, flatGhost, plain, surface } from './themed'
import ImagePreview from './image-preview'
import MessageEditor from './message-editor'
import { messageBody } from '../../../shared/message-content.mjs'
import './message-actions.scss'

export const CONTEXT_OPEN = '<editor-context>'

const toolNameOf = (part: any): string | undefined =>
  part.type === 'dynamic-tool'
    ? part.toolName
    : part.type.startsWith('tool-')
      ? part.type.slice(5)
      : undefined

function UserMessage({ message }: { message: UIMessage }) {
  return (
    <div className="align-self-end rounded-3 px-3 py-2" style={{ ...surface, ...plain, maxWidth: '85%' }}>
      {message.parts.map((part, index) => {
        if (part.type === 'text') {
          const visible = part.text.split(CONTEXT_OPEN)[0]
          const block = visible.match(/<reference-attachments>\s*([\s\S]*?)\s*<\/reference-attachments>/)
          let references: { id: string; name: string }[] = []
          try { references = block ? JSON.parse(block[1]) : [] } catch {}
          return <div key={index}><Markdown text={visible.replace(/<reference-attachments>[\s\S]*?<\/reference-attachments>/, '').trimEnd()} />{references.map(reference => <span className="pa-reference-chip" key={reference.id}>▤ {reference.name}</span>)}</div>
        }
        if (part.type === 'file') {
          const name = part.filename ?? 'Attached image'
          return (
            <ImagePreview src={part.url} name={name} key={index}>
              <img className="rounded me-1" style={{ ...boxed, height: 48 }} src={part.url} alt={name} tabIndex={0} />
            </ImagePreview>
          )
        }
        return null
      })}
    </div>
  )
}

function AssistantMessage({
  message,
  streaming,
  respond,
}: {
  message: UIMessage
  streaming: boolean
  respond: Respond
}) {
  return (
    <div className="d-flex flex-column gap-2">
      {message.parts.map((part: any, index) => {
        if (part.type === 'text') {
          return <Markdown text={part.text} key={index} />
        }
        if (part.type === 'reasoning') {
          const active = streaming && index === message.parts.length - 1
          return <Thinking text={part.text} active={active} key={index} />
        }
        const name = toolNameOf(part)
        if (!name) return null
        const tool = TOOLS[name]
        return (
          <ToolCard
            name={name}
            state={part.state}
            label={tool && part.input ? tool.label(part.input) : name}
            errorText={part.errorText}
            key={part.toolCallId}
          >
            {tool?.body?.(part, respond)}
          </ToolCard>
        )
      })}
    </div>
  )
}

export default memo(function MessageView({
  message,
  streaming,
  respond,
  editText, editBusy = false, editError = '', editingDisabled = false, resendDisabled = false, onEdit, onEditChange, onEditCancel, onResend,
}: {
  message: UIMessage
  streaming: boolean
  respond: Respond
  editText?: string; editBusy?: boolean; editError?: string; editingDisabled?: boolean; resendDisabled?: boolean
  onEdit?: (message: UIMessage) => void; onEditChange?: (text: string) => void; onEditCancel?: () => void; onResend?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const alive = useRef(true)
  const copyId = useId(), editId = useId()
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current) } }, [])
  const copy = async () => {
    const success = await copyTextToClipboard(messageBody(message))
    if (!alive.current) return
    setCopied(success); setFailed(!success)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setCopied(false); setFailed(false) }, 2000)
  }
  if (editText !== undefined) return <MessageEditor message={message} text={editText} busy={editBusy} error={editError} resendDisabled={resendDisabled}
    onChange={onEditChange!} onCancel={onEditCancel!} onResend={onResend!} />
  const user = message.role === 'user'
  const hasText = message.parts.some(part => part.type === 'text' && Boolean(part.text))
  return <>
    {user ? <UserMessage message={message} /> : <AssistantMessage message={message} streaming={streaming} respond={respond} />}
    <div className={`assistant-message-actions${user ? ' is-user' : ''}`}>
      {hasText && <OLTooltip id={copyId} description={failed ? ui('复制失败，请选中文字后复制。') : copied ? ui('已复制') : ui('复制消息')}>
        <OLIconButton icon={copied ? 'check' : 'content_copy'} size="sm" variant="ghost" style={flatGhost}
          accessibilityLabel={ui('复制消息')} onClick={copy} />
      </OLTooltip>}
      {user && onEdit && <OLTooltip id={editId} description={ui('编辑消息')}>
        <OLIconButton icon="edit" size="sm" variant="ghost" style={flatGhost} accessibilityLabel={ui('编辑消息')}
          disabled={editingDisabled} onClick={() => onEdit(message)} />
      </OLTooltip>}
      <span className="visually-hidden" role="status">{failed ? ui('复制失败，请选中文字后复制。') : copied ? ui('已复制') : ''}</span>
    </div>
  </>
})
