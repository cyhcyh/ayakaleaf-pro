import { ui } from './ui'
import './admin.scss'
import MaterialIcon from '@/shared/components/material-icon'

export default function AdminNav({ active }: { active: 'site' | 'users' | 'projects' | 'integrations' }) {
  return <aside className="rogerleaf-admin-sidebar"><nav className="rogerleaf-admin-nav" aria-label={ui('管理导航')}>
    {([
      ['site', '/admin', '站点管理', 'home'], ['users', '/admin/user', '用户管理', 'group'],
      ['projects', '/admin/project', '项目管理', 'folder'], ['integrations', '/admin/integrations', '集成配置', 'settings'],
    ] as const).map(([key, href, label, icon]) => <a key={key} href={href} aria-current={active === key ? 'page' : undefined}><MaterialIcon type={icon} /><span>{ui(label)}</span></a>)}
  </nav><a className="rogerleaf-admin-back" href="/project"><MaterialIcon type="arrow_back" />{ui('返回项目')}</a></aside>
}
