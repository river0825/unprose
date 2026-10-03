// SVG → PNG for canvas_snapshot (docs/canvas.md "Seeing the board"), with resvg (https://github.com/yisibl/resvg-js).
// Where the rasterizer comes from, in order — lazily, on the first PNG request, once:
//   1. the npm package `@resvg/resvg-js` (an optionalDependency of @awd/canvas: a checkout or an npm install has it);
//   2. a prebuilt native this canvas downloaded before, in <data>/native/resvg/<version>/ (<data> =
//      $CLAUDE_PLUGIN_DATA, else ~/.awd/plugin) — the plugin bundle has no node_modules and a native addon cannot be
//      bundled into dist/*.mjs;
//   3. a download of this platform's `@resvg/resvg-js-<platform>-<arch>` tarball from the npm registry, pinned to the
//      exact version and sha512 integrity of package-lock.json (src/resvgPins.ts, baked into the build). The tarball
//      is checked against the integrity before anything is unpacked; only its one `.node` file is extracted (no
//      install scripts run, nothing else is written); a lock directory keeps two canvases from downloading at once.
// Anything that fails (offline, an unsupported platform, an integrity mismatch) leaves the snapshot SVG with a
// one-line reason. UNPROSE_SNAPSHOT_PNG: `0` turns PNG off, `never-download` uses only 1 and 2, `download` skips 1
// (prefers the downloaded native). UNPROSE_NPM_REGISTRY points 3 at a mirror (the integrity still has to match).
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { RESVG_PINS, RESVG_VERSION, type ResvgPin } from './resvgPins.js'
import { userAgent } from './version.js'

export interface Raster {
  png?: Buffer
  /** why there is no PNG (one line) */
  why?: string
  /** what drew it: `resvg 2.6.2 (npm package)`, `resvg 2.6.2 (downloaded native)`, or `svg` */
  renderer: string
}

type RenderFn = (svg: string, opts: Record<string, unknown>) => Uint8Array
interface Loaded {
  render: RenderFn
  renderer: string
}
type PackageModule = { Resvg: new (svg: string, opts?: Record<string, unknown>) => { render(): { asPng(): Uint8Array } } }
/** The raw napi binding: options as a JSON string (the package's index.js does the stringify). */
type NativeModule = { Resvg: new (svg: string, opts?: string) => { render(): { asPng(): Uint8Array } } }

export type PngMode = 'off' | 'auto' | 'never-download' | 'download'

export function pngMode(env: NodeJS.ProcessEnv = process.env): PngMode {
  const v = (env.UNPROSE_SNAPSHOT_PNG ?? '').trim().toLowerCase()
  if (v === '0' || v === 'off' || v === 'false' || v === 'no') return 'off'
  if (v === 'never-download' || v === 'no-download') return 'never-download'
  if (v === 'download') return 'download'
  return 'auto'
}

export interface RasterDeps {
  env: NodeJS.ProcessEnv
  /** $CLAUDE_PLUGIN_DATA, else ~/.awd/plugin */
  dataDir: string
  pins: ResvgPin[]
  version: string
  platform: string
  arch: string
  /** linux only: which C library this Node runs on */
  libc: () => 'glibc' | 'musl' | undefined
  /** the installed npm package, or undefined */
  importPackage: () => Promise<PackageModule | undefined>
  /** load a `.node` file (createRequire) */
  loadNative: (file: string) => NativeModule
  fetch: typeof fetch
  now: () => number
  /** how long a failed load is remembered before trying again (ms) */
  retryMs: number
  /** how long to wait for another process's download (ms) */
  lockWaitMs: number
  timeoutMs: number
}

const RESVG = '@resvg/resvg-js'
const REGISTRY = 'https://registry.npmjs.org'
const MAX_TARBALL = 50 * 1024 * 1024
const STALE_LOCK_MS = 120_000
const nodeRequire = createRequire(import.meta.url)

function defaultLibc(): 'glibc' | 'musl' | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header
    return header?.glibcVersionRuntime ? 'glibc' : 'musl'
  } catch {
    return 'glibc'
  }
}

