import { expect } from 'chai'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import sinon from 'sinon'
import { ProjectContext } from '@/shared/context/project-context'
import i18nReady from '@/i18n'
import { ui } from '@modules/site-settings/frontend/js/ui'
import Composer from '../../frontend/js/chat/composer'
import MessageQueue from '../../frontend/js/chat/message-queue'
import useMessageQueue from '../../frontend/js/chat/use-message-queue'
import type { Draft, QueuedMessage } from '../../frontend/js/chat/draft'

const context = { path: 'main.tex', selection: [{ fromLine: 1, toLine: 1, content: 'Original selection' }] }
const item = (text = 'Queued instruction'): QueuedMessage => ({ id: '11111111-1111-4111-8111-111111111111', text, files: [], context })
const wrapper = ({ children }: { children: React.ReactNode }) => <ProjectContext.Provider value={{ projectId: '507f1f77bcf86cd799439011' } as any}>{children}</ProjectContext.Provider>

describe('AI message queue', function () {
  before(async function () { await i18nReady })
  afterEach(function () { cleanup(); sinon.restore() })

  it('restores queues paused and keeps each queue independent', function () {
    const first = renderHook(() => useMessageQueue([item()]))
    const second = renderHook(() => useMessageQueue())
    expect(first.result.current.paused).to.equal(true)
    expect(second.result.current.items).to.have.length(0)
    act(() => first.result.current.remove(item().id))
    expect(first.result.current.current.current).to.have.length(0)
  })

  it('edits the original slot while retaining its id, context and attachments', function () {
    const first = item()
    const second = { ...item('Second'), id: '22222222-2222-4222-8222-222222222222' }
    const { result } = renderHook(() => useMessageQueue([first, second]))
    act(() => result.current.edit(first.id))
    expect(result.current.editingRef.current).to.equal(first.id)
    const reference = { id: '33333333-3333-4333-8333-333333333333', name: 'reference.pdf', mediaType: 'application/pdf' }
    act(() => result.current.save(first.id, { text: 'Edited', files: [], references: [reference], context: { path: 'other.tex', selection: [] } }))
    expect(result.current.items.map(value => value.text)).to.deep.equal(['Edited', 'Second'])
    expect(result.current.items[0].context).to.deep.equal(context)
    expect(result.current.items[0].references).to.deep.equal([reference])
    expect(result.current.editing).to.equal(null)
  })

  it('captures a new queue entry without appending editor context to its visible text', function () {
    const { result } = renderHook(() => useMessageQueue())
    act(() => { result.current.enqueue({ text: 'New requirement', files: [] }, context) })
    expect(result.current.items[0].text).to.equal('New requirement')
    expect(result.current.items[0].context.path).to.equal('main.tex')
    expect(result.current.items[0].id).to.match(/^[a-f0-9-]{36}$/)
  })

  it('switches the existing stop icon to the arrow while typing and restores stop after queueing', async function () {
    const send = sinon.stub().resolves()
    const stop = sinon.stub()
    render(<Composer working onSend={send} onStop={stop} onProblem={() => {}} captureContext={() => context} />, { wrapper })
    const input = screen.getByRole('textbox', { name: ui('消息') })
    expect(screen.getByRole('button', { name: 'Stop' })).to.exist
    fireEvent.change(input, { target: { value: 'Steer later' } })
    expect(screen.queryByRole('button', { name: 'Stop' })).to.equal(null)
    expect(screen.getByRole('button', { name: ui('加入队列') }).textContent).to.include('arrow_upward')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: ui('加入队列') })))
    expect(send).to.have.been.calledOnce
    expect(send.firstCall.args[0].context).to.deep.equal(context)
    expect((input as HTMLTextAreaElement).value).to.equal('')
    expect(screen.getByRole('button', { name: 'Stop' })).to.exist
    expect(stop).not.to.have.been.called
  })

  it('allows attachment-only queueing and preserves draft text when submission fails', async function () {
    const reference = { id: '33333333-3333-4333-8333-333333333333', name: 'reference.pdf', mediaType: 'application/pdf' }
    const send = sinon.stub().rejects(new Error('Queue save failed'))
    const problem = sinon.stub()
    render(<Composer working initial={{ text: '', files: [], references: [reference] }} onSend={send} onStop={() => {}} onProblem={problem} />, { wrapper })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: ui('加入队列') })))
    expect(send.firstCall.args[0].references).to.deep.equal([reference])
    expect(screen.getByText('reference.pdf')).to.exist
    expect(problem).to.have.been.calledWith('Queue save failed')
  })

  it('does not submit while an input method is composing or Shift+Enter inserts a new line', async function () {
    const send = sinon.stub().resolves()
    render(<Composer working onSend={send} onStop={() => {}} onProblem={() => {}} />, { wrapper })
    const input = screen.getByRole('textbox', { name: ui('消息') })
    fireEvent.change(input, { target: { value: '中文' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(send).not.to.have.been.called
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
    expect(send).to.have.been.calledOnce
  })

  it('does not submit an attachment after its composer has been closed', async function () {
    const send = sinon.stub().resolves()
    const problem = sinon.stub()
    let reader: FileReader | undefined
    const create = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const revoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    const originalReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:queue-test' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: window.FileReader })
    try {
    sinon.stub(FileReader.prototype, 'readAsDataURL').callsFake(function (this: FileReader) { reader = this })
    const result = render(<Composer working onSend={send} onStop={() => {}} onProblem={problem} />, { wrapper })
    fireEvent.change(result.container.querySelector('input[type=file]')!, { target: { files: [new File(['Test'], 'reference.txt', { type: 'text/plain' })] } })
    fireEvent.click(screen.getByRole('button', { name: ui('加入队列') }))
    problem.resetHistory()
    result.unmount()
    await act(async () => {
      Object.defineProperty(reader!, 'result', { value: 'data:text/plain;base64,VGVzdA==' })
      reader!.onload!.call(reader!, new window.ProgressEvent('load') as ProgressEvent<FileReader>)
    })
    expect(send).not.to.have.been.called
    expect(problem).not.to.have.been.called
    } finally {
      if (create) Object.defineProperty(URL, 'createObjectURL', create)
      else delete (URL as any).createObjectURL
      if (revoke) Object.defineProperty(URL, 'revokeObjectURL', revoke)
      else delete (URL as any).revokeObjectURL
      if (originalReader) Object.defineProperty(globalThis, 'FileReader', originalReader)
      else delete (globalThis as any).FileReader
    }
  })

  it('shows steer, trash and pencil actions and saves edits in place', async function () {
    let saved: Draft | undefined
    const remove = sinon.stub(), steer = sinon.stub()
    function Queue() {
      const state = useMessageQueue([item()])
      return <MessageQueue items={state.items} paused={false} editing={state.editing} disabled={false} canResume
        onResume={() => {}} onSteer={steer} onRemove={remove} onEdit={state.edit}
        onSave={(id, draft) => { saved = draft; state.save(id, draft) }} onProblem={() => {}} />
    }
    render(<Queue />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ui('引导')) }))
    expect(steer).to.have.been.calledWith(item().id)
    fireEvent.click(screen.getByRole('button', { name: ui('编辑消息') }))
    const input = screen.getByRole('textbox', { name: ui('编辑排队消息') })
    fireEvent.change(input, { target: { value: 'Revised request' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: ui('保存') })))
    expect(saved?.text).to.equal('Revised request')
    expect(screen.getByText('Revised request')).to.exist
    fireEvent.click(screen.getByRole('button', { name: ui('取消排队') }))
    expect(remove).to.have.been.calledWith(item().id)
  })
})
