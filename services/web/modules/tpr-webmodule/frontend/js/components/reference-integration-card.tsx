import { useEffect, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import { OLModal, OLModalHeader, OLModalTitle, OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import { useFileTreeActionable } from '@/features/file-tree/contexts/file-tree-actionable'
import { useFileTreeMainContext } from '@/features/file-tree/contexts/file-tree-main'
import { authorizeReference } from '../reference-authorization'
import { ui } from '@modules/site-settings/frontend/js/ui'

export default function ReferenceIntegrationCard({ provider, title, icon, description }: { provider: 'zotero' | 'mendeley'; title: string; icon: React.ReactNode; description: string }) {
  const [linked, setLinked] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const { startCreatingFile } = useFileTreeActionable()
  const { setRefProviderEnabled } = useFileTreeMainContext()
  useEffect(() => {
    let alive = true
    const refresh = () => getJSON<Record<string, boolean>>('/reference-providers/status').then(value => { if (alive) { setLinked(value[provider]); setLoaded(true) } }).catch(() => { if (alive) setError(ui('无法读取账户状态，请重试。')) })
    refresh(); window.addEventListener('ayaka:reference-linked', refresh)
    return () => { alive = false; window.removeEventListener('ayaka:reference-linked', refresh) }
  }, [provider])
  const link = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const ok = await authorizeReference(provider)
      if (ok) { setLinked(true); setRefProviderEnabled(provider, true); setShow(true) }
      else { setError(ui('授权未完成，可以重试。')); setShow(true) }
    } catch (error) { setError(ui((error as Error).message)); setShow(true) } finally { setBusy(false) }
  }
  return <>
    <IntegrationCard title={title} description={description} icon={icon} showPaywallBadge={false} status={busy ? ui('等待授权…') : !loaded ? ui('正在读取…') : linked ? ui('已关联') : ui('未连接')} onClick={() => linked ? setShow(true) : link()} />
    <OLModal show={show} onHide={() => setShow(false)} size="sm" centered themed>
      <OLModalHeader closeButton><OLModalTitle>{title}</OLModalTitle></OLModalHeader>
      <OLModalBody>{error ? <p role="alert" className="text-danger">{error}</p> : <p>{ui('账户已关联，可以把文献库导入项目。')}</p>}</OLModalBody>
      <OLModalFooter><button className="btn btn-secondary" onClick={() => setShow(false)}>{ui('关闭')}</button>{linked ? <><a className="btn btn-secondary" href="/user/settings#references" target="_blank" rel="noopener noreferrer">{ui('账户管理')}</a><button className="btn btn-primary" onClick={() => { setShow(false); startCreatingFile(provider) }}>{ui('导入文献')}</button></> : <button className="btn btn-primary" disabled={busy} onClick={link}>{ui('重新授权')}</button>}</OLModalFooter>
    </OLModal>
  </>
}
