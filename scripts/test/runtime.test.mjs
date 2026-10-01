// The plugin's self-heal (scripts/runtime.mjs): where the runtime comes from, and what happens to the canvas
// after an update. Decisions are tested as pure functions; one integration test starts real canvases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assetName, autostartOff, boardsDirFor, canvasTarget, decideCanvas, ensureCanvas, ensureRuntime, findRuntime,
  isLocal, parseSha256, pidAlive, pluginCanvasArgs, probeCanvas, processArgs, processCwd, readState, runtimeCandidates, setting,
} from '../runtime.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'unprose-selfheal-')))

// ── pure ──────────────────────────────────────────────────────────────────────────────────────────

test('runtime candidates: the plugin dist/, then this version in the data dir, then a dev checkout', () => {
  const c = runtimeCandidates({ root: '/p', data: '/d', version: '1.2.3' })
  assert.deepEqual(c.map((x) => x.source), ['plugin', 'data', 'dev'])
  assert.equal(c[0].canvas, '/p/dist/canvas.mjs')
  assert.equal(c[1].canvas, '/d/runtime/1.2.3/canvas.mjs')
  assert.equal(c[2].awd, '/p/packages/cli/bin/awd.js')
  assert.deepEqual(runtimeCandidates({ root: '/p', data: '/d', version: null }).map((x) => x.source), ['plugin', 'dev'])
})

test('findRuntime takes the first complete candidate', () => {
  const opts = { root: '/p', data: '/d', version: '1.2.3' }
  const has = (...files) => (f) => files.includes(f)
  assert.equal(findRuntime(opts, has('/p/dist/canvas.mjs', '/p/dist/awd.mjs', '/d/runtime/1.2.3/canvas.mjs', '/d/runtime/1.2.3/awd.mjs'))?.source, 'plugin')
  assert.equal(findRuntime(opts, has('/p/dist/canvas.mjs', '/d/runtime/1.2.3/canvas.mjs', '/d/runtime/1.2.3/awd.mjs'))?.source, 'data', 'a half dist/ does not count')
  assert.equal(findRuntime(opts, has('/p/packages/canvas/dist/cli.js', '/p/packages/cli/bin/awd.js'))?.source, 'dev')
  assert.equal(findRuntime(opts, has()), undefined)
})

test('small helpers: checksum files, asset names, targets, opt-out, local hosts', () => {
  assert.equal(parseSha256(`${'a'.repeat(64)}  unprose-runtime-v1.tgz\n`), 'a'.repeat(64))
  assert.equal(parseSha256('nope'), undefined)
  assert.equal(assetName('0.3.1'), 'unprose-runtime-v0.3.1.tgz')
  assert.equal(canvasTarget({}), 'http://localhost:4400')
  assert.equal(canvasTarget({ AWD_CANVAS_URL: 'https://canvas.example.com/b/b_123?x=1' }), 'https://canvas.example.com')
  assert.equal(canvasTarget({ AWD_CANVAS_URL: 'https://example.com/unprose/b/b_1' }), 'https://example.com/unprose')
  assert.equal(autostartOff({}), false)
  assert.equal(autostartOff({ AWD_CANVAS_AUTOSTART: '0' }), true)
  assert.equal(autostartOff({ CLAUDE_PLUGIN_OPTION_CANVAS_AUTOSTART: 'false' }), true)
  assert.ok(isLocal('http://127.0.0.1:4400') && isLocal('http://localhost:1') && !isLocal('https://canvas.example.com'))
})

