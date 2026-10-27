import path from 'node:path'

export const INSTANCE_LABEL = 'org.rogerleaf.instance'
export const ROLE_LABEL = 'org.rogerleaf.role'
export const STARTUP_DELAY = 5000
export const SCAN_INTERVAL = 10 * 60 * 1000

const timestamp = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function ownsSandbox(info, { instanceId, image, directories }) {
  if (!instanceId) return false
  const labels = info.Config?.Labels || {}
  if (labels[INSTANCE_LABEL] !== undefined) {
    return labels[INSTANCE_LABEL] === instanceId && labels[ROLE_LABEL] === 'compile'
  }
  // Pre-Rogerleaf containers have no labels. Verify both their image and
  // actual /compile mount against this instance's persistent directories.
  if (info.Config?.Image !== image || !/^\/?project-[a-f0-9]{24}-/.test(info.Name || '')) return false
  const mount = info.Mounts?.find(item => item.Destination === '/compile')
  if (!mount?.Source) return false
  const source = path.posix.normalize(mount.Source)
  return directories.filter(Boolean).some(directory => {
    const root = path.posix.normalize(directory).replace(/\/$/, '')
    return source.startsWith(root + '/') && source !== root
  })
}

export function expiredSandbox(info, policy, now = Date.now(), projectAccess = 0) {
  if (!ownsSandbox(info, policy)) return false
  if (info.State?.Running || info.State?.Paused || info.State?.Restarting) return false
  if (!['exited', 'created', 'dead'].includes(info.State?.Status)) return false
  const lastUse = Math.max(timestamp(info.Created), timestamp(info.State?.FinishedAt), timestamp(projectAccess))
  return lastUse > 0 && now - lastUse >= policy.maxAge
}

// The caller starts this only after the cache's last-access index is restored.
export function startCleanupMonitor(sweep, { setTimeout: later = setTimeout, clearTimeout: cancelLater = clearTimeout, setInterval: repeat = setInterval, clearInterval: cancelRepeat = clearInterval } = {}) {
  let running = false, stopped = false, interval
  const run = () => {
    if (running || stopped) return
    running = true
    sweep(() => { running = false })
  }
  const timeout = later(() => { run(); interval = repeat(run, SCAN_INTERVAL) }, STARTUP_DELAY)
  return () => { stopped = true; cancelLater(timeout); if (interval) cancelRepeat(interval) }
}
