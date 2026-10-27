import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { applyIntegrations, validateProvider } from '../shared/integrations.mjs'
import { loadConfig, saveConfig, publicConfig } from '../shared/store.mjs'
import { localize } from '../shared/localize.mjs'

test('encrypted storage, redaction, restart status and concurrent saves', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ayaka-site-settings-'))
  const previous = process.env.AYAKA_SITE_SETTINGS_DIR
  process.env.AYAKA_SITE_SETTINGS_DIR = folder
  try {
    await fs.writeFile(path.join(folder, 'config.key'), crypto.randomBytes(32))
    assert.equal((await publicConfig({})).pending, false)
    const saved = await saveConfig({ revision: '', providers: { zotero: { enabled: true, clientId: 'client', clientSecret: 'private-secret' } } }, {})
    assert.equal((await fs.readFile(path.join(folder, 'integrations.enc.json'), 'utf8')).includes('private-secret'), false)
    const publicValue = await publicConfig({})
    assert.equal(publicValue.providers.zotero.hasSecret, true)
    assert.equal(JSON.stringify(publicValue).includes('private-secret'), false)
    assert.equal(publicValue.pending, true)
    const activeEnv = applyIntegrations(await loadConfig(), {})
    assert.equal(activeEnv.ZOTERO_CLIENT_SECRET, 'private-secret')
    assert.equal((await publicConfig(activeEnv)).pending, false)
    const attempts = await Promise.allSettled([1, 2].map(() => saveConfig({ revision: saved.revision, providers: { zotero: { enabled: false, clientId: 'client', clientSecret: '' } } }, {})))
    assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1)
    assert.equal(attempts.find(value => value.status === 'rejected').reason.status, 409)
    const disabled = await loadConfig()
    assert.equal(disabled.providers.zotero.clientSecret, 'private-secret')
    assert.equal(applyIntegrations(disabled, activeEnv).ENABLED_LINKED_FILE_TYPES.includes('zotero'), false)
    await saveConfig({ revision: disabled.revision, providers: { zotero: { enabled: false, clientId: 'client', clearSecret: true } } }, {})
    assert.equal((await publicConfig({})).providers.zotero.hasSecret, false)
  } finally {
    if (previous === undefined) delete process.env.AYAKA_SITE_SETTINGS_DIR
    else process.env.AYAKA_SITE_SETTINGS_DIR = previous
    await fs.rm(folder, { recursive: true })
  }
})

test('validate credentials and retain unrelated environment settings', () => {
  assert.throws(() => validateProvider('unknown', { enabled: false }))
  assert.throws(() => validateProvider('github', { enabled: true, clientId: 'client' }))
  assert.throws(() => validateProvider('gitea', { enabled: false, clientId: '', url: 'file:///tmp' }))
  const config = { providers: { github: validateProvider('github', { enabled: true, clientId: 'client', clientSecret: 'secret', url: 'https://enterprise.example/' }) } }
  const env = applyIntegrations(config, { ENABLED_LINKED_FILE_TYPES: 'project_file,url,mendeley', MENDELEY_CLIENT_ID: 'keep' })
  assert.equal(env.GITHUB_SYNC_URL, 'https://enterprise.example')
  assert.equal(env.MENDELEY_CLIENT_ID, 'keep')
  assert.equal(env.ENABLED_LINKED_FILE_TYPES, 'project_file,url,mendeley')
})

test('localization preserves arguments, whitespace and Chinese originals', () => {
  assert.equal(localize('已获取 {0} 个模型，也可以手动填写模型 ID', 'en', [42]), 'Fetched 42 models. You can also enter a model ID manually.')
  assert.equal(localize(' 关闭 ', 'en'), ' Close ')
  assert.equal(localize('关闭', 'zh-CN'), '关闭')
  assert.equal(localize('A remote service error', 'en'), 'A remote service error')
})
