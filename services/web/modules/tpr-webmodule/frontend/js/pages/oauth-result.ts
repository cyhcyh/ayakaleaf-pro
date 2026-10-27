const provider = document.querySelector<HTMLMetaElement>('meta[name="ayaka-oauth-provider"]')?.content
const ok = document.querySelector<HTMLMetaElement>('meta[name="ayaka-oauth-ok"]')?.content === 'true'
if (window.opener && ['zotero', 'mendeley'].includes(provider || '')) {
  window.opener.postMessage({ type: 'ayaka:reference-oauth', provider, ok }, window.location.origin)
  window.close()
}
