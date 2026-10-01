import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layered } from '../src/templates/layered.js'
import { renderWorkflow } from '../src/templates/index.js'
import { autoSides, bestLoop, bestTurn, freeLabelSpot, hits } from '../web/src/flow/route.js'

const NOW = '2026-10-01T00:00:00.000Z'
const n = (id: string, source = false) => ({ id, source, h: 110 })

test('layered: a loop is a back edge and does not push its nodes to the right', () => {
  // go → build → test → fix → build (the fix round), test → merge
  const r = layered([n('go', true), n('build'), n('test'), n('fix'), n('merge')], [
    { from: 'go', to: 'build' },
    { from: 'build', to: 'test' },
    { from: 'test', to: 'fix' },
    { from: 'fix', to: 'build' },
    { from: 'test', to: 'merge' },
  ])
  assert.deepEqual([...r.layer], [['go', 0], ['build', 1], ['test', 2], ['fix', 3], ['merge', 3]])
  assert.deepEqual(r.back, [false, false, false, true, false])
})

test('layered: ordering removes an avoidable crossing; nodes in a layer never overlap', () => {
  // a1→b2 and a2→b1 cross in declaration order; barycenter sweeps untangle them
  const r = layered([n('s', true), n('a1'), n('a2'), n('b1'), n('b2')], [
    { from: 's', to: 'a1' },
    { from: 's', to: 'a2' },
    { from: 'a1', to: 'b2' },
    { from: 'a2', to: 'b1' },
  ])
  const above = (x: string, y: string) => r.y.get(x)! < r.y.get(y)!
  assert.equal(above('a1', 'a2'), above('b2', 'b1'))
  for (const [x, y] of [['a1', 'a2'], ['b1', 'b2']]) assert.ok(Math.abs(r.y.get(x)! - r.y.get(y)!) >= 110, `${x} and ${y} overlap`)
})

test('workflow: a fix-round loop keeps the graph compact (no empty columns)', () => {
  const items = renderWorkflow(
    {
      nodes: [
        { id: 'go', kind: 'trigger' },
        { id: 'build', kind: 'ai' },
        { id: 'test', kind: 'script' },
        { id: 'fix', kind: 'script' },
        { id: 'merge', kind: 'script' },
      ],
      edges: [
        { from: 'go', to: 'build' },
        { from: 'build', to: 'test' },
        { from: 'test', to: 'fix' },
        { from: 'fix', to: 'build' },
        { from: 'test', to: 'merge' },
      ],
    },
    { now: NOW },
  )
  const xs = [...new Set(items.filter((i) => i.type === 'card').map((i) => i.x))].sort((a, b) => a - b)
  assert.equal(xs.length, 4, 'four columns: go, build, test, fix+merge')
  const x = (id: string) => items.find((i) => i.data?.nodeId === id)!.x
  assert.ok(x('build') < x('test') && x('test') < x('merge'))
})

test('autoSides: ahead → right/left, back along a row → loop, above/below → vertical', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 }
  assert.deepEqual(autoSides(a, { x: 300, y: 50, w: 100, h: 100 }), { fromSide: 'right', toSide: 'left' })
  assert.deepEqual(autoSides(a, { x: -300, y: 20, w: 100, h: 100 }), { fromSide: 'bottom', toSide: 'bottom' })
  assert.deepEqual(autoSides(a, { x: -300, y: 300, w: 100, h: 100 }), { fromSide: 'bottom', toSide: 'top' })
  assert.deepEqual(autoSides(a, { x: 20, y: -300, w: 100, h: 100 }), { fromSide: 'top', toSide: 'bottom' })
})

test('bestTurn: turns in a gap instead of through a box in the way', () => {
  // source at (0,0), target at (600,200); a box stands in the middle of the target row's approach
  const box = { x: 250, y: 150, w: 100, h: 100 }
  const cx = bestTurn(0, 0, 600, 200, [box], 300)
  const segs = [
    { x1: 0, y1: 0, x2: cx, y2: 0 },
    { x1: cx, y1: 0, x2: cx, y2: 200 },
    { x1: cx, y1: 200, x2: 600, y2: 200 },
  ]
  assert.ok(!segs.some((s) => hits(s, box)), `turn at ${cx} still crosses the box`)
})

test('bestLoop: goes over the top when the way underneath is blocked', () => {
  const from = { x: 600, y: 0, w: 100, h: 100 }
  const to = { x: 0, y: 0, w: 100, h: 100 }
  const below = { x: 600, y: 112, w: 100, h: 100 } // right under the source: any drop crosses it
  const r = bestLoop(from, to, [below], 22)
  assert.equal(r.side, 'top')
  assert.equal(r.n, 0)
})

test('freeLabelSpot: a label never lands on a box', () => {
  const box = { x: 180, y: -20, w: 100, h: 40 }
  const at = freeLabelSpot(0, 460, 0, 80, 18, [box])!
  assert.ok(at.x + 40 <= box.x || at.x - 40 >= box.x + box.w)
})
