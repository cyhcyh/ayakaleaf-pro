// Apply the same locale overlays as the upstream release, without requiring jq.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../services/web/locales/', import.meta.url))
const patches = path.join(root, 'locales_patches')
const versions = (await fs.readdir(patches)).filter(name => /^v\d/.test(name))
versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
if (versions.length) {
  const latest = path.join(patches, versions.at(-1))
  for (const name of await fs.readdir(latest)) {
    if (name.endsWith('.json')) await fs.copyFile(path.join(latest, name), path.join(root, name))
  }
}
const merge = (base, extra) => {
  for (const [key, value] of Object.entries(extra)) {
    base[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(base[key] && typeof base[key] === 'object' ? base[key] : {}, value)
      : value
  }
  return base
}
for (const name of await fs.readdir(path.join(patches, 'added'))) {
  if (!name.endsWith('.json') || name === 'added-translations.json') continue
  const target = path.join(root, name)
  const base = JSON.parse(await fs.readFile(target, 'utf8'))
  const extra = JSON.parse(await fs.readFile(path.join(patches, 'added', name), 'utf8'))
  await fs.writeFile(target, JSON.stringify(merge(base, extra), null, 2))
}
