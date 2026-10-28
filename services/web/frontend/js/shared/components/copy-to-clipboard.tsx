import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import MaterialIcon from '@/shared/components/material-icon'
import { copyTextToClipboard } from '@/utils/clipboard'

export const CopyToClipboard = memo<{
  content: string
  tooltipId: string
  kind?: 'text' | 'icon' | 'button'
  unfilled?: boolean
  onClick?: () => void
}>(({ content, tooltipId, kind = 'icon', unfilled = false, onClick }) => {
  const { t } = useTranslation()

  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const handleClick = useCallback(() => {
    copyTextToClipboard(content).then(success => {
      setCopied(success)
      setFailed(!success)
      if (success) {
        window.setTimeout(() => {
          setCopied(false)
        }, 1500)
      }
    })
    if (onClick) {
      onClick()
    }
  }, [content, onClick])

  return (
    <OLTooltip
      id={tooltipId}
      description={
        failed
          ? t('clipboard_copy_failed')
          : copied
            ? `${t('copied')}!`
            : t('copy')
      }
      overlayProps={{ delay: copied ? 1000 : 250 }}
    >
      {kind === 'text' ? (
        <OLButton
          onClick={handleClick}
          size="sm"
          variant="secondary"
          className="copy-button"
        >
          {t('copy')}
        </OLButton>
      ) : kind === 'button' ? (
        <OLButton
          onClick={handleClick}
          size="sm"
          variant="ghost"
          className="copy-button copy-button-ghost"
        >
          {copied ? (
            <MaterialIcon type="check" />
          ) : (
            <MaterialIcon type="content_copy" unfilled />
          )}
          {t('copy')}
        </OLButton>
      ) : (
        <OLIconButton
          onClick={handleClick}
          variant="link"
          size="sm"
          accessibilityLabel={t('copy')}
          className="copy-button"
          icon={copied ? 'check' : 'content_copy'}
          unfilled={unfilled}
        />
      )}
    </OLTooltip>
  )
})
CopyToClipboard.displayName = 'CopyToClipboard'
