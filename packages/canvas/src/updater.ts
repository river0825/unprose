// Upgrading the canvas from the canvas (docs/canvas.md "Updating"): check for a newer release (cached),
// run the install-specific upgrade as one job, then hand the port over to the new server. The rules live in
// updatePolicy.ts; the ports do the IO; the server only routes requests and provides the handoff.
import fs from 'node:fs'
import path from 'node:path'
import type { Installer, Launcher, UpdateSource } from './ports/update.js'
import { installedUpdate, isNewer, nextArgs, nextEntry, planUpgrade, type Install, type InstallKind, type Phase } from './updatePolicy.js'

export interface UpdateCheck {
  current: string | null
  latest?: string
  available: boolean
  /** Release notes of the latest version (the release body). */
  notes?: string
  url?: string
  checkedAt?: string
  source?: string
  error?: string
  install: InstallKind
  /** Can this install upgrade itself at all (independent of who asks)? */
  supported: boolean
  /** Why not, when it cannot. */
  reason?: string
  /** What to run by hand. */
  command: string
  /** A refresh asked for within REFRESH_THROTTLE of the previous check: this is that check's result. */
  throttled?: boolean
  /** This canvas restarts by itself after `claude plugin update` (followInstalled is running). */
  followsPluginUpdate?: boolean
}

export interface UpdateEvent {
  type: 'update'
  phase: Phase
  message: string
  at: string
  version?: string
}

export interface UpdateStatus {
  running: boolean
  phase?: Phase
  message?: string
  version?: string
  startedAt?: string
  /** Last output lines of the upgrade commands, oldest first. */
  log: string[]
}

/** What the server does for the restart: stop serving, serve again (the new server failed), or exit. */
export interface Handoff {
  port: number
  emit(e: UpdateEvent): void
  /** Stop accepting requests and close the page connections (they reconnect to the new server). */
  pause(): Promise<void>
  /** Listen again on the same port (the new server did not come up). */
  resume(): Promise<void>
  exit(code: number): void
}

export interface UpdateServiceOptions {
  current: string | null
  install: Install
  /** Absent: update checks are off (UNPROSE_UPDATE_CHECK=0). */
  source?: UpdateSource
  installer: Installer
  launcher: Launcher
  /** The running entry script (realpath of argv[1]) and the arguments after it. */
  entry: string
  argv: string[]
  env: Record<string, string>
  /** Where the check result is kept across restarts. */
  cacheFile?: string
  /** Where the new server's output goes. */
  logFile: string
  /** The plugin's canvas.json (${CLAUDE_PLUGIN_DATA}/canvas.json), updated when this process is the one it records. */
  stateFile?: string
  /** Claude Code's record of installed plugins (~/.claude/plugins/installed_plugins.json): a plugin canvas follows it. */
  installedFile?: string
  /** Started by launchd with KeepAlive: exit after installing and let launchd start the new version. */
  launchd?: boolean
  pluginRef?: string
  ttlMs?: number
  bootTimeoutMs?: number
  pollMs?: number
  now?: () => number
  pid?: number
}

interface Cached {
  latest?: string
  notes?: string
  url?: string
  source?: string
  error?: string
  checkedAt: string
  current: string | null
}

const SIX_HOURS = 6 * 60 * 60 * 1000
const ERROR_TTL = 30 * 60 * 1000
/** "Check for updates" more often than this answers with the previous check (protects the GitHub rate limit). */
export const REFRESH_THROTTLE = 30 * 1000
const LOG_LINES = 200

export class UpdateService {
  private cache?: Cached
  private checking?: Promise<Cached>
  private job: UpdateStatus = { running: false, log: [] }
  private following = false

  constructor(private o: UpdateServiceOptions) {
    try {
      if (o.cacheFile) {
        const c = JSON.parse(fs.readFileSync(o.cacheFile, 'utf8')) as Cached
        if (c.current === o.current) this.cache = c // a cache from another version is stale by definition
      }
    } catch {
      /* no cache yet */
    }
  }

  private now() {
    return this.o.now?.() ?? Date.now()
  }

  /** The install can upgrade itself (who may ask is the server's call). */
  get supported(): { ok: boolean; reason?: string } {
    const i = this.o.install
    if (i.unsupported) return { ok: false, reason: i.unsupported }
    if (!this.o.current) return { ok: false, reason: 'the running version is unknown' }
    return { ok: true }
  }

  private fresh(c: Cached | undefined): boolean {
    if (!c) return false
    const age = this.now() - Date.parse(c.checkedAt)
    return age < (c.error ? ERROR_TTL : (this.o.ttlMs ?? SIX_HOURS))
  }

