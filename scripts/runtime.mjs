// The plugin keeps itself runnable: find (or fetch) the bundled runtime, and keep a canvas it started on
// the plugin's version. Dependency-free on purpose — it runs from a fresh plugin install, before anything
// else works. Used by scripts/ensure.mjs (SessionStart hook), mcp.mjs, canvas.mjs, awd.mjs, entry.mjs.
//
// Why: a plugin update copies the plugin into a new version folder and there is no post-update hook
// (only SessionStart); the copy may lack dist/, and a canvas started from the old folder keeps running
// old code until that folder is deleted 14 days later. See docs/agents-setup.md → "Updates".
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const RELEASES = 'https://github.com/river0825/unprose/releases/download'
const FILES = { canvas: 'canvas.mjs', awd: 'awd.mjs' }
const DEV = { canvas: 'packages/canvas/dist/cli.js', awd: 'packages/cli/bin/awd.js' }

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}

/** The plugin's version: .claude-plugin/plugin.json, else package.json. */
export function pluginVersion(root = pluginRoot) {
  return readJson(path.join(root, '.claude-plugin/plugin.json'))?.version ?? readJson(path.join(root, 'package.json'))?.version ?? null
}

/** Where state that must survive plugin updates lives: $CLAUDE_PLUGIN_DATA (Claude Code), else ~/.awd/plugin. */
export function dataDir(env = process.env) {
  return env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.awd', 'plugin')
}

// ── runtime ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Where a runtime may be, in order: the plugin's own dist/, a copy unpacked into the data dir for this
 * version, a dev checkout's workspace build. Pure: `exists` is injected for tests.
 */
export function runtimeCandidates({ root = pluginRoot, data = dataDir(), version = pluginVersion(root) } = {}) {
  const out = [{ source: 'plugin', dir: path.join(root, 'dist'), canvas: path.join(root, 'dist', FILES.canvas), awd: path.join(root, 'dist', FILES.awd) }]
  if (version) {
    const dir = path.join(data, 'runtime', version)
    out.push({ source: 'data', dir, canvas: path.join(dir, FILES.canvas), awd: path.join(dir, FILES.awd) })
  }
  out.push({ source: 'dev', dir: root, canvas: path.join(root, DEV.canvas), awd: path.join(root, DEV.awd) })
  return out
}

/** The first candidate whose canvas and awd entries both exist, or undefined. */
export function findRuntime(opts = {}, exists = fs.existsSync) {
  return runtimeCandidates(opts).find((c) => exists(c.canvas) && exists(c.awd))
}

/** `<hex>  <file>` (sha256sum / shasum format) → hex, or undefined. */
export function parseSha256(text) {
  const m = String(text).trim().match(/^([0-9a-f]{64})\b/i)
  return m ? m[1].toLowerCase() : undefined
}

export const assetName = (version) => `unprose-runtime-v${version}.tgz`

