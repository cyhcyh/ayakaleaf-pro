import { once } from 'node:events';

// Keep the existing JSON endpoint available. Only the interactive translator
// uses this small SSE transport, for either an API model or Codex.
export async function sendTranslationStream(req, res, run) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', abort);
  const send = async value => {
    controller.signal.throwIfAborted();
    const ready = res.write(`data: ${JSON.stringify(value)}\n\n`);
    res.flush?.();
    if (!ready) {
      await once(res, 'drain', { signal: controller.signal });
    }
  };
  try {
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const result = await run(controller.signal, text => send({ type: 'delta', text }));
    await send({ type: 'done', result });
  } catch (error) {
    if (!controller.signal.aborted) await send({ type: 'error', error: error instanceof Error ? error.message : '翻译未完成' }).catch(() => {});
  } finally {
    req.removeListener('aborted', abort);
    res.removeListener('close', abort);
    if (!res.destroyed) res.end();
  }
}