test('boards for a plugin-started canvas: $AWD_BOARDS_DIR, a checkout’s ./boards, never inside the plugin cache', () => {
  const checkout = fs.mkdtempSync(path.join(tmp, 'checkout-'))
  fs.mkdirSync(path.join(checkout, 'boards'))
  assert.equal(boardsDirFor(checkout, { AWD_BOARDS_DIR: '/b' }), '/b')
  assert.equal(boardsDirFor(checkout, {}), path.join(checkout, 'boards'))
  const cached = path.join(tmp, 'plugins', 'cache', 'unprose', 'unprose', '0.3.1')
  fs.mkdirSync(path.join(cached, 'boards'), { recursive: true })
  assert.equal(boardsDirFor(cached, {}), undefined, 'server default (~/.awd/boards)')
})

test('canvas decisions after an update', () => {
  const local = 'http://localhost:4400'
  const base = { target: local, version: '0.3.1', alive: (pid) => pid === 42 }
  const ours = { target: local, pid: 42, version: '0.3.0' }
  // nothing running → start (unless the MCP server only wants to check)
  assert.equal(decideCanvas({ ...base, probe: { reachable: false }, state: null }).action, 'start')
  assert.equal(decideCanvas({ ...base, probe: { reachable: false }, state: null, startIfDown: false }).action, 'none')
  // ours, old version → restart; ours, same version → nothing
  assert.equal(decideCanvas({ ...base, probe: { reachable: true, version: '0.3.0', pid: 42 }, state: ours }).action, 'restart')
  assert.equal(decideCanvas({ ...base, probe: { reachable: true, version: '0.3.1', pid: 42 }, state: ours }).action, 'none')
  // an older canvas that does not report its pid: the live pid on the same target is ours
  assert.equal(decideCanvas({ ...base, probe: { reachable: true }, state: ours }).action, 'restart')
  // someone else's canvas (different pid, or no state, or a stale pid) → never touched, a note instead
  const note = decideCanvas({ ...base, probe: { reachable: true, version: '0.3.0', pid: 7 }, state: ours })
  assert.equal(note.action, 'note')
  assert.match(note.message, /not started by the plugin/)
  assert.equal(decideCanvas({ ...base, probe: { reachable: true, version: '0.3.0' }, state: null }).action, 'note')
  assert.equal(decideCanvas({ ...base, probe: { reachable: true, version: '0.3.0', pid: 43 }, state: { ...ours, pid: 43 } }).action, 'note', 'pid 43 is dead: stale state')
  // opted out: never start or restart
  assert.equal(decideCanvas({ ...base, autostart: false, probe: { reachable: false }, state: null }).action, 'note')
  assert.equal(decideCanvas({ ...base, autostart: false, probe: { reachable: true, version: '0.3.0', pid: 42 }, state: ours }).action, 'none')
  // a remote canvas is never started or stopped
  const remote = { ...base, target: 'https://canvas.example.com' }
  assert.equal(decideCanvas({ ...remote, probe: { reachable: false }, state: null }).action, 'note')
  assert.match(decideCanvas({ ...remote, probe: { reachable: true, version: '0.3.0' }, state: null }).message, /leaves it alone/)
  assert.equal(decideCanvas({ ...remote, probe: { reachable: true, version: '0.3.1' }, state: null }).action, 'none')
  // started by hand but running the plugin's code → restarted on the new version, keeping its options
  const adopted = decideCanvas({ ...base, probe: { reachable: true, version: '0.3.0', pid: 7 }, state: null, adopt: ['--dir', '/b'] })
  assert.deepEqual([adopted.action, adopted.pid, adopted.args], ['restart', 7, ['--dir', '/b']])
})

