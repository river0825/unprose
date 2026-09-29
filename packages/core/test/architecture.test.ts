// @awd/core is the domain + application layer of the runtime: pure by
// construction. No file may touch the outside world, and the package may not
// grow IO dependencies without someone noticing here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []))
}

function importsOf(file: string): string[] {
  return [...fs.readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
}

test('core never imports node builtins or anything with IO', () => {
  for (const f of walk(SRC)) {
    for (const spec of importsOf(f)) {
      assert.ok(!spec.startsWith('node:'), `${path.relative(ROOT, f)} imports ${spec}`)
      assert.ok(spec.startsWith('.') || spec === 'yaml', `${path.relative(ROOT, f)} imports an unexpected package: ${spec}`)
    }
    const text = fs.readFileSync(f, 'utf8')
    for (const banned of ['process.env', 'fetch(', 'require(', 'child_process', 'fs.']) {
      assert.ok(!text.includes(banned), `${path.relative(ROOT, f)} uses ${banned}`)
    }
  }
})

test('core declares only the yaml parser as a dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ['yaml'])
})
