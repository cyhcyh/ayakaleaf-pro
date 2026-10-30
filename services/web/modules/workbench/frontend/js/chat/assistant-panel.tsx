import { ui } from '@modules/site-settings/frontend/js/ui'
/**
 * The assistant's panel: a header with new chat, dock side and close, and
 * the chat below it. Running conversations stay mounted when another opens.
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
import useSessionRuntimes from './use-session-runtimes'
import { matchesHistory, connectHistoryEvents } from '../personal-ai/history-events'

function HeaderButton({
  id,
  label,
  icon,
  unfilled = false,
  disabled = false,
  onClick,
}: {
  id: string
  label: string
  icon: string
  unfilled?: boolean
  disabled?: boolean
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
        disabled={disabled}
      />
    </OLTooltip>
  )
}

export default function AssistantPanel() {
  const { t } = useTranslation()
  const { setSettingsShown } = useLayoutContext()
  const { view } = useEditorViewContext()
  const lastView = useRef(view)
  if (view) lastView.current = view
  const editorView = view || lastView.current
  const { side, open: assistantOpen, moveTo, setOpen } = useAssistantDock()
  const { isOpen, selectedTab, setIsOpen } = useRailContext()
  const { projectId } = useProjectContext()
  const runtimes = useSessionRuntimes()
  const { currentId, sessions, activate, register, report, controls, activity, remove } = runtimes
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState('')
  useEffect(connectHistoryEvents, [])
  const current = useRef(currentId)
  current.current = currentId
  const beforeChange = useCallback(async () => { await controls.current.get(current.current || '')?.flush() }, [controls])
  const stopCurrent = useCallback(async () => { await controls.current.get(current.current || '')?.stopAndFlush() }, [controls])
  const visible = side === 'right' ? assistantOpen : isOpen && selectedTab === 'workbench'
  const closed = side === 'right' ? !assistantOpen : !isOpen && selectedTab === 'workbench'
  const wasVisible = useRef(visible)
  useEffect(() => {
    // The rail keeps its portal mounted when hidden. Closing it must still
    // stop the turn, pause the queue and save, while changing dock preserves it.
    if (wasVisible.current && !visible && closed) stopCurrent().catch(error => setError(error.message))
    wasVisible.current = visible
  }, [visible, closed, stopCurrent])
  const load = useCallback(async () => {
    const result = await api<SavedSession>(`/sessions/current?projectId=${projectId}&paged=true`)
    activate(result); setError('')
  }, [projectId, activate])
  useEffect(() => {
    let active = true
    api<SavedSession>(`/sessions/current?projectId=${projectId}&paged=true`).then(result => { if (active) activate(result) }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [projectId, activate])
  const selectSession = async (id: string) => {
    setChanging(true)
    try {
      await beforeChange()
      const mounted = sessions.find(session => session.id === id)
      const result = mounted
        ? (await api(`/sessions/${id}/activate`, { projectId }), mounted)
        : await api<SavedSession>(`/sessions/${id}?projectId=${projectId}&paged=true`)
      activate(result)
    } finally { setChanging(false) }
  }
  const newSession = async (skipFlush = false) => {
    setChanging(true)
    try {
      if (!skipFlush) await beforeChange()
      activate(await api<SavedSession>('/sessions', { projectId }))
    } finally { setChanging(false) }
  }
  useEffect(() => {
    const cleared = (event: Event) => {
      const detail = (event as CustomEvent).detail
      const removed = new Set(sessions.filter(session => matchesHistory(detail, projectId, session.id)).map(session => session.id))
      remove(removed)
      if (currentId && removed.has(currentId)) newSession(true).catch(error => setError(error.message))
    }
    window.addEventListener('personal-ai:history-cleared', cleared)
    return () => window.removeEventListener('personal-ai:history-cleared', cleared)
  }, [projectId, sessions, currentId, remove])

  const renameSession = async (id: string, title: string) => {
    const runtime = controls.current.get(id)
    if (runtime) { await runtime.flush(); await runtime.rename(title) }
    else await api(`/sessions/${id}/rename`, { projectId, title })
  }

  if (!editorView) return null

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
            <HistoryPicker projectId={projectId} currentId={currentId} workingIds={Object.keys(activity).filter(id => activity[id].working)}
              disabled={changing} onRename={renameSession} onSelect={selectSession} onNew={newSession} />
            <HeaderButton id="assistant-model-settings" label={ui("AI 与翻译设置")} icon="settings" onClick={() => { setSettingsShown(true); openAiSettings() }} />
            <HeaderButton
              id="assistant-new-chat"
              label={t('start_new_chat')}
              icon="edit_square"
              unfilled
              disabled={changing}
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
        {sessions.map(session => <ChatView chatId={session.id} initial={session} registerRuntime={register} reportState={report}
          active={session.id === currentId} view={editorView} key={session.id} />)}
        {!currentId && !error && <div className="pa-muted p-3" role="status">{ui("正在加载会话…")}</div>}
      </div>
    </div>
  )
}
