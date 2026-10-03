// PNG snapshots (src/raster.ts): the installed package first, then the downloaded native, then a download pinned
// to package-lock.json's sha512 — never the network here (fetch is a fake serving a tarball built in the test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { checkIntegrity, createRasterizer, extractNative, pngMode, selectPin, svgToPng, type RasterDeps } from '../src/raster.js'
import { RESVG_PINS, RESVG_VERSION, type ResvgPin } from '../src/resvgPins.js'
import { headerJson } from '../src/server.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#ffb648"/></svg>'

/** A minimal ustar archive, gzipped — what `npm pack` makes. */
function tgz(files: Array<{ name: string; data: Buffer | string; type?: string }>): Buffer {
  const blocks: Buffer[] = []
  for (const f of files) {
    const data = Buffer.from(f.data)
    const h = Buffer.alloc(512)
    h.write(f.name, 0, 100, 'utf8')
    h.write('0000644\0', 100)
    h.write('0000000\0', 108)
    h.write('0000000\0', 116)
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    h.write('00000000000\0', 136)
    h.write('        ', 148)
    h.write(f.type ?? '0', 156)
    h.write('ustar\0', 257)
    h.write('00', 263)
    let sum = 0
    for (const b of h) sum += b
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(blocks))
}
const sri = (b: Buffer) => `sha512-${crypto.createHash('sha512').update(b).digest('base64')}`

const PIN_BASE: ResvgPin = { name: '@resvg/resvg-js-testos-testcpu', version: '9.9.9', resolved: 'https://registry.npmjs.org/@resvg/resvg-js-testos-testcpu/-/resvg-js-testos-testcpu-9.9.9.tgz', integrity: '', os: ['testos'], cpu: ['testcpu'] }
const NATIVE_BYTES = Buffer.from('not really a native addon')
const GOOD = tgz([
  { name: 'package/package.json', data: JSON.stringify({ name: PIN_BASE.name, version: '9.9.9', scripts: { postinstall: 'echo pwned > /tmp/pwned' } }) },
  { name: 'package/README.md', data: 'hello' },
  { name: 'package/../../escape.node', data: 'nope' },
  { name: 'package/resvgjs.testos-testcpu.node', data: NATIVE_BYTES },
])
const PIN: ResvgPin = { ...PIN_BASE, integrity: sri(GOOD) }

/** A fake napi binding: records what it was asked to load and renders a PNG signature. */
function fakeNative(loaded: string[]) {
  return (file: string) => {
    loaded.push(file)
    return { Resvg: class { constructor(_svg: string, opts?: string) { assert.equal(typeof opts, 'string', 'the raw binding takes JSON options') } render() { return { asPng: () => Uint8Array.from([...PNG_SIG, 1]) } } } }
  }
}
function fakeFetch(body: Buffer, calls: string[]): typeof fetch {
  return (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(new Uint8Array(body), { status: 200 })
  }) as typeof fetch
}
function deps(dataDir: string, over: Partial<RasterDeps> = {}): Partial<RasterDeps> {
  return { env: {}, dataDir, pins: [PIN], version: '9.9.9', platform: 'testos', arch: 'testcpu', libc: () => undefined, importPackage: async () => undefined, retryMs: 60_000, lockWaitMs: 2_000, ...over }
}
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'unprose-raster-'))

