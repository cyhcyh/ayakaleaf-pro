import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'

export type EditRecord = { id: string; chatId: string; toolCallId: string; revision: number; state: 'pending' | 'accepted' | 'rejected' | 'undone';
  input: { path: string; startLine: number; endLine: number; oldText: string; newText: string; reason?: string };
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
  updateEdits(projectId, { items: [record, ...current.items.filter(item => item.id !== record.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), error: '' })
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
  updateEdits(projectId, { loading: true })
  const work = api<{ items: EditRecord[] }>(`/edits?projectId=${projectId}`).then(result => {
    const current = editSnapshot(projectId)
    const merged = result.items.map(item => {
      const live = current.items.find(candidate => candidate.id === item.id)
      return live && live.revision > item.revision ? live : item
    })
    // A directly opened older record remains available alongside the recent list.
    if (current.focusId && !merged.some(item => item.id === current.focusId)) {
      const selected = current.items.find(item => item.id === current.focusId)
      if (selected) merged.unshift(selected)
    }
    updateEdits(projectId, { items: merged, error: '', loading: false })
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
