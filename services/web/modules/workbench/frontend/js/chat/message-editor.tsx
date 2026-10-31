import { useEffect, useRef } from 'react'
import type { UIMessage } from 'ai'
import { ui } from '@modules/site-settings/frontend/js/ui'
import useAutosizeComposer, { MIN_COMPOSER_ROWS } from './use-autosize-composer'

export default function MessageEditor({ message, text, busy, error, resendDisabled = false, onChange, onCancel, onResend }: {
  message: UIMessage; text: string; busy: boolean; error: string; resendDisabled?: boolean
  onChange: (text: string) => void; onCancel: () => void; onResend: () => void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  useAutosizeComposer(input, text)
  useEffect(() => { input.current?.focus() }, [])
  const attachments = message.parts.flatMap(part => {
    if (part.type === 'file') return [part.filename || ui('附件')]
    if (part.type !== 'text') return []
    const block = part.text.match(/<reference-attachments>\s*([\s\S]*?)\s*<\/reference-attachments>/)
    try { return block ? JSON.parse(block[1]).map((reference: { name: string }) => reference.name) : [] } catch { return [] }
  })
  return <div className="assistant-message-editor">
    <textarea ref={input} rows={MIN_COMPOSER_ROWS} aria-label={ui('编辑已发送的消息')} value={text} disabled={busy}
      onChange={event => onChange(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing || busy) return
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          if (!resendDisabled && (text.trim() || attachments.length)) onResend()
        }
      }} />
    {attachments.length > 0 && <div className="assistant-message-attachments">{attachments.map((name, index) => <span key={index} title={name}>▤ {name}</span>)}</div>}
    <div className="assistant-message-edit-footer">
      <p className="assistant-message-edit-note">{ui('重新发送将替换这条及之后的对话。')}<br />{ui('项目文件不会回退。')}</p>
      <div className="assistant-message-edit-buttons">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onCancel}>{ui('取消')}</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || resendDisabled || !text.trim() && !attachments.length} onClick={onResend}>{busy ? ui('正在发送…') : ui('重新发送')}</button>
      </div>
    </div>
    {error && <p className="assistant-message-edit-error" role="alert">{error}</p>}
  </div>
}
