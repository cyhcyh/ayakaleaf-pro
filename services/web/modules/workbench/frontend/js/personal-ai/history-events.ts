import getMeta from '@/utils/meta'

export type HistoryRange = { projectId: string; scope: 'project' | 'all'; ids?: string[] }
export function matchesHistory(range: HistoryRange, projectId: string, chatId: string) {
  return (range.scope === 'all' || range.projectId === projectId) && (!range.ids || range.ids.includes(chatId))
}
export async function prepareHistoryClear(range: HistoryRange) {
  const pending: Promise<unknown>[] = []
  window.dispatchEvent(new CustomEvent('personal-ai:history-will-clear', { detail: { ...range, waitUntil: (work: Promise<unknown>) => pending.push(work) } }))
  broadcast('personal-ai:history-will-clear', range)
  await Promise.all(pending)
}
export function historyCleared(range: HistoryRange) {
  window.dispatchEvent(new CustomEvent('personal-ai:history-cleared', { detail: range }))
  window.dispatchEvent(new Event('personal-ai:sessions'))
  broadcast('personal-ai:history-cleared', range)
}
export function historyClearFailed(range: HistoryRange) {
  window.dispatchEvent(new CustomEvent('personal-ai:history-clear-failed', { detail: range }))
  broadcast('personal-ai:history-clear-failed', range)
}
export function sessionSaved(projectId: string) {
  window.dispatchEvent(new Event('personal-ai:sessions'))
  broadcast('personal-ai:sessions', { projectId, scope: 'project' })
}

let channel: BroadcastChannel | undefined
let subscribers = 0
function broadcast(type: string, range: HistoryRange) { channel?.postMessage({ type, range }) }

// Project tabs in the same browser share the user's clear/delete operation.
// Server-side cancellation and deleted-session checks remain authoritative.
export function connectHistoryEvents() {
  try {
    const user = getMeta('ol-user')
    if (!user?.id || typeof BroadcastChannel === 'undefined') return () => {}
    if (!channel) {
      channel = new BroadcastChannel(`rogerleaf-history:${user.id}`)
      channel.onmessage = ({ data }) => {
        if (data?.type === 'personal-ai:sessions') { window.dispatchEvent(new Event('personal-ai:sessions')); return }
        if (!['personal-ai:history-will-clear', 'personal-ai:history-cleared', 'personal-ai:history-clear-failed'].includes(data?.type) || !data.range) return
        const pending: Promise<unknown>[] = []
        window.dispatchEvent(new CustomEvent(data.type, { detail: { ...data.range, waitUntil: (work: Promise<unknown>) => pending.push(work) } }))
        void Promise.allSettled(pending)
        if (data.type === 'personal-ai:history-cleared') window.dispatchEvent(new Event('personal-ai:sessions'))
      }
    }
    subscribers++
    return () => { if (--subscribers === 0) { channel?.close(); channel = undefined } }
  } catch { return () => {} }
}
