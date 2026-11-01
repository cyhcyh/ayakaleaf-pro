import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { WebReadError, webNetworkError } from './WebReadErrors.mjs';

export function isPublicAddress(address) {
  if (address.toLowerCase().startsWith("::ffff:"))
    return isPublicAddress(address.slice(7));
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  return net.isIPv6(address) && !/^(::|fc|fd|fe[89ab]|ff|2001:(?:2:|db8:))/i.test(address);
}

// TUN proxies can return benchmark addresses for every public hostname. Resolve
// only that case through a fixed public DNS service, then pin the real address.
export async function publicAddresses(host, signal, lookup = dns.lookup, dnsFetch = fetch) {
  signal?.throwIfAborted();
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }]
      : await lookup(host, { all: true });
  } catch (error) { throw webNetworkError(error, signal); }
  const virtual = address => /^198\.(18|19)\./.test(address) || /^2001:2:/i.test(address);
  if (!net.isIP(host) && addresses.length && addresses.every(({ address }) => virtual(address))) {
    let response;
    try { response = await dnsFetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      headers: { Accept: 'application/dns-json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    }); } catch (error) { throw webNetworkError(error, signal); }
    if (!response.ok) throw new WebReadError('dns');
    let result;
    try { result = await response.json(); } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new WebReadError('dns');
    }
    addresses = (result.Answer || []).filter(answer => answer.type === 1)
      .map(answer => ({ address: answer.data, family: 4 }));
  }
  if (!addresses.length) throw new WebReadError('dns');
  if (addresses.some(({ address }) => !isPublicAddress(address))) throw new WebReadError('private');
  return addresses;
}

// Public reference URLs use pinned, validated DNS results on every redirect.
// Personal model endpoints intentionally allow local/self-hosted addresses.
export async function readPublicURL(input, signal, redirects = 0) {
  signal?.throwIfAborted();
  let url;
  try { url = new URL(input); } catch { throw new WebReadError('address'); }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !["", "80", "443"].includes(url.port)
  ) {
    throw new WebReadError('address');
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await publicAddresses(host, signal);
  const pinned = addresses[0];
  const result = await new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        headers: {
          "User-Agent": "Rogerleaf-ReferenceReader/1.0",
          Accept: "application/json,text/html,application/pdf,text/plain,application/atom+xml",
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [pinned])
            : callback(null, pinned.address, pinned.family),
      },
      (response) => {
        if (response.headers['cf-mitigated'] === 'challenge') {
          response.resume(); reject(new WebReadError('challenge')); return;
        }
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (!response.headers.location) { reject(new WebReadError('redirect')); return; }
          resolve({ redirect: response.headers.location });
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new WebReadError(response.statusCode === 403 ? 'forbidden' : response.statusCode === 404 ? 'missing' : 'http', [response.statusCode]));
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) {
            request.destroy(new WebReadError('size'));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            url: url.href,
            type: response.headers["content-type"] || "",
            data: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  }).catch(error => { throw webNetworkError(error, signal); });
  if (result.redirect) {
    if (redirects >= 4) throw new WebReadError('redirects');
    let target;
    try { target = new URL(result.redirect, url); } catch { throw new WebReadError('redirect'); }
    try { return await readPublicURL(target.href, signal, redirects + 1); }
    catch (error) {
      if (error instanceof WebReadError && error.kind === 'dns') throw new WebReadError('redirect_dns');
      if (error instanceof WebReadError && error.kind === 'address') throw new WebReadError('redirect');
      throw error;
    }
  }
  return result;
}

export function plainHTML(html) {
  const decode = (text) =>
    text.replace(
      /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,
      (entity) => {
        const known = {
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
        };
        if (known[entity]) return known[entity];
        const value = entity.slice(2, -1);
        const code =
          value[0]?.toLowerCase() === "x"
            ? parseInt(value.slice(1), 16)
            : parseInt(value, 10);
        return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      },
    );
  return decode(
    html
      .replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/(?:p|div|h[1-6]|li|section|article)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}
