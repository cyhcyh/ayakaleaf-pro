import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'

const base = process.env.PERSONAL_AI_TEST_URL || 'http://127.0.0.1:39080'
if (!/^http:\/\/(127\.0\.0\.1|localhost):39080$/.test(base)) throw new Error('Run this fixture against the isolated local verification stack only')

class Session {
  cookies = new Map()
  csrf = ''
  async request(path, body, expected = 200) {
    let url = base + path
    let method = body === undefined ? 'GET' : 'POST'
    let payload = body
    let response
    for (let step = 0; step < 6; step++) {
      response = await fetch(url, { method, redirect: 'manual', headers: {
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        'Content-Type': 'application/json', 'X-Csrf-Token': this.csrf,
      }, ...(payload !== undefined && { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(180000) })
      for (const cookie of response.headers.getSetCookie()) {
        const [key, ...value] = cookie.split(';')[0].split('='); this.cookies.set(key, value.join('='))
      }
      if (![301, 302, 303].includes(response.status)) break
      const destination = new URL(response.headers.get('location'), url)
      if (!['127.0.0.1', 'localhost'].includes(destination.hostname) || destination.port !== '39080') throw new Error('Unexpected external redirect')
      url = base + destination.pathname + destination.search
      method = 'GET'; payload = undefined
    }
    const data = Buffer.from(await response.arrayBuffer())
    const text = data.toString()
    assert.equal(response.status, expected, `${path}: ${text.slice(0, 400)}`)
    const token = text.match(/<meta name="ol-csrfToken" content="([^"]+)"/)?.[1]
    if (token) this.csrf = token
    let json
    try { json = JSON.parse(text) } catch {}
    return { response, data, text, json }
  }
}

const email = 'verification-admin@localhost.test'
const password = 'Verify!' + crypto.randomBytes(12).toString('hex')
const alice = new Session()
await alice.request('/launchpad')
await alice.request('/launchpad/register_admin', { email, password })
await alice.request('/login')
await alice.request('/login', { email, password })
await alice.request('/project')
const { json: project } = await alice.request('/project/new', { projectName: 'Personal AI verification', template: 'blank' })
const projectId = project.project_id
assert.match(projectId, /^[a-f0-9]{24}$/)
const original = (await alice.request('/personal-ai/settings')).json
assert.equal(original.connections.length, 0)
const profile = { ...original,
  connections: [{ id: 'local-fixture', name: 'Local verification fixture', kind: 'cloud', baseURL: 'http://mock:39001/v1', apiKey: 'not-a-real-api-key' }],
  bindings: Object.fromEntries(['chat','fix','review','translation'].map(feature => [feature, { connectionId: 'local-fixture', model: feature === 'translation' ? 'translate-model' : feature === 'review' ? 'review-model' : feature === 'fix' ? 'fix-model' : 'test-model' }])),
  translation: { enabled: true, provider: 'llm', target: 'zh-CN', googleConnectionId: '' },
}
const saved = (await alice.request('/personal-ai/settings', profile)).json
assert.equal(saved.connections[0].hasKey, true)
assert.ok(!JSON.stringify(saved).includes('not-a-real-api-key'))
assert.ok(!JSON.stringify(saved).includes('encryptedKey'))
await alice.request('/personal-ai/settings', profile, 409)
assert.equal((await alice.request('/workbench/access')).json.allowed, true)
const catalog = (await alice.request('/personal-ai/connections/local-fixture/models', {})).json.models
assert.equal(catalog.length, 4)
await alice.request('/personal-ai/connections/local-fixture/test', { model: 'test-model' })
const translation = (await alice.request('/personal-ai/translate', { text: 'The spectral properties of a hypergraph depend on its degree distribution and connectivity.', provider: 'llm', target: 'zh-CN' })).json
assert.ok(translation.translatedText.includes('超图'))
const compiled = (await alice.request(`/project/${projectId}/compile`, { check: 'silent', stopOnFirstError: true })).json
assert.equal(compiled.status, 'success')
const pdf = compiled.outputFiles.find(file => file.type === 'pdf')
assert.ok(pdf)
const binary = (await alice.request(pdf.url)).data
assert.equal(binary.subarray(0, 5).toString(), '%PDF-')
const reference = (await alice.request('/personal-ai/references', { projectId, name: 'reference.pdf', mediaType: 'application/pdf', data: binary.toString('base64') })).json
assert.ok(reference.id)
const chatId = crypto.randomUUID()
const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: '[TEST:REFERENCES] 请阅读上传的参考资料。' }] }
const streamed = await alice.request('/workbench/chat', { id: chatId, projectId, messages: [message], enabledTools: [] })
assert.ok(streamed.text.includes('list_references'))
assert.ok(streamed.text.includes('read_reference'))
assert.ok(!streamed.text.includes('"type":"error"'), streamed.text.slice(-1000))
const reviewChat = crypto.randomUUID()
const pending = await alice.request('/workbench/chat', { id: reviewChat, projectId, messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: '[TEST:REVIEW] 请审阅论文并添加评论。' }] }], enabledTools: [] })
assert.ok(pending.text.includes('request_review'))
await alice.request('/personal-ai/reviews/check', { projectId, chatId: reviewChat, reviewId: crypto.randomUUID(), path: 'main.tex' }, 403)
const approved = (await alice.request('/personal-ai/reviews/approve', { projectId, chatId: reviewChat, scope: 'main.tex', focus: '检查引言，只评论 main.tex。' })).json
await alice.request('/personal-ai/reviews/check', { projectId, chatId: reviewChat, reviewId: approved.reviewId, path: 'main.tex' })
await alice.request('/personal-ai/reviews/check', { projectId, chatId: reviewChat, reviewId: approved.reviewId, path: 'other.tex' }, 403)
await alice.request('/personal-ai/reviews/stop', { projectId, chatId: reviewChat })
await alice.request('/personal-ai/reviews/check', { projectId, chatId: reviewChat, reviewId: approved.reviewId, path: 'main.tex' }, 403)
const second = new Session()
const secondPassword = 'Verify!' + crypto.randomBytes(12).toString('hex')
await second.request('/login')
await second.request('/register', { email: 'verification-second@localhost.test', password: secondPassword })
await second.request('/login')
await second.request('/login', { email: 'verification-second@localhost.test', password: secondPassword })
await second.request('/project')
assert.equal((await second.request('/personal-ai/settings')).json.connections.length, 0)
await second.request('/personal-ai/references', { projectId, name: 'forbidden.txt', mediaType: 'text/plain', data: Buffer.from('test').toString('base64') }, 403)
await second.request('/personal-ai/reviews/check', { projectId, chatId: reviewChat, reviewId: approved.reviewId, path: 'main.tex' }, 403)
const uiFixture = { base, email, password, projectId, referenceId: reference.id }
if (process.env.PERSONAL_AI_UI_FIXTURE) await fs.writeFile(process.env.PERSONAL_AI_UI_FIXTURE, JSON.stringify(uiFixture))
console.log(JSON.stringify({ passed: true, checks: ['login and native project creation', 'encrypted and masked personal settings', 'revision conflict', 'model catalog and test', 'feature-specific translation model', 'unchanged native PDF compilation', 'uploaded PDF extraction through assistant tools', 'review confirmation tool', 'review file scope and stop enforcement', 'second-user settings isolation and project permissions'], projectId }, null, 2))