async function fetchBuffer(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Download this version's runtime from its GitHub release, check it against the .sha256 asset, and
 * unpack it into <data>/runtime/<version>/. Returns the candidate, or throws with the reason.
 */
export async function downloadRuntime({ version, data = dataDir(), base = process.env.AWD_RUNTIME_URL || RELEASES, timeoutMs = 60_000, log = () => {} }) {
  if (!version) throw new Error('unknown plugin version')
  const name = assetName(version)
  const url = `${base}/v${version}/${name}`
  log(`downloading ${name} …`)
  const [tgz, sum] = await Promise.all([fetchBuffer(url, timeoutMs), fetchBuffer(`${url}.sha256`, timeoutMs)])
  const want = parseSha256(sum.toString('utf8'))
  const got = crypto.createHash('sha256').update(tgz).digest('hex')
  if (!want) throw new Error(`no checksum in ${name}.sha256`)
  if (want !== got) throw new Error(`checksum mismatch for ${name}`)
  const final = path.join(data, 'runtime', version)
  const tmp = `${final}.tmp-${process.pid}`
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  const file = path.join(tmp, name)
  fs.writeFileSync(file, tgz)
  const r = spawnSync('tar', ['-xzf', file, '-C', tmp], { encoding: 'utf8' })
  fs.rmSync(file, { force: true })
  if (r.status !== 0) throw new Error(`tar failed: ${(r.stderr || r.error?.message || '').trim()}`)
  if (!fs.existsSync(path.join(tmp, FILES.canvas)) || !fs.existsSync(path.join(tmp, FILES.awd))) throw new Error(`${name} has no ${FILES.canvas} / ${FILES.awd}`)
  fs.rmSync(final, { recursive: true, force: true })
  fs.renameSync(tmp, final)
  return { source: 'data', dir: final, canvas: path.join(final, FILES.canvas), awd: path.join(final, FILES.awd) }
}

/** The fix to print when nothing works. */
export function fixHint(root = pluginRoot) {
  return fs.existsSync(path.join(root, 'packages'))
    ? `(cd "${root}" && npm install && npm run build)`
    : `reinstall the plugin, or download ${RELEASES}/v<version>/${assetName('<version>')} and unpack it into "${path.join(dataDir(), 'runtime', '<version>')}"`
}

/**
 * A runnable runtime: found, else downloaded for this version, else (dev checkout) built. `log` gets short
 * status lines. Returns the candidate or undefined (with `reason`).
 */
export async function ensureRuntime({ root = pluginRoot, data = dataDir(), download = true, build = true, log = () => {} } = {}) {
  const version = pluginVersion(root)
  const found = findRuntime({ root, data, version })
  if (found) return { runtime: found }
  const reasons = []
  if (download && version && !fs.existsSync(path.join(root, 'packages'))) {
    try {
      const got = await downloadRuntime({ version, data, log })
      log(`runtime v${version} ready`)
      return { runtime: got }
    } catch (e) {
      reasons.push(`download: ${e.message}`)
    }
  }
  if (build && fs.existsSync(path.join(root, 'packages'))) {
    log('building the workspace (npm run build) …')
    const r = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
    const again = findRuntime({ root, data, version })
    if (again) return { runtime: again }
    reasons.push(`build: exit ${r.status}${r.stderr ? ` — ${r.stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`)
  }
  return { reason: `no runtime for v${version ?? '?'} (${reasons.join('; ') || 'nothing to try'}). Fix: ${fixHint(root)}` }
}

// ── canvas ──────────────────────────────────────────────────────────────────────────────────────

export const isLocal = (url) => {
  try {
    const h = new URL(url).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
  } catch {
    return false
  }
}

/**
 * A setting from the environment: AWD_* (set by you, or by the plugin's MCP config from its userConfig), else
 * the plugin option Claude Code exports to hooks (CLAUDE_PLUGIN_OPTION_<KEY>). Empty values and a
 * `${user_config.…}` Claude Code left unsubstituted count as unset.
 */
export function setting(env, name, option) {
  for (const v of [env[name], option && env[`CLAUDE_PLUGIN_OPTION_${option}`]]) {
    if (typeof v === 'string' && v.trim() && !/^\$\{[^}]*\}$/.test(v.trim())) return v.trim()
  }
  return undefined
}

/** The canvas origin from AWD_CANVAS_URL / the canvas_url option (a board link works too), default http://localhost:4400. */
export function canvasTarget(env = process.env) {
  const raw = setting(env, 'AWD_CANVAS_URL', 'CANVAS_URL') || 'http://localhost:4400'
  try {
    const u = new URL(raw)
    const i = u.pathname.search(/\/b\/[^/]+/)
    const prefix = (i >= 0 ? u.pathname.slice(0, i) : u.pathname).replace(/\/+$/, '')
    return `${u.protocol}//${u.host}${prefix}`
  } catch {
    return raw.replace(/\/+$/, '')
  }
}

export const portOf = (url) => {
  const u = new URL(url)
  return Number(u.port || (u.protocol === 'https:' ? 443 : 80))
}

/** Is automatic start/restart switched off? AWD_CANVAS_AUTOSTART=0 (or the plugin option canvas_autostart=false). */
export function autostartOff(env = process.env) {
  const v = String(setting(env, 'AWD_CANVAS_AUTOSTART', 'CANVAS_AUTOSTART') ?? '').toLowerCase()
  return v === '0' || v === 'false' || v === 'no' || v === 'off'
}

/**
 * What to do about the canvas — pure, so it can be tested.
 * probe: { reachable, version?, pid? } from GET /api/version; state: canvas.json or null;
 * alive(pid) → boolean. Returns { action: 'none' | 'start' | 'restart' | 'note', message? }.
 */
export function decideCanvas({ target, probe, state, alive = () => false, version, autostart = true, startIfDown = true, adopt }) {
  const v = (x) => (x ? `v${x}` : 'an unknown version')
  if (!isLocal(target)) {
    if (probe.reachable && version && probe.version && probe.version !== version) return { action: 'note', message: `the canvas at ${target} runs ${v(probe.version)}; the plugin is v${version} (it is not on this machine, so the plugin leaves it alone)` }
    if (!probe.reachable) return { action: 'note', message: `cannot reach the canvas at ${target} (AWD_CANVAS_URL); start it there` }
    return { action: 'none' }
  }
  if (!autostart) {
    if (!probe.reachable) return { action: 'note', message: `no canvas on ${target} and AWD_CANVAS_AUTOSTART=0 — start one with: node "${path.join(pluginRoot, 'scripts/canvas.mjs')}"` }
    return { action: 'none' }
  }
  const managedState = state && state.target === target && state.pid && alive(state.pid)
  if (!probe.reachable) return startIfDown ? { action: 'start' } : { action: 'none' }
  // ours: the pid it answers with is the one we started (older canvases do not answer a pid: fall back to the live pid on the same target)
  const ours = managedState && (probe.pid ? probe.pid === state.pid : true)
  if (probe.version === version) return { action: 'none' }
  if (ours) return { action: 'restart', pid: state.pid, args: state.args, message: `restarting the canvas: ${v(probe.version)} → v${version}` }
  // started by hand (an agent, a shell) but running this plugin's code: still the plugin's to keep current
  if (adopt && probe.pid) return { action: 'restart', pid: probe.pid, args: adopt, message: `restarting the canvas (started by hand from the plugin): ${v(probe.version)} → v${version}` }
  return { action: 'note', message: `a canvas ${v(probe.version)} is already running on ${target} (not started by the plugin); restart it to get v${version}` }
}

/** A local process's arguments: /proc (exact) on Linux, else `ps` (split on spaces). [] when unknown. */
export function processArgs(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
  } catch {}
  const r = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim().split(/\s+/).filter(Boolean) : []
}

/**
 * A canvas process running this plugin's code — any installed version (a sibling folder in the plugin
 * cache) or a runtime copy in the data dir — may be restarted on the plugin's version, whoever started it.
 * Returns its serve options (without `serve` and `--port`), or undefined for any other process. Pure.
 */
export function pluginCanvasArgs(argv, { root = pluginRoot, data = dataDir() } = {}) {
  const inCache = /[\\/]plugins[\\/]cache[\\/]/.test(root + path.sep)
  const under = (p, dir) => path.resolve(p).startsWith(path.resolve(dir) + path.sep)
  const i = argv.findIndex((a) => /canvas\.m?js$/.test(a) && ((inCache && under(a, path.dirname(root))) || under(a, path.join(data, 'runtime'))))
  if (i < 0) return undefined
  const rest = argv.slice(i + 1)
  if (rest[0] === 'serve') rest.shift()
  const out = []
  for (let j = 0; j < rest.length; j++) {
    if (rest[j] === '--port') j++
    else if (!rest[j].startsWith('--port=')) out.push(rest[j])
  }
  return out
}

export async function probeCanvas(target, timeoutMs = 1500) {
  try {
    const res = await fetch(`${target}/api/version`, { signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok) {
      const j = await res.json().catch(() => ({}))
      return { reachable: true, version: j.version ?? undefined, pid: typeof j.pid === 'number' ? j.pid : undefined }
    }
    // a canvas older than /api/version still answers /api/boards
    const b = await fetch(`${target}/api/boards`, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => undefined)
    return b?.ok ? { reachable: true } : { reachable: false }
  } catch {
    return { reachable: false }
  }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

const statePath = (data) => path.join(data, 'canvas.json')
export const readState = (data = dataDir()) => readJson(statePath(data)) ?? null
const writeState = (data, s) => {
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(statePath(data), JSON.stringify(s, null, 2) + '\n')
}

/** One ensure at a time per data dir (the hook and the MCP server start together). Stale after 60 s. */
async function withLock(data, fn) {
  const lock = path.join(data, 'ensure.lock')
  fs.mkdirSync(data, { recursive: true })
  for (let i = 0; i < 100; i++) {
    try {
      fs.mkdirSync(lock)
      try {
        return await fn()
      } finally {
        fs.rmSync(lock, { recursive: true, force: true })
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 60_000) fs.rmSync(lock, { recursive: true, force: true })
      } catch {}
      await new Promise((r) => setTimeout(r, 150))
    }
  }
  return fn() // give up waiting; better a duplicate check than no canvas
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function stopPid(pid) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  for (let i = 0; i < 50 && pidAlive(pid); i++) await sleep(100)
  if (pidAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
    for (let i = 0; i < 20 && pidAlive(pid); i++) await sleep(100)
  }
}

/**
 * Boards for a canvas the plugin starts: $AWD_BOARDS_DIR, else a dev checkout's existing ./boards (older
 * setups keep their data), else the server default (~/.awd/boards) — never inside a plugin install (unprose#1).
 */
export function boardsDirFor(root = pluginRoot, env = process.env) {
  if (env.AWD_BOARDS_DIR) return env.AWD_BOARDS_DIR
  const inCache = /[\\/]plugins[\\/]cache[\\/]/.test(root + path.sep)
  const legacy = path.join(root, 'boards')
  return !inCache && fs.existsSync(legacy) ? legacy : undefined
}

function startCanvas({ runtime, target, data, boardsDir, extra = [] }) {
  const port = portOf(target)
  fs.mkdirSync(data, { recursive: true })
  const logFile = path.join(data, 'canvas.log')
  const fd = fs.openSync(logFile, 'a')
  const args = [runtime.canvas, 'serve', '--port', String(port), ...(boardsDir && !extra.includes('--dir') ? ['--dir', boardsDir] : []), ...extra]
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, AWD_CANVAS_URL: target } })
  child.unref()
  fs.closeSync(fd)
  return { pid: child.pid, logFile }
}