test('a canvas running the plugin’s code (any installed version or its runtime copy) is the plugin’s to restart', () => {
  const cache = '/h/.claude/plugins/cache/unprose/unprose'
  const o = { root: `${cache}/0.5.0`, data: '/h/.claude/plugins/data/unprose' }
  assert.deepEqual(pluginCanvasArgs(['node', `${cache}/0.4.0/dist/canvas.mjs`, 'serve', '--port', '4400', '--dir', '/b'], o), ['--dir', '/b'])
  assert.deepEqual(pluginCanvasArgs(['node', `${cache}/0.4.0/scripts/canvas.mjs`, '--port=4400'], o), [])
  assert.deepEqual(pluginCanvasArgs(['node', `${o.data}/runtime/0.4.0/canvas.mjs`, 'serve'], o), [])
  // anything else: a checkout, another plugin, the MCP server
  assert.equal(pluginCanvasArgs(['node', '/h/code/unprose/scripts/canvas.mjs'], o), undefined)
  assert.equal(pluginCanvasArgs(['node', '/h/.claude/plugins/cache/other/x/1.0.0/dist/canvas.mjs'], o), undefined)
  assert.equal(pluginCanvasArgs(['node', `${cache}/0.4.0/scripts/mcp.mjs`], o), undefined)
  // a plugin loaded from a checkout (not the cache): its sibling folders are not plugin versions
  assert.equal(pluginCanvasArgs(['node', '/h/code/other/dist/canvas.mjs'], { root: '/h/code/unprose', data: o.data }), undefined)
  // started with a relative path from the plugin folder (cd <plugin> && node scripts/canvas.mjs --dir boards)
  assert.deepEqual(pluginCanvasArgs(['node', 'scripts/canvas.mjs', '--dir', 'b'], { ...o, cwd: `${cache}/0.4.0` }), ['--dir', `${cache}/0.4.0/b`])
  assert.equal(pluginCanvasArgs(['node', 'scripts/canvas.mjs'], { ...o, cwd: '/h/code/unprose' }), undefined)
  assert.equal(pluginCanvasArgs(['node', 'scripts/canvas.mjs'], o), undefined, 'cwd unknown: not recognised')
  assert.equal(processCwd(process.pid), fs.realpathSync(process.cwd()))
  assert.ok(processArgs(process.pid).some((a) => a.endsWith('node') || a.includes('node')), 'reads this process’s own command line')
})

test("the plugin's MCP server resolves to the plugin's scripts/mcp.mjs, never the user's project", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin/plugin.json'), 'utf8'))
  const server = manifest.mcpServers?.unprose
  assert.ok(server, 'plugin.json declares the unprose server itself (not only a root .mcp.json)')
  // Claude Code substitutes plain ${NAME} (docs: plugins-reference → Environment variables); no shell defaults
  const all = JSON.stringify(manifest) + fs.readFileSync(path.join(repo, 'hooks/hooks.json'), 'utf8')
  assert.doesNotMatch(all, /\$\{[A-Za-z_][A-Za-z0-9_]*:-/, 'no ${VAR:-default}: it once resolved to "." = the project dir')
  const pluginDir = plugin('layout-for-mcp', '0.9.3', { withDist: false })
  fs.mkdirSync(path.join(pluginDir, 'scripts'))
  fs.writeFileSync(path.join(pluginDir, 'scripts/mcp.mjs'), '')
  const project = fs.mkdtempSync(path.join(tmp, 'some-project-'))
  const expand = (v) => v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => ({ CLAUDE_PLUGIN_ROOT: pluginDir, CLAUDE_PLUGIN_DATA: path.join(tmp, 'd') })[k] ?? '')
  const script = path.resolve(project, expand(server.args[0])) // a relative result would land in the project
  assert.equal(script, path.join(pluginDir, 'scripts/mcp.mjs'))
  assert.ok(fs.existsSync(script))
  // user options reach the server as ${user_config.*}; unsubstituted or empty means the default
  assert.equal(canvasTarget({ AWD_CANVAS_URL: '${user_config.canvas_url}' }), 'http://localhost:4400')
  assert.equal(canvasTarget({ AWD_CANVAS_URL: '' }), 'http://localhost:4400')
  assert.equal(canvasTarget({ CLAUDE_PLUGIN_OPTION_CANVAS_URL: 'https://canvas.example.com/b/b_1' }), 'https://canvas.example.com', 'a hook reads the option')
  assert.equal(autostartOff({ AWD_CANVAS_AUTOSTART: '${user_config.canvas_autostart}' }), false)
  assert.equal(setting({ AWD_X: ' ', CLAUDE_PLUGIN_OPTION_X: 'y' }, 'AWD_X', 'X'), 'y')
})

