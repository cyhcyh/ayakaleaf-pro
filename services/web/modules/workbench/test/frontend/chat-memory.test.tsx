import { expect } from 'chai'
import { act, cleanup, renderHook } from '@testing-library/react'
import sinon from 'sinon'
import type { UIMessage } from 'ai'
import i18nReady from '@/i18n'
import { useSessionAutosave, type SavedSession } from '../../frontend/js/personal-ai/session-state'
import useConversationHistory from '../../frontend/js/chat/use-conversation-history'
import useSessionRuntimes from '../../frontend/js/chat/use-session-runtimes'

const history = (start: number, turns: number): UIMessage[] => Array.from({ length: turns }, (_, i) => [
  { id: `u${start + i}`, role: 'user', parts: [{ type: 'text', text: `Question ${start + i}` }] },
  { id: `a${start + i}`, role: 'assistant', parts: [{ type: 'text', text: `Answer ${start + i}` }] },
] as UIMessage[]).flat()
const saved = (messages: UIMessage[], offset = 0): SavedSession => ({ id: 'session', projectId: 'project', title: 'Memory test', revision: 0,
  historyVersion: 0, messages, messageOffset: offset, olderBefore: offset || null, summary: null, binding: null, outbox: [] })
const json = (value: any) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

describe('bounded conversation memory', function () {
  before(async function () { await i18nReady })
  afterEach(function () { cleanup(); sinon.restore() })

  it('releases saved SDK history and rebases later saves/requests without losing the model context boundary', async function () {
    const original = history(0, 1000), initial = saved(original)
    const position = { current: { messageOffset: 0, historyVersion: 0 } }, outbox = { current: [] }
    const requests: any[] = []
    sinon.stub(globalThis, 'fetch').callsFake(async (_path: any, options: any) => { const input = JSON.parse(options.body); requests.push(input); return json({ revision: input.revision + 1 }) })
    const { result, rerender } = renderHook(({ messages }) => useSessionAutosave(initial, 'project', messages, null, false, null, outbox.current, outbox, position), { initialProps: { messages: original } })
    let kept: UIMessage[] = []
    act(() => { kept = result.current.retainTail(original)! })
    expect(kept).to.have.length(40)
    expect(position.current.messageOffset).to.equal(1960)
    const next = history(1000, 1)[0]
    rerender({ messages: [...kept, next] })
    await act(async () => { await result.current.flush() })
    expect(requests.at(-1).messages.map((row: any) => row.order)).to.deep.equal([2000])
    const request = await result.current.prepareRequest({ sessionContext: true }, [...kept, next], () => true)
    expect(request.messageOffset).to.equal(2000)
    expect(request.messages).to.deep.equal([next])
    // An evicted message is no longer held in the autosave snapshot map.
    const evicted = await result.current.prepareRequest({}, [original[0], next], () => true)
    expect(evicted.messages[0]).to.equal(original[0])
  })

  it('never removes unsaved history, and permits trimming after its real save succeeds', async function () {
    const initial = saved([]), messages = history(0, 60)
    const position = { current: { messageOffset: 0, historyVersion: 0 } }, outbox = { current: [] }
    sinon.stub(globalThis, 'fetch').callsFake(async (_path: any, options: any) => json({ revision: JSON.parse(options.body).revision + 1 }))
    const { result } = renderHook(() => useSessionAutosave(initial, 'project', messages, null, false, null, outbox.current, outbox, position))
    expect(result.current.retainTail(messages)).to.equal(null)
    expect(position.current.messageOffset).to.equal(0)
    await act(async () => { await result.current.flush() })
    expect(result.current.retainTail(messages)).to.have.length(40)
    expect(position.current.messageOffset).to.equal(80)
  })

  it('does not rebase while a save is in flight', async function () {
    const messages = history(0, 30), position = { current: { messageOffset: 0, historyVersion: 0 } }, outbox = { current: [] }
    const initial = saved(messages.slice(0, -1))
    let resolve!: (response: Response) => void
    sinon.stub(globalThis, 'fetch').callsFake(() => new Promise(done => { resolve = done }))
    const { result } = renderHook(() => useSessionAutosave(initial, 'project', messages, null, false, null, outbox.current, outbox, position))
    let work!: Promise<void>
    await act(async () => { work = result.current.flush(); await Promise.resolve() })
    expect(result.current.retainTail(messages)).to.equal(null)
    await act(async () => { resolve(json({ revision: 1 })); await work })
    expect(result.current.retainTail(messages)).to.have.length(40)
  })

  it('drops the parent seed after a runtime owns it, without mutating the seed used to initialize the runtime', async function () {
    const seed = saved(history(0, 20))
    seed.outbox = [{ id: 'queued', text: 'Queue', files: [], context: { path: 'main.tex', selection: [] } }]
    const { result } = renderHook(useSessionRuntimes)
    await act(async () => { result.current.activate(seed) })
    await act(async () => { result.current.register(seed.id, { flush: async () => {}, stopAndFlush: async () => {}, rename: async () => {}, suspend: () => {}, state: () => ({ working: true, retain: true }) }) })
    expect(result.current.sessions[0].messages).to.have.length(0)
    expect(result.current.sessions[0].outbox).to.have.length(0)
    expect(seed.messages).to.have.length(40)
    expect(seed.outbox).to.have.length(1)
  })

  it('keeps history bounded across repeated older/newer reads while the live turn changes independently', async function () {
    const all = history(0, 200), live = all.slice(-40)
    const position = { current: { messageOffset: 360, historyVersion: 0 } }, controller = new AbortController()
    const urls: string[] = []
    sinon.stub(globalThis, 'fetch').callsFake(async (url: any) => {
      urls.push(String(url)); const query = new URL(String(url), 'http://test').searchParams
      const before = query.has('before') ? Number(query.get('before')) : all.length
      const start = query.has('after') ? Number(query.get('after')) + 1 : Math.max(0, before - 40)
      const end = query.has('after') ? Math.min(all.length, start + 40) : before
      return json({ messages: all.slice(start, end), messageOffset: start, messageEnd: end, olderBefore: start || null, newerAfter: end < all.length ? end - 1 : null, historyVersion: 0 })
    })
    const { result, rerender } = renderHook(({ messages }) => useConversationHistory('project', 'session', messages, position, controller.signal), { initialProps: { messages: live } })
    for (let i = 0; i < 8; i++) {
      const anchor = result.current.messages[0]
      await act(async () => { await result.current.loadOlder({ id: anchor.id, visibleIds: [anchor.id] }) })
      expect(result.current.messages.length).to.be.at.most(40)
    }
    expect(urls.every(url => url.includes('/messages?') && !url.includes('/stop'))).to.equal(true)
    const historical = result.current.messages[0].id
    const changed = [...live.slice(0, -1), { ...live.at(-1)!, parts: [{ type: 'text' as const, text: 'Still working' }] }]
    rerender({ messages: changed })
    expect(result.current.messages[0].id).to.equal(historical)
    expect(result.current.hasNewer).to.equal(true)
    for (let i = 0; i < 5; i++) {
      const anchor = result.current.messages.at(-1)!
      await act(async () => { await result.current.loadNewer({ id: anchor.id, visibleIds: [anchor.id] }) })
      expect(result.current.messages.length).to.be.at.most(40)
    }
    act(() => result.current.reset())
    expect(result.current.messages).to.equal(changed)
    expect(result.current.browsing).to.equal(false)
    expect(position.current).to.deep.equal({ messageOffset: 360, historyVersion: 0 })
    expect(live.at(-1)!.parts[0]).to.deep.equal({ type: 'text', text: 'Answer 199' })
  })

  it('discards a late page after returning to latest or rewriting history', async function () {
    const live = history(20, 20), position = { current: { messageOffset: 40, historyVersion: 0 } }, controller = new AbortController()
    let resolve!: (response: Response) => void
    sinon.stub(globalThis, 'fetch').callsFake(() => new Promise(done => { resolve = done }))
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    let work!: Promise<void>
    await act(async () => { work = result.current.loadOlder() })
    act(() => result.current.reset())
    await act(async () => { resolve(json({ messages: history(0, 20), messageOffset: 0, olderBefore: null })); await work })
    expect(result.current.messages).to.equal(live)
    await act(async () => { work = result.current.loadOlder() })
    position.current.historyVersion = 1
    await act(async () => { resolve(json({ messages: history(0, 20), messageOffset: 0, olderBefore: null })); await work })
    expect(result.current.messages).to.equal(live)
  })

  it('pins the reading position before any page load and retains the completed result after live eviction', function () {
    const live = history(0, 20), position = { current: { messageOffset: 0, historyVersion: 0 } }, controller = new AbortController()
    const { result, rerender } = renderHook(({ messages }) => useConversationHistory('project', 'session', messages, position, controller.signal), { initialProps: { messages: live } })
    act(() => result.current.observeReading({ id: 'u0', visibleIds: ['u0', 'a0'] }))
    expect(result.current.browsing).to.equal(true)
    const completed = [...live.slice(0, -1), { ...live.at(-1)!, parts: [{ type: 'text' as const, text: 'Completed result' }] }]
    act(() => result.current.syncLive(completed))
    position.current.messageOffset = 40
    rerender({ messages: history(20, 20) })
    expect(result.current.messages[0].id).to.equal('u0')
    expect(result.current.messages.at(-1)!.parts[0]).to.deep.equal({ type: 'text', text: 'Completed result' })
    expect(result.current.hasNewer).to.equal(true)
  })

  it('admits adjacent history even when a tall viewport shows every cached turn', async function () {
    const live = history(20, 20), position = { current: { messageOffset: 40, historyVersion: 0 } }, controller = new AbortController()
    sinon.stub(globalThis, 'fetch').resolves(json({ messages: history(0, 20), messageOffset: 0, olderBefore: null, newerAfter: 39 }))
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    await act(async () => { await result.current.loadOlder({ id: live[0].id, visibleIds: live.map(message => message.id) }) })
    expect(result.current.messages.some(message => message.id === 'u19')).to.equal(true)
    expect(result.current.messages.some(message => message.id === 'a39')).to.equal(true)
    expect(result.current.messages.length).to.equal(42)
  })

  it('pins the latest reading position when an older page arrives after the user scrolls away', async function () {
    const live = history(80, 20), position = { current: { messageOffset: 160, historyVersion: 0 } }, controller = new AbortController()
    let resolve!: (response: Response) => void
    sinon.stub(globalThis, 'fetch').callsFake(() => new Promise(done => { resolve = done }))
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    let visible = { id: 'u80', visibleIds: ['u80', 'a80'] }
    let work!: Promise<void>
    await act(async () => { work = result.current.loadOlder(() => visible) })
    expect(result.current.loading).to.equal('older')
    // The user crosses most of the cached page while the request is pending.
    visible = { id: 'u99', visibleIds: ['u99', 'a99'] }
    await act(async () => { resolve(json({ messages: history(60, 20), messageOffset: 120, olderBefore: 120, newerAfter: 159 })); await work })
    expect(result.current.messages.some(message => message.id === 'u99')).to.equal(true)
    expect(result.current.messages.at(-1)?.id).to.equal('a99')
    expect(result.current.messages.length).to.be.at.most(40)
    expect(result.current.loading).to.equal(null)
    expect(position.current.messageOffset).to.equal(160)
  })

  it('pins the latest reading position when a newer page arrives after a reverse scroll', async function () {
    const live = history(80, 20), position = { current: { messageOffset: 160, historyVersion: 0 } }, controller = new AbortController()
    const fetch = sinon.stub(globalThis, 'fetch')
    fetch.onFirstCall().resolves(json({ messages: history(60, 20), messageOffset: 120, olderBefore: 120, newerAfter: 159 }))
    fetch.onSecondCall().resolves(json({ messages: history(40, 20), messageOffset: 80, olderBefore: 80, newerAfter: 119 }))
    let resolve!: (response: Response) => void
    fetch.onThirdCall().callsFake(() => new Promise(done => { resolve = done }))
    const { result } = renderHook(() => useConversationHistory('project', 'session', live, position, controller.signal))
    await act(async () => { await result.current.loadOlder(); await result.current.loadOlder() })
    let visible = { id: 'a59', visibleIds: ['a59'] }
    let work!: Promise<void>
    await act(async () => { work = result.current.loadNewer(() => visible) })
    visible = { id: 'a40', visibleIds: ['a40'] }
    await act(async () => { resolve(json({ messages: history(60, 20), messageOffset: 120, olderBefore: 120, newerAfter: 159 })); await work })
    expect(result.current.messages.some(message => message.id === 'a40')).to.equal(true)
    expect(result.current.messages[0].id).to.equal('u40')
    expect(result.current.messages.length).to.be.at.most(40)
  })

  it('does not rerender an old history window for unrelated streamed tokens', async function () {
    const live = history(80, 20), position = { current: { messageOffset: 160, historyVersion: 0 } }, controller = new AbortController()
    sinon.stub(globalThis, 'fetch').resolves(json({ messages: history(60, 20), messageOffset: 120, olderBefore: 120, newerAfter: 159 }))
    const { result, rerender } = renderHook(({ messages }) => useConversationHistory('project', 'session', messages, position, controller.signal), { initialProps: { messages: live } })
    await act(async () => { await result.current.loadOlder() })
    const page = result.current.messages
    rerender({ messages: [...live.slice(0, -1), { ...live.at(-1)!, parts: [{ type: 'text', text: 'Streaming continues in the background' }] }] })
    expect(result.current.messages).to.equal(page)
  })

})