test('the pins match package-lock.json (scripts/resvg-pins.mjs) and cover what resvg publishes', async () => {
  const { pinsSource, currentLock } = (await import(path.join(ROOT, 'scripts/resvg-pins.mjs'))) as { pinsSource: (l: unknown) => string; currentLock: () => unknown }
  assert.equal(fs.readFileSync(path.join(ROOT, 'packages/canvas/src/resvgPins.ts'), 'utf8'), pinsSource(currentLock()), 'run node scripts/resvg-pins.mjs')
  const lock = currentLock() as { packages: Record<string, { version: string }> }
  assert.equal(lock.packages['node_modules/@resvg/resvg-js'].version, RESVG_VERSION)
  for (const [plat, arch, libc] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64', 'glibc'], ['linux', 'x64', 'musl'], ['linux', 'arm64', 'glibc'], ['linux', 'arm64', 'musl'], ['win32', 'x64'], ['win32', 'arm64']] as const) {
    const p = selectPin(RESVG_PINS, plat, arch, libc)
    assert.ok(p && /^sha512-/.test(p.integrity) && p.version === RESVG_VERSION, `${plat}-${arch}-${libc ?? ''}`)
  }
  assert.equal(selectPin(RESVG_PINS, 'linux', 'x64', 'musl')!.name, '@resvg/resvg-js-linux-x64-musl')
  assert.equal(selectPin(RESVG_PINS, 'linux', 'x64', undefined), undefined, 'a linux pin needs the libc')
  assert.equal(selectPin(RESVG_PINS, 'sunos', 'x64'), undefined)
})

test('UNPROSE_SNAPSHOT_PNG modes', () => {
  assert.equal(pngMode({}), 'auto')
  assert.equal(pngMode({ UNPROSE_SNAPSHOT_PNG: '0' }), 'off')
  assert.equal(pngMode({ UNPROSE_SNAPSHOT_PNG: 'never-download' }), 'never-download')
  assert.equal(pngMode({ UNPROSE_SNAPSHOT_PNG: 'download' }), 'download')
})

test('the integrity check and the tarball reader: only the one .node file, a tampered tarball is rejected', () => {
  assert.ok(checkIntegrity(GOOD, PIN.integrity))
  const tampered = Buffer.from(GOOD)
  tampered[tampered.length - 20] ^= 0xff
  assert.equal(checkIntegrity(tampered, PIN.integrity), false)
  assert.equal(checkIntegrity(GOOD, 'sha1-abc'), false, 'only sha512 counts')
  const x = extractNative(GOOD)
  assert.equal(x.file, 'resvgjs.testos-testcpu.node')
  assert.deepEqual(x.data, NATIVE_BYTES)
  assert.equal(x.pkg?.name, PIN.name)
  assert.throws(() => extractNative(tgz([{ name: 'package/a.node', data: 'a' }, { name: 'package/b.node', data: 'b' }])), /more than one/)
  assert.throws(() => extractNative(tgz([{ name: 'package/x.node', data: 'a', type: '2' }])), /no \.node/, 'a symlink is never extracted')
})

test('a tampered tarball is not installed: SVG with the reason, nothing written', async () => {
  const dir = scratch()
  const evil = tgz([{ name: 'package/package.json', data: JSON.stringify({ name: PIN.name, version: '9.9.9' }) }, { name: 'package/resvgjs.testos-testcpu.node', data: 'evil' }])
  const loaded: string[] = []
  const r = await createRasterizer(deps(dir, { fetch: fakeFetch(evil, []), loadNative: fakeNative(loaded) })).svgToPng(SVG)
  assert.equal(r.png, undefined)
  assert.equal(r.renderer, 'svg')
  assert.match(r.why!, /integrity check/)
  assert.ok(!r.why!.includes('\n'), 'one line')
  assert.deepEqual(loaded, [])
  const native = path.join(dir, 'native/resvg/9.9.9')
  assert.deepEqual(fs.existsSync(native) ? fs.readdirSync(native) : [], [], 'nothing left behind (no lock, no file)')
})

