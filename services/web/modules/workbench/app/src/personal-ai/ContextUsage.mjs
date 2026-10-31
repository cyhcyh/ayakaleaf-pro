import { createHash } from 'node:crypto';
import { estimateTokens } from '../../../shared/context-policy.mjs';
import { isContextTool } from '../../../shared/context-checkpoint.mjs';

const digest = text => createHash('sha256').update(text).digest('base64url');
export const contextKey = value => digest(JSON.stringify(value));

function content(part, inputOnly = false) {
  if (part.type === 'step-start') return '';
  if (part.type === 'file') return JSON.stringify({ type: part.type, url: part.url, mediaType: part.mediaType });
  if (isContextTool(part)) return JSON.stringify({ type: part.type, toolCallId: part.toolCallId, input: part.input,
    ...(!inputOnly && { output: part.output, errorText: part.errorText, state: part.state }) });
  return JSON.stringify({ type: part.type, text: part.text });
}

// Persist only small signatures/counts, never a second copy of the transcript.
// Signatures invalidate same-length edits too. The expensive token estimator
// runs only on new/changed parts; object identity also skips serialization
// during the SDK's server-side loop.
export function createContextMeter(saved, estimate = estimateTokens) {
  const cache = new Map((saved?.estimates || []).map(entry => [entry.key, entry]));
  const refs = new WeakMap();
  let anchor = saved?.anchor || null;
  let evaluatedChars = 0;
  function record(message, part, index, inputOnly = false) {
    const key = `${message.id}:${index + (message.contextPartOffset || 0)}${inputOnly ? ':input' : ''}`;
    const byRef = refs.get(part)?.[inputOnly ? 'input' : 'full'];
    if (byRef && byRef.key === key) return byRef;
    const text = content(part, inputOnly);
    const hash = digest(text);
    let entry = cache.get(key);
    if (!entry || entry.hash !== hash) {
      evaluatedChars += text.length;
      const image = part.type === 'file' || part.type === 'tool-render_pdf_page' && !inputOnly && !part.output?.contextOmitted;
      entry = { key, hash, tokens: !text ? 0 : image ? 1500 : estimate(text),
        ...(isContextTool(part) && { inputHash: digest(content(part, true)), hasOutput: !inputOnly }) };
      cache.set(key, entry);
    }
    refs.set(part, { ...refs.get(part), [inputOnly ? 'input' : 'full']: entry });
    return entry;
  }
  function entries(messages, unpriced = new Set()) {
    return messages.flatMap(message => [{ key: `${message.id}:role`, hash: message.role, tokens: 16 },
      ...message.parts.map((part, index) => {
        const entry = record(message, part, index, unpriced.has(part.toolCallId));
        return unpriced.has(part.toolCallId) ? { ...entry, key: entry.key.replace(/:input$/, '') } : entry;
      })]);
  }
  function measure(messages, overhead, signature) {
    const current = entries(messages);
    const indexed = new Map(current.map(entry => [entry.key, entry]));
    let delta = 0;
    let valid = anchor?.signature === signature;
    if (valid) for (const old of anchor.entries) {
      const now = indexed.get(old.key);
      if (!now) { valid = false; break; }
      if (now.hash !== old.hash) {
        if (old.hasOutput === false && old.inputHash === now.inputHash) delta += Math.max(0, now.tokens - old.tokens);
        else { valid = false; break; }
      }
      indexed.delete(old.key);
    }
    return valid ? anchor.tokens + delta + [...indexed.values()].reduce((sum, entry) => sum + entry.tokens, 0)
      : overhead + current.reduce((sum, entry) => sum + entry.tokens, 0);
  }
  return {
    measure,
    cost: unit => unit.parts.reduce((sum, part, index) => sum + record({ ...unit.message, contextPartOffset: unit.start }, part, index).tokens, 0) + 16,
    observe(messages, usage, signature, unpriced) {
      const input = usage?.inputTokens, output = usage?.outputTokens;
      if (Number.isFinite(input) && input > 0 && Number.isFinite(output) && output >= 0)
        anchor = { signature, tokens: input + output, entries: entries(messages, new Set(unpriced || [])) };
      else anchor = null;
    },
    reset() { anchor = null; },
    snapshot(messages) {
      const wanted = new Set(entries(messages).map(entry => entry.key));
      // Input-only entries cover results the provider has not seen yet.
      for (const entry of anchor?.entries || []) { wanted.add(entry.key); if (entry.hasOutput === false) wanted.add(entry.key + ':input'); }
      return { anchor, estimates: [...cache.values()].filter(entry => wanted.has(entry.key)) };
    },
    stats: () => ({ evaluatedChars, cachedParts: cache.size }),
  };
}

export async function beginContextRun(userId, projectId, chatId, runId) {
  const { collection } = await import('./ProfileStore.mjs');
  const row = await (await collection('Sessions')).findOneAndUpdate({ _id: chatId, userId: String(userId), projectId, deleted: false },
    { $set: { contextRunId: runId } }, { returnDocument: 'after', includeResultMetadata: false, projection: { contextState: 1 } });
  if (!row) throw Object.assign(new Error('会话不存在或已被删除'), { code: 'context_compaction' });
  return row.contextState;
}

export async function saveContextState(userId, projectId, chatId, runId, state) {
  const { collection } = await import('./ProfileStore.mjs');
  // No upsert: an in-flight response must never recreate a deleted session.
  await (await collection('Sessions')).updateOne({ _id: chatId, userId: String(userId), projectId, deleted: false, contextRunId: runId },
    { $set: { contextState: { version: 1, ...state } } });
}
