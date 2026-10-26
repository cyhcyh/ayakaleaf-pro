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
import MessageView, { CONTEXT_OPEN } from './message-view'
import Composer, { type Draft } from './composer'
import StarterPrompts from './starter-prompts'
import ConsentCard from './consent-card'
import { AiOffNotice, ChatFailedNotice, ChatNotice, QuotaNotice } from './notices'
import { faint, muted, plain, ruleAbove } from './themed'
import { useProjectContext } from '@/shared/context/project-context'
import { ReviewChatContext, approve } from '../personal-ai/review-tools'
import { api, openAiSettings } from '../personal-ai/api'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useSessionAutosave, type SavedSession, type Summary } from '../personal-ai/session-state'

// The browser offers both searches; the server adds the configured ones
const SEARCH_TOOLS = ['web_search', 'search_docs']

/** Set by the server when it summarizes turns up to and including a message. */
type Selection = { fromLine: number; toLine: number; content: string }

/** Settles with work, or rejects as soon as the signal aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    work.then(resolve, reject)
  })
}

function contextBlock(path: string, selection: Selection[]) {
  const lines = [CONTEXT_OPEN, `Open file: ${path}`]
  for (const range of selection) {
    lines.push(`Selected lines ${range.fromLine}-${range.toLine}:`, range.content)
  }
  lines.push('</editor-context>')
  return lines.join('\n')
}

/** Keeps the newest message in view unless the user has scrolled up. */
function useFollowBottom(trigger: unknown) {
  const box = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useEffect(() => {
    const element = box.current
    if (element && following.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [trigger])
  const onScroll = useCallback(() => {
    const element = box.current
    if (element) {
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
    }
  }, [])
  return { box, onScroll }
}

export default function ChatView({ chatId, view, initial, registerFlush }: { chatId: string; view: EditorView; initial?: SavedSession; registerFlush?: (flush: () => Promise<void>) => (() => void) }) {
  const { projectId } = useProjectContext()
  const { setSettingsShown } = useLayoutContext()
  const reviewId = useRef<string | null>(null)
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
  const hasAccess = useAiAccess()
  const aiOffHere = getMeta('ol-showAiFeaturesDisabled')
  const { signal } = useAbortController()
  const actions = useProjectActions()
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const [problem, setProblem] = useState<string | boolean>(false)
  const [quotaHit, setQuotaHit] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(initial?.summary || null)
  const summaryRef = useRef<Summary | null>(initial?.summary || null)
  // The open file the model was last told about
  const toldPath = useRef<string | null>(null)
  // Browser tools still running, and whether the user stopped the reply
  const running = useRef(new Set<AbortController>())
  const [toolsRunning, setToolsRunning] = useState(0)
  const stopped = useRef(false)

  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  const path = (currentDocumentId && pathInFolder(currentDocumentId)) || 'main.tex'

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
          const from = kept ? messages.findIndex(m => m.id === kept.upToMessageId) + 1 : 0
          const protectedIds = new Set(kept?.protectedFirstIds || [])
          return {
            body: {
              id,
              projectId,
              reviewId: reviewId.current || undefined,
              trigger,
              messageId,
              messages: messages.filter((message, index) => index >= from || protectedIds.has(message.id)),
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
            throw new Error(detail.error || `AI 请求失败（HTTP ${response.status}）`)
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
      if (part.type === 'data-compaction') {
        summaryRef.current = part.data as Summary
        setSummary(part.data as Summary)
      }
    },
    onError(error) {
      if (error instanceof QuotaExceededError) {
        setQuotaHit(true)
      } else if (error instanceof ToolBudgetError) {
        setProblem(error.message)
      } else {
        debugConsole.error(error)
        setProblem(error.message || true)
      }
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
        const output = await untilAborted(
          Promise.resolve().then(() =>
            tool.run!(toolCall.input, {
              view,
              openPath: path,
              actions: actionsRef.current,
              projectId,
              chatId,
              signal: controller.signal,
            })
          ),
          controller.signal
        )
        addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: output ?? null } as any)
      } catch (error) {
        const aborted = controller.signal.aborted
        addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: 'output-error',
          errorText: aborted
            ? 'Stopped by the user.'
            : error instanceof Error
              ? error.message
              : String(error),
        } as any)
        if (!aborted && !(error instanceof ToolRefusal)) setProblem(true)
      } finally {
        signal.removeEventListener('abort', abort)
        running.current.delete(controller)
        setToolsRunning(running.current.size)
      }
    },
  })
  const persistence = useSessionAutosave(initial, projectId, messages, summary, status === 'streaming' || status === 'submitted')

  // A new chat must not keep running when the panel goes away
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(
    () => () => {
      stopRef.current()
    },
    []
  )

  const respond = useCallback<Respond>(output => addToolOutput(output as any), [addToolOutput])

  const stopReply = useCallback(() => {
    stopped.current = true
    running.current.forEach(controller => controller.abort())
    stop()
    reviewId.current = null
    api('/reviews/stop', { projectId, chatId }).catch(() => {})
  }, [stop, projectId, chatId])
  const leave = useRef(stopReply)
  leave.current = stopReply
  useEffect(() => registerFlush?.(async () => { leave.current(); await persistence.flush() }), [registerFlush, persistence.flush])

  const { editorSelection } = useEditorSelectionContext()
  const selection: Selection[] = useMemo(() => {
    const { doc } = view.state
    return (editorSelection?.ranges ?? [])
      .filter((range: any) => !range.empty)
      .map((range: any) => {
        const from = Math.min(range.from, doc.length)
        const to = Math.min(range.to, doc.length)
        return { fromLine: doc.lineAt(from).number, toLine: doc.lineAt(to).number, content: doc.sliceString(from, to) }
      })
  }, [editorSelection, view])

  const send = useCallback(
    async (draft: Draft) => {
      if (!canChat) return
      setProblem(false)
      stopped.current = false
      const pending = messages.at(-1)?.parts.find((part: any) => part.type === 'tool-request_review' && part.state === 'input-available') as any
      let approval: unknown = { approved: false, reason: '用户尚未确认，继续讨论要求。' }
      if (pending && /^(同意|确认|可以|开始|好的|好|同意审阅|开始审阅|同意审阅并添加评论|可以开始|按这个范围开始|yes|approve|go ahead|start)[。.!！\s]*$/i.test(draft.text.trim())) {
        try {
          const result = await approve(pending.input, projectId, chatId)
          reviewId.current = result.reviewId
          approval = result
        } catch (error) { setProblem((error as Error).message); return }
      }
      // An edit still waiting for Apply or Reject would reach the model as a
      // call without a result, which the gateway refuses
      setMessages(current =>
        current.map(message => ({
          ...message,
          parts: message.parts.map(part =>
            pending && isToolUIPart(part) && part.type === 'tool-request_review' && part.state === 'input-available'
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
      // The context goes with the first message, whenever text is selected
      // and when another file is open than the model was last told
      const withContext =
        toldPath.current !== path || selection.length > 0
          ? `${draft.text}\n\n${contextBlock(path, selection)}`
          : draft.text
      toldPath.current = path
      sendMessage({ text: withContext, files: draft.files })
    },
    [canChat, path, selection, sendMessage, setMessages, messages, projectId, chatId]
  )

  const { box, onScroll } = useFollowBottom(messages)
  const selectionNote = selection.length
    ? `${path.split('/').pop()}: ${selection.map(r => (r.fromLine === r.toLine ? r.fromLine : `${r.fromLine}-${r.toLine}`)).join(', ')}`
    : undefined

  let body
  if (!hasAccess && messages.length === 0) {
    body = <div className="pa-empty m-3"><h4>连接你的 AI 助手</h4><p>在个人设置中添加模型服务或登录 Codex，即可对话、阅读参考资料和审阅论文。</p><button className="btn btn-primary btn-sm" onClick={() => { setSettingsShown(true); openAiSettings() }}>配置模型连接</button></div>
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
    body = messages.map((message: UIMessage) => (
      <div className="d-flex flex-column gap-2" key={message.id}>
        <MessageView
          message={message}
          streaming={status === 'streaming' && message.id === messages.at(-1)?.id}
          respond={respond}
        />
        {message.id === summary?.upToMessageId && (
          <div className="small text-center pt-1" style={{ ...muted, ...ruleAbove }}>
            以上早期对话已整理为摘要，完整记录仍保留在此会话。
          </div>
        )}
      </div>
    ))
  }

  return (
    <ReviewChatContext.Provider value={{ projectId, chatId, onApproved: id => { reviewId.current = id } }}>
    {/* Match the editor panel's body text size. */}
    <div className="d-flex flex-column h-100" style={{ ...plain, fontSize: 'var(--font-size-02)' }}>
      <div
        ref={box}
        onScroll={onScroll}
        className="flex-grow-1 overflow-auto p-2 d-flex flex-column gap-3"
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
      <div data-chat-input="" {...(canChat ? {} : ({ inert: '' } as any))} className={canChat ? undefined : 'opacity-50'}>
        {problem && !quotaHit && (
          typeof problem === 'string' ? <ChatNotice type="error" text={problem} /> : <ChatFailedNotice />
        )}
        <Composer
          working={status === 'submitted' || status === 'streaming' || toolsRunning > 0}
          selectionNote={selectionNote}
          onSend={send}
          onStop={stopReply}
          onProblem={message => setProblem(message)}
        />
        {/* One line, or a break after the first sentence */}
        <p
          className="d-flex flex-wrap justify-content-center mb-2"
          style={{ ...faint, fontSize: 'var(--font-size-01)', columnGap: '0.5ch' }}
        >
          <span className="text-nowrap">AI can make mistakes.</span>
          <span className="text-nowrap">Always check responses.</span>
        </p>
      </div>
      {persistence.error && <div className="pa-save-error" role="alert">会话尚未保存：{persistence.error}<button className="pa-text-action" onClick={() => persistence.flush().catch(() => {})}>重试保存</button></div>}
      {persistence.saving && <small className="pa-muted text-center pb-1" role="status">正在保存会话…</small>}
    </div>
    </ReviewChatContext.Provider>
  )
}