test('the loader prefers the installed package, then the cached native, then a download', async () => {
  const dir = scratch()
  const calls: string[] = []
  const loaded: string[] = []
  const pkg = { Resvg: class { constructor(_s: string, o?: unknown) { assert.equal(typeof o, 'object') } render() { return { asPng: () => Uint8Array.from([...PNG_SIG, 2]) } } } }
  // 1. installed package: no download, no native
  const a = await createRasterizer(deps(dir, { importPackage: async () => pkg, fetch: fakeFetch(GOOD, calls), loadNative: fakeNative(loaded) })).svgToPng(SVG)
  assert.equal(a.png![8], 2)
  assert.match(a.renderer, /npm package/)
  assert.deepEqual([calls, loaded], [[], []])
  // 3. nothing installed, nothing cached → one download (concurrent requests share it), unpacked, loaded
  const r3 = createRasterizer(deps(dir, { fetch: fakeFetch(GOOD, calls), loadNative: fakeNative(loaded), env: { UNPROSE_NPM_REGISTRY: 'https://mirror.example/npm/' } }))
  const [b, b2] = await Promise.all([r3.svgToPng(SVG), r3.svgToPng(SVG)])
  assert.ok(b.png!.subarray(0, 8).equals(PNG_SIG) && b2.png)
  assert.match(b.renderer, /downloaded native/)
  assert.deepEqual(calls, ['https://mirror.example/npm/@resvg/resvg-js-testos-testcpu/-/resvg-js-testos-testcpu-9.9.9.tgz'])
  const file = path.join(dir, 'native/resvg/9.9.9/resvgjs.testos-testcpu.node')
  assert.deepEqual(fs.readFileSync(file), NATIVE_BYTES)
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ['resvg-js-testos-testcpu.json', 'resvgjs.testos-testcpu.node'], 'only the .node and its manifest; the lock is gone')
  assert.deepEqual(loaded, [file])
  await r3.svgToPng(SVG)
  assert.equal(calls.length, 1, 'loaded once')
  // 2. a new canvas: the cached native, no download — even with downloads off
  const c = await createRasterizer(deps(dir, { fetch: fakeFetch(GOOD, calls), loadNative: fakeNative(loaded), env: { UNPROSE_SNAPSHOT_PNG: 'never-download' } })).svgToPng(SVG)
  assert.ok(c.png)
  assert.equal(calls.length, 1)
  // a changed cached file is not loaded: downloaded again
  fs.writeFileSync(file, 'changed')
  const d = await createRasterizer(deps(dir, { fetch: fakeFetch(GOOD, calls), loadNative: fakeNative(loaded) })).svgToPng(SVG)
  assert.ok(d.png)
  assert.equal(calls.length, 2)
  assert.deepEqual(fs.readFileSync(file), NATIVE_BYTES)
  // `download` skips the installed package
  const e = await createRasterizer(deps(dir, { importPackage: async () => pkg, loadNative: fakeNative(loaded), env: { UNPROSE_SNAPSHOT_PNG: 'download' } })).svgToPng(SVG)
  assert.match(e.renderer, /downloaded native/)
})

test('a waiting canvas takes the native another process downloaded under the lock', async () => {
  const dir = scratch()
  const native = path.join(dir, 'native/resvg/9.9.9')
  fs.mkdirSync(path.join(native, '.lock-resvg-js-testos-testcpu'), { recursive: true })
  const calls: string[] = []
  const p = createRasterizer(deps(dir, { fetch: fakeFetch(GOOD, calls), loadNative: fakeNative([]) })).svgToPng(SVG)
  // "the other process" finishes: file + manifest, then releases the lock
  setTimeout(() => {
    fs.writeFileSync(path.join(native, 'resvgjs.testos-testcpu.node'), NATIVE_BYTES)
    fs.writeFileSync(path.join(native, 'resvg-js-testos-testcpu.json'), JSON.stringify({ name: PIN.name, version: '9.9.9', integrity: PIN.integrity, file: 'resvgjs.testos-testcpu.node', sha256: crypto.createHash('sha256').update(NATIVE_BYTES).digest('hex') }))
    fs.rmSync(path.join(native, '.lock-resvg-js-testos-testcpu'), { recursive: true })
  }, 300)
  const r = await p
  assert.ok(r.png)
  assert.deepEqual(calls, [], 'no second download')
})

