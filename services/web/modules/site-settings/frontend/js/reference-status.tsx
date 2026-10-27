import { ui } from './ui'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import ZoteroLogo from '@/shared/svgs/zotero-logo'
import MendeleyLogo from '@/shared/svgs/mendeley-logo'

export default function ReferenceStatus({ provider }: { provider: 'Zotero' | 'Mendeley' }) {
  const { loaded, canConfigure } = useInstanceFeatures()
  return <div className="settings-widget-container rogerleaf-reference-status">
    <div>{provider === 'Zotero' ? <ZoteroLogo /> : <MendeleyLogo />}</div>
    <div className="description-container"><div className="title-row"><h4>{provider}</h4></div><p className="small">{ui(loaded ? '站点尚未启用此服务。' : '正在读取…')}</p></div>
    <div>{loaded && (canConfigure ? <a className="btn btn-secondary btn-sm" href="/admin/integrations">{ui('前往集成配置')}</a> : <span className="small">{ui('请联系站点管理员。')}</span>)}</div>
  </div>
}
