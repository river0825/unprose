// The dependency rule for the canvas: the domain (model, templates, diff,
// place, thumb) is pure; the port knows only the model; adapters know ports +
// domain; the driving side (server, cli, mcp) is the only place adapters are wired.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []))
}
function importsOf(file: string): string[] {
  return [...fs.readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
}
const rel = (f: string) => path.relative(SRC, f)

type Layer = 'domain' | 'ports' | 'adapters' | 'driving' | 'shim' | 'external'
const DOMAIN = ['model.ts', 'diff.ts', 'place.ts', 'thumb.ts', 'demo.ts']
function layerOf(file: string): Layer {
  const r = rel(file)
  if (DOMAIN.includes(r) || r.startsWith('templates/') || r.startsWith('diagrams/')) return 'domain'
  if (r.startsWith('ports/')) return 'ports'
  if (r.startsWith('adapters/')) return 'adapters'
  if (r === 'store.ts' || r === 'index.ts') return 'shim'
  return 'driving' // server, cli, mcp, client, docs
}
function target(from: string, spec: string): Layer {
  if (!spec.startsWith('.')) return 'external'
  return layerOf(path.resolve(path.dirname(from), spec.replace(/\.js$/, '.ts')))
}

test('the domain is pure: no IO builtins, no ports, no adapters (zod is the schema language)', () => {
  for (const f of walk(SRC).filter((f) => layerOf(f) === 'domain')) {
    for (const spec of importsOf(f)) {
      // node:crypto is hashing (deterministic ids), not IO — the one builtin the domain may use.
      assert.ok(!spec.startsWith('node:') || spec === 'node:crypto', `${rel(f)} imports ${spec}`)
      const t = target(f, spec)
      assert.ok(t === 'domain' || (t === 'external' && (spec === 'zod' || spec === 'node:crypto')), `${rel(f)} imports ${spec} (${t})`)
    }
  }
})

test('the port imports only the model', () => {
  for (const f of walk(path.join(SRC, 'ports'))) {
    for (const spec of importsOf(f)) assert.match(spec, /model\.js$/, `${rel(f)} imports ${spec}`)
  }
})

test('adapters depend on the port and the domain, never on the driving side', () => {
  for (const f of walk(path.join(SRC, 'adapters'))) {
    for (const spec of importsOf(f)) {
      const t = target(f, spec)
      assert.ok(t !== 'driving' && t !== 'shim', `${rel(f)} imports ${spec} (${t})`)
    }
  }
})

test('only the driving side and the shims choose an adapter', () => {
  for (const f of walk(SRC)) {
    const l = layerOf(f)
    if (l === 'driving' || l === 'shim' || l === 'adapters') continue
    for (const spec of importsOf(f)) assert.notEqual(target(f, spec), 'adapters', `${rel(f)} picks an adapter via ${spec}`)
  }
})