test('no PNG: off, offline, unsupported platform, downloads off — each with a one-line reason', async () => {
  const dir = scratch()
  const off = await createRasterizer(deps(dir, { env: { UNPROSE_SNAPSHOT_PNG: '0' } })).svgToPng(SVG)
  assert.match(off.why!, /turned off/)
  let n = 0
  const offline = (async () => {
    n++
    throw new TypeError('fetch failed')
  }) as typeof fetch
  const r = createRasterizer(deps(dir, { fetch: offline }))
  const o = await r.svgToPng(SVG)
  assert.match(o.why!, /^no PNG rasterizer: could not get @resvg\/resvg-js-testos-testcpu@9\.9\.9 .*fetch failed.*SVG/)
  assert.equal(o.renderer, 'svg')
  await r.svgToPng(SVG)
  assert.equal(n, 1, 'a failure is remembered, not retried on every snapshot')
  const u = await createRasterizer(deps(dir, { platform: 'sunos' })).svgToPng(SVG)
  assert.match(u.why!, /no prebuilt native for sunos-testcpu/)
  const nd = await createRasterizer(deps(dir, { env: { UNPROSE_SNAPSHOT_PNG: 'never-download' }, fetch: offline })).svgToPng(SVG)
  assert.match(nd.why!, /never-download/)
  assert.equal(n, 1)
  for (const x of [off, o, u, nd]) assert.ok(!x.png && !x.why!.includes('\n'))
})

test('with resvg installed in this checkout the PNG is a PNG', async () => {
  const r = await svgToPng(SVG)
  assert.ok(r.png, r.why)
  assert.ok(r.png!.subarray(0, 8).equals(PNG_SIG))
  assert.match(r.renderer, /^resvg 2\.\d+\.\d+ \(npm package/)
})

test('the real platform native loads from the download cache (the plugin path, no network)', async (t) => {
  const pin = selectPin(RESVG_PINS, process.platform, process.arch, process.platform === 'linux' ? ((process.report?.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime ? 'glibc' : 'musl') : undefined)
  let pkgDir: string | undefined
  try {
    pkgDir = path.dirname(createRequire(import.meta.url).resolve(`${pin?.name}/package.json`))
  } catch {
    // not installed for this platform
  }
  if (!pin || !pkgDir) return t.skip('no resvg native installed for this platform')
  const nodeFile = fs.readdirSync(pkgDir).find((f) => f.endsWith('.node'))!
  const data = fs.readFileSync(path.join(pkgDir, nodeFile))
  const dir = scratch()
  const native = path.join(dir, 'native/resvg', RESVG_VERSION)
  fs.mkdirSync(native, { recursive: true })
  fs.writeFileSync(path.join(native, nodeFile), data)
  fs.writeFileSync(path.join(native, `${pin.name.replace('@resvg/', '')}.json`), JSON.stringify({ name: pin.name, version: pin.version, integrity: pin.integrity, file: nodeFile, sha256: crypto.createHash('sha256').update(data).digest('hex') }))
  const r = await createRasterizer({ env: { UNPROSE_SNAPSHOT_PNG: 'never-download' }, dataDir: dir, importPackage: async () => undefined }).svgToPng(SVG)
  assert.ok(r.png, r.why)
  assert.ok(r.png!.subarray(0, 8).equals(PNG_SIG))
  assert.match(r.renderer, /downloaded native/)
})

test('the snapshot info header survives a reason with a dash and a non-ASCII path', () => {
  const info = { notes: ['no PNG rasterizer: could not get it (fetch failed), so the snapshot is SVG — tried again in 10 min'], renderer: `resvg 2.6.2 (downloaded native, ${['', 'Users', '林', 'x.node'].join('/')}) 🖼` }
  const h = headerJson(info)
  assert.match(h, /^[\x20-\x7e]*$/)
  assert.deepEqual(JSON.parse(h), info)
})
