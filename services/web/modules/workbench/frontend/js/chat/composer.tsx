/**
 * Where the user writes: a growing text box, images by picker, paste or drop,
 * a note of the selected lines that go along, and send or stop.
 */
import { forwardRef, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileUIPart } from 'ai'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import { boxed, flatGhost, plain, surface } from './themed'
import ImagePreview from './image-preview'
import { useProjectContext } from '@/shared/context/project-context'
import { api } from '../personal-ai/api'

const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 8

export type Draft = { text: string; files: FileUIPart[] }

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const Composer = forwardRef<
  HTMLTextAreaElement,
  {
    working: boolean
    selectionNote?: string
    onSend: (draft: Draft) => void | Promise<void>
    onStop: () => void
    onProblem: (message: string | false) => void
    modelPicker?: ReactNode
    disabled?: boolean
  }
>(function Composer({ working, selectionNote, onSend, onStop, onProblem, modelPicker, disabled = false }, ref) {
  const { t } = useTranslation()
  const { projectId } = useProjectContext()
  const [uploading, setUploading] = useState(false)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [images, setImages] = useState<File[]>([])
  const picker = useRef<HTMLInputElement>(null)
  // Object URLs for the previews, released when the images change or go
  const previews = useMemo(() => images.map(file => URL.createObjectURL(file)), [images])
  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews])

  const attach = (files: File[]) => {
    if (disabled) return
    onProblem(false)
    if (files.some(file => !file.type.startsWith('image/') && !['application/pdf', 'text/plain', 'text/markdown'].includes(file.type) && !/\.(txt|md)$/i.test(file.name))) {
      onProblem('支持图片、PDF、TXT 和 Markdown 参考资料。')
    } else if (files.some(file => file.size > (file.type.startsWith('image/') ? MAX_IMAGE_BYTES : 8 * 1024 * 1024))) {
      onProblem('图片需小于 2 MB，参考资料需小于 8 MB。')
    } else if (images.length + files.length > 10) {
      onProblem('每条消息最多附加 10 个文件。')
    } else if ([...images, ...files].filter(file => file.type.startsWith('image/')).reduce((size, file) => size + file.size, 0) > 6 * 1024 * 1024) {
      onProblem('单条消息中的图片总大小需小于 6 MB，较大参考资料请用 PDF 上传。')
    } else {
      setImages(current => [...current, ...files])
    }
  }

  const send = async () => {
    if (disabled || working || uploading || !text.trim()) return
    setUploading(true)
    try {
    const references = []
    const files = []
    for (const file of images) {
      const dataURL = await readAsDataUrl(file)
      if (file.type.startsWith('image/')) files.push({
        type: 'file' as const,
        mediaType: file.type,
        filename: file.name,
        url: dataURL,
      })
      else references.push(await api('/references', {
        projectId, name: file.name, mediaType: file.type === 'application/pdf' ? 'application/pdf' : /\.md$/i.test(file.name) ? 'text/markdown' : 'text/plain',
        data: dataURL.slice(dataURL.indexOf(',') + 1),
      }))
    }
    const referenceBlock = references.length ? `\n\n<reference-attachments>\n${JSON.stringify(references)}\n</reference-attachments>` : ''
    await onSend({ text: text + referenceBlock, files })
    setText('')
    setImages([])
    } catch (error) { onProblem((error as Error).message) }
    finally { setUploading(false) }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while an input method is composing picks a candidate
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const onPaste = (event: ClipboardEvent) => {
    const pasted = Array.from(event.clipboardData.files)
    if (pasted.length) {
      event.preventDefault()
      attach(pasted)
    }
  }

  const onDrop = (event: DragEvent) => {
    if (event.dataTransfer.files.length) {
      event.preventDefault()
      attach(Array.from(event.dataTransfer.files))
    }
  }

  const rows = Math.min(MAX_ROWS, Math.max(2, text.split('\n').length))

  return (
    <div
      className="rounded m-2 p-2 d-flex flex-column gap-2"
      // Writing in the box rings it, like a focused form field
      style={
        focused
          ? { border: '1px solid var(--border-active-themed)', boxShadow: 'var(--blue-30) 0 0 0 2px' }
          : boxed
      }
      onDragOver={event => event.dataTransfer.types.includes('Files') && event.preventDefault()}
      onDrop={onDrop}
    >
      {(selectionNote || images.length > 0) && (
        <div className="d-flex flex-wrap gap-1 small">
          {selectionNote && (
            <span className="badge d-inline-flex align-items-center gap-1" style={{ ...surface, ...plain }}>
              <MaterialIcon type="code" /> {selectionNote}
            </span>
          )}
          {images.map((image, index) => (
            <span className="badge d-inline-flex align-items-center gap-1" style={{ ...surface, ...plain }} key={index}>
              {image.type.startsWith('image/') ? <ImagePreview src={previews[index]} name={image.name}>
                <span className="d-inline-flex align-items-center gap-1" tabIndex={0}>
                  <MaterialIcon type="image" /> {image.name}
                </span>
              </ImagePreview> : <span className="d-inline-flex align-items-center gap-1"><MaterialIcon type="description" />{image.name}</span>}
              <button
                type="button"
                className="btn btn-link p-0 text-reset d-inline-flex"
                aria-label={`Remove ${image.name}`}
                onClick={() => setImages(images.filter((_, other) => other !== index))}
              >
                <MaterialIcon type="close" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        disabled={disabled}
        ref={ref}
        className="form-control border-0 shadow-none p-1"
        style={{ ...plain, resize: 'none', fontSize: 'var(--font-size-02)', background: 'transparent' }}
        rows={rows}
        placeholder={t('what_would_you_like_to_do')}
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div className="d-flex align-items-center">
        <input
          ref={picker}
          type="file"
          accept="image/*,application/pdf,text/plain,text/markdown,.txt,.md"
          multiple
          hidden
          disabled={disabled}
          aria-label="附加图片或参考资料"
          onChange={event => {
            attach(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <OLTooltip id="assistant-attach" description={t('attach_image_or_pdf')}>
          <OLIconButton
            icon="add_photo_alternate"
            variant="ghost"
            style={{ ...flatGhost, ...plain }}
            accessibilityLabel={t('attach_image_or_pdf')}
            disabled={disabled}
            onClick={() => picker.current?.click()}
          />
        </OLTooltip>
        <span className="flex-grow-1" />
        {modelPicker}
        {working ? (
          <OLIconButton icon="stop_circle" variant="ghost" style={{ ...flatGhost, ...plain }} accessibilityLabel={t('stop')} onClick={onStop} />
        ) : (
          <OLIconButton
            icon="arrow_upward"
            variant="ghost"
            style={{ ...flatGhost, ...plain }}
            accessibilityLabel={t('send')}
            disabled={disabled || !text.trim() || uploading}
            onClick={send}
          />
        )}
        {uploading && <span role="status" className="small ms-2">正在上传参考资料…</span>}
      </div>
    </div>
  )
})

export default Composer
