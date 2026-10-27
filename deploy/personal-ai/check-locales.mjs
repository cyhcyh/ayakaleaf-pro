// The frontend loader includes only extracted keys, even if the server locale
// contains the translation. Check the module entries before packaging assets.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const root = new URL('../../services/web/', import.meta.url)
const extracted = JSON.parse(await fs.readFile(new URL('frontend/extracted-translations.json', root), 'utf8'))
const keys = ['mcp_server', 'mcp_server_description', 'sync_with_a_x_repository', 'sync_with_a_github_repository', 'git_clone_this_project', 'sync_all_projects_with_dropbox']
for (const key of keys) assert.ok(Object.hasOwn(extracted, key), `Missing extracted integration key: ${key}`)
for (const language of ['en', 'zh-CN']) {
  const dictionary = JSON.parse(await fs.readFile(new URL(`locales/${language}.json`, root), 'utf8'))
  for (const key of keys) assert.ok(dictionary[key]?.trim(), `Missing ${language} integration translation: ${key}`)
}
console.log('Integration translations are present in frontend extraction and both locale dictionaries.')
