export type HistoryRange = { projectId: string; scope: 'project' | 'all' }
export async function prepareHistoryClear(range: HistoryRange) {
  const pending: Promise<unknown>[] = []
  window.dispatchEvent(new CustomEvent('personal-ai:history-will-clear', { detail: { ...range, waitUntil: (work: Promise<unknown>) => pending.push(work) } }))
  await Promise.all(pending)
}
export function historyCleared(range: HistoryRange) {
  window.dispatchEvent(new CustomEvent('personal-ai:history-cleared', { detail: range }))
  window.dispatchEvent(new Event('personal-ai:sessions'))
}
