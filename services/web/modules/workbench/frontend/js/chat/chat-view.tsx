import { ui } from '@modules/site-settings/frontend/js/ui'
/**
 * The conversation: sends messages to /workbench/chat with the editor
 * context, runs the browser tools the model calls, keeps the server's
 * summary of older turns, and shows consent, quota and error notices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from 'ai'
import type { EditorView } from '@codemirror/view'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'
import { useEditorContext } from '@/shared/context/editor-context'
import { useEditorSelectionContext } from '@/shared/context/editor-selection-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import useAiConsent from '@/shared/hooks/use-ai-consent'
import useAbortController from '@/shared/hooks/use-abort-controller'
import AiPaywallNotification from '@/shared/components/ai-paywall-notification'
import useAiAccess from '../hooks/use-ai-access'
import { useProjectActions } from '../hooks/use-project-actions'
import { TOOLS, type Respond } from '../agent/tools'
import { AiUnavailableError, QuotaExceededError, ToolBudgetError, ToolRefusal } from '../errors'
import ConversationMessages from './conversation-messages'
import Composer, { type Draft } from './composer'
import StarterPrompts from './starter-prompts'
import ConsentCard from './consent-card'
import { AiOffNotice, ChatFailedNotice, ChatNotice, QuotaNotice } from './notices'
import { faint, plain } from './themed'
import { useProjectContext } from '@/shared/context/project-context'
import { ReviewChatContext, approve } from '../personal-ai/review-tools'
import { api, openAiSettings, type Binding } from '../personal-ai/api'
import SessionModelPicker from '../personal-ai/session-model-picker'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useSessionAutosave, type SavedSession, type Summary, type MessagePage } from '../personal-ai/session-state'
import useMessageQueue from './use-message-queue'
import MessageQueue from './message-queue'
import type { DraftContext } from './draft'
import { draftText, interruptTools, waitingForReview } from '../../../shared/chat-turn.mjs'
import { createEditRetryGuard, readEditFailure } from '../../../shared/edit-recovery.mjs'
import type { RuntimeState, SessionRuntime } from './use-session-runtimes'
import { matchesHistory } from '../personal-ai/history-events'

// The browser offers both searches; the server adds the configured ones
const SEARCH_TOOLS = ['web_search', 'search_docs']

export default function ChatView({ chatId, view, initial, active = true, registerRuntime, reportState }: {
  chatId: string; view: EditorView; initial?: SavedSession; active?: boolean
  registerRuntime?: (id: string, runtime: SessionRuntime) => (() => void)
  reportState?: (id: string, state: RuntimeState) => void
}) {
  const { projectId } = useProjectContext()
  const { setSettingsShown } = useLayoutContext()
  const reviewId = useRef<string | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const {
    hasSuggestionsLeft,
    premiumSuggestionResetDate,
    setSuggestionsLeft,
    setPremiumSuggestionResetDate,
    hasTokensLeft,
    setTokensLeft,
    tokenResetDate,
    setTokenResetDate,
  } = useEditorContext()
  const { hasGivenAiConsent } = useAiConsent()
  const defaultAccess = useAiAccess()
  const permissionEnabled = useAiAccess('enabled')
  const aiOffHere = getMeta('ol-showAiFeaturesDisabled')
  const { signal } = useAbortController()
  const actions = useProjectActions()
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const [problem, setProblem] = useState<string | boolean>(false)
  const [quotaHit, setQuotaHit] = useState(false)
  const [limitHit, setLimitHit] = useState(false)
  const queue = useMessageQueue(initial?.outbox)
  const turnComplete = useRef(false)
  const dispatching = useRef(false)
  const generation = useRef(0)
  const [transitioning, setTransitioning] = useState(false)
  const [turnVersion, setTurnVersion] = useState(0)
  const stopping = useRef<Promise<void> | null>(null)
  const editFailures = useMemo(createEditRetryGuard, [])
  const haltRepeatedEdit = useRef<() => Promise<void>>(async () => {})
  const [summary, setSummary] = useState<Summary | null>(initial?.summary || null)
  const [compacting, setCompacting] = useState(false)
  const summaryRef = useRef<Summary | null>(initial?.summary || null)
  const [binding, setBinding] = useState<Binding | null>(initial?.binding || null)
  const hasAccess = defaultAccess || (permissionEnabled && Boolean(binding))
  const bindingRef = useRef(binding)
  bindingRef.current = binding
  const [olderMessages, setOlderMessages] = useState<UIMessage[]>([])
  const [olderBefore, setOlderBefore] = useState(initial?.olderBefore ?? null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const loadingPage = useRef(false)
  const loadOlder = useCallback(async () => {
    if (olderBefore === null || loadingPage.current) return
    loadingPage.current = true; setLoadingOlder(true); setHistoryError('')
    try {
      const result = await api<MessagePage>(`/sessions/${chatId}/messages?projectId=${projectId}&before=${olderBefore}`, undefined, signal)
      setOlderMessages(current => [...result.messages, ...current])
      setOlderBefore(result.olderBefore)
    } catch (error) { if (!signal.aborted) setHistoryError((error as Error).message); throw error }
    finally { loadingPage.current = false; if (!signal.aborted) setLoadingOlder(false) }
  }, [chatId, projectId, olderBefore, signal])
  // Browser tools still running, and whether the user stopped the reply
  const running = useRef(new Set<AbortController>())
  const jobs = useRef(new Set<Promise<unknown>>())
  const [toolsRunning, setToolsRunning] = useState(0)
  const stopped = useRef(false)
  const suspended = useRef(false)
  const [deleting, setDeleting] = useState(false)
  const turnContext = useRef<DraftContext | null>(null)
  const documentRef = useRef({ view, path: '' })

  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  const path = (currentDocumentId && pathInFolder(currentDocumentId)) || 'main.tex'
  documentRef.current = { view, path }

  const now = new Date()
  const canChat =
    hasGivenAiConsent &&
    hasAccess &&
    !aiOffHere &&
    (hasSuggestionsLeft || premiumSuggestionResetDate < now) &&
    (hasTokensLeft || tokenResetDate < now)

  // Quota headers feed the core editor state that the paywall notice reads
  const readQuotaHeaders = useCallback(
    (response: Response) => {
      const header = (name: string) => response.headers.get(name)
      const resetIn = (name: string) => new Date(Date.now() + parseInt(header(name) || '0') * 1000)
      if (header('RateLimit-Reset')) {
        setPremiumSuggestionResetDate(resetIn('RateLimit-Reset'))
        setSuggestionsLeft(parseInt(header('RateLimit-Remaining') || '0'))
      }
      if (header('Token-RateLimit-Reset')) {
        setTokenResetDate(resetIn('Token-RateLimit-Reset'))
        setTokensLeft(parseInt(header('Token-RateLimit-Remaining') || '0'))
      }
    },
    [setPremiumSuggestionResetDate, setSuggestionsLeft, setTokenResetDate, setTokensLeft]
  )
  const readQuotaRef = useRef(readQuotaHeaders)
  readQuotaRef.current = readQuotaHeaders

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/workbench/chat',
        headers: { 'X-Csrf-Token': getMeta('ol-csrfToken') },
        // Turns the server summarized are replaced by the summary
        prepareSendMessagesRequest({ id, messages, trigger, messageId }) {
          const kept = summaryRef.current
          const from = kept?.upToMessageId ? messages.findIndex(m => m.id === kept.upToMessageId) + (kept.partial ? 0 : 1) : 0
          const protectedIds = new Set(kept?.protectedFirstIds || [])
          return {
            body: {
              id,
              projectId,
              reviewId: reviewId.current || undefined,
              trigger,
              messageId,
              messages: initial ? messages : messages.filter((message, index) => index >= from || protectedIds.has(message.id)),
              ...(initial && { sessionContext: true, messageOffset: initial.messageOffset || 0, binding: bindingRef.current }),
              summary: kept?.summary,
              compaction: kept || undefined,
              enabledTools: SEARCH_TOOLS,
            },
          }
        },
        async fetch(input, init) {
          const response = await fetch(input, init)
          readQuotaRef.current(response)
          if (response.status === 403) throw new AiUnavailableError()
          if (response.status === 409) throw new ToolBudgetError()
          if (response.status === 429) throw new QuotaExceededError()
          if (!response.ok) {
            const detail = await response.json().catch(() => ({}))
            throw new Error(detail.error || ui("AI 请求失败（HTTP {0}）", [response.status]))
          }
          return response
        },
      }),
    []
  )

  const { messages, setMessages, sendMessage, addToolOutput, stop, status } = useChat({
    id: chatId,
    messages: initial?.messages,
    transport,
    // A tool that ends after Stop must not start the next step
    sendAutomaticallyWhen: options =>
      !stopped.current && lastAssistantMessageIsCompleteWithToolCalls(options),
    onData(part) {
      if (part.type === 'data-context-status') setCompacting(Boolean((part.data as { active: boolean }).active))
      if (part.type === 'data-compaction') {
        summaryRef.current = part.data as Summary
        setSummary(part.data as Summary)
      }
    },
    onError(error) {
      setCompacting(false)
      turnComplete.current = false
      queue.pause()
      running.current.forEach(controller => controller.abort())
      if (error instanceof QuotaExceededError) {
        setQuotaHit(true)
      } else if (error instanceof ToolBudgetError) {
        setLimitHit(true)
      } else {
        debugConsole.error(error)
        setProblem(error.message || true)
      }
    },
    onFinish({ isAbort, isError, isDisconnect, finishReason }) {
      setCompacting(false)
      // A tool step is followed by the SDK's automatic continuation. It is
      // never the boundary at which another queued user message can run.
      turnComplete.current = !isAbort && !isError && !isDisconnect && finishReason !== 'tool-calls'
      if (isError || isDisconnect) queue.pause()
      setTurnVersion(value => value + 1)
    },
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return
      const tool = TOOLS[toolCall.toolName]
      // Server tools and the edit proposal are answered elsewhere
      if (!tool?.run) return
      // Stop and closing the panel both end the tool
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort)
      running.current.add(controller)
      setToolsRunning(running.current.size)
      try {
        const work = Promise.resolve().then(() => {
          controller.signal.throwIfAborted()
          return tool.run!(toolCall.input, {
              view: documentRef.current.view,
              openPath: documentRef.current.path,
              diagnosticsEnabled: Boolean(currentDocumentId) && (!turnContext.current || turnContext.current.path === documentRef.current.path),
              isActive: () => activeRef.current,
              actions: actionsRef.current,
              projectId,
              chatId,
              toolCallId: toolCall.toolCallId,
              signal: controller.signal,
            })
        })
        jobs.current.add(work)
        let output
        try { output = await work } finally { jobs.current.delete(work) }
        addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: output ?? null } as any)
      } catch (error) {
        const aborted = controller.signal.aborted
        const errorText = aborted ? 'Stopped by the user.' : error instanceof Error ? error.message : String(error)
        const failure = toolCall.toolName === 'propose_edit' ? readEditFailure(errorText) : null
        const repeated = !aborted && failure && editFailures.failed(toolCall.input, failure)
        if (failure) queue.pause()
        if (repeated) {
          // Set the continuation guard before publishing the failed result.
          stopped.current = true
          turnComplete.current = false
          setProblem(ui("同一条修改建议重复失败，已暂停本轮。请核对目标后再继续。"))
        }
        addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: 'output-error',
          errorText,
        } as any)
        if (repeated) {
          const epoch = generation.current
          setTimeout(() => {
            if (!signal.aborted && epoch === generation.current) haltRepeatedEdit.current().catch(error => setProblem(error.message))
          }, 0)
        }
        if (!aborted && !(error instanceof ToolRefusal)) { queue.pause(); setProblem(true) }
      } finally {
        signal.removeEventListener('abort', abort)
        running.current.delete(controller)
        setToolsRunning(running.current.size)
      }
    },
  })
  const persistence = useSessionAutosave(initial, projectId, messages, summary, status === 'streaming' || status === 'submitted', binding, queue.items, queue.current)
  const displayedMessages = useMemo(() => [...olderMessages, ...messages], [olderMessages, messages])

  const responseGeneration = generation.current
  const respond = useCallback<Respond>(output => {
    if (!stopped.current && responseGeneration === generation.current) addToolOutput(output as any)
  }, [addToolOutput, responseGeneration])

  const stopReply = useCallback(() => {
    setCompacting(false)
    if (stopping.current) return stopping.current
    stopped.current = true
    turnComplete.current = false
    queue.pause()
    generation.current++
    setTransitioning(true)
    running.current.forEach(controller => controller.abort())
    reviewId.current = null
    const work = (async () => {
      await stop()
      // File creation and already-submitted writes may have to finish. Wait
      // for their real results before starting a steering turn.
      await Promise.allSettled([...jobs.current])
      await api('/reviews/stop', { projectId, chatId }, AbortSignal.timeout(5000)).catch(() => {})
      setMessages(current => interruptTools(current, ui("工具调用已中断，尚未执行。")))
      await new Promise(resolve => setTimeout(resolve, 0))
    })().finally(() => { dispatching.current = false; stopping.current = null; setTransitioning(false) })
    stopping.current = work
    return work
  }, [stop, setMessages, projectId, chatId, queue.pause])
  const leave = useRef(stopReply)
  leave.current = stopReply
  haltRepeatedEdit.current = async () => { await stopReply(); await persistence.flush() }
  useEffect(() => () => { leave.current() }, [])
  useEffect(() => {
    const prepare = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (matchesHistory(detail, projectId, chatId)) {
        suspended.current = true
        setDeleting(true)
        detail.waitUntil(leave.current().then(() => persistence.flush()).catch(() => {}))
      }
    }
    const failed = (event: Event) => {
      if (matchesHistory((event as CustomEvent).detail, projectId, chatId)) {
        suspended.current = false
        setDeleting(false)
      }
    }
    window.addEventListener('personal-ai:history-will-clear', prepare)
    window.addEventListener('personal-ai:history-clear-failed', failed)
    return () => {
      window.removeEventListener('personal-ai:history-will-clear', prepare)
      window.removeEventListener('personal-ai:history-clear-failed', failed)
    }
  }, [projectId, chatId, persistence.flush])

  const { editorSelection } = useEditorSelectionContext()
  const selection: DraftContext['selection'] = useMemo(() => {
    const { doc } = view.state
    return (editorSelection?.ranges ?? [])
      .filter((range: any) => !range.empty)
      .map((range: any) => {
        const from = Math.min(range.from, doc.length)
        const to = Math.min(range.to, doc.length)
        return { fromLine: doc.lineAt(from).number, toLine: doc.lineAt(to).number, content: doc.sliceString(from, to) }
      })
  }, [editorSelection, view])

  const captureContext = useCallback(() => ({ path, selection }), [path, selection])
  const dispatch = useCallback(
    async (draft: Draft, id?: string, allowApproval = true) => {
      if (signal.aborted || suspended.current || !canChat || dispatching.current) throw new Error(ui("请等待当前操作结束后重试。"))
      dispatching.current = true
      editFailures.reset()
      const epoch = ++generation.current
      setProblem(false)
      setLimitHit(false)
      setQuotaHit(false)
      turnComplete.current = false
      setTransitioning(true)
      try {
      const pending = messages.at(-1)?.parts.find((part: any) => part.type === 'tool-request_review' && part.state === 'input-available') as any
      let approval: unknown = { approved: false, reason: ui("用户尚未确认，继续讨论要求。") }
      if (allowApproval && pending && /^(同意|确认|可以|开始|好的|好|同意审阅|开始审阅|同意审阅并添加评论|可以开始|按这个范围开始|yes|approve|go ahead|start)[。.!！\s]*$/i.test(draft.text.trim())) {
          const result = await approve(pending.input, projectId, chatId)
          reviewId.current = result.reviewId
          approval = result
      }
      if (epoch !== generation.current) throw new Error(ui("操作已停止。"))
      // An edit still waiting for Apply or Reject would reach the model as a
      // call without a result, which the gateway refuses
      setMessages(current =>
        interruptTools(current, ui("工具调用已中断，尚未执行。")).map((message: UIMessage) => ({
          ...message,
          parts: message.parts.map(part =>
            pending && isToolUIPart(part) && part.type === 'tool-request_review' && part.toolCallId === pending.toolCallId
              ? { ...part, state: 'output-available' as const, output: approval }
              : isToolUIPart(part) && part.type === 'tool-propose_edit' && part.state === 'input-available'
              ? {
                  ...part,
                  state: 'output-error' as const,
                  errorText: 'The user wrote again without applying or rejecting this edit; it was not applied.',
                }
              : part
          ),
        }))
      )
      stopped.current = false
      turnContext.current = draft.context || captureContext()
      const text = draftText({ ...draft, context: turnContext.current })
      const work = id
        ? sendMessage({ id, role: 'user', parts: [{ type: 'text', text }, ...draft.files] })
        : sendMessage({ text, files: draft.files })
      void work.catch(() => { queue.pause() }).finally(() => {
        if (epoch === generation.current) { dispatching.current = false; setTurnVersion(value => value + 1) }
      })
      } catch (error) { dispatching.current = false; queue.pause(); throw error }
      finally { setTransitioning(false) }
    },
    [canChat, captureContext, sendMessage, setMessages, messages, projectId, chatId, queue.pause, signal]
  )

  const working = status === 'submitted' || status === 'streaming' || toolsRunning > 0 || transitioning
  const reviewWaiting = Boolean(waitingForReview(messages))
  useEffect(() => { if (reviewWaiting) queue.pause() }, [reviewWaiting, queue.pause])
  const send = useCallback(async (draft: Draft) => {
    if (suspended.current) throw new Error(ui("请等待当前操作结束后重试。"))
    if (working || dispatching.current) {
      queue.enqueue(draft, captureContext())
      await persistence.flush().catch(() => { queue.pause() })
    }
    else await dispatch(draft)
  }, [working, queue.enqueue, queue.pause, captureContext, dispatch, persistence.flush])
  useEffect(() => { if (persistence.error) queue.pause() }, [persistence.error, queue.pause])
  useEffect(() => {
    if (working || !['ready', 'error'].includes(status) || !canChat || reviewWaiting || !turnComplete.current || queue.paused || queue.editing || !queue.items.length) return
    const timer = setTimeout(() => {
      if (dispatching.current || queue.pausedRef.current || queue.editingRef.current) return
      const item = queue.current.current[0]
      if (!item) return
      dispatch(item, item.id, false).then(() => queue.remove(item.id)).catch(error => { queue.pause(); setProblem(error.message) })
    }, 0)
    return () => clearTimeout(timer)
  }, [working, status, canChat, reviewWaiting, turnVersion, queue.items, queue.paused, queue.editing, dispatch, queue.remove, queue.pause, queue.current, queue.pausedRef, queue.editingRef])
  const steer = async (id: string) => {
    try {
      await stopReply()
      const item = queue.current.current.find(item => item.id === id)
      if (!item) return
      await dispatch(item, item.id, false)
      queue.remove(id)
      queue.pause(false)
    } catch (error) { queue.pause(); setProblem((error as Error).message) }
  }

  const runtimeState = useRef<RuntimeState>({ working: false, retain: true })
  runtimeState.current = { working: working && !deleting,
    retain: deleting || working || dispatching.current || reviewWaiting || queue.items.length > 0 || Boolean(persistence.error) }
  const suspend = useCallback((value: boolean) => { suspended.current = value; setDeleting(value) }, [])
  useEffect(() => registerRuntime?.(chatId, {
    flush: persistence.flush,
    stopAndFlush: async () => { await leave.current(); await persistence.flush() },
    rename: persistence.rename,
    suspend,
    state: () => runtimeState.current,
  }), [chatId, registerRuntime, persistence.flush, persistence.rename, suspend])
  const { working: runtimeWorking, retain } = runtimeState.current
  useEffect(() => { reportState?.(chatId, { working: runtimeWorking, retain }) }, [chatId, reportState, runtimeWorking, retain])

  // A hidden conversation still streams, saves and executes its tools. Its
  // message list and composer are rendered only when the user opens it.
  if (!active) return null

  const selectionNote = selection.length
    ? { path, lines: selection.map(r => (r.fromLine === r.toLine ? r.fromLine : `${r.fromLine}-${r.toLine}`)).join(', ') }
    : undefined

  let body
  if (!hasAccess && messages.length === 0) {
    body = <div className="pa-empty m-3"><h4>{ui("连接你的 AI 助手")}</h4><p>{ui("在个人设置中添加模型服务或登录 Codex，即可对话、阅读参考资料和审阅论文。")}</p><button className="btn btn-primary btn-sm" onClick={() => { setSettingsShown(true); openAiSettings() }}>{ui("配置模型连接")}</button></div>
  } else if (hasAccess && !hasGivenAiConsent && messages.length === 0) {
    body = <ConsentCard />
  } else if (messages.length === 0) {
    body = (
      <StarterPrompts
        withSelection={selection.length > 0}
        onPick={text => send({ text, files: [] })}
        disabled={!canChat}
      />
    )
  } else {
    body = <ConversationMessages messages={displayedMessages} streaming={status === 'streaming'} respond={respond} summary={summary}
      hasOlder={olderBefore !== null} loadingOlder={loadingOlder} historyError={historyError} loadOlder={loadOlder} />
  }

  return (
    <ReviewChatContext.Provider value={{ projectId, chatId, onApproved: id => {
      if (!stopped.current && responseGeneration === generation.current) reviewId.current = id
    } }}>
    {/* Match the editor panel's body text size. */}
    <div className="d-flex flex-column h-100" style={{ ...plain, fontSize: 'var(--font-size-02)' }}>
      <div
        className={`flex-grow-1 ${messages.length ? 'd-flex flex-column overflow-hidden' : 'overflow-auto p-2'}`}
        // A flex item is as tall as its content unless allowed to shrink
        style={{ minHeight: 0 }}
      >
        {body}
        {aiOffHere && <AiOffNotice />}
      </div>
      {hasAccess &&
        (getMeta('ol-showAiFeatures') ? (
          <AiPaywallNotification isActionBelowContent featureLocation="workbench" />
        ) : (
          !hasTokensLeft && tokenResetDate > now && <QuotaNotice resetsAt={tokenResetDate} />
        ))}
      <div data-chat-input="">
        {compacting && <div className="pa-context-status" role="status" aria-live="polite"><span className="spinner-border spinner-border-sm" aria-hidden="true" />{ui("正在整理上下文…")}</div>}
        {problem && !quotaHit && (
          typeof problem === 'string' ? <ChatNotice type="error" text={problem} /> : <ChatFailedNotice />
        )}
        {limitHit && <div className="assistant-turn-limit" role="status"><p>{ui("本轮工具调用已达上限。可以继续当前任务，已有结果会保留。")}</p>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!canChat || working} onClick={() => dispatch({ text: ui("继续当前任务。"), files: [] }, undefined, false).then(() => queue.pause(false)).catch(error => setProblem(error.message))}>{ui("继续当前任务")}</button></div>}
        <MessageQueue items={queue.items} paused={queue.paused} editing={queue.editing} disabled={transitioning} canSteer={canChat}
          canResume={canChat && !working && !reviewWaiting && !limitHit && !quotaHit && !persistence.error}
          onResume={() => { setProblem(false); turnComplete.current = true; queue.pause(false) }} onSteer={steer} onRemove={queue.remove}
          onEdit={queue.edit} onSave={queue.save} onProblem={message => setProblem(message)} />
        <Composer
          disabled={!canChat || deleting}
          working={working}
          selectionNote={selectionNote}
          onSend={send}
          onStop={stopReply}
          onProblem={message => setProblem(message)}
          captureContext={captureContext}
          modelPicker={<SessionModelPicker value={binding} onChange={setBinding} disabled={!permissionEnabled || status === 'submitted' || status === 'streaming' || toolsRunning > 0}
            onManage={() => { setSettingsShown(true); openAiSettings() }} />}
        />
        {/* One line, or a break after the first sentence */}
        <p
          className="d-flex flex-wrap justify-content-center mb-2"
          style={{ ...faint, fontSize: 'var(--font-size-01)', columnGap: '0.5ch' }}
        >
          <span className="text-nowrap">{ui("请核对回答和修改建议。")}</span>
        </p>
      </div>
      {persistence.error && <div className="pa-save-error" role="alert">{ui("会话尚未保存：")}{persistence.error}<button className="pa-text-action" onClick={() => persistence.flush().catch(() => {})}>{ui("重试保存")}</button></div>}
      {persistence.saving && <small className="pa-muted text-center pb-1" role="status">{ui("正在保存会话…")}</small>}
    </div>
    </ReviewChatContext.Provider>
  )
}
