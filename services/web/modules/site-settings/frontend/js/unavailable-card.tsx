import { useState } from 'react'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import { OLModal, OLModalHeader, OLModalTitle, OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import { ui } from './ui'
import './site-settings.scss'

export default function UnavailableCard({ title, description, icon, service = false }: { title: string; description: string; icon: React.ReactNode; service?: boolean }) {
  const [show, setShow] = useState(false)
  const { canConfigure, loaded } = useInstanceFeatures()
  return <>
    <IntegrationCard title={title} description={description} icon={icon} showPaywallBadge={false} onClick={() => setShow(true)} status={loaded ? ui(service ? '未启用' : '未配置') : ui('正在读取…')} />
    <OLModal show={show} onHide={() => setShow(false)} size="sm" centered themed>
      <OLModalHeader closeButton><OLModalTitle>{title}</OLModalTitle></OLModalHeader>
      <OLModalBody><div className="ayaka-integration-unavailable"><p>{ui(service ? '站点尚未启用 Git Bridge 服务。启用后可查看连接信息。' : '站点尚未配置此集成。配置完成后，你可以关联自己的账户。')}</p></div></OLModalBody>
      <OLModalFooter><button className="btn btn-secondary" onClick={() => setShow(false)}>{ui('关闭')}</button>{canConfigure ? <a className="btn btn-primary" href="/admin/integrations" target="_blank" rel="noopener noreferrer">{ui('集成配置')}</a> : <span className="small">{ui('请联系站点管理员。')}</span>}</OLModalFooter>
    </OLModal>
  </>
}
