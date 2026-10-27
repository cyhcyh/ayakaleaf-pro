export const DEFAULT_CONTEXT_WINDOW = 256000;
export const DEFAULT_SUMMARY_OUTPUT = 8192;

export function contextBudget(manual, reported) {
  const known = Number.isFinite(reported) && reported > 0 ? reported : 0;
  return manual > 0 ? known ? Math.min(manual, known) : manual : known || DEFAULT_CONTEXT_WINDOW;
}

export function summaryBudget(policy, chatWindow, summaryWindow, outputLimit) {
  return Math.min(policy.summaryMaxTokens || Infinity, Math.floor(chatWindow * policy.targetRatio),
    outputLimit > 0 ? outputLimit : DEFAULT_SUMMARY_OUTPUT, Math.floor(summaryWindow / 3));
}