// The export script lives only in the private repo (it is not exported), so the public repo's CI skips this.
const exportScript = path.join(repo, 'scripts/export-public.sh')
test('the public export ships no root .mcp.json and no ${VAR:-} form (checked by scripts/export-public.sh)', { skip: !fs.existsSync(exportScript) && 'export script not in this checkout (public repo)' }, () => {
  const sh = fs.readFileSync(path.join(repo, 'scripts/export-public.sh'), 'utf8')
  assert.match(sh, /^\s+\.mcp\.json\s/m, '.mcp.json is in the exclude list')
  assert.match(sh, /VAR:-default/, 'the export rejects the default form')
})

// ── integration: real canvases from a bundled runtime ────────────────────────────────────────────

const built = fs.existsSync(path.join(repo, 'packages/canvas/dist/cli.js')) && fs.existsSync(path.join(repo, 'packages/canvas/web/dist/index.html'))
let bundle
function bundleOnce() {
  if (bundle) return bundle
  bundle = path.join(tmp, 'bundle')
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts/bundle.mjs'), bundle], { cwd: repo, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return bundle
}
/** A fake installed plugin: .claude-plugin/plugin.json + dist/ at `version`. */
function plugin(name, version, { withDist = true } = {}) {
  const root = path.join(tmp, name)
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'unprose', version }))
  if (withDist) {
    fs.cpSync(bundleOnce(), path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist/package.json'), JSON.stringify({ name: 'unprose-runtime', version, private: true, type: 'module' }))
  }
  return root
}
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
const started = []
const kill = (pid) => {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
}
test.after(() => started.forEach(kill))

test('first session after an update: start the canvas, restart it on the new version, leave a foreign one alone', { skip: !built && 'run npm run build first', timeout: 120_000 }, async () => {
  const data = path.join(tmp, 'data-a')
  const port = await freePort()
  const env = { AWD_CANVAS_URL: `http://127.0.0.1:${port}`, AWD_BOARDS_DIR: path.join(tmp, 'boards') }
  const log = () => {}

  // 0.9.0 installed, nothing running → the plugin starts its canvas
  const v1 = plugin('plugin-0.9.0', '0.9.0')
  const first = await ensureCanvas({ runtime: findRuntime({ root: v1, data }), root: v1, data, env, log })
  assert.equal(first.action, 'start')
  started.push(first.pid)
  assert.equal((await probeCanvas(env.AWD_CANVAS_URL)).version, '0.9.0')
  assert.equal(readState(data).pid, first.pid)

  // the same session again → nothing to do
  assert.equal((await ensureCanvas({ runtime: findRuntime({ root: v1, data }), root: v1, data, env, log })).action, 'none')

  // plugin updated to 0.9.1 (a new version folder) → the plugin's canvas is restarted from it
  const v2 = plugin('plugin-0.9.1', '0.9.1')
  const second = await ensureCanvas({ runtime: findRuntime({ root: v2, data }), root: v2, data, env, log })
  assert.equal(second.action, 'restart')
  started.push(second.pid)
  assert.notEqual(second.pid, first.pid)
  assert.equal(pidAlive(first.pid), false, 'the old canvas is stopped')
  const now = await probeCanvas(env.AWD_CANVAS_URL)
  assert.equal(now.version, '0.9.1')
  assert.equal(now.pid, second.pid)

  // a canvas the person started (no state for it) → left alone, with a note
  const port2 = await freePort()
  const foreign = spawn(process.execPath, [path.join(v1, 'dist/canvas.mjs'), 'serve', '--port', String(port2), '--dir', path.join(tmp, 'boards-2')], { stdio: 'ignore' })
  started.push(foreign.pid)
  const env2 = { AWD_CANVAS_URL: `http://127.0.0.1:${port2}` }
  for (let i = 0; i < 100 && !(await probeCanvas(env2.AWD_CANVAS_URL)).reachable; i++) await new Promise((r) => setTimeout(r, 100))
  const notes = []
  const third = await ensureCanvas({ runtime: findRuntime({ root: v2, data }), root: v2, data: path.join(tmp, 'data-b'), env: env2, log: (s) => notes.push(s) })
  assert.equal(third.action, 'note')
  assert.match(notes.join('\n'), /not started by the plugin/)
  assert.equal(pidAlive(foreign.pid), true)
  assert.equal((await probeCanvas(env2.AWD_CANVAS_URL)).version, '0.9.0')
})

