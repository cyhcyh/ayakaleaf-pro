import OLBadge from '@/shared/components/ol/ol-badge'
import MaterialIcon from '@/shared/components/material-icon'
import { useTranslation } from 'react-i18next'

export default function IntegrationCard({
  href,
  onClick,
  title,
  description,
  icon,
  showPaywallBadge,
  status,
}: {
  href?: string
  onClick?: () => void
  title: string
  description: string
  icon: React.ReactNode
  showPaywallBadge: boolean
  status?: string
}) {
  const { t } = useTranslation()

  const content = (
    <div className="integrations-panel-card-contents">
      <div className="integrations-panel-card-icon">{icon}</div>
      <div className="integrations-panel-card-inner">
        <div className={`integrations-panel-card-header${status ? ' ayaka-integration-header' : ''}`}>
          <div className="integrations-panel-card-title" translate="no">
            {title}
          </div>
          {showPaywallBadge && (
            <OLBadge
              prepend={<MaterialIcon type="star" />}
              bg="light"
              className="integrations-panel-card-premium-badge"
            >
              {t('premium')}
            </OLBadge>
          )}
          {status && <span className="ayaka-integration-status">{status}</span>}
        </div>
        <p className="integrations-panel-card-description">{description}</p>
      </div>
    </div>
  )

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="integrations-panel-card-button"
      >
        {content}
      </a>
    )
  }

  return (
    <button onClick={onClick} className="integrations-panel-card-button">
      {content}
    </button>
  )
}
