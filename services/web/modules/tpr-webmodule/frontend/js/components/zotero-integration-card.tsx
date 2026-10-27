import UnavailableCard from '@modules/site-settings/frontend/js/unavailable-card'
import { ui } from '@modules/site-settings/frontend/js/ui'
import ReferenceIntegrationCard from './reference-integration-card'
import { useTranslation } from 'react-i18next'
import ZoteroLogo from '@/shared/svgs/zotero-logo'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

/**
 * Zotero card in the editor's Integrations panel. Clicking it takes the user to
 * the Reference managers section of Account Settings, where the Zotero account
 * can be linked or unlinked.
 *
 * Registered via overleafModuleImports.integrationPanelComponents.
 */
const ZoteroIntegrationCard = () => {
  const { t } = useTranslation()
  const { zotero } = useInstanceFeatures()

  if (!zotero) { return <UnavailableCard title="Zotero" description={ui('从 Zotero 文献库导入参考文献。')} icon={<ZoteroLogo size={32} />} /> }

  return (
    <ReferenceIntegrationCard
      title={t('zotero')}
      description={ui('从 Zotero 文献库导入参考文献。')}
      icon={<ZoteroLogo size={32} />}
      provider="zotero"
    />
  )
}

export default ZoteroIntegrationCard
