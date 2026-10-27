import { useEffect, useState } from 'react'
import Setting from '@/features/ide-settings/components/setting'
import { useProjectContext } from '@/shared/context/project-context'
import { OLModal, OLModalHeader, OLModalTitle, OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import { api } from './api'
import { prepareHistoryClear, historyCleared } from './history-events'

export default function DataSettings() {
  const { projectId } = useProjectContext()
  const [scope, setScope] = useState<'project' | 'all'>('project')
  const [count, setCount] = useState<number | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    setCount(null); setError(''); setNotice('')
    const refresh = () => api<{ count: number }>(`/history/count?projectId=${projectId}&scope=${scope}`, undefined, abort.signal)
      .then(result => setCount(result.count)).catch(error => { if (!abort.signal.aborted) setError(error.message) })
    refresh()
    window.addEventListener('personal-ai:sessions', refresh)
    return () => { abort.abort(); window.removeEventListener('personal-ai:sessions', refresh) }
  }, [projectId, scope])
  const clear = async () => {
    setBusy(true); setError('')
    try {
      await prepareHistoryClear({ projectId, scope })
      await api('/history/clear', { projectId, scope })
      historyCleared({ projectId, scope })
      setConfirm(false); setCount(0); setNotice('历史会话已清空。')
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <div className="pa-native-settings">
    <Setting controlId="pa-history-scope" label="清除范围" description="只清除你自己的历史会话。">
      <select id="pa-history-scope" className="form-control form-select" value={scope} disabled={busy} onChange={event => setScope(event.target.value as typeof scope)}><option value="project">当前项目</option><option value="all">我的所有项目</option></select>
    </Setting>
    <Setting controlId="pa-clear-history" label="历史会话" description="清除对话和摘要，保留正文、评论、参考文件和 AI 修改记录。">
      <div className="pa-data-action"><span>{count === null ? '正在读取…' : `${count} 个会话`}</span><button id="pa-clear-history" aria-label="清空历史会话" className="btn btn-secondary pa-danger-action" disabled={busy || !count} onClick={() => { setError(''); setConfirm(true) }}>清空历史会话</button></div>
    </Setting>
    {error && !confirm && <p className="pa-inline-error" role="alert">{error}</p>}
    {notice && <p className="pa-notice" role="status">{notice}</p>}
    <OLModal show={confirm} onHide={() => { if (!busy) setConfirm(false) }} backdrop="static" size="sm" centered themed>
      <OLModalHeader closeButton={!busy}><OLModalTitle>{scope === 'project' ? '清空当前项目的历史会话？' : '清空所有项目的历史会话？'}</OLModalTitle></OLModalHeader>
      <OLModalBody><p>将清除 {count} 个会话及其摘要，无法恢复。</p><p>正文、评论、参考文件和 AI 修改记录会保留。</p>{error && <p className="pa-inline-error" role="alert">{error}</p>}</OLModalBody>
      <OLModalFooter><button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(false)}>取消</button><button className="btn btn-danger" disabled={busy} onClick={clear}>{busy ? '正在清空…' : '清空会话'}</button></OLModalFooter>
    </OLModal>
  </div>
}
