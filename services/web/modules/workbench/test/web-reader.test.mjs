import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { webpageLinks, linkPage } from '../app/src/personal-ai/WebLinks.mjs';
import { readPublicURL, publicAddresses } from '../app/src/personal-ai/PublicWeb.mjs';
import { WebReadError, webReadErrorMessage, webNetworkError } from '../app/src/personal-ai/WebReadErrors.mjs';

test('HTML links resolve against the final page/base, decode entities and keep exact query/fragment distinctions', () => {
  const { links } = webpageLinks(`<a href="../first">Before base</a><base href="/docs/"><base href="https://other.example/">
    <a href='rules.pdf?a=1&amp;b=2'><b>Rules</b> &copy; &amp; &#x4E2D;</a>
    <a href="rules.pdf?a=1&amp;b=2">Duplicate</a><a href="rules.pdf?a=2&amp;b=2">Page 2</a>
    <a href="#one">Section 1</a><a href="#two">Section 2</a>
    <a href="http://example.org/docs/rules.pdf">HTTP</a>
    <a href="mailto:test@example.org">Email</a><a href="tel:123">Call</a><a href="javascript:alert(1)">Script</a>`, 'https://example.org/final/index.html');
  assert.equal(links.length, 6);
  assert.equal(links[0].url, 'https://example.org/first');
  assert.deepEqual(links[1], { text: 'Rules © & 中', url: 'https://example.org/docs/rules.pdf?a=1&b=2' });
  assert.equal(links[2].url, 'https://example.org/docs/rules.pdf?a=2&b=2');
  assert.equal(links[3].url, 'https://example.org/docs/#one');
  assert.equal(links[4].url, 'https://example.org/docs/#two');
  assert.ok(links[5].url.startsWith('http://'));
});

test('link extraction handles unquoted/uppercase attributes, image and accessibility labels without executing HTML', () => {
  const result = webpageLinks(`<script><a href='/fake'>Fake</a></script><style>.bad{}</style>
    <A HREF=/real><img src=x alt="Image &amp; label"></A>
    <a href=/label aria-label="Accessible &amp; label"></a><a href=/literal>&amp;lt;tag&amp;gt;</a>`, 'https://example.org/');
  assert.deepEqual(result.links.map(link => link.text), ['Image & label', 'Accessible & label', '&lt;tag&gt;']);
  assert.ok(!result.links.some(link => link.url.includes('fake')));
});

test('link pages obey both limits and can be resumed without dropping or changing destinations', () => {
  const catalog = webpageLinks(Array.from({ length: 123 }, (_, i) => `<a href="/page?i=${i}">${'😀'.repeat(140)}</a>`).join(''), 'https://example.org/');
  assert.ok(catalog.links.every(link => [...link.text].length === 120));
  let offset = 0, found = [];
  do {
    const page = linkPage(catalog, offset);
    assert.ok(page.links.length > 0 && page.links.length <= 50);
    assert.ok(JSON.stringify(page.links).length <= 8000);
    assert.equal(page.linksRemaining, 123 - offset - page.links.length);
    found.push(...page.links); offset = page.nextLinkOffset;
  } while (offset !== null);
  assert.deepEqual(found, catalog.links);
  assert.deepEqual(linkPage(catalog, 500).links, []);
  assert.equal(linkPage({ links: [], unreadableLinkCount: 0 }).nextLinkOffset, null);
  const short = webpageLinks(Array.from({ length: 70 }, (_, i) => `<a href=/${i}>Short</a>`).join(''), 'https://example.org/');
  assert.equal(linkPage(short).links.length, 50);
  assert.equal(linkPage(short, 50).links.length, 20);
});

test('URLs keep all characters; URLs beyond the existing tool input limit are counted explicitly', () => {
  const url = 'https://example.org/?q=' + 'x'.repeat(1950);
  const catalog = webpageLinks(`<a href="${url}">Full</a><a href="${url}more${'x'.repeat(100)}">Too long</a>`, 'https://example.org/');
  assert.equal(catalog.links[0].url, url);
  assert.equal(catalog.unreadableLinkCount, 1);
  const page = linkPage(catalog);
  assert.equal(page.unreadableLinkCount, 1);
  assert.match(page.linkNote, /2000/);
});