  /** The previous check is younger than REFRESH_THROTTLE: a refresh answers with it. */
  private recent(c: Cached | undefined): boolean {
    return !!c && this.now() - Date.parse(c.checkedAt) < REFRESH_THROTTLE
  }

  private async lookup(refresh: boolean): Promise<Cached> {
    if (!refresh && this.fresh(this.cache)) return this.cache!
    if (refresh && this.recent(this.cache)) return this.cache!
    if (this.checking) return this.checking
    const src = this.o.source!
    this.checking = src
      .latest()
      .then((r): Cached => ({ latest: r.version, notes: r.notes, url: r.url, source: r.source, checkedAt: new Date(this.now()).toISOString(), current: this.o.current }))
      .catch((e: Error): Cached => ({ error: e.message, checkedAt: new Date(this.now()).toISOString(), current: this.o.current }))
      .then((c) => {
        this.cache = c
        try {
          if (this.o.cacheFile) {
            fs.mkdirSync(path.dirname(this.o.cacheFile), { recursive: true })
            fs.writeFileSync(this.o.cacheFile, JSON.stringify(c, null, 2) + '\n')
          }
        } catch {
          /* the in-memory cache still works */
        }
        return c
      })
      .finally(() => (this.checking = undefined))
    return this.checking
  }

  async check(refresh = false): Promise<UpdateCheck> {
    const s = this.supported
    const base = { current: this.o.current, install: this.o.install.kind, supported: s.ok, reason: s.reason }
    const command = (latest?: string) => planUpgrade(this.o.install, latest ?? this.o.current ?? '0.0.0', this.o.pluginRef).command
    if (!this.o.source) return { ...base, ...(this.following ? { followsPluginUpdate: true } : {}), available: false, error: 'update checks are off (UNPROSE_UPDATE_CHECK=0)', command: command() }
    const throttled = refresh && !this.checking && this.recent(this.cache)
    const c = await this.lookup(refresh)
    return { ...base, ...(throttled ? { throttled: true } : {}), ...(this.following ? { followsPluginUpdate: true } : {}), latest: c.latest, available: isNewer(c.latest, this.o.current ?? undefined), notes: c.notes, url: c.url, checkedAt: c.checkedAt, source: c.source, error: c.error, command: command(c.latest) }
  }

  status(): UpdateStatus {
    return { ...this.job, log: [...this.job.log] }
  }

  /** Start the upgrade in the background. Resolves once it has started (or with why it cannot). */
  async start(h: Handoff): Promise<{ started: boolean; error?: string; version?: string }> {
    if (this.job.running) return { started: false, error: 'an upgrade is already running' }
    const s = this.supported
    if (!s.ok) return { started: false, error: s.reason }
    const c = await this.check(true)
    if (!c.latest) return { started: false, error: c.error ?? 'no release found' }
    if (!c.available) return { started: false, error: `already on the latest version (v${this.o.current})` }
    this.job = { running: true, phase: 'checking', message: `upgrading to v${c.latest}`, version: c.latest, startedAt: new Date(this.now()).toISOString(), log: [] }
    void this.run(c.latest, h)
    return { started: true, version: c.latest }
  }

  private say(h: Handoff, phase: Phase, message: string) {
    this.job.phase = phase
    this.job.message = message
    h.emit({ type: 'update', phase, message, at: new Date(this.now()).toISOString(), version: this.job.version })
  }

  private line = (l: string) => {
    this.job.log.push(l)
    if (this.job.log.length > LOG_LINES) this.job.log.splice(0, this.job.log.length - LOG_LINES)
  }

  private fail(h: Handoff, message: string) {
    this.say(h, 'failed', message)
    this.job.running = false
  }

  private async run(latest: string, h: Handoff): Promise<void> {
    const { installer, launcher, install } = this.o
    const plan = planUpgrade(install, latest, this.o.pluginRef)
    try {
      this.say(h, 'checking', `preparing the upgrade to v${latest}`)
      if (plan.requireClean) {
        const dirty = await installer.dirtyFiles(plan.requireClean)
        if (dirty.length) return this.fail(h, `not upgrading: tracked files have uncommitted changes (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ' …' : ''}). Commit or stash them, or run: ${plan.command}`)
      }
      for (const step of plan.steps) {
        this.say(h, step.phase, `${[step.command, ...step.args].join(' ')}`)
        await installer.run(step, this.line)
      }
      if (plan.download) {
        this.say(h, 'installing', `downloading the v${latest} runtime`)
        await installer.downloadRuntime(plan.download.version, plan.download.dir, this.line)
      }
      const entry = nextEntry(install, this.o.entry, latest)
      if (!installer.exists(entry)) return this.fail(h, `the new version is not where it should be (${entry}); run: ${plan.command}`)

      this.say(h, 'restarting', `restarting on v${latest}`)
      await this.restartOn(entry, h)
    } catch (e) {
      this.fail(h, `${(e as Error).message}${plan.command ? ` — to do it by hand: ${plan.command}` : ''}`)
    }
  }

