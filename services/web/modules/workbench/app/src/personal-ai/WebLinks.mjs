import sanitizeHtml from 'sanitize-html';

const MAX_LINKS = 50, MAX_LINK_CHARS = 8000, MAX_LABEL_CHARS = 120;
// Keep the existing read_webpage URL limit; never shorten a URL into a
// different destination just to fit the tool's input or output budget.
const MAX_URL_CHARS = 2000;

export function webpageLinks(html, pageURL) {
  const raw = [];
  let base = pageURL, hasBase = false, anchor = null;
  sanitizeHtml(html, {
    allowedTags: ['a'],
    allowedAttributes: { a: ['href'] },
    onOpenTag(name, attrs) {
      if (name === 'base' && !hasBase && attrs.href !== undefined) {
        hasBase = true;
        try {
          const url = new URL(attrs.href, pageURL);
          if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
            base = url.href;
          }
        } catch { /* An unusable base does not invalidate other links. */ }
      }
      if (name === 'a' && attrs.href !== undefined) {
        anchor = { href: attrs.href, text: '', fallback: attrs['aria-label'] || attrs.title || '' };
        raw.push(anchor);
      }
      if (name === 'img' && anchor && attrs.alt && anchor.text.length < 512)
        anchor.text += (' ' + attrs.alt).slice(0, 512 - anchor.text.length);
    },
    textFilter(text) {
      // The parser already decodes named/numeric entities. Its textFilter
      // escapes HTML again; undo that one escaping pass for plain labels.
      if (anchor && anchor.text.length < 512) anchor.text += text.replace(/&(amp|lt|gt|quot);/g,
        (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"' })[name]).slice(0, 512 - anchor.text.length);
      return text;
    },
    onCloseTag(name) { if (name === 'a') anchor = null; },
  });
  const links = [], seen = new Set();
  let unreadableLinkCount = 0;
  for (const item of raw) {
    let url;
    try { url = new URL(item.href, base); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
    seen.add(url.href);
    if (url.href.length > MAX_URL_CHARS) { unreadableLinkCount++; continue; }
    const text = (item.text.trim() || item.fallback).replace(/\s+/g, ' ').trim();
    links.push({ text: [...text].slice(0, MAX_LABEL_CHARS).join(''), url: url.href });
  }
  return { links, unreadableLinkCount };
}

export function linkPage(catalog, offset = 0) {
  const links = [];
  let chars = 2, index = Math.min(offset, catalog.links.length);
  while (index < catalog.links.length && links.length < MAX_LINKS) {
    const link = catalog.links[index], size = JSON.stringify(link).length + (links.length ? 1 : 0);
    if (chars + size > MAX_LINK_CHARS) break;
    links.push(link); chars += size; index++;
  }
  return { links, linkOffset: offset, totalLinks: catalog.links.length,
    nextLinkOffset: index < catalog.links.length ? index : null,
    linksRemaining: catalog.links.length - index,
    ...(catalog.unreadableLinkCount && { unreadableLinkCount: catalog.unreadableLinkCount,
      linkNote: 'Some URLs exceed the existing 2000-character input limit and cannot be opened by this tool. No URL was shortened.' }),
  };
}
