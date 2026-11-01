import { expect } from 'chai'
import { act, cleanup, renderHook } from '@testing-library/react'
import sinon from 'sinon'
import type { UIMessage } from 'ai'
import i18nReady from '@/i18n'
import { useSessionAutosave, type SavedSession } from '../../frontend/js/personal-ai/session-state'
import { CHAT_REQUEST_BYTES, jsonBytes } from '../../shared/session-request.mjs'

const message = (id: string, text = id): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] })
const initial = (messages: UIMessage[]): SavedSession => ({ id: 'session', projectId: 'project', title: 'Test', revision: 0, historyVersion: 0,
  messageOffset: 40, olderBefore: 40, messages, summary: null, binding: null })
const body = { id: 'session', projectId: 'project', sessionContext: true }
const outbox = { current: [] }

describe('incremental chat requests', function () {
  before(async function () { await i18nReady })
  afterEach(function () { cleanup(); sinon.restore() })

  function setup(messages: UIMessage[] = [], position = { current: { messageOffset: 40, historyVersion: 0 } }) {
    return { ...renderHook(({ current }) => useSessionAutosave(initial(messages), 'project', current, null, false, null, outbox.current, outbox, position),
      { initialProps: { current: messages } }), position }
  }

  it('omits saved history immediately without waiting for or invoking a save', async function () {
    const history = [message('old', 'A'.repeat(13 * 1024 * 1024))]
    const fetch = sinon.stub(globalThis, 'fetch').rejects(new Error('Must not save to send a small delta'))
    const { result } = setup(history)
    const next = message('new')
    const request = await result.current.prepareRequest(body, [...history, next], () => true)
    expect(request.messages).to.deep.equal([next])
    expect(request.messageOffset).to.equal(41)
    expect(jsonBytes(request)).to.be.lessThan(1024)
    expect(fetch).not.to.have.been.called
  })

  it('saves the exact SDK snapshot in bounded batches when React has not rendered the newest messages', async function () {
    const calls: any[] = []
    sinon.stub(globalThis, 'fetch').callsFake(async (_path: any, options: any) => {
      const data = JSON.parse(options.body); calls.push(data)
      return new Response(JSON.stringify({ revision: data.revision + 1 }), { headers: { 'Content-Type': 'application/json' } })
    })
    const { result } = setup()
    const sdkMessages = [message('one', 'A'.repeat(6 * 1024 * 1024)), message('two', 'B'.repeat(6 * 1024 * 1024)), message('latest', 'Fresh tool/user content')]
    let request: any
    await act(async () => { request = await result.current.prepareRequest(body, sdkMessages, () => true) })
    expect(calls).to.have.length(2)
    expect(calls.every(call => jsonBytes(call) < CHAT_REQUEST_BYTES)).to.equal(true)
    expect(calls.flatMap(call => call.messages.map((row: any) => [row.order, row.message.id]))).to.deep.equal([[40, 'one'], [41, 'two'], [42, 'latest']])
    expect(request.messages).to.deep.equal([sdkMessages[2]])
    expect(request.messageOffset).to.equal(42)
    expect(jsonBytes(request)).to.be.lessThan(1024)
  })

  it('retains unsaved messages after a failed batch and retries only the remaining saves', async function () {
    const calls: any[] = []
    let fail = true
    sinon.stub(globalThis, 'fetch').callsFake(async (_path: any, options: any) => {
      const data = JSON.parse(options.body); calls.push(data)
      if (calls.length === 2 && fail) return new Response(JSON.stringify({ error: 'Save failed' }), { status: 500 })
      return new Response(JSON.stringify({ revision: data.revision + 1 }))
    })
    const { result } = setup()
    const sdkMessages = [message('one', 'A'.repeat(6 * 1024 * 1024)), message('two', 'B'.repeat(6 * 1024 * 1024)), message('latest')]
    let error = ''
    await act(async () => { try { await result.current.prepareRequest(body, sdkMessages, () => true) } catch (e) { error = (e as Error).message } })
    expect(error).to.equal('Save failed')
    expect(result.current.error).to.equal('Save failed')
    fail = false
    const request = await result.current.prepareRequest(body, sdkMessages, () => true)
    // The first batch is confirmed saved; its large message is no longer sent.
    expect(request.messages.map((m: UIMessage) => m.id)).to.deep.equal(['two', 'latest'])
    expect(request.messageOffset).to.equal(41)
    expect(calls).to.have.length(2)
    await act(async () => { await result.current.flush(sdkMessages) })
    expect(calls.at(-1).messages.map((row: any) => row.message.id)).to.deep.equal(['two', 'latest'])
  })

  it('aborts a prepared request when stopped during a size-triggered save', async function () {
    let current = true
    sinon.stub(globalThis, 'fetch').callsFake(async (_path: any, options: any) => {
      current = false
      return new Response(JSON.stringify({ revision: JSON.parse(options.body).revision + 1 }))
    })
    const { result } = setup()
    let error: any
    await act(async () => { try { await result.current.prepareRequest(body, [message('a', 'A'.repeat(6 * 1024 * 1024)), message('b', 'B'.repeat(6 * 1024 * 1024))], () => current) } catch (e) { error = e } })
    expect(error.name).to.equal('AbortError')
  })

  it('rebases after editing and rejects an obsolete in-flight history version', async function () {
    const old = message('old'), edited = message('old', 'Edited')
    const { result, position } = setup([old])
    let rewriteDuringSave = false
    sinon.stub(globalThis, 'fetch').callsFake(async (path: any, options: any) => {
      const data = JSON.parse(options.body)
      if (rewriteDuringSave) position.current.historyVersion = 2
      return new Response(JSON.stringify(String(path).endsWith('edit-message')
        ? { ...initial([edited]), messageOffset: 0, historyVersion: 1, revision: 1 }
        : { revision: data.revision + 1 }))
    })
    await act(async () => { await result.current.editMessage('old', 'Edited') })
    const request = await result.current.prepareRequest(body, [edited], () => true)
    expect(request.historyVersion).to.equal(1)
    expect(request.messageOffset).to.equal(0)
    expect(request.messages).to.deep.equal([edited])
    let error: any
    rewriteDuringSave = true
    await act(async () => { try { await result.current.prepareRequest(body, [message('a', 'A'.repeat(6 * 1024 * 1024)), message('b', 'B'.repeat(6 * 1024 * 1024))], () => true) } catch (e) { error = e } })
    expect(error.name).to.equal('AbortError')
  })

  it('keeps sessions independent and preserves model and summary metadata without sending the outbox', async function () {
    const history = [message('same-id')], first = setup(history), second = setup()
    const next = message('next')
    const metadata = { ...body, binding: { connectionId: 'custom', model: 'test', reasoningEffort: 'high' }, compaction: { summary: 'Summary', upToMessageId: 'same-id' } }
    const request = await first.result.current.prepareRequest(metadata, [...history, next], () => true)
    const other = await second.result.current.prepareRequest({ ...body, id: 'other' }, [...history, next], () => true)
    expect(request.messages).to.deep.equal([next])
    expect(other.messages).to.deep.equal([...history, next])
    expect(request).to.include({ binding: metadata.binding, compaction: metadata.compaction })
    expect(request).not.to.have.property('outbox')
    expect(other.id).to.equal('other')
  })

  it('blocks an oversized single message without sending a chat request', async function () {
    const fetch = sinon.stub(globalThis, 'fetch').rejects(new Error('No request expected'))
    const { result } = setup()
    let error = ''
    await act(async () => { try { await result.current.prepareRequest(body, [message('too-big', 'A'.repeat(11 * 1024 * 1024))], () => true) } catch (e) { error = (e as Error).message } })
    expect(error).to.not.equal('')
    expect(error).to.not.include('413')
    expect(fetch).not.to.have.been.called
  })
})
