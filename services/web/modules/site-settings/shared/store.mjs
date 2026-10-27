import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fromEnvironment, validateProvider, providers } from './integrations.mjs'

export const directory = () => process.env.AYAKA_SITE_SETTINGS_DIR || '/var/lib/overleaf/data/site-settings'
const file = () => path.join(directory(), 'integrations.enc.json')
const key = async () => crypto.createHash('sha256').update(await fs.readFile(path.join(directory(), 'config.key'))).digest()
let writes = Promise.resolve()

export async function loadConfig() {
  let envelope
  try { envelope = JSON.parse(await fs.readFile(file(), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return { revision: '', providers: {} }
    throw error
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', await key(), Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from('ayakaleaf-site-integrations-v1'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'))
}

export function saveConfig(input, env = process.env) {
  const operation = writes.then(async () => {
    const old = await loadConfig()
    if (input.revision !== old.revision) throw Object.assign(new Error('Settings changed in another window. Reload and try again.'), { status: 409 })
    if (!input.providers || Object.keys(input.providers).some(name => !Object.hasOwn(providers, name))) throw new Error('Invalid integration configuration')
    const baseline = fromEnvironment(env)
    const next = { revision: crypto.randomUUID(), providers: { ...old.providers } }
    for (const [name, values] of Object.entries(input.providers)) next.providers[name] = validateProvider(name, values, old.providers[name] || baseline[name])
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', await key(), iv)
    cipher.setAAD(Buffer.from('ayakaleaf-site-integrations-v1'))
    const data = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()])
    const temp = `${file()}.${crypto.randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600, flag: 'wx' })
      await fs.rename(temp, file())
    } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    return next
  })
  writes = operation.catch(() => {})
  return operation
}

export async function publicConfig(env = process.env) {
  const saved = await loadConfig()
  const active = fromEnvironment(env)
  const pending = saved.revision !== (env.AYAKA_INTEGRATIONS_REVISION || '')
  return {
    revision: saved.revision, pending,
    siteURL: env.OVERLEAF_SITE_URL || 'http://localhost:8080',
    providers: Object.fromEntries(Object.entries(providers).map(([name, spec]) => {
      const value = saved.providers[name] || active[name]
      const { clientSecret, ...publicValue } = value
      return [name, { ...publicValue, hasSecret: Boolean(clientSecret), active: Boolean(active[name].enabled && active[name].clientId && active[name].clientSecret), callback: spec.callback }]
    })),
  }
}
