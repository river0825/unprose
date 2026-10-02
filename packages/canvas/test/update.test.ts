// Upgrading the canvas from the canvas (docs/canvas.md "Updating"): the policy, the job and the routes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compareVersions, detectInstall, installedUpdate, isNewer, nextArgs, nextEntry, notesOf, planUpgrade } from '../src/updatePolicy.js'
import { UpdateService, type Handoff, type UpdateEvent } from '../src/updater.js'
import { FakeInstaller, FakeLauncher, FakeUpdateSource } from '../src/adapters/update/index.js'
import { releaseFrom, GitHubReleaseSource } from '../src/adapters/update/github.js'
import { startServer } from '../src/server.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { createBoardRepository } from '../src/adapters/boards/index.js'

test('semver precedence, including prereleases', () => {
  assert.ok(compareVersions('0.4.1', '0.4.0') > 0)
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0)
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
  assert.ok(compareVersions('1.0.0', '1.0.0-rc.1') > 0, 'a release beats its prerelease')
  assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.10') < 0, 'numeric identifiers compare as numbers')
  assert.ok(compareVersions('1.0.0-alpha', '1.0.0-1') > 0, 'alphanumeric sorts after numeric')
  assert.ok(compareVersions('1.0.0-alpha.1', '1.0.0-alpha') > 0)
  assert.ok(compareVersions('garbage', '0.0.1') < 0)
  assert.equal(isNewer('0.5.0', '0.4.1'), true)
  assert.equal(isNewer('0.4.1', '0.4.1'), false)
  assert.equal(isNewer(undefined, '0.4.1'), false)
})

test('install detection: plugin cache, CLAUDE_PLUGIN_ROOT, runtime bundle, git checkout, unknown', () => {
  const none = () => false
  const plugin = detectInstall('/home/u/.claude/plugins/cache/unprose/unprose/0.4.1/dist/canvas.mjs', {}, none)
  assert.deepEqual(plugin, { kind: 'plugin', root: '/home/u/.claude/plugins/cache/unprose/unprose/0.4.1' })
  assert.equal(detectInstall('/data/runtime/0.4.1/canvas.mjs', { CLAUDE_PLUGIN_ROOT: '/p/0.4.1' }, none).kind, 'plugin')
  assert.deepEqual(detectInstall('/home/u/.awd/plugin/runtime/0.4.1/canvas.mjs', {}, none), { kind: 'bundle', root: '/home/u/.awd/plugin/runtime/0.4.1' })
  const repo = new Set(['/src/unprose/.git', '/src/unprose/packages'])
  assert.deepEqual(detectInstall('/src/unprose/packages/canvas/dist/cli.js', {}, (p) => repo.has(p)), { kind: 'checkout', root: '/src/unprose', build: true })
  const clone = new Set(['/src/pub/.git'])
  assert.deepEqual(detectInstall('/src/pub/dist/canvas.mjs', {}, (p) => clone.has(p)), { kind: 'checkout', root: '/src/pub', build: false })
  const u = detectInstall('/opt/x/canvas.mjs', {}, none)
  assert.equal(u.kind, 'unknown')
  assert.ok(u.unsupported)
  assert.equal(detectInstall('C:\\Users\\u\\.claude\\plugins\\cache\\unprose\\unprose\\0.4.1\\dist\\canvas.mjs', {}, none).kind, 'plugin')
})

