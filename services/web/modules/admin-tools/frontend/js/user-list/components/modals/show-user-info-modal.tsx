import React, { useEffect, useState } from 'react'
import { Card } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLCard from '@/shared/components/ol/ol-card'
import OLBadge from '@/shared/components/ol/ol-badge'
import { formatDate } from '@/utils/dates'
import UsersActionModal from './users-action-modal'
import { getAdditionalUserInfo } from '../../util/api'
import { copyTextToClipboard } from '@/utils/clipboard'

type ShowUserInfoModalProps = Pick<
  React.ComponentProps<typeof UsersActionModal>,
  'users' | 'showModal' | 'handleCloseModal'
>

function InfoRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <OLRow className="mb-2">
      <OLCol xs={4} className="fw-semibold text-muted">
        {label}
      </OLCol>
      <OLCol xs={8}>{value}</OLCol>
    </OLRow>
  )
}

function ShowUserInfoModal({
  users,
  showModal,
  handleCloseModal,
}: ShowUserInfoModalProps) {
  const { t } = useTranslation()

  if (users.length !== 1) return null
  const user = users[0]

  const [activationLink, setActivationLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    if (!showModal) return

    getAdditionalUserInfo(user.id)
      .then(({ activationLink }) => {
        setActivationLink(activationLink)
      })
      .catch(() => {
        setActivationLink(null)
      })
  }, [showModal, user.id])

  const handleCopy = async () => {
    if (!activationLink) return

    const success = await copyTextToClipboard(activationLink)
    setCopied(success)
    setCopyFailed(!success)
    if (success) {
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <UsersActionModal
      action="info"
      title={t('info')}
      showModal={showModal}
      handleCloseModal={handleCloseModal}
      users={users}
    >
      <OLCard className="mb-3">
        {(Body) => (
          <>
            <Card.Header>{t('Account')}</Card.Header>
            <Body>
              <InfoRow label={t('id')} value={user.id} />
              <InfoRow label={t('email_address')} value={user.email} />
              <InfoRow label={t('first_name')} value={user.firstName || '—'} />
              <InfoRow label={t('last_name')} value={user.lastName || '—'} />

              {user.isAdmin && (
                <InfoRow
                  label={t('role')}
                  value={
                    <OLBadge bg="danger">
                      {t('admin')}
                    </OLBadge>
                  }
                />
              )}
              {activationLink && (
                <InfoRow 
                  label={t('activate_account')}
                  value={
                    <span
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={handleCopy}
                    >
                      {activationLink}
                      {copied && (
                        <span className="ms-2 text-success">
                          ({t('copied')})
                        </span>
                      )}
                      {copyFailed && (
                        <span className="ms-2 text-danger" role="alert">
                          {t('clipboard_copy_failed')}
                        </span>
                      )}
                    </span>
                  }
                />
              )}
            </Body>
          </>
        )}
      </OLCard>

      <OLCard>
        {(Body) => (
          <>
            <Card.Header>{t('actions')}</Card.Header>
            <Body>
              <InfoRow
                label={t('sign_up')}
                value={formatDate(user.signUpDate)}
              />
              <InfoRow
                label={t('last_logged_in')}
                value={
                  user.lastLoggedIn
                    ? formatDate(user.lastLoggedIn)
                    : t('unknown')
                }
              />
              <InfoRow
                label={t('last_active')}
                value={
                  user.lastActive
                    ? formatDate(user.lastActive)
                    : t('unknown')
                }
              />
              <InfoRow
                label={t('login_count')}
                value={user.loginCount}
              />
            </Body>
          </>
        )}
      </OLCard>
    </UsersActionModal>
  )
}

export default ShowUserInfoModal

