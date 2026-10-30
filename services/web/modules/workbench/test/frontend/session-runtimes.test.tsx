import { expect } from 'chai'
import { act, cleanup, renderHook } from '@testing-library/react'
import sinon from 'sinon'
import useSessionRuntimes, { type SessionRuntime } from '../../frontend/js/chat/use-session-runtimes'
import { matchesHistory, prepareHistoryClear, historyClearFailed } from '../../frontend/js/personal-ai/history-events'
import { editSnapshot, putEdit, updateEdits, refreshEdits, type EditRecord } from '../../frontend/js/personal-ai/edits-store'
import type { SavedSession } from '../../frontend/js/personal-ai/session-state'

const saved = (id: string) => ({ id, projectId: 'project', messages: [], revision: 0, summary: null, binding: null, messageOffset: 0, olderBefore: null, title: id }) as SavedSession
const runtime = (retain = true) => ({ flush: sinon.stub().resolves(), stopAndFlush: sinon.stub().resolves(), rename: sinon.stub().resolves(),
  suspend: sinon.stub(), state: () => ({ working: retain, retain }) }) as SessionRuntime

describe('background conversation runtimes', function () {
  afterEach(cleanup)

  it('keeps running sessions mounted across switches without stopping or resetting them', async function () {
    const { result } = renderHook(useSessionRuntimes)
    const first = runtime(), second = runtime()
    await act(async () => {
      result.current.activate(saved('a')); result.current.register('a', first)
      result.current.activate(saved('b')); result.current.register('b', second)
      result.current.report('a', { working: true, retain: true })
    })
    expect(result.current.sessions.map(item => item.id)).to.deep.equal(['a', 'b'])
    expect(result.current.currentId).to.equal('b')
    expect(first.stopAndFlush).not.to.have.been.called
    await act(async () => result.current.activate({ ...saved('a'), revision: 99 }))
    expect(result.current.sessions[0].revision).to.equal(0)
    expect(result.current.controls.current.get('a')).to.equal(first)
    expect(second.stopAndFlush).not.to.have.been.called
  })

  it('releases completed background sessions only after their final save', async function () {
    const { result } = renderHook(useSessionRuntimes)
    let resolve!: () => void
    const first = runtime(false)
    first.flush = sinon.stub().returns(new Promise<void>(done => { resolve = done }))
    await act(async () => {
      result.current.activate(saved('a')); result.current.register('a', first)
      result.current.activate(saved('b')); result.current.register('b', runtime())
    })
    expect(result.current.sessions).to.have.length(2)
    await act(async () => resolve())
    expect(result.current.sessions.map(item => item.id)).to.deep.equal(['b'])
    expect(first.stopAndFlush).not.to.have.been.called
  })

  it('does not evict a session reopened while its final save was pending', async function () {
    const { result } = renderHook(useSessionRuntimes)
    let resolve!: () => void
    const first = runtime(false)
    first.flush = sinon.stub().returns(new Promise<void>(done => { resolve = done }))
    await act(async () => {
      result.current.activate(saved('a')); result.current.register('a', first)
      result.current.activate(saved('b')); result.current.register('b', runtime())
    })
    await act(async () => { result.current.activate(saved('a')); resolve() })
    expect(result.current.sessions.map(item => item.id)).to.include('a')
    expect(result.current.currentId).to.equal('a')
  })

  it('removes only selected runtimes and their activity status', async function () {
    const { result } = renderHook(useSessionRuntimes)
    await act(async () => {
      for (const id of ['a', 'b', 'c']) { result.current.activate(saved(id)); result.current.register(id, runtime()); result.current.report(id, { working: true, retain: true }) }
    })
    await act(async () => result.current.remove(new Set(['a', 'b'])))
    expect(result.current.sessions.map(item => item.id)).to.deep.equal(['c'])
    expect(Object.keys(result.current.activity)).to.deep.equal(['c'])
    expect(result.current.currentId).to.equal('c')
  })

  it('matches single deletion, project clearing and all-project clearing separately', async function () {
    expect(matchesHistory({ projectId: 'p', scope: 'project', ids: ['a'] }, 'p', 'b')).to.equal(false)
    expect(matchesHistory({ projectId: 'p', scope: 'project', ids: ['a'] }, 'p', 'a')).to.equal(true)
    expect(matchesHistory({ projectId: 'p', scope: 'project' }, 'other', 'a')).to.equal(false)
    expect(matchesHistory({ projectId: 'p', scope: 'all' }, 'other', 'a')).to.equal(true)
    let finished = false
    const prepare = (event: Event) => (event as CustomEvent).detail.waitUntil(Promise.resolve().then(() => { finished = true }))
    window.addEventListener('personal-ai:history-will-clear', prepare)
    try { await prepareHistoryClear({ projectId: 'p', scope: 'project' }); expect(finished).to.equal(true) }
    finally { window.removeEventListener('personal-ai:history-will-clear', prepare) }
    const failed = sinon.stub()
    window.addEventListener('personal-ai:history-clear-failed', failed)
    historyClearFailed({ projectId: 'p', scope: 'project' })
    window.removeEventListener('personal-ai:history-clear-failed', failed)
    expect(failed).to.have.been.calledOnce
  })

  it('updates the focused proposal to its successor and rejects stale responses', function () {
    const previous = { id: 'old', chatId: 'a', toolCallId: 'call-1', state: 'pending', revision: 0, input: { path: 'main.tex', oldText: 'Original.', newText: 'Draft.', startLine: 2, endLine: 2 }, createdAt: '2026-10-01', updatedAt: '2026-10-01', operation: null } as EditRecord
    updateEdits('test-edit-store', { items: [previous], focusId: 'old' })
    const next = { ...previous, id: 'next', toolCallId: 'call-2', replaces: ['old'], revision: 0, input: { ...previous.input, newText: 'Final.' } }
    putEdit('test-edit-store', next)
    expect(editSnapshot('test-edit-store').items.filter(item => item.state === 'pending').map(item => item.id)).to.deep.equal(['next'])
    expect(editSnapshot('test-edit-store').focusId).to.equal('next')
    putEdit('test-edit-store', previous)
    expect(editSnapshot('test-edit-store').items.find(item => item.id === 'old')?.state).to.equal('superseded')
  })

  it('keeps a background proposal that arrives while the panel refresh is in flight', async function () {
    const project = 'refresh-race', proposal = { id: 'arrived', state: 'pending', revision: 0, createdAt: '2026-10-01', input: {} } as EditRecord
    updateEdits(project, { items: [], focusId: null })
    let resolve!: (value: Response) => void
    const fetch = sinon.stub(globalThis, 'fetch').returns(new Promise(done => { resolve = done }) as Promise<Response>)
    try {
      const loading = refreshEdits(project)
      putEdit(project, proposal)
      resolve({ ok: true, json: async () => ({ items: [] }) } as Response)
      await loading
      expect(editSnapshot(project).items.map(item => item.id)).to.deep.equal(['arrived'])
    } finally { fetch.restore() }
  })

  it('does not revive a focused legacy draft that the server consolidated', async function () {
    const project = 'legacy-focus', old = { id: 'old', state: 'pending', revision: 0, createdAt: '2026-10-01', input: {} } as EditRecord
    const latest = { ...old, id: 'new' }
    updateEdits(project, { items: [old], focusId: old.id })
    const fetch = sinon.stub(globalThis, 'fetch')
    fetch.onFirstCall().resolves({ ok: true, json: async () => ({ items: [latest] }) } as Response)
    fetch.onSecondCall().resolves({ ok: true, json: async () => ({ ...old, state: 'superseded', supersededBy: latest.id, revision: 1 }) } as Response)
    try {
      await refreshEdits(project)
      expect(editSnapshot(project).items.filter(item => item.state === 'pending').map(item => item.id)).to.deep.equal(['new'])
      expect(editSnapshot(project).focusId).to.equal(latest.id)
    } finally { fetch.restore() }
  })
})
