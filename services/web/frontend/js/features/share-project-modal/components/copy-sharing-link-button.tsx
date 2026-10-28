import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import OLButton from '@/shared/components/ol/ol-button'
import { useShareProjectContext } from '@/features/share-project-modal/components/share-project-modal'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '@/shared/context/user-context'
import { copyTextToClipboard } from '@/utils/clipboard'
import getMeta from '@/utils/meta'
import { sendMB } from '@/infrastructure/event-tracking'

export default function CopySharingLinkButton() {
  const { t } = useTranslation()
  const { sharingLinkData, projectAccess, setSuccessActionMessage } =
    useShareProjectContext()
  const { projectId } = useProjectContext()
  const { isAdmin } = useUserContext()
  const [failedLink, setFailedLink] = useState('')

  const isCopyBtnEnabled =
    Boolean(sharingLinkData?.token) &&
    (projectAccess?.startsWith('anyoneInXyzWithTheLink') ||
      projectAccess === 'anyoneWithTheLink')

  const handleCopyClick = async () => {
    if (!sharingLinkData?.token) {
      return
    }

    const origin = isAdmin
      ? getMeta('ol-ExposedSettings').siteUrl
      : window.location.origin
    const link = `${origin}/project/${projectId}/share#${sharingLinkData.token}`

    if (await copyTextToClipboard(link)) {
      setFailedLink('')
      setSuccessActionMessage(t('link_copied'))
      sendMB('sharing-link-copied', {
        project_id: projectId,
      })
    } else {
      setSuccessActionMessage(undefined)
      setFailedLink(link)
    }
  }

  return (
    <>
      <OLButton
        variant="secondary"
        leadingIcon={isCopyBtnEnabled ? 'link' : 'link_off'}
        disabled={!isCopyBtnEnabled}
        onClick={handleCopyClick}
      >
        {t('copy_sharing_link')}
      </OLButton>
      {failedLink && (
        <div className="w-100 small" role="alert">
          <label className="w-100">
            {t('clipboard_copy_failed')}
            <input
              className="form-control mt-1"
              aria-label={t('copy_sharing_link')}
              readOnly
              value={failedLink}
            />
          </label>
        </div>
      )}
    </>
  )
}