function network(t, handler, lookup = async () => [{ address: '8.8.8.8', family: 4 }]) {
  t.mock.method(dns, 'lookup', lookup);
  const get = (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = error => { queueMicrotask(() => request.emit('error', error)); };
    queueMicrotask(() => {
      const value = handler(url, options);
      if (value instanceof Error) { request.emit('error', value); return; }
      const response = Readable.from([Buffer.from(value.body || 'Page')]);
      response.statusCode = value.status || 200;
      response.headers = { 'content-type': 'text/html', ...value.headers };
      callback(response);
    });
    return request;
  };
  t.mock.method(http, 'get', get); t.mock.method(https, 'get', get);
}

test('HTTP/HTTPS requests retain pinned DNS, their final URL, and relative redirects', async t => {
  const requests = [];
  network(t, (url, options) => {
    requests.push(url.href);
    options.lookup(url.hostname, {}, (_, address) => assert.equal(address, '8.8.8.8'));
    return requests.length === 1 ? { status: 302, headers: { location: 'https://example.org/final' } } : { body: 'Final body' };
  });
  const result = await readPublicURL('http://example.org/start');
  assert.deepEqual(requests, ['http://example.org/start', 'https://example.org/final']);
  assert.equal(result.url, requests[1]); assert.equal(result.data.toString(), 'Final body');
});

for (const [status, headers, kind] of [[403, {}, 'forbidden'], [403, { 'cf-mitigated': 'challenge' }, 'challenge'],
  [404, {}, 'missing'], [503, {}, 'http'], [302, {}, 'redirect']]) {
  test(`web response ${status} is classified as ${kind}`, async t => {
    network(t, () => ({ status, headers }));
    await assert.rejects(readPublicURL('https://example.org/'), e => e instanceof WebReadError && e.kind === kind);
  });
}

test('empty DNS results are distinct from private addresses, including a DNS fallback with no answers', async () => {
  await assert.rejects(publicAddresses('none.example', undefined, async () => []), e => e.kind === 'dns');
  await assert.rejects(publicAddresses('private.example', undefined, async () => [{ address: '10.0.0.1', family: 4 }]), e => e.kind === 'private');
  await assert.rejects(publicAddresses('virtual.example', undefined, async () => [{ address: '198.18.0.1', family: 4 }],
    async () => Response.json({ Status: 3, Answer: [] })), e => e.kind === 'dns');
});

test('redirect DNS failures, unsupported protocols and redirect loops have distinct results', async t => {
  network(t, () => ({ status: 302, headers: { location: 'https://missing.example/page' } }), async host => {
    if (host === 'missing.example') throw Object.assign(new Error('private resolver detail'), { code: 'ENOTFOUND' });
    return [{ address: '8.8.8.8', family: 4 }];
  });
  await assert.rejects(readPublicURL('https://example.org/'), e => e.kind === 'redirect_dns');
});

test('redirects are checked again for private targets and invalid protocols', async t => {
  let target = 'http://127.0.0.1/secret';
  network(t, () => ({ status: 302, headers: { location: target } }));
  await assert.rejects(readPublicURL('https://example.org/'), e => e.kind === 'private');
  target = 'javascript:alert(1)';
  await assert.rejects(readPublicURL('https://example.org/'), e => e.kind === 'redirect');
  target = '/loop';
  await assert.rejects(readPublicURL('https://example.org/'), e => e.kind === 'redirects');
});

test('timeouts are readable and stopping a request keeps the original cancellation reason', async t => {
  network(t, () => Object.assign(new Error('internal socket detail'), { code: 'ABORT_ERR' }));
  await assert.rejects(readPublicURL('https://example.org/'), e => e.kind === 'timeout');
  const controller = new AbortController(), reason = new Error('User stopped'); controller.abort(reason);
  await assert.rejects(readPublicURL('https://example.org/', controller.signal), e => e === reason);
  assert.equal(webNetworkError(new Error('socket'), controller.signal), reason);
});

test('only recognized web errors pass through localization, including SDK cause wrappers', () => {
  const failure = new WebReadError('challenge');
  assert.match(webReadErrorMessage(failure, 'zh-CN'), /浏览器验证/);
  assert.match(webReadErrorMessage(new Error('Tool wrapper', { cause: failure }), 'en'), /browser verification/);
  assert.equal(webReadErrorMessage(Object.assign(new Error('secret-api-key'), { kind: 'challenge' }), 'en'), null);
  assert.equal(webReadErrorMessage(new Error('provider response body'), 'en'), null);
  assert.equal(webReadErrorMessage(new WebReadError('http', [502]), 'en'), 'The page returned HTTP 502 and could not be read.');
});
