import AdminNav from '@modules/site-settings/frontend/js/admin-nav'
import { useTranslation } from 'react-i18next'
import ProjectListTable from './table/project-list-table'
import SearchForm from './search-form'
import ProjectsDropdown from './dropdown/projects-dropdown'
import SortByDropdown from './dropdown/sort-by-dropdown'
import ProjectTools from './table/project-tools/project-tools'
import ProjectListTitle from './title/project-list-title'
import LoadMore from './load-more'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'
import { TableContainer } from '@/shared/components/ol/ol-table'
import DashApiError from '@/features/project-list/components/dash-api-error'
import getMeta from '@/utils/meta'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import SidebarFilters from './sidebar/sidebar-filters'
import AdminPageHeader from '@modules/site-settings/frontend/js/admin-page-header'
import { ui } from '@modules/site-settings/frontend/js/ui'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import { useProjectListContext } from '../context/project-list-context'
import { useUserIdentityContext } from '../../user-list/context/user-identity-context'

export function ProjectListDsNav() {

  const navbarProps = getMeta('ol-navbar')
  const footerProps = getMeta('ol-footer')

  const { t } = useTranslation()
  const {
    error,
    searchText,
    setSearchText,
    selectedProjects,
    filter,
    projectsOwnerId,
  } = useProjectListContext()
  const { getUserNameById } = useUserIdentityContext()

  const userName = projectsOwnerId ? getUserNameById(projectsOwnerId) : t('all')
  const tableTopArea = (
    <div className="pt-2 pb-3 d-md-none d-flex gap-3">
      <div className="pt-1 fs-5 fw-bold" translate="no">
         {userName}
      </div>
      <SearchForm
        inputValue={searchText}
        setInputValue={setSearchText}
        className="overflow-hidden flex-grow-1"
      />
    </div>
  )

  return (
    <div className="project-ds-nav-page website-redesign rogerleaf-admin-page">
      <DefaultNavbar
        {...navbarProps}
        overleafLogo={overleafLogo}
        showCloseIcon
        showThemeToggle
      />
      <div className="rogerleaf-admin-layout">
        <AdminNav active="projects" />
        <div className="project-ds-nav-content-and-messages rogerleaf-admin-main">
          <div className="project-ds-nav-content">
            <div className="project-ds-nav-main rogerleaf-admin-content">
              <AdminPageHeader title={ui('项目管理')} description={ui('查找项目，管理归档和删除状态。')} actions={projectsOwnerId && <button className="btn btn-secondary" onClick={() => { if (history.length > 1) history.back(); else history.replaceState({ type: 'users' }, '') }}>{t('back')}</button>} />
              {error ? <DashApiError /> : ''}
              <main aria-labelledby="main-content">
                {projectsOwnerId && <p>{t('owner')}: <strong translate="no">{userName}</strong></p>}
                <div className="project-list-header-row position-relative">
                  <ProjectListTitle
                    filter={filter}
                    className="text-truncate d-none d-md-block"
                  />
                  <div className="project-tools">
                    <div className="d-none d-md-block">
                      {selectedProjects.length !== 0 && <ProjectTools />}
                    </div>
                  </div>
                </div>
                <div className="project-ds-nav-project-list">
                  <div className="rogerleaf-admin-filters" aria-label={t('filters')}><SidebarFilters /></div>
                  <OLRow className="d-none d-md-block">
                    <OLCol lg={7}>
                      <SearchForm
                        inputValue={searchText}
                        setInputValue={setSearchText}
                      />
                    </OLCol>
                  </OLRow>
                  <div className="mt-1 d-md-none">
                    <div
                      role="toolbar"
                      className="projects-toolbar"
                      aria-label={t('projects')}
                    >
                      <ProjectsDropdown />
                      <SortByDropdown />
                    </div>
                  </div>
                  <div className="mt-3">
                    <TableContainer bordered>
                      {tableTopArea}
                      <ProjectListTable />
                    </TableContainer>
                  </div>
                  <div className="mt-3">
                    <LoadMore />
                  </div>
                </div>
              </main>
            </div>
            <Footer {...footerProps} />
          </div>
        </div>
      </div>
    </div>
  )
}
