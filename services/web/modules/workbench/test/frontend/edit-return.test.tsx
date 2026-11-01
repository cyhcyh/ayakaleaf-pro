import { expect } from 'chai'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import sinon from 'sinon'
import type { UIMessage } from 'ai'
import i18nReady from '@/i18n'
import { ui } from '@modules/site-settings/frontend/js/ui'
import useConversationHistory from '../../frontend/js/chat/use-conversation-history'
import useEditingVisibility from '../../frontend/js/chat/use-editing-visibility'
import EditingReminder from '../../frontend/js/chat/editing-reminder'

const turns = (start: number, count: number): UIMessage[] => Array.from({ length: count }, (_, i) => [
  { id: `u${start + i}`, role: 'user', parts: [{ type: 'text', text: `Question ${start + i}` }] },
  { id: `a${start + i}`, role: 'assistant', parts: [{ type: 'text', text: `Answer ${start + i}` }] },
] as UIMessage[]).flat()
const json = (value: any) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

describe('returning to an unfinished historical edit', function () {
  before(async function () { await i18nReady })
  afterEach(function () { cleanup(); sinon.restore() })

  it('returns to an evicted message in one bounded read without replacing live messages or their absolute position', async function () {
    const all = turns(0, 1000), live = all.slice(-40)
    const position = { current: { messageOffset: 1960, historyVersion: 0 } }, controller = new AbortController()
    const fetch = sinon.stub(globalThis, 'fetch').callsFake(async (url: any) => {
      const end = Number(new URL(String(url), 'http://test').searchParams.get('before'))
      const start = Math.max(0, (Math.ceil(end / 2) - 20) * 2)
      return json({ messages: all.slice(start, end), messageOffset: start, messageEnd: end, olderBefore: start || null, newerAfter: end - 1, historyVersion: 0 })
    })
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    await act(async () => { await result.current.loadOlder() })
    const target = result.current.targetFor('u960')!
    expect(target).to.deep.equal({ id: 'u960', order: 1920, historyVersion: 0 })
    act(() => result.current.reset())
    expect(result.current.messages).to.equal(live)
    await act(async () => { await result.current.locate(target) })
    expect(fetch.callCount).to.equal(2)
    expect(String(fetch.lastCall.args[0])).to.contain('before=1921&historyVersion=0')
    expect(result.current.messages).to.have.length(39)
    expect(result.current.messages.at(-1)?.id).to.equal(target.id)
    expect(result.current.focus?.id).to.equal(target.id)
    const sequence = result.current.focus!.sequence
    await act(async () => { await result.current.locate(target) })
    expect(fetch.callCount).to.equal(2)
    expect(result.current.focus!.sequence).to.be.greaterThan(sequence)
    expect(position.current).to.deep.equal({ messageOffset: 1960, historyVersion: 0 })
    expect(live).to.have.length(40)
    expect(live.at(-1)?.id).to.equal('a999')
  })

  it('can locate the first message at order zero using the existing cursor', async function () {
    const live = turns(980, 20), position = { current: { messageOffset: 1960, historyVersion: 0 } }, controller = new AbortController()
    const fetch = sinon.stub(globalThis, 'fetch').resolves(json({ messages: turns(0, 1).slice(0, 1), messageOffset: 0, olderBefore: null, newerAfter: 0, historyVersion: 0 }))
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    await act(async () => { await result.current.locate({ id: 'u0', order: 0, historyVersion: 0 }) })
    expect(String(fetch.firstCall.args[0])).to.contain('before=1&historyVersion=0')
    expect(result.current.focus?.id).to.equal('u0')
    expect(result.current.hasOlder).to.equal(false)
    expect(result.current.hasNewer).to.equal(true)
  })

  it('captures the clicked page position even if an adjacent page arrives before React updates its handler', async function () {
    const live = turns(980, 20), position = { current: { messageOffset: 1960, historyVersion: 0 } }, controller = new AbortController()
    const fetch = sinon.stub(globalThis, 'fetch')
    fetch.onFirstCall().resolves(json({ messages: turns(960, 20), messageOffset: 1920, olderBefore: 1920, newerAfter: 1959 }))
    fetch.onSecondCall().resolves(json({ messages: turns(940, 20), messageOffset: 1880, olderBefore: 1880, newerAfter: 1919 }))
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    await act(async () => { await result.current.loadOlder() })
    const renderedClickTarget = result.current.targetFor
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.targetFor('u970')).to.equal(null)
    expect(renderedClickTarget('u970')).to.deep.equal({ id: 'u970', order: 1940, historyVersion: 0 })
  })

  it('uses live messages without a request, including unsaved content', async function () {
    const live = turns(980, 20), position = { current: { messageOffset: 1960, historyVersion: 0 } }, controller = new AbortController()
    const fetch = sinon.stub(globalThis, 'fetch').rejects(new Error('No request expected'))
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    const target = result.current.targetFor('u990')!
    await act(async () => { await result.current.locate(target) })
    expect(fetch).not.to.have.been.called
    expect(result.current.messages.find(message => message.id === target.id)).to.equal(live[20])
    expect(result.current.focus?.id).to.equal(target.id)
    expect(position.current.messageOffset).to.equal(1960)
  })

  for (const action of ['reset', 'cancelLocate'] as const) {
    it(`ignores a late locate response after ${action}`, async function () {
      const live = turns(980, 20), position = { current: { messageOffset: 1960, historyVersion: 0 } }, controller = new AbortController()
      let resolve!: (response: Response) => void
      let requestSignal!: AbortSignal
      sinon.stub(globalThis, 'fetch').callsFake((_url: any, options: any) => { requestSignal = options.signal; return new Promise(done => { resolve = done }) })
      const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
      let work!: Promise<void>
      await act(async () => { work = result.current.locate({ id: 'u0', order: 0, historyVersion: 0 }); await Promise.resolve() })
      expect(result.current.locating).to.equal(true)
      act(() => result.current[action]())
      expect(requestSignal.aborted).to.equal(true)
      await act(async () => { resolve(json({ messages: turns(0, 1).slice(0, 1), messageOffset: 0, olderBefore: null })); await work })
      expect(result.current.messages).to.equal(live)
      expect(result.current.focus).to.equal(null)
      expect(result.current.loading).to.equal(null)
    })
  }

  it('rejects a mismatched id or changed history without navigating to a different message', async function () {
    const live = turns(980, 20), position = { current: { messageOffset: 1960, historyVersion: 0 } }, controller = new AbortController()
    const fetch = sinon.stub(globalThis, 'fetch').resolves(json({ messages: turns(1, 1).slice(0, 1), messageOffset: 0, olderBefore: null }))
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    let problem = ''
    await act(async () => { try { await result.current.locate({ id: 'u0', order: 0, historyVersion: 0 }) } catch (e) { problem = (e as Error).message } })
    expect(problem).to.equal(ui('无法定位这条消息，请重新打开会话后重试。'))
    expect(result.current.messages).to.equal(live)
    expect(result.current.focus).to.equal(null)
    position.current.historyVersion = 1
    await act(async () => { try { await result.current.locate({ id: 'u0', order: 0, historyVersion: 0 }) } catch (e) { problem = (e as Error).message } })
    expect(problem).to.equal(ui('会话已在其他页面更新，请重新打开会话后继续'))
    expect(fetch.callCount).to.equal(1)
  })

  it('keeps return errors readable and permits cancellation while a page is loading', function () {
    const back = sinon.stub(), cancel = sinon.stub()
    const view = render(<EditingReminder busy={false} locating error="Network error" onReturn={back} onCancel={cancel} />)
    expect(screen.getByRole('status').textContent).to.equal(ui('正在编辑较早的消息'))
    expect(screen.getByRole('button', { name: ui('返回编辑') }).getAttribute('aria-busy')).to.equal('true')
    expect((screen.getByRole('button', { name: ui('返回编辑') }) as HTMLButtonElement).disabled).to.equal(true)
    expect(screen.getByRole('alert').textContent).to.equal('Network error')
    fireEvent.click(screen.getByRole('button', { name: ui('取消编辑') }))
    expect(cancel).to.have.been.calledOnce
    view.rerender(<EditingReminder busy={false} locating={false} error="" onReturn={back} onCancel={cancel} />)
    fireEvent.click(screen.getByRole('button', { name: ui('返回编辑') }))
    expect(back).to.have.been.calledOnce
  })
})