test('upgrade plans, next entry and arguments per install kind', () => {
  const plugin = { kind: 'plugin' as const, root: '/c/unprose/unprose/0.4.1' }
  assert.equal(planUpgrade(plugin, '0.5.0').command, 'claude plugin update unprose@unprose')
  assert.deepEqual(planUpgrade(plugin, '0.5.0').steps.map((s) => [s.command, ...s.args].join(' ')), ['claude plugin update unprose@unprose'])
  assert.equal(nextEntry(plugin, '/c/unprose/unprose/0.4.1/dist/canvas.mjs', '0.5.0'), '/c/unprose/unprose/0.5.0/scripts/canvas.mjs')
  assert.deepEqual(nextArgs(plugin, ['serve', '--port', '4400', '--dir', '/b']), ['--port', '4400', '--dir', '/b'])

  const dev = { kind: 'checkout' as const, root: '/src/u', build: true }
  const p = planUpgrade(dev, '0.5.0')
  assert.deepEqual(p.steps.map((s) => [s.command, ...s.args].join(' ')), ['git pull --ff-only', 'npm ci', 'npm run build'])
  assert.equal(p.requireClean, '/src/u')
  assert.equal(nextEntry(dev, '/src/u/packages/canvas/dist/cli.js', '0.5.0'), '/src/u/packages/canvas/dist/cli.js')
  assert.deepEqual(nextArgs(dev, ['serve', '--port', '4400']), ['serve', '--port', '4400'])
  assert.deepEqual(planUpgrade({ kind: 'checkout', root: '/pub', build: false }, '0.5.0').steps.length, 1)

  const bundle = { kind: 'bundle' as const, root: '/d/runtime/0.4.1' }
  assert.deepEqual(planUpgrade(bundle, '0.5.0').download, { version: '0.5.0', dir: '/d/runtime/0.5.0' })
  assert.equal(nextEntry(bundle, '/d/runtime/0.4.1/canvas.mjs', '0.5.0'), '/d/runtime/0.5.0/canvas.mjs')
})

test('notes of one version from the CHANGELOG', () => {
  const cl = '# Changelog\n\n## [Unreleased]\n\n## [0.5.0] — 2026-10-01\n\n### Added\n- Upgrade button\n\n## [0.4.1] — 2026-09-30\n\n- fix\n\n[0.5.0]: https://x\n'
  assert.equal(notesOf(cl, '0.5.0'), '### Added\n- Upgrade button')
  assert.equal(notesOf(cl, '0.4.1'), '- fix')
  assert.equal(notesOf(cl, '9.9.9'), undefined)
})

test('the GitHub source: tag → version; a private repo without credentials says so', async () => {
  assert.equal(releaseFrom({ tag_name: 'v0.5.0', body: 'notes' }, 'github').version, '0.5.0')
  const notFound = (async () => new Response('{}', { status: 404 })) as typeof fetch
  const src = new GitHubReleaseSource({ repo: 'o/r', env: {}, fetch: notFound, gh: async () => Promise.reject(new Error('gh: not logged in')) })
  await assert.rejects(src.latest(), /private repository/)
  const viaGh = new GitHubReleaseSource({ repo: 'o/r', env: {}, fetch: notFound, gh: async () => JSON.stringify({ tag_name: 'v0.5.0', body: 'b' }) })
  assert.deepEqual(await viaGh.latest(), { version: '0.5.0', notes: 'b', url: undefined, source: 'gh' })
  let auth = ''
  const withToken = new GitHubReleaseSource({
    repo: 'o/r',
    env: { GITHUB_TOKEN: 't0k' },
    fetch: (async (_u: string, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>)?.authorization ?? '')
      return auth ? new Response(JSON.stringify({ tag_name: 'v1.0.0' })) : new Response('{}', { status: 404 })
    }) as typeof fetch,
    gh: async () => Promise.reject(new Error('no gh')),
  })
  assert.equal((await withToken.latest()).source, 'github (token)')
  assert.equal(auth, 'Bearer t0k')
})

function fakeHandoff(port = 4999) {
  const events: UpdateEvent[] = []
  const calls: string[] = []
  const h: Handoff = {
    port,
    emit: (e) => events.push(e),
    pause: async () => void calls.push('pause'),
    resume: async () => void calls.push('resume'),
    exit: (c) => void calls.push(`exit ${c}`),
  }
  return { h, events, calls }
}
const waitFor = async (f: () => boolean, ms = 3000) => {
  const until = Date.now() + ms
  while (!f() && Date.now() < until) await new Promise((r) => setTimeout(r, 10))
  assert.ok(f(), 'timed out')
}

