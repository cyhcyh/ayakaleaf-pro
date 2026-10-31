import { expect } from 'chai'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import sinon from 'sinon'
import type { UIMessage } from 'ai'
import i18nReady from '@/i18n'
import { ui } from '@modules/site-settings/frontend/js/ui'
import MessageEditor from '../../frontend/js/chat/message-editor'
import { useSessionAutosave, type SavedSession } from '../../frontend/js/personal-ai/session-state'

const original: UIMessage = { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Original\n\n<reference-attachments>\n[{"id":"ref","name":"reference.pdf"}]\n</reference-attachments>\n\n<editor-context>\nOpen file: old.tex\nSecret selection\n</editor-context>' }] }
const saved: SavedSession = { id: 'session', projectId: 'project', title: 'Original', revision: 7, messages: [original], summary: null, binding: null, messageOffset: 40, olderBefore: 40 }

describe('sent message editing', function () {
  before(async function () { await i18nReady })
  afterEach(function () { cleanup(); sinon.restore() })

  it('shows only the edited text, retains reference names, and exposes clear cancel/resend actions', function () {
    const change = sinon.stub(), cancel = sinon.stub(), resend = sinon.stub()
    render(<MessageEditor message={original} text="Edited text" busy={false} error="" onChange={change} onCancel={cancel} onResend={resend} />)
    const input = screen.getByRole('textbox', { name: ui('编辑已发送的消息') }) as HTMLTextAreaElement
    expect(input.value).to.equal('Edited text')
    expect(input.rows).to.equal(3)
    expect(screen.getByText('▤ reference.pdf')).to.exist
    expect(screen.queryByText('Secret selection')).to.equal(null)
    expect(screen.getByText(text => text.includes(ui('项目文件不会回退。')))).to.exist
    fireEvent.change(input, { target: { value: 'Changed again' } })
    expect(change).to.have.been.calledWith('Changed again')
    fireEvent.click(screen.getByRole('button', { name: ui('取消') }))
    expect(cancel).to.have.been.calledOnce
    expect(resend).not.to.have.been.called
    fireEvent.click(screen.getByRole('button', { name: ui('重新发送') }))
    expect(resend).to.have.been.calledOnce
  })

  it('keeps Enter available for multiline editing and ignores composing shortcuts', function () {
    const resend = sinon.stub(), cancel = sinon.stub()
    render(<MessageEditor message={original} text="中文" busy={false} error="" onChange={() => {}} onCancel={cancel} onResend={resend} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(resend).not.to.have.been.called
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(resend).to.have.been.calledOnce
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(cancel).to.have.been.calledOnce
  })

  it('retains the draft on an error and prevents duplicate submissions while saving', function () {
    const resend = sinon.stub()
    render(<MessageEditor message={original} text="Keep my draft" busy error="Save failed" onChange={() => {}} onCancel={() => {}} onResend={resend} />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).to.equal('Keep my draft')
    expect(screen.getByRole('alert').textContent).to.equal('Save failed')
    expect((screen.getByRole('button', { name: ui('正在发送…') }) as HTMLButtonElement).disabled).to.equal(true)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    expect(resend).not.to.have.been.called
  })

  it('allows cancelling when sending is unavailable and prevents empty keyboard submissions', function () {
    const resend = sinon.stub(), cancel = sinon.stub()
    const props = { message: original, text: 'Draft', busy: false, error: '', onChange: () => {}, onCancel: cancel, onResend: resend }
    const view = render(<MessageEditor {...props} resendDisabled />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    expect(resend).not.to.have.been.called
    fireEvent.click(screen.getByRole('button', { name: ui('取消') }))
    expect(cancel).to.have.been.calledOnce
    view.rerender(<MessageEditor {...props} message={{ id: 'empty', role: 'user', parts: [] }} text="" />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    expect(resend).not.to.have.been.called
  })

  it('serializes rewrites after saves and rebases message offsets, history version and future writes', async function () {
    const calls: { path: string; body: any }[] = []
    const edited = { ...original, parts: [{ type: 'text', text: 'Revised' }] } as UIMessage
    const position = { current: { messageOffset: 40, historyVersion: 0 } }, outbox = { current: [] }
    sinon.stub(globalThis, 'fetch').callsFake(async (path: any, options: any) => {
      const body = JSON.parse(options.body); calls.push({ path: String(path), body })
      return new Response(JSON.stringify(String(path).endsWith('edit-message')
        ? { ...saved, revision: 9, historyVersion: 1, messages: [edited], messageOffset: 0, olderBefore: null }
        : { revision: body.revision + 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const { result, rerender } = renderHook(({ messages }) => useSessionAutosave(saved, 'project', messages, null, false, null, [], outbox, position),
      { initialProps: { messages: [original] } })
    await act(async () => { await result.current.flush(); await result.current.editMessage(original.id, 'Revised') })
    expect(position.current).to.deep.equal({ messageOffset: 0, historyVersion: 1 })
    expect(calls.at(-1)?.body.messageId).to.equal(original.id)
    const answer = { id: 'new-answer', role: 'assistant', parts: [{ type: 'text', text: 'New answer' }] } as UIMessage
    rerender({ messages: [edited, answer] })
    await act(async () => { await result.current.flush() })
    const last = calls.at(-1)!.body
    expect(last.historyVersion).to.equal(1)
    expect(last.revision).to.equal(9)
    expect(last.messages.map((row: any) => row.order)).to.deep.equal([0, 1])
    expect(last.messages[0].message.parts[0].text).to.equal('Revised')
  })
})
