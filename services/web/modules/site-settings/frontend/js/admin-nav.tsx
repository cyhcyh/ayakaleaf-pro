import { ui } from './ui'
import './admin.scss'

export default function AdminNav({ active }: { active: 'site' | 'users' | 'projects' | 'integrations' }) {
  return <nav className="rogerleaf-admin-nav" aria-label={ui('管理导航')}>
    {([
      ['site', '/admin', '站点管理'], ['users', '/admin/user', '用户管理'],
      ['projects', '/admin/project', '项目管理'], ['integrations', '/admin/integrations', '集成配置'],
    ] as const).map(([key, href, label]) => <a key={key} href={href} aria-current={active === key ? 'page' : undefined}>{ui(label)}</a>)}
  </nav>
}