test('check: cached for hours, refresh forces, off when no source; unsupported installs say why', async () => {
  const src = new FakeUpdateSource({ version: '0.5.0', notes: 'n', source: 'fake' })
  const svc = new UpdateService({ current: '0.4.1', install: { kind: 'checkout', root: '/r', build: true }, source: src, installer: new FakeInstaller(), launcher: new FakeLauncher('0.5.0'), entry: '/r/packages/canvas/dist/cli.js', argv: ['serve'], env: {}, logFile: '/tmp/x.log' })
  const c = await svc.check()
  assert.equal(c.available, true)
  assert.equal(c.latest, '0.5.0')
  assert.equal(c.command, 'cd /r && git pull --ff-only && npm ci && npm run build')
  await svc.check()
  assert.equal(src.calls, 1, 'cached')
  await svc.check(true)
  assert.equal(src.calls, 2, 'refresh')
  const off = new UpdateService({ current: '0.4.1', install: { kind: 'unknown', unsupported: 'nope' }, installer: new FakeInstaller(), launcher: new FakeLauncher(undefined), entry: '/x', argv: [], env: {}, logFile: '/tmp/x.log' })
  const o = await off.check()
  assert.equal(o.available, false)
  assert.match(o.error!, /off/)
  assert.equal(o.supported, false)
  assert.equal(o.reason, 'nope')
})

test('upgrade job, checkout: pull + ci + build, pause, start the next server, exit once it answers', async () => {
  const installer = new FakeInstaller()
  installer.files.add('/r/packages/canvas/dist/cli.js')
  const launcher = new FakeLauncher('0.5.0')
  const svc = new UpdateService({ current: '0.4.1', install: { kind: 'checkout', root: '/r', build: true }, source: new FakeUpdateSource({ version: '0.5.0', source: 'fake' }), installer, launcher, entry: '/r/packages/canvas/dist/cli.js', argv: ['serve', '--port', '4999'], env: { A: '1' }, logFile: '/tmp/x.log', pollMs: 5 })
  const { h, events, calls } = fakeHandoff()
  assert.deepEqual(await svc.start(h), { started: true, version: '0.5.0' })
  await waitFor(() => calls.includes('exit 0'))
  assert.deepEqual(installer.ran.map((c) => [c.command, ...c.args].join(' ')), ['git pull --ff-only', 'npm ci', 'npm run build'])
  assert.deepEqual(launcher.spawned, [{ entry: '/r/packages/canvas/dist/cli.js', args: ['serve', '--port', '4999'] }])
  assert.deepEqual(calls, ['pause', 'exit 0'])
  assert.deepEqual([...new Set(events.map((e) => e.phase))], ['checking', 'installing', 'building', 'restarting'])
  assert.equal(svc.status().phase, 'done')
})

test('upgrade job refuses a dirty checkout, and resumes the old server when the new one never answers', async () => {
  const dirty = new UpdateService({ current: '0.4.1', install: { kind: 'checkout', root: '/r', build: true }, source: new FakeUpdateSource({ version: '0.5.0', source: 'fake' }), installer: new FakeInstaller({ dirty: ['a.ts'] }), launcher: new FakeLauncher('0.5.0'), entry: '/r/e.js', argv: [], env: {}, logFile: '/tmp/x.log' })
  const d = fakeHandoff()
  await dirty.start(d.h)
  await waitFor(() => dirty.status().phase === 'failed')
  assert.match(dirty.status().message!, /uncommitted changes \(a\.ts\)/)
  assert.deepEqual(d.calls, [], 'nothing paused, nothing run')

  const installer = new FakeInstaller()
  installer.files.add('/r/e.js')
  const stuck = new UpdateService({ current: '0.4.1', install: { kind: 'checkout', root: '/r', build: false }, source: new FakeUpdateSource({ version: '0.5.0', source: 'fake' }), installer, launcher: new FakeLauncher(undefined), entry: '/r/e.js', argv: [], env: {}, logFile: '/tmp/x.log', bootTimeoutMs: 60, pollMs: 5 })
  const s = fakeHandoff()
  await stuck.start(s.h)
  await waitFor(() => stuck.status().phase === 'failed')
  assert.deepEqual(s.calls, ['pause', 'resume'])
  assert.match(stuck.status().message!, /did not come up/)
})

