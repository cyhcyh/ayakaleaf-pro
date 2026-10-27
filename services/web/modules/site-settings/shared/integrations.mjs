// Shared by the admin page API and the container bootstrap. No application imports:
// credentials must be applied before Overleaf initialises its integration modules.
export const providers = {
  github: { flag: 'GITHUB_SYNC_ENABLED', id: 'GITHUB_SYNC_CLIENT_ID', secret: 'GITHUB_SYNC_CLIENT_SECRET', url: 'GITHUB_SYNC_URL', defaultURL: 'https://github.com', callback: '/user/github-sync/oauth2/callback', cipher: 'GITHUB_TOKEN_CIPHER_PASSWORD' },
  gitlab: { flag: 'GITLAB_SYNC_ENABLED', id: 'GITLAB_SYNC_CLIENT_ID', secret: 'GITLAB_SYNC_CLIENT_SECRET', url: 'GITLAB_SYNC_URL', defaultURL: 'https://gitlab.com', callback: '/user/gitlab-sync/oauth2/callback', cipher: 'GITLAB_TOKEN_CIPHER_PASSWORD' },
  gitea: { flag: 'GITEA_SYNC_ENABLED', id: 'GITEA_SYNC_CLIENT_ID', secret: 'GITEA_SYNC_CLIENT_SECRET', url: 'GITEA_SYNC_URL', defaultURL: 'https://gitea.com', callback: '/user/gitea-sync/oauth2/callback', cipher: 'GITEA_TOKEN_CIPHER_PASSWORD' },
  dropbox: { flag: 'DROPBOX_ENABLED', id: 'DROPBOX_APP_KEY', secret: 'DROPBOX_APP_SECRET', callback: '/user/dropbox/oauth/callback', cipher: 'DROPBOX_TOKEN_CIPHER_PASSWORD' },
  zotero: { id: 'ZOTERO_CLIENT_ID', secret: 'ZOTERO_CLIENT_SECRET', callback: '/user/zotero/oauth/callback' },
  mendeley: { id: 'MENDELEY_CLIENT_ID', secret: 'MENDELEY_CLIENT_SECRET', callback: '/user/mendeley/oauth/callback' },
}

export function fromEnvironment(env = process.env) {
  const linked = (env.ENABLED_LINKED_FILE_TYPES || '').split(',')
  return Object.fromEntries(Object.entries(providers).map(([name, spec]) => [name, {
    enabled: spec.flag ? env[spec.flag]?.toLowerCase() === 'true' : linked.includes(name),
    clientId: env[spec.id] || '', clientSecret: env[spec.secret] || '',
    ...(spec.url && { url: env[spec.url] || spec.defaultURL }),
  }]))
}

export function applyIntegrations(config, env = process.env) {
  const linked = new Set((env.ENABLED_LINKED_FILE_TYPES || 'project_file,project_output_file,url').split(',').filter(Boolean))
  for (const [name, patch] of Object.entries(config.providers || {})) {
    const spec = providers[name]
    if (!Object.hasOwn(providers, name)) continue
    if (spec.flag) env[spec.flag] = String(patch.enabled)
    else if (patch.enabled) linked.add(name)
    else linked.delete(name)
    env[spec.id] = patch.clientId
    env[spec.secret] = patch.clientSecret
    if (spec.url) env[spec.url] = patch.url
  }
  env.ENABLED_LINKED_FILE_TYPES = [...linked].join(',')
  env.AYAKA_INTEGRATIONS_REVISION = config.revision || ''
  return env
}

export function validateProvider(name, input, previous = {}) {
  const spec = providers[name]
  if (!Object.hasOwn(providers, name) || !input || typeof input.enabled !== 'boolean') throw new Error('Invalid integration configuration')
  const clean = (value, max) => {
    if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid integration configuration')
    return value.trim()
  }
  const clientId = clean(input.clientId, 500)
  const clientSecret = input.clearSecret ? '' : input.clientSecret ? clean(input.clientSecret, 4096) : previous.clientSecret || ''
  const result = { enabled: input.enabled, clientId, clientSecret }
  if (spec.url) {
    let url
    try { url = new URL(clean(input.url || spec.defaultURL, 2000)) } catch { throw new Error('Use an HTTP or HTTPS service address') }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('Use an HTTP or HTTPS service address')
    result.url = url.toString().replace(/\/+$/, '')
  }
  if (result.enabled && (!clientId || !clientSecret)) throw new Error('Enter the application ID and secret before enabling this integration')
  return result
}
