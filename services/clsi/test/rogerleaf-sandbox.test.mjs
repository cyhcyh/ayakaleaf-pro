import test from 'node:test'
import assert from 'node:assert/strict'
import { ownsSandbox, expiredSandbox, startCleanupMonitor, INSTANCE_LABEL, ROLE_LABEL, STARTUP_DELAY, SCAN_INTERVAL } from '../app/js/RogerleafSandbox.mjs'
const now = Date.now(), hour = 3600000
const policy = { instanceId: 'test-site', image: 'tex:2026.1', directories: ['/vol/site/data/compiles'], maxAge: hour }
const info = () => ({ Name: '/project-0123456789abcdef01234567-user-hash', Config: { Image: 'tex:2026.1', Labels: { [INSTANCE_LABEL]: 'test-site', [ROLE_LABEL]: 'compile' } }, State: { Status: 'exited', Running: false, FinishedAt: new Date(now - 2 * hour).toISOString() }, Created: new Date(now - 3 * hour).toISOString(), Mounts: [{ Source: '/vol/site/data/compiles/project-user', Destination: '/compile' }] })

test('cleanup isolates sites and recognizes pre-branding containers by image and mount', () => {
  const candidate = info(); assert.equal(ownsSandbox(candidate, policy), true)
  candidate.Config.Labels[INSTANCE_LABEL] = 'other-site'; assert.equal(ownsSandbox(candidate, policy), false)
  candidate.Config.Labels = {}; assert.equal(ownsSandbox(candidate, policy), true)
  candidate.Mounts[0].Source = '/vol/site/data/compiles-other/project'; assert.equal(ownsSandbox(candidate, policy), false)
  candidate.Mounts[0].Source = '/vol/other/data/compiles/project'; assert.equal(ownsSandbox(candidate, policy), false)
  candidate.Mounts[0].Source = '/vol/site/data/compiles/project'; candidate.Config.Image = 'unrelated-image'; assert.equal(ownsSandbox(candidate, policy), false)
})

test('elapsed time survives restart while fresh use, running and unknown states prevent deletion', () => {
  const candidate = info(); assert.equal(expiredSandbox(candidate, policy, now), true)
  candidate.State.FinishedAt = new Date(now - 1000).toISOString(); assert.equal(expiredSandbox(candidate, policy, now), false)
  candidate.State.FinishedAt = new Date(now - 2 * hour).toISOString(); assert.equal(expiredSandbox(candidate, policy, now, now - 500), false)
  candidate.State.Running = true; assert.equal(expiredSandbox(candidate, policy, now), false)
  candidate.State.Running = false; candidate.State.Status = 'removing'; assert.equal(expiredSandbox(candidate, policy, now), false)
  candidate.State.Status = 'created'; candidate.State.FinishedAt = ''; assert.equal(expiredSandbox(candidate, policy, now), true)
  candidate.Created = 'invalid'; assert.equal(expiredSandbox(candidate, policy, now), false)
})

test('monitor starts after five seconds, repeats every ten minutes, avoids overlap and stops', () => {
  let first, repeat, firstDelay, repeatDelay, finish, calls = 0, cancelled = 0
  const stop = startCleanupMonitor(done => { calls++; finish = done }, {
    setTimeout: (fn, delay) => { first = fn; firstDelay = delay; return 1 }, clearTimeout: () => { cancelled++ },
    setInterval: (fn, delay) => { repeat = fn; repeatDelay = delay; return 2 }, clearInterval: () => { cancelled++ },
  })
  assert.equal(calls, 0); assert.equal(firstDelay, STARTUP_DELAY); first(); assert.equal(calls, 1); assert.equal(repeatDelay, SCAN_INTERVAL)
  repeat(); assert.equal(calls, 1); finish(); repeat(); assert.equal(calls, 2)
  stop(); finish(); repeat(); assert.equal(calls, 2); assert.equal(cancelled, 2)
})