test('upgrade job, plugin: claude plugin update, then start from the new version directory; canvas.json follows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'))
  const stateFile = path.join(dir, 'canvas.json')
  fs.writeFileSync(stateFile, JSON.stringify({ pid: 111, target: 'http://localhost:4400', version: '0.4.1', root: '/c/u/u/0.4.1' }))
  const installer = new FakeInstaller()
  installer.files.add('/c/u/u/0.5.0/scripts/canvas.mjs')
  const launcher = new FakeLauncher('0.5.0')
  const svc = new UpdateService({ current: '0.4.1', install: { kind: 'plugin', root: '/c/u/u/0.4.1' }, source: new FakeUpdateSource({ version: '0.5.0', source: 'fake' }), installer, launcher, entry: '/c/u/u/0.4.1/dist/canvas.mjs', argv: ['serve', '--port', '4400'], env: {}, logFile: '/tmp/x.log', stateFile, pid: 111, pollMs: 5 })
  const { h, calls } = fakeHandoff()
  await svc.start(h)
  await waitFor(() => calls.includes('exit 0'))
  assert.deepEqual(installer.ran.map((c) => [c.command, ...c.args].join(' ')), ['claude plugin update unprose@unprose'])
  assert.deepEqual(launcher.spawned, [{ entry: '/c/u/u/0.5.0/scripts/canvas.mjs', args: ['--port', '4400'] }])
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  assert.equal(s.pid, 4242)
  assert.equal(s.version, '0.5.0')
  assert.equal(s.root, '/c/u/u/0.5.0')
})