async function defaultImportPackage(): Promise<PackageModule | undefined> {
  // a variable specifier: neither TypeScript nor esbuild resolves it, and a missing package is a normal answer
  try {
    const m = (await import(RESVG)) as PackageModule & { default?: PackageModule }
    return m && typeof m.Resvg === 'function' ? m : m.default && typeof m.default.Resvg === 'function' ? m.default : undefined
  } catch {
    return undefined
  }
}

function packageVersion(): string | undefined {
  try {
    return (nodeRequire(`${RESVG}/package.json`) as { version?: string }).version
  } catch {
    return undefined
  }
}

export function defaultDeps(env: NodeJS.ProcessEnv = process.env): RasterDeps {
  return {
    env,
    dataDir: env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.awd', 'plugin'),
    pins: RESVG_PINS,
    version: RESVG_VERSION,
    platform: process.platform,
    arch: process.arch,
    libc: defaultLibc,
    importPackage: defaultImportPackage,
    loadNative: (file) => nodeRequire(file) as NativeModule,
    fetch: (...a) => fetch(...a),
    now: Date.now,
    retryMs: 10 * 60_000,
    lockWaitMs: 90_000,
    timeoutMs: 60_000,
  }
}

// ── pure parts: which package, the integrity check, the tarball ─────────────────────────────────────────

/** The pinned native package for this platform (os × cpu × libc as npm declares them), or undefined. */
export function selectPin(pins: ResvgPin[], platform: string, arch: string, libc?: 'glibc' | 'musl'): ResvgPin | undefined {
  return pins.find((p) => p.os.includes(platform) && p.cpu.includes(arch) && (!p.libc || (libc !== undefined && p.libc.includes(libc))))
}

/** Does `data` match an SRI string (`sha512-<base64>`, possibly several)? Only sha512 counts. */
export function checkIntegrity(data: Buffer, integrity: string): boolean {
  const want = integrity
    .split(/\s+/)
    .filter((s) => s.startsWith('sha512-'))
    .map((s) => Buffer.from(s.slice('sha512-'.length).replace(/\?.*$/, ''), 'base64'))
  if (!want.length) return false
  const got = crypto.createHash('sha512').update(data).digest()
  return want.some((w) => w.length === got.length && crypto.timingSafeEqual(w, got))
}

/**
 * The one `package/<name>.node` file (and package/package.json) of an npm tarball. A small ustar reader: regular
 * files only, no links, no paths outside `package/`; nothing is written. Throws when there is not exactly one.
 */
export function extractNative(tgz: Buffer): { file: string; data: Buffer; pkg?: { name?: string; version?: string } } {
  const tar = zlib.gunzipSync(tgz, { maxOutputLength: 4 * MAX_TARBALL })
  const cstr = (b: Buffer) => {
    const z = b.indexOf(0)
    return b.subarray(0, z < 0 ? b.length : z).toString('utf8')
  }
  const found: Array<{ file: string; data: Buffer }> = []
  let pkg: { name?: string; version?: string } | undefined
  let paxPath: string | undefined
  for (let off = 0; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512)
    if (h.every((b) => b === 0)) break
    const sizeField = cstr(h.subarray(124, 136)).trim()
    if (!/^[0-7]*$/.test(sizeField)) throw new Error('unreadable tar header')
    const size = parseInt(sizeField || '0', 8)
    const type = String.fromCharCode(h[156] || 48)
    const isUstar = h.subarray(257, 262).toString('latin1') === 'ustar'
    const prefix = isUstar ? cstr(h.subarray(345, 500)) : ''
    const name = paxPath ?? (prefix ? `${prefix}/${cstr(h.subarray(0, 100))}` : cstr(h.subarray(0, 100)))
    const body = tar.subarray(off + 512, off + 512 + size)
    if (body.length < size) throw new Error('truncated tarball')
    off += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1]
      continue
    }
    paxPath = undefined
    if (type !== '0') continue // directories, links, global headers …: never extracted
    if (/^package\/[\w.-]+\.node$/.test(name)) found.push({ file: name.slice('package/'.length), data: Buffer.from(body) })
    else if (name === 'package/package.json') {
      try {
        pkg = JSON.parse(body.toString('utf8')) as { name?: string; version?: string }
      } catch {
        // no package.json to compare: the integrity check already vouched for the tarball
      }
    }
  }
  if (found.length !== 1) throw new Error(found.length ? 'more than one .node file in the tarball' : 'no .node file in the tarball')
  return { ...found[0], pkg }
}

