import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bin = path.join(here, '..', 'bin', 'awd.js')
const example = path.join(here, '..', '..', '..', 'examples', 'card-pipeline', 'workflow.yaml')

function awd(...args: string[]) {
  const r = spawnSync('node', [bin, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('lint passes on the example', () => {
  const r = awd('lint', example)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /0 errors/)
})

test('graph --json lists every step', () => {
  const r = awd('graph', example, '--json')
  assert.equal(r.code, 0, r.out)
  const g = JSON.parse(r.out)
  assert.ok(g.nodes.some((n: { id: string }) => n.id === 'size-gate'))
  assert.ok(g.edges.some((e: { from: string; to: string; label: string }) => e.from === 'human-review' && e.to === 'merge' && e.label === 'passed'))
})

test('golden tests of the example are green', () => {
  const r = awd('test', example)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /15 passed/)
})

test('lint fails on a broken workflow', () => {
  const r = awd('lint', path.join(here, 'broken.yaml'))
  assert.equal(r.code, 1)
  assert.match(r.out, /nothing produces event/)
})