  /** Hand the port to a server started from `entry`; if it does not come up, keep serving. */
  private async restartOn(entry: string, h: Handoff): Promise<void> {
    const { launcher, install } = this.o
    if (this.o.launchd) {
      // launchd (KeepAlive) starts the same command again, which now runs the new code
      setTimeout(() => h.exit(0), 300)
      return
    }
    await h.pause()
    const pid = launcher.spawnDetached(entry, nextArgs(install, this.o.argv), this.o.env, this.o.logFile)
    const until = this.now() + (this.o.bootTimeoutMs ?? 15_000)
    let answered: string | undefined
    while (this.now() < until) {
      answered = await launcher.probeVersion(h.port)
      if (answered && answered !== this.o.current) break
      await new Promise((r) => setTimeout(r, this.o.pollMs ?? 250))
    }
    if (!answered || answered === this.o.current) {
      launcher.kill(pid)
      await h.resume()
      return this.fail(h, `the new server did not come up on port ${h.port}; still on v${this.o.current}. Its output: ${this.o.logFile}`)
    }
    this.recordState(pid, answered, entry)
    this.job.phase = 'done'
    this.job.message = `upgraded to v${answered}`
    this.job.running = false
    h.exit(0)
  }

  /** A newer version of this plugin that Claude Code has installed (`claude plugin update`), if any. */
  installedNewer(): { version: string; entry: string } | undefined {
    const { install, installedFile } = this.o
    if (install.kind !== 'plugin' || !installedFile) return undefined
    let json: unknown
    try {
      json = JSON.parse(fs.readFileSync(installedFile, 'utf8'))
    } catch {
      return undefined
    }
    const found = installedUpdate(json, install.root, this.o.current, (p) => this.o.installer.exists(p))
    return found && { version: found.version, entry: path.join(found.root, 'scripts', 'canvas.mjs') }
  }

  /**
   * Follow `claude plugin update`: there is no post-update hook, so a plugin canvas looks at Claude Code's
   * install record every `everyMs` and, when a newer version of itself is installed, restarts on it (the same
   * port handoff as Upgrade; the pages reconnect). Returns a stop function.
   */
  followInstalled(handoff: () => Handoff, everyMs = 10_000): () => void {
    // under launchd the same (old) command would come back: leave that setup to its own restart
    if (this.o.install.kind !== 'plugin' || !this.o.installedFile || this.o.launchd) return () => undefined
    this.following = true
    let busy = false
    const tried = new Set<string>() // a version that failed to come up is not retried every tick
    const tick = async () => {
      if (busy || this.job.running) return
      const next = this.installedNewer()
      if (!next || tried.has(next.version)) return
      busy = true
      tried.add(next.version)
      const h = handoff()
      this.job = { running: true, phase: 'restarting', message: `the plugin was updated to v${next.version}`, version: next.version, startedAt: new Date(this.now()).toISOString(), log: [] }
      try {
        this.say(h, 'restarting', `the plugin was updated to v${next.version} — restarting on it`)
        await this.restartOn(next.entry, h)
      } catch (e) {
        this.fail(h, `could not restart on v${next.version}: ${(e as Error).message}`)
      } finally {
        busy = false
      }
    }
    const timer = setInterval(() => void tick(), everyMs)
    timer.unref?.()
    void tick()
    return () => {
      clearInterval(timer)
      this.following = false
    }
  }

  /** Keep the plugin's canvas.json pointing at the running canvas, so the next session does not restart it. */
  private recordState(pid: number, version: string, entry: string) {
    const f = this.o.stateFile
    if (!f) return
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>
      if (s.pid !== (this.o.pid ?? process.pid)) return // the plugin did not start this canvas
      const root = this.o.install.kind === 'plugin' ? path.dirname(path.dirname(entry)) : s.root
      const runtime = this.o.install.kind === 'plugin' ? path.join(String(root), 'dist') : path.dirname(entry)
      fs.writeFileSync(f, JSON.stringify({ ...s, pid, version, root, runtime, startedAt: new Date(this.now()).toISOString() }, null, 2) + '\n')
    } catch {
      /* no state file: the canvas was not started by the plugin */
    }
  }
}
