import { GlobalToastGeneratorEntry } from '@/features/ide-react/components/global-toasts'
import { useTranslation } from 'react-i18next'
import { isMac } from '@/shared/utils/os'

const ClipboardPasteErrorToast = ({ shortcut }: { shortcut?: string }) => {
  const { t } = useTranslation()
  const resolvedShortcut = shortcut ?? (isMac ? '⌘V' : 'Ctrl+V')

  return <>{t('clipboard_paste_shortcut', { shortcut: resolvedShortcut })}</>
}

const ClipboardCopyErrorToast = ({ cut }: { cut?: boolean }) => {
  const { t } = useTranslation()
  return <>{cut ? t('clipboard_cut_failed') : t('clipboard_copy_failed')}</>
}

const generators: GlobalToastGeneratorEntry[] = [
  {
    key: 'clipboard:paste-error',
    generator: ({ shortcut }: { shortcut?: string }) => ({
      content: <ClipboardPasteErrorToast shortcut={shortcut} />,
      type: 'warning',
      autoHide: true,
      delay: 6000,
      isDismissible: true,
    }),
  },
  {
    key: 'clipboard:copy-error',
    generator: ({ cut }: { cut?: boolean }) => ({
      content: <ClipboardCopyErrorToast cut={cut} />,
      type: 'warning',
      autoHide: true,
      delay: 6000,
      isDismissible: true,
    }),
  },
]

export default generators

export const showClipboardPasteErrorToast = (shortcut?: string) => {
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'clipboard:paste-error', shortcut },
    })
  )
}

export const showClipboardCopyErrorToast = (cut = false) => {
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'clipboard:copy-error', cut },
    })
  )
}
