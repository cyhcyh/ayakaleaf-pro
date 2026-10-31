import { streamText } from 'ai';
import { loadProfile } from './ProfileStore.mjs';
import { currentConfig, withUserAi, resolveConfig } from './Runtime.mjs';
import { getProvider, getProviderOptions, resolveModel } from '../WorkbenchAiClient.mjs';
import { recordTokenUsage } from '../TokenQuota.mjs';
import { estimateTokens } from '../../../shared/context-policy.mjs';
import { contextBudget, summaryBudget } from '../../../shared/compression-budget.mjs';
import { createContextManager, SUMMARY_PROMPT } from './ContextManager.mjs';

export async function personalContext(options) {
  const policy = (await loadProfile(options.userId)).compression;
  const live = currentConfig();
  const window = contextBudget(policy.contextWindow, live?.capabilities?.contextWindow || 0);
  const reserve = Math.max(256, Math.min(live?.capabilities?.outputLimit || 8192, Math.floor(window * .12)));
  let summarizer;
  return createContextManager({ ...options, policy, window, reserve,
    modelKey: { connection: live?.id || live?.connectionId, kind: live?.kind, baseURL: live?.baseURL,
      model: options.model, reasoningEffort: live?.reasoningEffort },
    async summarize(previous, material, signal) {
      summarizer ||= await resolveConfig(options.userId, 'compression');
      const summaryWindow = contextBudget(policy.summaryContextWindow, summarizer?.capabilities?.contextWindow || 0);
      const output = summaryBudget(policy, window, summaryWindow, summarizer?.capabilities?.outputLimit || 0);
      const capacity = Math.floor(summaryWindow - output - estimateTokens(SUMMARY_PROMPT) - 768);
      if (output < 256 || capacity < 512) throw new Error('上下文或摘要预算过小，请调整压缩设置');
      let text = previous || '';
      let at = 0;
      while (at < material.length) {
        signal?.throwIfAborted();
        // Conservative character-sized batches also fit Chinese and TeX.
        const room = capacity - estimateTokens(text);
        if (room < 256) throw new Error('摘要仍过长，请降低摘要长度上限或增加压缩模型容量');
        const batch = material.slice(at, at + room);
        const result = await withUserAi(options.userId, 'compression', async () => {
          const stream = streamText({ model: getProvider()(resolveModel()), providerOptions: getProviderOptions(), system: SUMMARY_PROMPT,
            prompt: `Previous summary:\n${text}\n\nHistorical material to merge (continued in order):\n${batch}\n\nKeep the result within approximately ${output} tokens.`,
            maxOutputTokens: output,
            abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
          });
          const value = await stream.text;
          await recordTokenUsage(options.userId, (await stream.totalUsage)?.totalTokens);
          return value;
        });
        if (!result?.trim()) throw new Error('压缩模型没有返回摘要，原会话和摘要已保留，请重试');
        if (estimateTokens(result) > Math.min(capacity - 256, Math.max(output * 1.5, 512)))
          throw new Error('摘要仍过长，请降低摘要长度上限或增加压缩模型容量');
        text = result;
        at += batch.length;
      }
      return text;
    },
  });
}
