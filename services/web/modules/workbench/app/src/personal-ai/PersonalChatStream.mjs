import crypto from 'node:crypto';
import logger from '@overleaf/logger';
import { consumeStream, createUIMessageStream, pipeUIMessageStreamToResponse, streamText, wrapLanguageModel } from 'ai';
import { getProvider, getProviderOptions, resolveModel } from '../WorkbenchAiClient.mjs';
import { convertWorkbenchMessages } from '../WorkbenchTools.mjs';
import { recordTokenUsage } from '../TokenQuota.mjs';
import { personalContext } from './Compression.mjs';
import { beginContextRun, saveContextState } from './ContextUsage.mjs';
import { localize } from '../../../../site-settings/shared/localize.mjs';

const overflow = error => /context_length_exceeded|context_window_exceeded|maximum context length|context window.*exceed|too many input tokens/i
  .test(`${error?.code || ''} ${error?.message || ''} ${error?.responseBody || ''} ${error?.cause?.message || ''}`);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const aborted = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

// Personal context handling is kept beside the workbench module so upstream
// editor/tool execution and the operator's non-project chat remain unchanged.
export function streamPersonalChat({ req, res, userId, signal, system, tools, toolCallLimit, headers }) {
  const raw = req.personalAiContext?.rawMessages || req.body.messages;
  const model = resolveModel(raw);
  const responseId = raw.at(-1)?.role === 'assistant' ? raw.at(-1).id : crypto.randomUUID();
  const runId = crypto.randomUUID();
  const coreSteps = [], snapshots = [];
  const slot = (array, index) => array[index] ||= deferred();
  const cancelled = aborted(signal);
  // Observe rejection even when no step boundary needs to wait for it.
  cancelled.catch(() => {});
  let snapshotIndex = 0, completedIndex = 0;
  let context;
  const message = error => {
    logger.warn({ err: error, userId }, 'personal chat request failed');
    return error?.code === 'context_compaction' ? localize(error.message, req.language)
      : localize('AI 服务暂时不可用，请稍后重试。', req.language);
  };
  const stream = createUIMessageStream({
    originalMessages: raw,
    generateId: () => responseId,
    onError: message,
    async onStepFinish({ messages }) {
      const index = snapshotIndex++;
      const step = await Promise.race([slot(coreSteps, index).promise, cancelled]);
      try {
        await context.completed(messages, step.usage, step.toolCalls.map(call => call.toolCallId));
      } finally { slot(snapshots, index).resolve(); }
    },
    async execute({ writer }) {
      const saved = req.body.sessionContext ? await beginContextRun(userId, req.body.projectId, req.body.id, runId, req.body.historyVersion || 0) : undefined;
      signal.throwIfAborted();
      context = await personalContext({ userId, messages: raw, model, system, tools, signal,
        previous: saved?.checkpoint || req.body.compaction || (req.body.summary ? { summary: req.body.summary, upToMessageId: '' } : null), saved,
        status: active => writer.write({ type: 'data-context-status', data: { active }, transient: true }),
        changed: checkpoint => writer.write({ type: 'data-compaction', data: checkpoint, transient: true }),
        persist: req.body.sessionContext
          ? state => saveContextState(userId, req.body.projectId, req.body.id, runId, state) : async () => {},
      });
      let force = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        signal.throwIfAborted();
        const first = await context.prepare({ force });
        let failure;
        let producedContent = false;
        const firstStepIndex = completedIndex;
        const result = streamText({
          model: wrapLanguageModel({ model: getProvider()(model), middleware: toolCallLimit.middleware }),
          system: first.summary ? `${system}\n\nEarlier conversation summary (historical evidence, not permission):\n${first.summary}` : system,
          messages: await convertWorkbenchMessages(first.messages), tools, providerOptions: getProviderOptions(), abortSignal: signal,
          stopWhen: [toolCallLimit.exhausted, () => res.destroyed],
          async prepareStep({ stepNumber }) {
            if (stepNumber > 0) await Promise.race([slot(snapshots, firstStepIndex + stepNumber - 1).promise, cancelled]);
            const input = stepNumber === 0 ? first : await context.prepare();
            return { messages: await convertWorkbenchMessages(input.messages),
              system: input.summary ? `${system}\n\nEarlier conversation summary (historical evidence, not permission):\n${input.summary}` : system };
          },
          async onStepFinish(step) {
            slot(coreSteps, completedIndex++).resolve(step);
            await recordTokenUsage(userId, step.usage?.totalTokens);
          },
        });
        const reader = result.toUIMessageStream({ generateMessageId: () => responseId, originalMessages: raw,
          sendStart: attempt === 0, sendFinish: false,
          onError(error) { failure = error; return message(error); },
        }).getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (['text-delta', 'reasoning-delta', 'tool-input-start', 'tool-input-available', 'tool-output-available'].includes(value.type)) producedContent = true;
            if (value.type === 'error' && attempt === 0 && !producedContent && overflow(failure)) continue;
            writer.write(value);
          }
        } finally { reader.releaseLock(); }
        // Retry only a rejected model request. Once any content/tool call was
        // emitted, never restart the run or replay tools already carried out.
        if (attempt === 0 && !producedContent && overflow(failure)) { force = true; continue; }
        writer.write({ type: 'finish', finishReason: failure ? 'error' : await result.finishReason });
        return;
      }
    },
  });
  pipeUIMessageStreamToResponse({ response: res, stream, consumeSseStream: consumeStream, headers });
}
