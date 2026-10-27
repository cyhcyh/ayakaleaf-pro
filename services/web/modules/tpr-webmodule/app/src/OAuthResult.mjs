import path from 'node:path'

export function oauthResult(req, res, provider, ok) {
  const popup = req.session[`${provider}OAuthPopup`]
  delete req.session[`${provider}OAuthPopup`]
  if (!popup) return res.redirect(`/user/settings?oauth-${ok ? 'complete' : 'error'}=${provider}#references`)
  res.set('Cache-Control', 'no-store')
  return res.render(path.resolve(import.meta.dirname, '../views/oauth-result'), { provider, ok, title: provider === 'zotero' ? 'Zotero' : 'Mendeley' })
}
