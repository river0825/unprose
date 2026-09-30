// Upgrading the canvas from the canvas (docs/canvas.md "Updating"): which version is newer, how this server
// was installed, what upgrading it means, and where the new version will start from. Pure: no IO — paths are
// strings, the file checks are injected — so every rule is testable; updater.ts drives the ports.

/** A parsed semantic version: 0.4.1, 1.2.0-beta.2 (a leading "v" is allowed). */
export interface Version {
  major: number
  minor: number
  patch: number
  pre: (string | number)[]
}

export function parseVersion(v: string): Version | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return undefined
  const pre = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : []
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre }
}

/** < 0 when a is older than b, 0 when equal, > 0 when newer (semver precedence; unparseable sorts oldest). */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return x ? 1 : y ? -1 : 0
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] - y[k]
  // a release is newer than any of its prereleases
  if (!x.pre.length || !y.pre.length) return x.pre.length ? -1 : y.pre.length ? 1 : 0
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    if (typeof p === 'number' && typeof q === 'number') return p - q
    if (typeof p === 'number') return -1 // numeric identifiers sort before alphanumeric ones
    if (typeof q === 'number') return 1
    return p < q ? -1 : 1
  }
  return 0
}

export const isNewer = (latest: string | undefined, current: string | undefined) => !!latest && !!current && compareVersions(latest, current) > 0

export type InstallKind = 'plugin' | 'checkout' | 'bundle' | 'unknown'

export interface Install {
  kind: InstallKind
  /** plugin: the version directory in the plugin cache; checkout: the git work tree; bundle: the runtime dir. */
  root?: string
  /** checkout: a dev work tree with packages/ (needs npm ci + build) or a clone that commits dist/. */
  build?: boolean
  /** Why this install cannot be upgraded from the canvas, if it cannot. */
  unsupported?: string
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const dirname = (p: string) => norm(p).replace(/\/[^/]*$/, '') || '/'
const join = (...parts: string[]) => norm(parts.join('/'))

/**
 * How this server was installed, from the entry script it runs (realpath of argv[1]) and its environment.
 * `exists(path)` answers file-system questions (a `.git` entry, `packages/`).
 */
export function detectInstall(entry: string, env: Record<string, string | undefined>, exists: (p: string) => boolean): Install {
  const e = norm(entry)
  // Claude Code plugin: …/plugins/cache/<marketplace>/<plugin>/<version>/…
  const cache = /^(.*\/plugins\/cache\/[^/]+\/[^/]+\/[^/]+)(?:\/|$)/.exec(e)
  if (cache) return { kind: 'plugin', root: cache[1] }
  if (env.CLAUDE_PLUGIN_ROOT) return { kind: 'plugin', root: norm(env.CLAUDE_PLUGIN_ROOT) }
  // a runtime bundle unpacked into a data dir: …/runtime/<version>/canvas.mjs
  const bundle = /^(.*\/runtime\/[^/]+)\/canvas\.mjs$/.exec(e)
  if (bundle) return { kind: 'bundle', root: bundle[1] }
  // a git work tree: the dev checkout (packages/…/dist/cli.js) or a clone of the published repo (dist/canvas.mjs)
  for (let d = dirname(e), i = 0; i < 8 && d !== '/'; d = dirname(d), i++) {
    if (exists(join(d, '.git'))) return { kind: 'checkout', root: d, build: exists(join(d, 'packages')) }
  }
  return { kind: 'unknown', unsupported: 'this canvas was not started from a plugin install, a runtime bundle or a git checkout' }
}

export type Phase = 'checking' | 'installing' | 'building' | 'restarting' | 'done' | 'failed'

export interface Step {
  phase: 'installing' | 'building'
  command: string
  args: string[]
  cwd?: string
}

export interface Plan {
  /** Commands to run, in order (a bundle downloads instead: `download` is set). */
  steps: Step[]
  /** bundle: download this version's runtime into `dir`. */
  download?: { version: string; dir: string }
  /** checkout: refuse when tracked files have uncommitted changes. */
  requireClean?: string
  /** What to run by hand, shown when the canvas cannot upgrade itself. */
  command: string
}

/** What upgrading means for this install. */
export function planUpgrade(install: Install, latest: string, pluginRef = 'unprose@unprose'): Plan {
  if (install.kind === 'plugin') return { steps: [{ phase: 'installing', command: 'claude', args: ['plugin', 'update', pluginRef] }], command: `claude plugin update ${pluginRef}` }
  if (install.kind === 'checkout' && install.root) {
    const cwd = install.root
    const steps: Step[] = [{ phase: 'installing', command: 'git', args: ['pull', '--ff-only'], cwd }]
    if (install.build) steps.push({ phase: 'installing', command: 'npm', args: ['ci'], cwd }, { phase: 'building', command: 'npm', args: ['run', 'build'], cwd })
    return { steps, requireClean: cwd, command: `cd ${cwd} && git pull --ff-only${install.build ? ' && npm ci && npm run build' : ''}` }
  }
  if (install.kind === 'bundle' && install.root) {
    const dir = join(dirname(install.root), latest)
    return { steps: [], download: { version: latest, dir }, command: `download unprose-runtime-v${latest}.tgz from the GitHub release into ${dir}` }
  }
  return { steps: [], command: 'reinstall Unprose (see the README)' }
}

/**
 * The script the upgraded server starts from. A checkout rebuilds in place (same script); a plugin gets a
 * sibling version directory and starts through its launcher (which also fetches a missing runtime); a bundle
 * uses the sibling runtime directory.
 */
export function nextEntry(install: Install, entry: string, latest: string): string {
  if (install.kind === 'plugin' && install.root) return join(dirname(install.root), latest, 'scripts', 'canvas.mjs')
  if (install.kind === 'bundle' && install.root) return join(dirname(install.root), latest, 'canvas.mjs')
  return norm(entry)
}

/**
 * The arguments for the new server. The plugin launcher (scripts/canvas.mjs) adds `serve` itself, so the
 * `serve` subcommand is dropped there; everything after it (port, --dir, --project …) is kept as is.
 */
export function nextArgs(install: Install, argvAfterEntry: string[]): string[] {
  if (install.kind !== 'plugin') return argvAfterEntry
  return argvAfterEntry[0] === 'serve' ? argvAfterEntry.slice(1) : argvAfterEntry
}

/** The CHANGELOG section of one version ("## [0.4.1] — …" up to the next "## "), without its heading. */
export function notesOf(changelog: string, version: string): string | undefined {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^## \\[?v?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && (l.startsWith('## ') || /^\[[^\]]+\]:\s/.test(l)))
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
  return body || undefined
}

/**
 * For a page reached from elsewhere (a tunnel): the same answer with this machine's absolute paths replaced by
 * `<unprose folder>` — the canvas has no login, so where things live stays private. Pure, deep, strings only.
 */
export function redactPaths<T>(value: T): T {
  const ABS = /(?:\/(?:Users|home|root|private|var|opt|tmp|mnt|srv)\/[^\s'"`]*)|(?:[A-Za-z]:\\[^\s'"`]*)/g
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(ABS, '<unprose folder>')
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as T
}