test('routes: GET /api/update (canUpgrade only locally), POST refused from a tunnel, WS progress, no board changes', async () => {
  const installer = new FakeInstaller()
  installer.files.add('/r/e.js')
  const svc = new UpdateService({ current: '0.4.1', install: { kind: 'checkout', root: '/r', build: false }, source: new FakeUpdateSource({ version: '0.5.0', notes: 'the notes', source: 'fake' }), installer, launcher: new FakeLauncher(undefined), entry: '/r/e.js', argv: [], env: {}, logFile: '/tmp/x.log', bootTimeoutMs: 50, pollMs: 5 })
  const exits: number[] = []
  const access = new AccessService({ store: new MemoryAccessStore() })
  const { token } = access.createToken({ name: 'remote' }, 'test')
  const srv = await startServer({ port: 0, store: createBoardRepository('memory'), update: svc, exit: (c) => void exits.push(c), access })
  try {
    const u = `http://127.0.0.1:${srv.port}/api/update`
    const local = await (await fetch(u)).json()
    assert.equal(local.available, true)
    assert.equal(local.canUpgrade, true)
    assert.equal(local.notes, 'the notes')
    assert.equal((await fetch(u, { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 401, 'a tunnel without credentials gets nothing')
    const remote = await (await fetch(u, { headers: { 'x-forwarded-for': '1.2.3.4', authorization: `Bearer ${token}` } })).json()
    assert.equal(remote.canUpgrade, false)
    assert.match(remote.reason, /only possible from a page opened on this machine/)
    const denied = await fetch(u, { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4', authorization: `Bearer ${token}` } })
    assert.equal(denied.status, 403)

    const board = await (await fetch(`http://127.0.0.1:${srv.port}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 't', kind: 'freeform' }) })).json()
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/${board.board.id}`)
    const got: { type: string; phase?: string }[] = []
    ws.on('message', (d) => got.push(JSON.parse(String(d))))
    await new Promise((r) => ws.once('open', r))
    const r = await fetch(u, { method: 'POST' })
    assert.equal(r.status, 202)
    await waitFor(() => got.some((m) => m.type === 'update' && m.phase === 'restarting'))
    // the fake next server never answers → the old one listens again and reports the failure
    await waitFor(() => svc.status().phase === 'failed', 5000)
    const status = await (await fetch(`${u}/status`)).json()
    assert.equal(status.phase, 'failed')
    assert.deepEqual(exits, [])
    const changes = await (await fetch(`http://127.0.0.1:${srv.port}/api/boards/${board.board.id}/changes?since=0`)).json()
    assert.equal(changes.changes.length, 0, 'upgrade progress is not a board change')
    ws.close()
  } finally {
    await srv.close()
  }
})

test('restart handoff with a real process: the old server lets go of the port and a new one takes it', async () => {
  const { ProcessLauncher } = await import('../src/adapters/update/index.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-handoff-'))
  const next = path.join(dir, 'next.mjs')
  // stands in for the upgraded canvas: binds the port it is given and answers GET /api/version
  fs.writeFileSync(next, `import http from 'node:http'
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
http.createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ version: '0.5.0', pid: process.pid })) }).listen(port)
setTimeout(() => process.exit(0), 20000)
`)
  const installer = new FakeInstaller()
  installer.files.add(next)
  const exits: number[] = []
  let svc: UpdateService | undefined
  const launcher = new ProcessLauncher()
  const srv = await startServer({ port: 0, store: createBoardRepository('memory'), exit: (c) => void exits.push(c), get update() { return svc } } as Parameters<typeof startServer>[0])
  svc = new UpdateService({ current: '0.4.1', install: { kind: 'checkout', root: dir, build: false }, source: new FakeUpdateSource({ version: '0.5.0', source: 'fake' }), installer, launcher, entry: next, argv: ['serve', '--port', String(srv.port)], env: { ...process.env } as Record<string, string>, logFile: path.join(dir, 'next.log'), pollMs: 50 })
  try {
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/update`, { method: 'POST' })
    assert.equal(r.status, 202)
    await waitFor(() => exits.length > 0, 10_000)
    assert.deepEqual(exits, [0])
    const v = await (await fetch(`http://127.0.0.1:${srv.port}/api/version`)).json()
    assert.equal(v.version, '0.5.0', 'the new process answers on the same port')
    process.kill(v.pid, 'SIGTERM')
  } finally {
    srv.server.close()
  }
})

test('a remote page never sees this machine\'s paths in the update answer', async () => {
  const { redactPaths } = await import('../src/updatePolicy.js')
  // sample paths are built at run time so this file itself holds no machine-looking path (the export's leak check)
  const mac = ['', 'Users', 'me', 'code', 'unprose'].join('/')
  const linux = ['', 'home', 'me', 'unprose'].join('/')
  const win = ['C:', 'Users', 'me', 'unprose'].join('\\')
  const out = redactPaths({ command: `cd ${mac} && git pull --ff-only`, install: { kind: 'checkout', root: linux }, log: [`${win}> npm ci`, 'ok'], n: 3 })
  assert.equal(out.command, 'cd <unprose folder> && git pull --ff-only')
  assert.equal(out.install.root, '<unprose folder>')
  assert.equal(out.log[0], '<unprose folder> npm ci')
  assert.equal(out.n, 3)
})

test('installedUpdate: the newer version of this plugin that claude plugin update installed', () => {
  const exists = (p: string) => p !== '/c/m/unprose/0.7.0/scripts/canvas.mjs'
  const json = {
    version: 2,
    plugins: {
      'unprose@m': [
        { scope: 'user', installPath: '/c/m/unprose/0.6.2', version: '0.6.2' },
        { scope: 'project', installPath: '/c/m/unprose/0.6.1', version: '0.6.1' },
      ],
      'other@m': [{ installPath: '/c/m/other/9.9.9', version: '9.9.9' }],
    },
  }
  assert.deepEqual(installedUpdate(json, '/c/m/unprose/0.6.0', '0.6.0', exists), { version: '0.6.2', root: '/c/m/unprose/0.6.2' })
  assert.equal(installedUpdate(json, '/c/m/unprose/0.6.2', '0.6.2', exists), undefined, 'already on it')
  assert.equal(installedUpdate({ plugins: { 'unprose@m': [{ installPath: '/c/m/unprose/0.7.0', version: '0.7.0' }] } }, '/c/m/unprose/0.6.0', '0.6.0', exists), undefined, 'the new folder has no launcher yet')
  assert.equal(installedUpdate('nonsense', '/c/m/unprose/0.6.0', '0.6.0', exists), undefined)
})

test('a plugin canvas follows claude plugin update: restarts on the newly installed version, once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-'))
  const installedFile = path.join(dir, 'installed_plugins.json')
  const write = (v: string) => fs.writeFileSync(installedFile, JSON.stringify({ version: 2, plugins: { 'unprose@unprose': [{ scope: 'user', installPath: '/c/u/u/' + v, version: v }] } }))
  write('0.6.0')
  const installer = new FakeInstaller()
  installer.files.add('/c/u/u/0.6.3/scripts/canvas.mjs')
  const launcher = new FakeLauncher('0.6.3')
  const svc = new UpdateService({ current: '0.6.0', install: { kind: 'plugin', root: '/c/u/u/0.6.0' }, installer, launcher, entry: '/c/u/u/0.6.0/dist/canvas.mjs', argv: ['serve', '--port', '4400', '--dir', '/b'], env: {}, logFile: '/tmp/x.log', installedFile, pollMs: 5 })
  const { h, events, calls } = fakeHandoff()
  const stop = svc.followInstalled(() => h, 10)
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(launcher.spawned, [], 'nothing newer installed: keeps running')
  write('0.6.3') // claude plugin update unprose@unprose, in a terminal
  await waitFor(() => calls.includes('exit 0'))
  stop()
  assert.deepEqual(launcher.spawned, [{ entry: '/c/u/u/0.6.3/scripts/canvas.mjs', args: ['--port', '4400', '--dir', '/b'] }])
  assert.match(events.map((e) => e.message).join('\n'), /the plugin was updated to v0\.6\.3/)
  assert.equal(svc.status().phase, 'done')

  // a checkout (or no install record) never follows
  const checkout = new UpdateService({ current: '0.6.0', install: { kind: 'checkout', root: '/r' }, installer, launcher: new FakeLauncher('0.6.3'), entry: '/r/e.js', argv: [], env: {}, logFile: '/tmp/x.log', installedFile })
  const off = checkout.followInstalled(() => h, 10)
  await new Promise((r) => setTimeout(r, 30))
  off()
})

test('a version that does not come up is not retried every tick', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-'))
  const installedFile = path.join(dir, 'installed_plugins.json')
  fs.writeFileSync(installedFile, JSON.stringify({ plugins: { 'unprose@unprose': [{ installPath: '/c/u/u/0.6.3', version: '0.6.3' }] } }))
  const installer = new FakeInstaller()
  installer.files.add('/c/u/u/0.6.3/scripts/canvas.mjs')
  const launcher = new FakeLauncher(undefined)
  const svc = new UpdateService({ current: '0.6.0', install: { kind: 'plugin', root: '/c/u/u/0.6.0' }, installer, launcher, entry: '/c/u/u/0.6.0/dist/canvas.mjs', argv: ['serve'], env: {}, logFile: '/tmp/x.log', installedFile, bootTimeoutMs: 30, pollMs: 5 })
  const { h, calls } = fakeHandoff()
  const stop = svc.followInstalled(() => h, 10)
  await waitFor(() => svc.status().phase === 'failed')
  await new Promise((r) => setTimeout(r, 60))
  stop()
  assert.equal(launcher.spawned.length, 1)
  assert.deepEqual(calls, ['pause', 'resume'])
})
