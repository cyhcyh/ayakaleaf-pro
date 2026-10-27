import type { DefaultNavbarMetadata } from '@/shared/components/types/default-navbar-metadata'
import NavDropdownMenu from '@/shared/components/navbar/nav-dropdown-menu'
import NavDropdownLinkItem from '@/shared/components/navbar/nav-dropdown-link-item'
import { useSendProjectListMB } from '@/features/project-list/components/project-list-events'
import { ui } from '@modules/site-settings/frontend/js/ui'

export default function AdminMenu({
  canDisplayAdminMenu,
  canDisplayAdminRedirect,
  canDisplayProjectUrlLookup,
  canDisplaySplitTestMenu,
  canDisplaySurveyMenu,
  canDisplayScriptLogMenu,
  adminUrl,
}: Pick<
  DefaultNavbarMetadata,
  | 'canDisplayAdminMenu'
  | 'canDisplayAdminRedirect'
  | 'canDisplayProjectUrlLookup'
  | 'canDisplaySplitTestMenu'
  | 'canDisplaySurveyMenu'
  | 'canDisplayScriptLogMenu'
  | 'adminUrl'
>) {
  const sendProjectListMB = useSendProjectListMB()
  return (
    <NavDropdownMenu
      title={ui('管理')}
      className="subdued"
      onToggle={nextShow => {
        if (nextShow) {
          sendProjectListMB('menu-expand', {
            item: 'admin',
            location: 'top-menu',
          })
        }
      }}
    >
      {canDisplayAdminMenu ? (
        <>
          <NavDropdownLinkItem href="/admin">{ui('站点管理')}</NavDropdownLinkItem>
          <NavDropdownLinkItem href="/admin/user">
            {ui('用户管理')}
          </NavDropdownLinkItem>
          <NavDropdownLinkItem href="/admin/integrations">{ui('集成配置')}</NavDropdownLinkItem>
        </>
      ) : null}
      {canDisplayProjectUrlLookup ? (
        <NavDropdownLinkItem href="/admin/project">
          {ui('项目管理')}
        </NavDropdownLinkItem>
      ) : null}
      {canDisplayAdminRedirect && adminUrl ? (
        <NavDropdownLinkItem href={adminUrl}>
          Switch to Admin
        </NavDropdownLinkItem>
      ) : null}
      {canDisplaySplitTestMenu ? (
        <NavDropdownLinkItem href="/admin/split-test">
          Manage Feature Flags
        </NavDropdownLinkItem>
      ) : null}
      {canDisplaySurveyMenu ? (
        <NavDropdownLinkItem href="/admin/survey">
          Manage Surveys
        </NavDropdownLinkItem>
      ) : null}
      {canDisplayScriptLogMenu ? (
        <NavDropdownLinkItem href="/admin/script-logs">
          View Script Logs
        </NavDropdownLinkItem>
      ) : null}
    </NavDropdownMenu>
  )
}
