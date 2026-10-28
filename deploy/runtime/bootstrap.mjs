import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import { directory, loadConfig } from '../../services/web/modules/site-settings/shared/store.mjs'
import { applyIntegrations, providers } from '../../services/web/modules/site-settings/shared/integrations.mjs'

const env = process.env
env.COMPILE_TIMEOUT ||= '240'
const folder = directory()
await fs.mkdir(folder, { recursive: true, mode: 0o700 })
await fs.chown(folder, 33, 33)
const secretsPath = path.join(folder, 'runtime-secrets.json')
let saved = {}
try { saved = JSON.parse(await fs.readFile(secretsPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
for (const name of ['OVERLEAF_SESSION_SECRET', 'OVERLEAF_INVITE_TOKEN_SECRET']) env[name] ||= saved[name] || crypto.randomBytes(48).toString('hex')
// Preserve the session-secret fallback used by existing personal AI profiles.
env.PERSONAL_AI_ENCRYPTION_KEY ||= saved.PERSONAL_AI_ENCRYPTION_KEY || env.OVERLEAF_SESSION_SECRET
for (const name of ['OVERLEAF_SESSION_SECRET', 'OVERLEAF_INVITE_TOKEN_SECRET', 'PERSONAL_AI_ENCRYPTION_KEY']) saved[name] = env[name]
for (const spec of Object.values(providers)) {
  if (spec.cipher) { env[spec.cipher] ||= saved[spec.cipher] || crypto.randomBytes(48).toString('hex'); saved[spec.cipher] = env[spec.cipher] }
}
await fs.writeFile(secretsPath, JSON.stringify(saved), { mode: 0o600 })
await fs.chown(secretsPath, 33, 33)
const keyPath = path.join(folder, 'config.key')
try { await fs.writeFile(keyPath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST') throw error }
await fs.chown(keyPath, 33, 33)
applyIntegrations(await loadConfig(), env)

function docker(method, endpoint, onEvent) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/var/run/docker.sock', path: endpoint, method }, res => {
      let body = '', pending = '', failure
      res.setEncoding('utf8')
      res.on('data', chunk => {
        if (!onEvent) { body += chunk; return }
        pending += chunk
        let newline
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
          if (!line.trim()) continue
          try { const event = JSON.parse(line); if (event.error) failure = event.error; onEvent(event) } catch (error) { failure ||= error.message }
        }
      })
      res.on('end', () => {
        if (res.statusCode >= 400 || failure) return reject(Object.assign(new Error(failure || `Docker request failed (${res.statusCode}): ${body.slice(0, 300)}`), { status: res.statusCode }))
        try { resolve(body ? JSON.parse(body) : null) } catch (error) { reject(error) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

if (env.SANDBOXED_COMPILES === 'true') {
  const image = env.TEX_LIVE_DOCKER_IMAGE || 'roger1001/rogerleaf-texlive:2025.1'
  env.TEX_LIVE_DOCKER_IMAGE = image
  env.ALL_TEX_LIVE_DOCKER_IMAGES ||= image
  env.ALL_TEX_LIVE_DOCKER_IMAGE_NAMES ||= 'TeX Live 2025'
  env.IMAGE_ROOT ||= image.substring(0, image.lastIndexOf('/')) || 'roger1001'
  env.DOCKER_RUNNER = 'true'
  env.SANDBOXED_COMPILES_SIBLING_CONTAINERS = 'true'
  const info = await docker('GET', `/containers/${encodeURIComponent(os.hostname())}/json`)
  const mount = info.Mounts?.find(item => item.Destination === '/var/lib/overleaf')
  if (!mount) throw new Error('Mount persistent application data at /var/lib/overleaf before enabling sandboxed compiles')
  env.ROGERLEAF_SANDBOX_INSTANCE = mount.Name || mount.Source
  for (const [suffix, subfolder] of Object.entries({ COMPILES: 'compiles', OUTPUT: 'output', CACHE: 'cache' })) env[`SANDBOXED_COMPILES_HOST_DIR_${suffix}`] ||= path.posix.join(mount.Source, 'data', subfolder)
  try { await docker('GET', `/images/${encodeURIComponent(image)}/json`) } catch (error) {
    if (error.status !== 404) throw error
    console.log(`[Rogerleaf] Downloading ${image}. Initial startup may take several minutes.`)
    let last = 0
    await docker('POST', `/images/create?fromImage=${encodeURIComponent(image)}`, event => {
      if (Date.now() - last > 10000 && event.status) { console.log(`[TeX Live] ${event.status}${event.progress ? ` ${event.progress}` : ''}`); last = Date.now() }
    })
  }
}

// All services, including Dropbox's datastore, inherit the same applied config.
const command = process.argv.slice(2)
const executable = command[0] || '/sbin/my_init'
process.execve(executable, [executable, ...command.slice(1)], env)
