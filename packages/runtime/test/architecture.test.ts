// The dependency rule, enforced: ports know nothing, the application knows
// only ports, adapters know ports + application, and only the composition
// root (src/index.ts) and the compatibility shims see every adapter.
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
  const text = fs.readFileSync(file, 'utf8')
  return [...text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
}

function layerOf(file: string): 'ports' | 'application' | 'adapters' | 'root' | 'shim' {
  const rel = path.relative(SRC, file).split(path.sep)
  if (rel[0] === 'ports') return 'ports'
  if (rel[0] === 'application') return 'application'
  if (rel[0] === 'adapters') return 'adapters'
  if (rel.length === 1 && rel[0] === 'index.ts') return 'root'
  return 'shim' // top-level compatibility entries (engine.ts, workers/*.ts, …)
}

function resolveLayer(from: string, spec: string): 'ports' | 'application' | 'adapters' | 'root' | 'shim' | 'external' {
  if (!spec.startsWith('.')) return 'external'
  const target = path.resolve(path.dirname(from), spec.replace(/\.js$/, '.ts'))
  return layerOf(target)
}

test('ports import nothing but other ports and @awd/core', () => {
  for (const f of walk(path.join(SRC, 'ports'))) {
    for (const spec of importsOf(f)) {
      const layer = resolveLayer(f, spec)
      assert.ok(layer === 'ports' || spec === '@awd/core', `${path.relative(SRC, f)} imports ${spec}`)
    }
  }
})

test('the application never imports an adapter', () => {
  for (const f of walk(path.join(SRC, 'application'))) {
    for (const spec of importsOf(f)) {
      const layer = resolveLayer(f, spec)
      assert.notEqual(layer, 'adapters', `${path.relative(SRC, f)} reaches into adapters via ${spec}`)
      assert.notEqual(layer, 'root', `${path.relative(SRC, f)} imports the composition root`)
      assert.notEqual(layer, 'shim', `${path.relative(SRC, f)} imports a compatibility shim`)
    }
  }
})

test('adapters depend on ports and the application, never on the root or shims', () => {
  for (const f of walk(path.join(SRC, 'adapters'))) {
    for (const spec of importsOf(f)) {
      const layer = resolveLayer(f, spec)
      assert.ok(layer !== 'root', `${path.relative(SRC, f)} imports the composition root`)
      // herdr.ts is the one adapter that still lives at its old path (frozen this round).
      if (layer === 'shim') assert.match(spec, /workers\/herdr\.js$/, `${path.relative(SRC, f)} imports a shim: ${spec}`)
    }
  }
})

test('the composition root is the only non-shim file that imports two or more adapter families', () => {
  const families = (f: string) => new Set(importsOf(f).filter((s) => s.startsWith('.')).map((s) => path.relative(SRC, path.resolve(path.dirname(f), s))).filter((r) => r.startsWith('adapters/')).map((r) => r.split('/')[1]))
  for (const f of walk(SRC)) {
    const layer = layerOf(f)
    if (layer === 'root' || layer === 'shim' || layer === 'adapters') continue
    assert.ok(families(f).size === 0, `${path.relative(SRC, f)} wires adapters: ${[...families(f)].join(', ')}`)
  }
  assert.ok(families(path.join(SRC, 'index.ts')).size >= 3)
})
