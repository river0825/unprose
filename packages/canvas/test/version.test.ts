// GET /api/version: the running version and its release notes (CHANGELOG.md next to the code).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer } from '../src/server.js'
import { findRelease } from '../src/release.js'
import { createBoardRepository } from '../src/adapters/boards/index.js'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-version-')))
const repo = path.join(tmp, 'repo')
const nested = path.join(repo, 'packages', 'canvas', 'dist')
fs.mkdirSync(nested, { recursive: true })
fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'unprose', version: '9.8.7' }))
fs.writeFileSync(path.join(repo, 'packages', 'canvas', 'package.json'), JSON.stringify({ name: '@awd/canvas', version: '0.0.1' }))
fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## [9.8.7] — 2026-01-01\n\n### Added\n- a thing\n')

test('findRelease walks up to the CHANGELOG and takes the version of the package.json beside it', () => {
  const r = findRelease(nested)
  assert.equal(r.version, '9.8.7', 'the root package, not the workspace package on the way up')
  assert.match(r.changelog ?? '', /## \[9\.8\.7\]/)
})

test('a bundle copies CHANGELOG.md into dist/; the version still comes from the package above it', () => {
  const dist = path.join(repo, 'dist')
  fs.mkdirSync(dist, { recursive: true })
  fs.copyFileSync(path.join(repo, 'CHANGELOG.md'), path.join(dist, 'CHANGELOG.md'))
  const r = findRelease(dist)
  assert.equal(r.version, '9.8.7')
  assert.ok(r.changelog)
})

test('no CHANGELOG anywhere: both are null', () => {
  const lonely = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-noversion-'))
  assert.deepEqual(findRelease(lonely), { version: null, changelog: null })
})

test('GET /api/version answers { version, changelog }', async () => {
  const srv = await startServer({ port: 0, store: createBoardRepository('memory'), releaseDir: nested })
  try {
    const r = await fetch(`${srv.url}/api/version`)
    assert.equal(r.status, 200)
    const body = (await r.json()) as { version: string; changelog: string }
    assert.equal(body.version, '9.8.7')
    assert.match(body.changelog, /a thing/)
  } finally {
    await srv.close()
  }
})
