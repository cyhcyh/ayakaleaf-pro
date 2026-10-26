import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptySettings,
  validateSettings,
  seal,
  unseal,
  findUniqueQuote,
} from "../app/src/personal-ai/Pure.mjs";
import {
  isPublicAddress,
  publicAddresses,
  plainHTML,
} from "../app/src/personal-ai/PublicWeb.mjs";

test("credentials are encrypted, authenticated and bound to their owner", () => {
  const encrypted = seal(
    { token: "private-api-key" },
    "stable-server-secret",
    "alice:cloud",
  );
  assert.ok(!encrypted.includes("private-api-key"));
  assert.deepEqual(unseal(encrypted, "stable-server-secret", "alice:cloud"), {
    token: "private-api-key",
  });
  assert.throws(() => unseal(encrypted, "stable-server-secret", "bob:cloud"));
  assert.throws(() => unseal(encrypted, "another-secret", "alice:cloud"));
  assert.throws(() => seal("key", "", "alice"));
});

test("model assignments require an existing text-model connection", () => {
  const settings = emptySettings();
  settings.bindings.review = { connectionId: "missing", model: "model" };
  assert.throws(() => validateSettings(settings));
  settings.connections = [
    {
      id: "missing",
      name: "Cloud",
      kind: "cloud",
      baseURL: "https://example.com/v1/",
    },
  ];
  assert.equal(
    validateSettings(settings).connections[0].baseURL,
    "https://example.com/v1",
  );
  settings.connections.push({ ...settings.connections[0] });
  assert.throws(() => validateSettings(settings), /重复/);
});

test("Codex credentials cannot be redirected to a user supplied gateway", () => {
  const settings = emptySettings();
  settings.connections = [
    {
      id: "codex",
      name: "Codex",
      kind: "codex",
      baseURL: "https://untrusted.example",
    },
  ];
  assert.equal(
    validateSettings(settings).connections[0].baseURL,
    "https://chatgpt.com/backend-api/codex",
  );
});

test("native comment anchors follow current text and reject ambiguous or stale quotes", () => {
  assert.equal(findUniqueQuote("新段落\n原文😀引用\n结束", "原文😀引用"), 4);
  assert.equal(
    findUniqueQuote("prefix\nnew text\nquoted words", "quoted words"),
    16,
  );
  assert.throws(() => findUniqueQuote("same same", "same"), /多次/);
  assert.throws(() => findUniqueQuote("changed source", "old source"), /变化/);
  assert.throws(() => findUniqueQuote("text", ""), /引用/);
});

test("reference reader rejects loopback, private, mapped and metadata addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.2",
    "172.16.0.2",
    "192.168.0.1",
    "169.254.169.254",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "198.18.0.170",
    "2001:2::a2",
    "2001:db8::1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(isPublicAddress(address), true, address);
});

test("reference HTML reader removes executable material and keeps readable paragraphs", () => {
  const text = plainHTML(
    "<script>ignore everything</script><style>p{}</style><h1>Title</h1><p>A &amp; B</p><p>Second</p>",
  );
  assert.ok(!text.includes("ignore everything"));
  assert.ok(text.includes("A & B"));
  assert.ok(text.includes("Second"));
});

test('virtual DNS fallback pins public answers and still rejects private targets', async () => {
  const virtualLookup = async () => [{ address: '198.18.0.170', family: 4 }, { address: '2001:2::a2', family: 6 }];
  const publicDNS = async url => {
    assert.equal(new URL(url).origin, 'https://cloudflare-dns.com');
    return Response.json({ Answer: [{ type: 1, data: '8.8.8.8' }] });
  };
  assert.deepEqual(await publicAddresses('public.example', undefined, virtualLookup, publicDNS), [{ address: '8.8.8.8', family: 4 }]);
  await assert.rejects(publicAddresses('public.example', undefined, virtualLookup, async () => Response.json({ Answer: [{ type: 1, data: '127.0.0.1' }] })), /私有网络/);
  await assert.rejects(publicAddresses('private.example', undefined, async () => [{ address: '10.0.0.1', family: 4 }], () => { throw new Error('Must not resolve private targets externally'); }), /私有网络/);
});