describe('edit-form visibility without per-token measurements', function () {
  const originalObserver = globalThis.IntersectionObserver, originalCSS = globalThis.CSS
  afterEach(function () { cleanup(); sinon.restore(); globalThis.IntersectionObserver = originalObserver; globalThis.CSS = originalCSS })

  it('observes one editor, reuses the observer on text updates, and reports eviction', function () {
    let notify!: IntersectionObserverCallback
    const disconnect = sinon.stub(), observe = sinon.stub()
    const Observer = sinon.stub().callsFake((callback: IntersectionObserverCallback) => { notify = callback; return { observe, disconnect } })
    globalThis.IntersectionObserver = Observer as any
    globalThis.CSS = { ...originalCSS, escape: (id: string) => id } as any
    const box = document.createElement('div'), row = document.createElement('div'), editor = document.createElement('div')
    row.dataset.messageId = 'u0'; editor.className = 'assistant-message-editor'; row.append(editor); box.append(row)
    const bounds = sinon.stub(box, 'getBoundingClientRect').returns({ top: 100, bottom: 700 } as DOMRect)
    const rect = sinon.stub(editor, 'getBoundingClientRect').returns({ top: 200, bottom: 400 } as DOMRect)
    const onVisible = sinon.stub(), root = { current: box }
    const { rerender, unmount } = renderHook(({ mounted, text }) => {
      useEditingVisibility(root, 'u0', mounted, onVisible)
      return text
    }, { initialProps: { mounted: true, text: 'first token' } })
    expect(onVisible).to.have.been.calledWith(true)
    expect(observe).to.have.been.calledOnceWithExactly(editor)
    rerender({ mounted: true, text: 'later streamed text' })
    expect(Observer).to.have.been.calledOnce
    expect(bounds).to.have.been.calledOnce
    expect(rect).to.have.been.calledOnce
    act(() => notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(onVisible.lastCall.args[0]).to.equal(false)
    rerender({ mounted: false, text: 'later streamed text' })
    expect(disconnect).to.have.been.calledOnce
    expect(onVisible.lastCall.args[0]).to.equal(false)
    unmount()
  })
})