test('after an update, a canvas started by hand from the plugin is restarted on the new version with its options', { skip: !built && 'run npm run build first', timeout: 120_000 }, async () => {
  const data = path.join(tmp, 'data-c')
  const port = await freePort()
  const env = { AWD_CANVAS_URL: `http://127.0.0.1:${port}` }
  const v1 = plugin('plugins/cache/unprose/unprose/0.9.0', '0.9.0')
  const v2 = plugin('plugins/cache/unprose/unprose/0.9.1', '0.9.1')
  const dir = path.join(tmp, 'boards-by-hand')
  // an agent restarted the canvas itself: no plugin state records it
  fs.mkdirSync(path.join(v1, 'scripts'))
  for (const f of ['canvas.mjs', 'runtime.mjs']) fs.copyFileSync(path.join(repo, 'scripts', f), path.join(v1, 'scripts', f))
  // as the other project's agent did: cd into the plugin folder, then a relative script path
  const byHand = spawn(process.execPath, ['scripts/canvas.mjs', '--port', String(port), '--dir', dir], { cwd: v1, stdio: 'ignore' })
  started.push(byHand.pid)
  for (let i = 0; i < 100 && !(await probeCanvas(env.AWD_CANVAS_URL)).reachable; i++) await new Promise((r) => setTimeout(r, 100))
  const r = await ensureCanvas({ runtime: findRuntime({ root: v2, data }), root: v2, data, env, log: () => {} })
  assert.equal(r.action, 'restart')
  started.push(r.pid)
  assert.equal(pidAlive(byHand.pid), false, 'the old canvas is stopped')
  assert.equal((await probeCanvas(env.AWD_CANVAS_URL)).version, '0.9.1')
  assert.deepEqual(readState(data).args, ['--dir', dir], 'its board folder is kept')
  assert.ok(processArgs(r.pid).includes(dir))
})

test('claude plugin update in a terminal: a running plugin canvas restarts on the new version by itself', { skip: !built && 'run npm run build first', timeout: 120_000 }, async () => {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const v1 = plugin('follow/plugins/cache/unprose/unprose/0.9.0', '0.9.0')
  const v2 = plugin('follow/plugins/cache/unprose/unprose/0.9.1', '0.9.1')
  for (const v of [v1, v2]) {
    fs.mkdirSync(path.join(v, 'scripts'), { recursive: true })
    for (const f of ['canvas.mjs', 'runtime.mjs']) fs.copyFileSync(path.join(repo, 'scripts', f), path.join(v, 'scripts', f))
  }
  const config = path.join(tmp, 'follow', 'claude-config')
  const record = (root, version) => {
    fs.mkdirSync(path.join(config, 'plugins'), { recursive: true })
    fs.writeFileSync(path.join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'unprose@unprose': [{ scope: 'user', installPath: root, version }] } }))
  }
  record(v1, '0.9.0')
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config, UNPROSE_FOLLOW_INSTALLED_MS: '200', UNPROSE_UPDATE_CHECK: '0', HOME: path.join(tmp, 'follow') }
  const old = spawn(process.execPath, [path.join(v1, 'dist/canvas.mjs'), 'serve', '--port', String(port), '--dir', path.join(tmp, 'follow-boards')], { env, stdio: 'ignore' })
  started.push(old.pid)
  for (let i = 0; i < 100 && !(await probeCanvas(url)).reachable; i++) await new Promise((r) => setTimeout(r, 100))
  assert.equal((await probeCanvas(url)).version, '0.9.0')
  record(v2, '0.9.1') // what `claude plugin update unprose@unprose` writes
  let now
  for (let i = 0; i < 150; i++) {
    now = await probeCanvas(url)
    if (now.version === '0.9.1') break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.equal(now?.version, '0.9.1', 'the canvas restarted on the new version')
  if (now.pid) started.push(now.pid)
  for (let i = 0; i < 50 && pidAlive(old.pid); i++) await new Promise((r) => setTimeout(r, 100))
  assert.equal(pidAlive(old.pid), false, 'the old server exited')
  assert.ok(processArgs(now.pid).includes(path.join(tmp, 'follow-boards')), 'with the same board folder')
})

