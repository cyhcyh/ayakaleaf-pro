import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'

export type EditRecord = { id: string; chatId: string; toolCallId: string; revision: number; state: 'pending' | 'accepted' | 'rejected' | 'undone' | 'superseded';
  input: { path: string; startLine: number; endLine: number; oldText: string; newText: string; reason?: string; replacesEditId?: string; keepSeparate?: boolean };
  replaces?: string[]; supersededBy?: string; positionedAt?: string;
  proposalAnchor?: EditAnchor; lastAnchor?: EditAnchor;
  createdAt: string; updatedAt: string; operation: { id: string; action: string; anchor: EditAnchor } | null }
export type EditAnchor = { before: string; after: string; prefix: string; suffix: string; atStart: boolean; atEnd: boolean }
type EditSnapshot = { items: EditRecord[]; error: string; loading: boolean; focusId: string | null; busy: string[] }
const empty: EditSnapshot = { items: [], error: '', loading: false, focusId: null, busy: [] }
const snapshots = new Map<string, EditSnapshot>()
const listeners = new Map<string, Set<() => void>>()
const requests = new Map<string, Promise<void>>()
export const editSnapshot = (projectId: string) => snapshots.get(projectId) || empty
export function updateEdits(projectId: string, change: Partial<EditSnapshot>) {
  snapshots.set(projectId, { ...editSnapshot(projectId), ...change })
  listeners.get(projectId)?.forEach(notify => notify())
}
export function putEdit(projectId: string, record: EditRecord) {
  const current = editSnapshot(projectId)
  if (current.items.some(item => item.id === record.id && item.revision > record.revision)) return
  const replaced = new Set(record.replaces || [])
  updateEdits(projectId, { items: [record, ...current.items.filter(item => item.id !== record.id).map(item =>
    replaced.has(item.id) && item.state === 'pending' ? { ...item, state: 'superseded' as const, supersededBy: record.id, revision: item.revision + 1 } : item)]
    .sort((a, b) => (b.positionedAt || b.createdAt).localeCompare(a.positionedAt || a.createdAt)),
    focusId: current.focusId && replaced.has(current.focusId) ? record.id : current.focusId, error: '' })
}
export function focusEdit(projectId: string, id: string | null) { updateEdits(projectId, { focusId: id }) }
export async function ensureEdit(projectId: string, id: string) {
  const record = editSnapshot(projectId).items.find(item => item.id === id)
  if (record) return record
  const loaded = await api<EditRecord>(`/edits/${id}?projectId=${projectId}`)
  putEdit(projectId, loaded)
  return loaded
}
export function refreshEdits(projectId: string) {
  if (requests.has(projectId)) return requests.get(projectId)!
  const started = new Map(editSnapshot(projectId).items.map(item => [item.id, item]))
  updateEdits(projectId, { loading: true })
  const work = api<{ items: EditRecord[] }>(`/edits?projectId=${projectId}`).then(async result => {
    const focusedId = editSnapshot(projectId).focusId
    // An absent focused record may have been superseded, rather than merely
    // falling outside the recent page. Never restore its stale pending state.
    const focused = focusedId && !result.items.some(item => item.id === focusedId)
      ? await api<EditRecord>(`/edits/${focusedId}?projectId=${projectId}`).catch(() => null) : null
    const current = editSnapshot(projectId)
    const merged = [...result.items, ...(focused ? [focused] : [])].map(item => {
      const live = current.items.find(candidate => candidate.id === item.id)
      return live && live.revision > item.revision ? live : item
    })
    for (const live of current.items) {
      if (started.get(live.id) !== live && !merged.some(item => item.id === live.id)) merged.push(live)
    }
    updateEdits(projectId, { items: merged,
      focusId: current.focusId === focusedId && focused?.supersededBy ? focused.supersededBy : current.focusId,
      error: '', loading: false })
  }).catch(error => { updateEdits(projectId, { error: error.message, loading: false }); throw error })
    .finally(() => requests.delete(projectId))
  requests.set(projectId, work)
  return work
}
export function useEdits(projectId: string) {
  const snapshot = useSyncExternalStore(notify => {
    if (!listeners.has(projectId)) listeners.set(projectId, new Set())
    listeners.get(projectId)!.add(notify)
    return () => { listeners.get(projectId)?.delete(notify) }
  }, () => editSnapshot(projectId))
  useEffect(() => {
    refreshEdits(projectId).catch(() => {})
    const refresh = () => { if (document.visibilityState === 'visible') refreshEdits(projectId).catch(() => {}) }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [projectId])
  return snapshot
}
