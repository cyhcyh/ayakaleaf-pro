export function authorizeReference(provider: 'zotero' | 'mendeley'): Promise<boolean> {
  const popup = window.open(`/user/${provider}/oauth?popup=1`, `ayaka-${provider}-authorization`, 'popup=yes,width=680,height=760,resizable=yes,scrollbars=yes')
  if (!popup) return Promise.reject(new Error('请允许浏览器弹窗后重试。'))
  return new Promise((resolve, reject) => {
    let completed = false
    const finish = (ok: boolean) => {
      if (completed) return
      completed = true
      window.removeEventListener('message', message)
      window.clearInterval(closed)
      window.clearTimeout(deadline)
      if (ok) window.dispatchEvent(new CustomEvent('ayaka:reference-linked', { detail: { provider } }))
      resolve(ok)
    }
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== 'ayaka:reference-oauth' || event.data.provider !== provider) return
      finish(event.data.ok === true)
    }
    window.addEventListener('message', message)
    const closed = window.setInterval(() => { if (popup.closed) finish(false) }, 700)
    const deadline = window.setTimeout(() => { finish(false) }, 10 * 60 * 1000)
  })
}
