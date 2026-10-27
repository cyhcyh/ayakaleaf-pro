import UnavailableCard from '@modules/site-settings/frontend/js/unavailable-card'
import ReferenceIntegrationCard from './reference-integration-card'
import { useTranslation } from 'react-i18next'
import MendeleyLogo from '@/shared/svgs/mendeley-logo'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

/**
 * Mendeley card in the editor's Integrations panel. Clicking it takes the user
 * to the Reference managers section of Account Settings, where the Mendeley
 * account can be linked or unlinked.
 *
 * Registered via overleafModuleImports.integrationPanelComponents.
 */
const MendeleyIntegrationCard = () => {
  const { t } = useTranslation()
  const { mendeley } = useInstanceFeatures()

  if (!mendeley) { return <UnavailableCard title="Mendeley" description={t('cite_directly_or_import_references')} icon={<MendeleyLogo size={32} />} /> }

  return (
    <ReferenceIntegrationCard
      title={t('mendeley')}
      description={t('cite_directly_or_import_references')}
      icon={<MendeleyLogo size={32} />}
      provider="mendeley"
    />
  )
}

export default MendeleyIntegrationCard
