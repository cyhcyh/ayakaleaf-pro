import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { protectMath } from '../shared/math-protection.mjs';
import { translationFrames } from '../shared/translation-stream.mjs';
import { layoutEditCards, revealEditDelta } from '../shared/edit-panel-layout.mjs';
import { sendTranslationStream } from '../app/src/personal-ai/TranslationStream.mjs';

test('every streamed prefix withholds split formula markers and restores whole formulas', () => {
  const math = protectMath('A $L=D-A$ and \\[x^2+y^2\\].', 'stream-fixture');
  const complete = math.restore(math.text);
  let previous = '';
  for (let end = 1; end <= math.text.length; end++) {
    const visible = math.restorePartial(math.text.slice(0, end));
    assert.ok(visible.startsWith(previous));
    assert.ok(complete.startsWith(visible));
    assert.ok(!visible.includes('ZXQMATHTOKEN'));
    previous = visible;
  }
  assert.equal(previous, complete);
  assert.throws(() => math.restore('missing formulas'), /数学公式/);
});

test('translation SSE frames survive arbitrary byte boundaries and multibyte text', () => {
  const expected = [{ type: 'delta', text: '中文 $L=D-A$\n下一行' }, { type: 'done', result: { translatedText: '中文' } }];
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\n' + expected.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join(''));
  for (const size of [1, 2, 7, bytes.length]) {
    const decoder = new TextDecoder(), parse = translationFrames(), received = [];
    for (let at = 0; at < bytes.length; at += size) received.push(...parse(decoder.decode(bytes.slice(at, at + size), { stream: true })));
    received.push(...parse(decoder.decode()));
    assert.deepEqual(received, expected);
  }
});

test('anchored cards retain source order around the selected card without overlap', () => {
  const cards = [{ id: 'a', top: 10, height: 200 }, { id: 'b', top: 60, height: 150 }, { id: 'c', top: 80, height: 180 }];
  const { positions, bottom } = layoutEditCards(cards, 'b');
  assert.ok(positions.get('a') >= 44);
  assert.ok(positions.get('b') >= 60);
  assert.ok(positions.get('a') + 200 < positions.get('b'));
  assert.ok(positions.get('b') + 150 < positions.get('c'));
  assert.equal(bottom, positions.get('c') + 180);
  assert.equal(revealEditDelta(30, 150, 50, 650), -20);
  assert.equal(revealEditDelta(550, 150, 50, 650), 50);
  assert.equal(revealEditDelta(250, 150, 50, 650), 0);
});

test('dense cards remain reachable below the filter bar when a later card is focused', () => {
  const cards = [
    { id: 'line12', top: 240, height: 154 },
    { id: 'line15', top: 300, height: 154 },
    { id: 'line16', top: 330, height: 154 },
    { id: 'line19', top: 468.1875, height: 154 },
  ];
  for (const focused of cards) {
    for (const minimumTop of [44, 80]) {
      const { positions, bottom } = layoutEditCards(cards, focused.id, minimumTop);
      assert.ok(positions.get(cards[0].id) >= minimumTop);
      for (let i = 1; i < cards.length; i++) {
        assert.ok(positions.get(cards[i].id) >= positions.get(cards[i - 1].id) + cards[i - 1].height + 4);
      }
      assert.equal(bottom, positions.get('line19') + cards.at(-1).height);
    }
  }
  cards[0].height = 420;
  const expanded = layoutEditCards(cards, 'line19', 44);
  assert.equal(expanded.positions.get('line12'), 44);
  assert.ok(expanded.bottom > 44 + cards.reduce((height, card) => height + card.height, 0));
});

test('translation transport sends early text, preserves partial errors and cancels upstream work', async () => {
  let aborted = false;
  const server = http.createServer((req, res) => {
    res.set = headers => { for (const [name, value] of Object.entries(headers)) res.setHeader(name, value); };
    sendTranslationStream(req, res, async (signal, onText) => {
      await onText('第一段');
      if (req.url === '/cancel') {
        await new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
        signal.throwIfAborted();
      }
      await new Promise(resolve => setTimeout(resolve, 60));
      if (req.url === '/error') throw new Error('连接失败');
      await onText('第二段');
      return { translatedText: '第一段第二段', source: 'auto' };
    }).catch(error => { if (!res.destroyed) res.destroy(error); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(url), reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes('第一段')); assert.ok(!first.includes('第二段'));
    const rest = await new Response(new ReadableStream({ async start(controller) {
      while (true) { const part = await reader.read(); if (part.done) break; controller.enqueue(part.value); } controller.close();
    } })).text();
    assert.ok(rest.includes('第二段')); assert.ok(rest.includes('"done"'));
    const failure = await (await fetch(url + '/error')).text();
    assert.ok(failure.includes('第一段')); assert.ok(failure.includes('连接失败')); assert.ok(!failure.includes('"done"'));
    const controller = new AbortController();
    const cancel = await fetch(url + '/cancel', { signal: controller.signal });
    await cancel.body.getReader().read(); controller.abort();
    for (let i = 0; i < 30 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(aborted, true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
