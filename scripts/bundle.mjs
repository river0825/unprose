#!/usr/bin/env node
// scripts/bundle.mjs <out-dir> — the published plugin's runtime, no install or build needed (unprose#4).
//   <out>/awd.mjs     the `awd` CLI (workflow runtime, design, studio …), all dependencies inside
//   <out>/canvas.mjs  the canvas server + MCP server (`serve`, `mcp`, …)
//   <out>/web/        the web UI the server serves
// Run after `npm run build` (it bundles the built packages). scripts/mcp.mjs, scripts/awd.mjs and
// scripts/start.mjs prefer these files and fall back to the workspace build in a dev checkout.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv[2]) {
  // no default: a stray dist/ in a dev checkout would shadow the workspace build in the launchers
  console.error('usage: node scripts/bundle.mjs <out-dir>   (the export passes <public repo>/dist)')
  process.exit(1)
}
const out = path.resolve(process.argv[2])
const need = ['packages/cli/dist/index.js', 'packages/canvas/dist/cli.js', 'packages/canvas/web/dist/index.html']
const missing = need.filter((p) => !fs.existsSync(path.join(root, p)))
if (missing.length) {
  console.error(`bundle: missing ${missing.join(', ')} — run \`npm run build\` first`)
  process.exit(1)
}

// PNG snapshots: the bundle has no node_modules, so the canvas downloads resvg's native for its platform, pinned to
// the lockfile's version + sha512 (packages/canvas/src/resvgPins.ts) — refuse to ship pins that drifted from it
const { pinsSource, currentLock, PINS_FILE } = await import('./resvg-pins.mjs')
if (fs.readFileSync(PINS_FILE, 'utf8') !== pinsSource(currentLock())) {
  console.error('bundle: packages/canvas/src/resvgPins.ts is out of date with package-lock.json — run `node scripts/resvg-pins.mjs` and `npm run build`')
  process.exit(1)
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfigRaw: {}, // the bundled files are already built JS
  absWorkingDir: root, // module comments in the output stay repo-relative (no personal paths)
  legalComments: 'none',
  logLevel: 'warning',
  // CommonJS dependencies call require(); give the ESM bundle one
  banner: { js: "import { createRequire as __awdRequire } from 'node:module'; const require = __awdRequire(import.meta.url);" },
  // ws's optional native speedups; ws works without them
  external: ['bufferutil', 'utf-8-validate'],
}
await build({ ...common, entryPoints: ['packages/cli/dist/index.js'], outfile: path.join(out, 'awd.mjs') })
await build({ ...common, entryPoints: ['packages/canvas/dist/cli.js'], outfile: path.join(out, 'canvas.mjs') })
fs.cpSync(path.join(root, 'packages/canvas/web/dist'), path.join(out, 'web'), { recursive: true })
// the release notes the bundled server shows (GET /api/version); the repo root has them too, but a copied dist/ may not
if (fs.existsSync(path.join(root, 'CHANGELOG.md'))) fs.copyFileSync(path.join(root, 'CHANGELOG.md'), path.join(out, 'CHANGELOG.md'))
// and its version beside them: a runtime unpacked away from the repo (the plugin's data dir) still knows it
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'unprose-runtime', version: rootPkg.version, private: true, type: 'module' }, null, 2) + '\n')

const size = (p) => {
  const st = fs.statSync(p)
  return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0) : st.size
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
console.log(`bundle → ${path.relative(root, out) || out}: awd.mjs ${mb(size(path.join(out, 'awd.mjs')))}, canvas.mjs ${mb(size(path.join(out, 'canvas.mjs')))}, web ${mb(size(path.join(out, 'web')))}`)
