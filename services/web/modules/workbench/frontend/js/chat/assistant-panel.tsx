import { ui } from '@modules/site-settings/frontend/js/ui'
/**
 * The assistant's panel: a header with new chat, dock side and close, and
 * the chat below it. A new chat is a fresh ChatView under a new id.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { useAssistantDock } from '../assistant-dock-context'
import ChatView from './chat-view'
import { useLayoutContext } from '@/shared/context/layout-context'
import { openAiSettings } from '../personal-ai/api'
import { api } from '../personal-ai/api'
import HistoryPicker from '../personal-ai/history-picker'
import type { SavedSession } from '../personal-ai/session-state'
import { useProjectContext } from '@/shared/context/project-context'

function HeaderButton({
  id,
  label,
  icon,
  unfilled = false,
  onClick,
}: {
  id: string
  label: string
  icon: string
  unfilled?: boolean
  onClick: () => void
}) {
  return (
    <OLTooltip id={id} description={label} overlayProps={{ placement: 'bottom' }}>
      <OLIconButton
        className="rail-panel-header-button-subdued"
        size="sm"
        icon={icon}
        unfilled={unfilled as any}
        accessibilityLabel={label}
        onClick={onClick}
      />
    </OLTooltip>
  )
}

export default function AssistantPanel() {
  const { t } = useTranslation()
  const { setSettingsShown } = useLayoutContext()
  const { view } = useEditorViewContext()
  const { side, moveTo, setOpen } = useAssistantDock()
  const { isOpen, setIsOpen } = useRailContext()
  const { projectId } = useProjectContext()
  const [session, setSession] = useState<SavedSession | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [error, setError] = useState('')
  const flush = useRef<() => Promise<void>>(async () => {})
  const registerFlush = useCallback((work: () => Promise<void>) => {
    flush.current = work
    return () => { if (flush.current === work) flush.current = async () => {} }
  }, [])
  const beforeChange = useCallback(async () => { await flush.current() }, [])
  const load = useCallback(async () => {
    const result = await api<SavedSession>(`/sessions/current?projectId=${projectId}&paged=true`)
    setSession(result); setError('')
  }, [projectId])
  useEffect(() => {
    let active = true
    api<SavedSession>(`/sessions/current?projectId=${projectId}&paged=true`).then(result => { if (active) setSession(result) }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [projectId])
  const selectSession = async (id: string) => {
    await beforeChange()
    const result = await api<SavedSession>(`/sessions/${id}?projectId=${projectId}&paged=true`)
    setSession(result); setEpoch(value => value + 1)
  }
  const newSession = async (skipFlush = false) => {
    if (!skipFlush) await beforeChange()
    const result = await api<SavedSession>('/sessions', { projectId })
    setSession(result); setEpoch(value => value + 1)
  }
  useEffect(() => {
    const cleared = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail.scope === 'all' || detail.projectId === projectId)
        newSession(true).catch(error => setError(error.message))
    }
    window.addEventListener('personal-ai:history-cleared', cleared)
    return () => window.removeEventListener('personal-ai:history-cleared', cleared)
  }, [projectId])

  if (!view) return null

  const close = () => {
    setOpen(false)
    // The shared rail header also closes the rail; only right for a left dock
    if (side === 'left') setIsOpen(false)
    else setIsOpen(isOpen)
  }

  return (
    <div className="d-flex flex-column h-100" data-assistant-panel="">
      <RailPanelHeader
        title="AI assistant"
        actions={
          <>
            <HistoryPicker projectId={projectId} currentId={session?.id} beforeChange={beforeChange} onSelect={selectSession} onNew={newSession} />
            <HeaderButton id="assistant-model-settings" label={ui("AI 与翻译设置")} icon="settings" onClick={() => { setSettingsShown(true); openAiSettings() }} />
            <HeaderButton
              id="assistant-new-chat"
              label={t('start_new_chat')}
              icon="edit_square"
              unfilled
              onClick={() => newSession().catch(error => setError(error.message))}
            />
            <HeaderButton
              id="assistant-dock-side"
              label={side === 'left' ? t('move_to_the_right') : t('move_to_the_left')}
              icon={side === 'left' ? 'dock_to_left' : 'dock_to_right'}
              onClick={() => moveTo(side === 'left' ? 'right' : 'left')}
            />
          </>
        }
        onClose={close}
      />
      <div className="flex-grow-1 overflow-hidden" style={{ minHeight: 0 }}>
        {error && <div className="pa-save-error" role="alert">{error}<button className="pa-text-action" onClick={() => load().catch(error => setError(error.message))}>{ui("重试加载")}</button></div>}
        {session ? <ChatView chatId={session.id} initial={session} registerFlush={registerFlush} view={view} key={`${session.id}:${epoch}`} /> : !error && <div className="pa-muted p-3" role="status">{ui("正在加载会话…")}</div>}
      </div>
    </div>
  )
}