// ── the loader ──────────────────────────────────────────────────────────────────────────────────────────

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const short = (msg: string) => msg.replace(/\s+/g, ' ').trim().slice(0, 160)
const NO = 'no PNG rasterizer'

interface Manifest {
  name: string
  version: string
  integrity: string
  file: string
  sha256: string
}

export function createRasterizer(over: Partial<RasterDeps> = {}) {
  const d: RasterDeps = { ...defaultDeps(over.env), ...over }
  let ok: Promise<Loaded> | undefined
  let failed: { at: number; why: string } | undefined
  let inflight: Promise<Loaded | { why: string }> | undefined

  const fromNative = (m: NativeModule, renderer: string): Loaded => ({ render: (svg, opts) => new m.Resvg(svg, JSON.stringify(opts)).render().asPng(), renderer })
  const nativeDir = () => path.join(d.dataDir, 'native', 'resvg', d.version)
  const manifestPath = (pin: ResvgPin) => path.join(nativeDir(), `${pin.name.replace(/^@resvg\//, '')}.json`)

  /** The native downloaded before, if it is there and intact; throws when it is there but will not load. */
  function cached(pin: ResvgPin): Loaded | undefined {
    let man: Manifest
    try {
      man = JSON.parse(fs.readFileSync(manifestPath(pin), 'utf8')) as Manifest
    } catch {
      return undefined
    }
    if (man.name !== pin.name || man.version !== pin.version || man.integrity !== pin.integrity || !/^[\w.-]+\.node$/.test(man.file)) return undefined
    const file = path.join(nativeDir(), man.file)
    let data: Buffer
    try {
      data = fs.readFileSync(file)
    } catch {
      return undefined
    }
    if (sha256(data) !== man.sha256) return undefined // half-written or changed: download again
    return fromNative(d.loadNative(file), `resvg ${pin.version} (downloaded native, ${file})`)
  }

  async function download(pin: ResvgPin): Promise<void> {
    const base = (d.env.UNPROSE_NPM_REGISTRY || REGISTRY).replace(/\/+$/, '')
    const url = pin.resolved.startsWith(REGISTRY) ? base + pin.resolved.slice(REGISTRY.length) : pin.resolved
    const res = await d.fetch(url, { signal: AbortSignal.timeout(d.timeoutMs), redirect: 'follow', headers: { 'user-agent': userAgent('snapshot') } })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_TARBALL) throw new Error(`the tarball is ${len} bytes — too big`)
    const tgz = Buffer.from(await res.arrayBuffer())
    if (tgz.length > MAX_TARBALL) throw new Error(`the tarball is ${tgz.length} bytes — too big`)
    if (!checkIntegrity(tgz, pin.integrity)) throw new IntegrityError(`${pin.name}@${pin.version} failed its integrity check (its sha512 is not the one in package-lock.json) — nothing was installed`)
    const { file, data, pkg } = extractNative(tgz)
    if (pkg && (pkg.name !== pin.name || pkg.version !== pin.version)) throw new IntegrityError(`the tarball says it is ${pkg.name}@${pkg.version}, not ${pin.name}@${pin.version}`)
    const dir = nativeDir()
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `.${file}.tmp-${process.pid}`)
    fs.writeFileSync(tmp, data, { mode: 0o644 })
    fs.renameSync(tmp, path.join(dir, file))
    const man: Manifest = { name: pin.name, version: pin.version, integrity: pin.integrity, file, sha256: sha256(data) }
    const mtmp = `${manifestPath(pin)}.tmp-${process.pid}`
    fs.writeFileSync(mtmp, JSON.stringify(man, null, 2) + '\n')
    fs.renameSync(mtmp, manifestPath(pin))
  }

  /** Download under a lock directory; another process holding it → wait for its result. */
  async function downloadLocked(pin: ResvgPin): Promise<Loaded> {
    fs.mkdirSync(nativeDir(), { recursive: true })
    const lock = path.join(nativeDir(), `.lock-${pin.name.replace(/^@resvg\//, '')}`)
    const deadline = d.now() + d.lockWaitMs
    for (;;) {
      try {
        fs.mkdirSync(lock)
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
      try {
        if (d.now() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS) {
          fs.rmSync(lock, { recursive: true, force: true }) // a crashed download
          continue
        }
      } catch {
        continue // released meanwhile
      }
      const done = cached(pin)
      if (done) return done
      if (d.now() > deadline) throw new Error('another process has been downloading it for too long')
      await new Promise((r) => setTimeout(r, 200))
    }
    try {
      const done = cached(pin) // it finished while we waited for the lock
      if (done) return done
      await download(pin)
      const now = cached(pin)
      if (!now) throw new Error('the downloaded native did not verify')
      return now
    } finally {
      fs.rmSync(lock, { recursive: true, force: true })
    }
  }

  async function load(): Promise<Loaded | { why: string }> {
    const mode = pngMode(d.env)
    if (mode !== 'download') {
      const m = await d.importPackage()
      if (m) {
        const v = packageVersion()
        return { render: (svg, opts) => new m.Resvg(svg, opts).render().asPng(), renderer: `resvg${v ? ` ${v}` : ''} (npm package ${RESVG})` }
      }
    }
    const libc = d.platform === 'linux' ? d.libc() : undefined
    const pin = selectPin(d.pins, d.platform, d.arch, libc)
    if (!pin) return { why: `${NO}: resvg publishes no prebuilt native for ${d.platform}-${d.arch}${libc ? `-${libc}` : ''} and ${RESVG} is not installed, so the snapshot is SVG` }
    try {
      const c = cached(pin)
      if (c) return c
    } catch (e) {
      return { why: `${NO}: the downloaded ${pin.name} would not load (${short((e as Error).message)}), so the snapshot is SVG` }
    }
    if (mode === 'never-download') return { why: `${NO}: ${RESVG} is not installed and downloading it is off (UNPROSE_SNAPSHOT_PNG=never-download), so the snapshot is SVG` }
    try {
      return await downloadLocked(pin)
    } catch (e) {
      const msg = short((e as Error).message)
      if (e instanceof IntegrityError) return { why: `${NO}: ${msg}; the snapshot is SVG` }
      return { why: `${NO}: could not get ${pin.name}@${pin.version} from the npm registry (${msg}), so the snapshot is SVG — tried again in ${Math.round(d.retryMs / 60_000)} min` }
    }
  }

  /** The rasterizer, loaded once (a failure is remembered for `retryMs`), or why there is none. */
  async function rasterizer(): Promise<Loaded | { why: string }> {
    if (ok) return ok
    if (failed && d.now() - failed.at < d.retryMs) return { why: failed.why }
    inflight ??= load().then((r) => {
      inflight = undefined
      if ('render' in r) {
        ok = Promise.resolve(r)
        failed = undefined
      } else failed = { at: d.now(), why: r.why }
      return r
    })
    return inflight
  }

  /** Rasterize a self-contained SVG; `{ why }` when no rasterizer is available or it fails. */
  async function svgToPng(svg: string): Promise<Raster> {
    if (pngMode(d.env) === 'off') return { why: 'PNG output is turned off on this canvas (UNPROSE_SNAPSHOT_PNG=0), so the snapshot is SVG', renderer: 'svg' }
    const r = await rasterizer()
    if (!('render' in r)) return { why: r.why, renderer: 'svg' }
    try {
      const png = r.render(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' }, background: 'rgba(0,0,0,0)' })
      return { png: Buffer.from(png), renderer: r.renderer }
    } catch (e) {
      return { why: `rasterizing failed (${short((e as Error).message)}); here is the SVG`, renderer: 'svg' }
    }
  }

  return { svgToPng, rasterizer }
}

class IntegrityError extends Error {}

let shared: ReturnType<typeof createRasterizer> | undefined

/** Rasterize a self-contained SVG with the canvas's rasterizer (see the top of this file). */
export function svgToPng(svg: string): Promise<Raster> {
  shared ??= createRasterizer()
  return shared.svgToPng(svg)
}
