import assert from 'node:assert/strict'

export const base = process.env.PERSONAL_AI_TEST_URL || 'http://127.0.0.1:39080'
if (!/^http:\/\/(127\.0\.0\.1|localhost):39080$/.test(base)) throw new Error('Run this fixture against the isolated local verification stack only')

export class Session {
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