test('an install without dist/ downloads its runtime from the release (checksum verified)', { skip: !built && 'run npm run build first', timeout: 120_000 }, async () => {
  const version = '0.9.2'
  const src = plugin('src-0.9.2', version)
  const tgz = path.join(tmp, assetName(version))
  assert.equal(spawnSync('tar', ['-czf', tgz, '-C', path.join(src, 'dist'), '.']).status, 0)
  const bytes = fs.readFileSync(tgz)
  const good = `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${assetName(version)}\n`
  let sum = good
  const server = http.createServer((req, res) => {
    if (req.url === `/v${version}/${assetName(version)}`) return res.end(bytes)
    if (req.url === `/v${version}/${assetName(version)}.sha256`) return res.end(sum)
    res.statusCode = 404
    res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const prev = process.env.AWD_RUNTIME_URL
  process.env.AWD_RUNTIME_URL = `http://127.0.0.1:${server.address().port}`
  try {
    const bare = plugin('installed-0.9.2', version, { withDist: false })
    // a wrong checksum is refused
    sum = `${'0'.repeat(64)}  x\n`
    const bad = await ensureRuntime({ root: bare, data: path.join(tmp, 'data-c'), build: false })
    assert.equal(bad.runtime, undefined)
    assert.match(bad.reason, /checksum mismatch/)
    // the right one is unpacked into the data dir, and found without a download next time
    sum = good
    const ok = await ensureRuntime({ root: bare, data: path.join(tmp, 'data-c'), build: false })
    assert.equal(ok.runtime?.source, 'data')
    assert.ok(fs.existsSync(path.join(tmp, 'data-c/runtime', version, 'canvas.mjs')))
    server.close()
    assert.equal((await ensureRuntime({ root: bare, data: path.join(tmp, 'data-c'), build: false })).runtime?.source, 'data')
  } finally {
    if (prev === undefined) delete process.env.AWD_RUNTIME_URL
    else process.env.AWD_RUNTIME_URL = prev
    server.close()
  }
})

test('the session project (for the SessionStart hook): CLAUDE_PROJECT_DIR or cwd, lifted to the repo; none for home', async () => {
  const { sessionProjectRoot, registerSessionProject } = await import('../runtime.mjs')
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-sess-')))
  const root = path.join(base, 'repo')
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
  assert.equal(sessionProjectRoot({ CLAUDE_PROJECT_DIR: path.join(root, 'sub') }, '/', '/nohome'), root)
  assert.equal(sessionProjectRoot({}, base, base), undefined)
  // a remote canvas is never asked to register a local directory
  assert.equal(await registerSessionProject({ env: { AWD_CANVAS_URL: 'https://canvas.example.com', CLAUDE_PROJECT_DIR: root } }), undefined)
})
