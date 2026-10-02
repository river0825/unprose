// "Check for updates" in the release-notes dialog: what the person reads after a check (docs/canvas.md "Updating").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSummary, plainError, timeAgo, type UpdateInfo } from '../web/src/components/updateCheck.js'

const now = Date.parse('2026-10-02T10:00:00Z')
const info = (o: Partial<UpdateInfo>): UpdateInfo => ({ current: '0.9.0', available: false, install: 'checkout', supported: true, canUpgrade: true, command: 'git pull', ...o })

test('time ago', () => {
  assert.equal(timeAgo('2026-10-02T09:59:50Z', now), 'just now')
  assert.equal(timeAgo('2026-10-02T09:59:00Z', now), 'a minute ago')
  assert.equal(timeAgo('2026-10-02T09:55:00Z', now), '5 min ago')
  assert.equal(timeAgo('2026-10-02T07:00:00Z', now), '3 h ago')
  assert.equal(timeAgo('2026-09-29T10:00:00Z', now), '3 days ago')
  assert.equal(timeAgo(undefined, now), undefined)
  assert.equal(timeAgo('nonsense', now), undefined)
})

test('the states after Check for updates: checking, latest, available, error', () => {
  assert.deepEqual(checkSummary(info({ latest: '0.9.0', checkedAt: '2026-10-02T09:50:00Z' }), true, null, now), { tone: 'checking', text: 'Checking…', lastChecked: 'last checked 10 min ago' })
  assert.deepEqual(checkSummary(info({ latest: '0.9.0', checkedAt: '2026-10-02T09:59:58Z' }), false, null, now), { tone: 'latest', text: "You're on the latest version (v0.9.0, checked just now).", lastChecked: 'last checked just now' })
  const avail = checkSummary(info({ latest: '0.9.1', available: true, checkedAt: '2026-10-02T09:58:00Z' }), false, null, now)
  assert.equal(avail.tone, 'available')
  assert.equal(avail.text, '', 'the banner says it')
  assert.equal(avail.lastChecked, 'last checked 2 min ago')
  const err = checkSummary(info({ error: 'cannot check for updates (github: fetch failed; gh: not found)', checkedAt: '2026-10-02T09:59:59Z' }), false, null, now)
  assert.equal(err.tone, 'error')
  assert.equal(err.text, "Couldn't reach GitHub: github: fetch failed; gh: not found.")
  assert.equal(checkSummary(null, false, 'Failed to fetch', now).text, "Couldn't reach this canvas: Failed to fetch.")
  assert.equal(checkSummary(null, false, null, now).tone, 'unknown')
})

test('errors in plain words, with the fix when there is one', () => {
  assert.match(plainError('cannot check (private repository): set GITHUB_TOKEN or log in with gh'), /private\. Set GITHUB_TOKEN .*gh auth login/)
  assert.match(plainError('update checks are off (UNPROSE_UPDATE_CHECK=0)'), /are off on this canvas/)
  assert.match(plainError('cannot check for updates (github: HTTP 403; gh: not found)'), /rate-limiting/)
})