/**
 * Keep the canvas on the plugin's version: start one if none answers locally, restart one the plugin
 * started when its version differs, never touch a canvas someone else runs (a note instead).
 */
export async function ensureCanvas({ runtime, root = pluginRoot, data = dataDir(), env = process.env, startIfDown = true, log = () => {} } = {}) {
  const target = canvasTarget(env)
  const version = pluginVersion(root)
  return withLock(data, async () => {
    const probe = await probeCanvas(target)
    const state = readState(data)
    const adopt = isLocal(target) && probe.pid && probe.version !== version ? pluginCanvasArgs(processArgs(probe.pid), { root, data }) : undefined
    const d = decideCanvas({ target, probe, state, alive: pidAlive, version, autostart: !autostartOff(env), startIfDown, adopt })
    if (d.action === 'none') return { action: 'none', target, version: probe.version }
    if (d.action === 'note') {
      log(d.message)
      return d
    }
    if (!runtime) {
      log(`cannot ${d.action} the canvas: no runtime`)
      return { action: 'note', message: 'no runtime' }
    }
    if (d.action === 'restart') {
      log(d.message)
      await stopPid(d.pid)
    }
    // a restarted canvas keeps its options (--dir, --studio-project, …); a new one gets the plugin's
    const extra = (d.action === 'restart' && d.args) || []
    const boardsDir = boardsDirFor(root, env)
    const { pid, logFile } = startCanvas({ runtime, target, data, boardsDir, extra })
    writeState(data, { pid, target, port: portOf(target), version, root, runtime: runtime.dir, startedAt: new Date().toISOString(), boardsDir: boardsDir ?? null, ...(extra.length ? { args: extra } : {}) })
    for (let i = 0; i < 100; i++) {
      const p = await probeCanvas(target, 800)
      if (p.reachable) {
        log(`canvas v${p.version ?? version} on ${target}${d.action === 'restart' ? ' (restarted)' : ''}`)
        return { action: d.action, target, pid, version: p.version }
      }
      if (!pidAlive(pid)) break
      await sleep(100)
    }
    log(`the canvas did not come up on ${target}; see ${logFile}`)
    return { action: 'note', message: `canvas failed to start (log: ${logFile})` }
  })
}

/**
 * The project a session works in: CLAUDE_PROJECT_DIR (Claude Code sets it for hooks), else the working
 * directory, lifted to its git top level; none for the home directory or `/` (docs/canvas.md "Projects").
 */
export function sessionProjectRoot(env = process.env, cwd = process.cwd(), home = os.homedir()) {
  const start = path.resolve(env.CLAUDE_PROJECT_DIR || cwd)
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    if (path.dirname(d) === d) break
  }
  if (start === path.resolve(home) || path.dirname(start) === start) return undefined
  return start
}

/**
 * Register the session's project with a canvas on this machine, so boards made in this session are
 * stored in <project>/.unprose/boards/. Quiet: a remote canvas, an older server or no project is fine.
 */
export async function registerSessionProject({ env = process.env, cwd = process.cwd(), timeoutMs = 2000 } = {}) {
  const target = canvasTarget(env)
  const root = sessionProjectRoot(env, cwd)
  if (!root || !isLocal(target)) return undefined
  try {
    const res = await fetch(`${target}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }), signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return undefined
    return (await res.json()).project?.id
  } catch {
    return undefined
  }
}
