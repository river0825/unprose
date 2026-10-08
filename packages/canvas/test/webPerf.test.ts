// The pure halves of the web's render-saving helpers: which boxes a wire can meet and when two lists of boxes say
// the same (flow/obstacleBoxes.ts), when a node or an edge from boardToFlow says the same as the one before
// (flow/reuse.ts), and that boardToFlow answers the same sides from its planSides memo as without it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Edge } from '@xyflow/react'
import type { Board, Item } from '../src/model.js'
import { boxesNear, NEAR, sameBoxes, type ObstacleBox } from '../web/src/flow/obstacleBoxes.js'
import { reuse, sameEdge, sameNode } from '../web/src/flow/reuse.js'
import { boardToFlow, type ItemNode } from '../web/src/flow/boardToFlow.js'
import { planSides } from '../web/src/flow/route.js'

const box = (id: string, x: number, y: number, w = 100, h = 60): ObstacleBox => ({ id, x, y, w, h })

test('sameBoxes: equal when the same boxes stand at the same places, whatever the array', () => {
  const a = [box('a', 0, 0), box('b', 300, 0)]
  assert.ok(sameBoxes(a, a))
  assert.ok(sameBoxes(a, [box('a', 0, 0), box('b', 300, 0)]))
  assert.ok(!sameBoxes(a, [box('a', 0, 0), box('b', 310, 0)]), 'one moved')
  assert.ok(!sameBoxes(a, [box('a', 0, 0), box('b', 300, 0, 120)]), 'one resized')
  assert.ok(!sameBoxes(a, [box('a', 0, 0)]), 'one gone')
  assert.ok(!sameBoxes(a, [box('b', 300, 0), box('a', 0, 0)]), 'another order is another list')
})

test('boxesNear: keeps every box in the x band or the y band of the wire, drops the rest, and returns the list itself when all are near', () => {
  const far = box('far', 2000, 2000)
  const inX = box('inX', 200, 1500) // under the span: a loop could meet it
  const inY = box('inY', 1500, 20) // beside the span, same rows: a vertical wire's turn could meet it
  const edgeX = box('edgeX', 500 + NEAR - 1, 1500) // just inside the band
  const outX = box('outX', 500 + NEAR, 1500) // just outside it (and outside the y band)
  const all = [far, inX, inY, edgeX, outX]
  const near = boxesNear(all, 0, 0, 500, 50)
  assert.deepEqual(
    near.map((b) => b.id),
    ['inX', 'inY', 'edgeX'],
  )
  const same = [inX, inY]
  assert.equal(boxesNear(same, 0, 0, 500, 50), same, 'all near: the same array, so a memo on it holds')
})

test('boxesNear: a wire going back (target left of source) uses the same bands', () => {
  const b = box('b', 250, 1000)
  assert.deepEqual(boxesNear([b, box('far', 3000, 3000)], 500, 0, 0, 50), [b])
})

const item = (id: string, patch: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 60, text: id, createdBy: 'agent', updatedBy: 'agent', updatedAt: '2026-01-01T00:00:00.000Z', ...patch })
const node = (it: Item, patch: Partial<ItemNode> = {}, data: Partial<ItemNode['data']> = {}): ItemNode => ({
  id: it.id,
  type: it.type,
  position: { x: it.x, y: it.y },
  width: it.w,
  height: it.h,
  data: { item: it, pulse: false, open: true, replies: [], ...data },
  ...patch,
})

test('sameNode: the same item, place and data say the same; a changed item, place, class or badge does not', () => {
  const it = item('a')
  const base = node(it)
  assert.ok(sameNode(base, node(it)))
  assert.ok(sameNode({ ...base, selected: true, measured: { width: 100, height: 60 } } as ItemNode, node(it)), 'what React Flow wrote on it is not compared')
  assert.ok(!sameNode(base, node({ ...it })), 'another item object (a change touched it)')
  assert.ok(!sameNode(base, node(it, { position: { x: 10, y: 0 } })))
  assert.ok(!sameNode(base, node(it, { className: 'node-pending' })))
  assert.ok(!sameNode(base, node(it, {}, { pulse: true })))
  assert.ok(!sameNode(base, node(it, {}, { open: false })))
  assert.ok(!sameNode(base, node(it, {}, { replies: [item('r')] })))
  assert.ok(!sameNode(base, node(it, {}, { childCount: 2 })))
  const d = { kind: 'es', name: 'EventStorming', key: 'x' }
  assert.ok(sameNode(node(it, {}, { diagram: d }), node(it, {}, { diagram: { ...d } })), 'a diagram badge is compared by its fields')
  assert.ok(!sameNode(node(it, {}, { diagram: d }), node(it, {}, { diagram: { ...d, findings: 2 } })))
  const badge = { key: 'in:a:x', end: 'in' as const, text: 'on x', title: 't', wires: ['w1'], open: false }
  assert.ok(sameNode(node(it, {}, { wireBadges: [badge] }), node(it, {}, { wireBadges: [{ ...badge, wires: ['w1'] }] })))
  assert.ok(!sameNode(node(it, {}, { wireBadges: [badge] }), node(it, {}, { wireBadges: [{ ...badge, open: true }] })))
})

test('sameEdge: the same wire, sides, ports and style say the same', () => {
  const it = item('w', { type: 'arrow', from: 'a', to: 'b' })
  const edge = (patch: Partial<Edge> = {}, data: Record<string, unknown> = {}): Edge => ({ id: 'w', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left', type: 'item', label: 'x', style: { stroke: 'red' }, markerEnd: { type: 'arrowclosed' }, data: { item: it, port: { s: 0, t: 8 }, ...data }, ...patch })
  assert.ok(sameEdge(edge(), edge()))
  assert.ok(sameEdge({ ...edge(), selected: true }, edge()), 'selection is not compared (it is carried over)')
  assert.ok(!sameEdge(edge(), edge({ targetHandle: 'top' })))
  assert.ok(!sameEdge(edge(), edge({ hidden: true })))
  assert.ok(!sameEdge(edge(), edge({ className: 'wire-trace' })))
  assert.ok(!sameEdge(edge(), edge({ style: { stroke: 'blue' } })))
  assert.ok(!sameEdge(edge(), edge({}, { port: { s: 0, t: 16 } })))
  assert.ok(!sameEdge(edge(), edge({}, { item: { ...it } })))
  assert.ok(sameEdge(edge({}, { dsPlan: { from: { x: 1 } } }), edge({}, { dsPlan: { from: { x: 1 } } })), 'a domain-story plan is compared by value')
  assert.ok(!sameEdge(edge({}, { dsPlan: { from: { x: 1 } } }), edge({}, { dsPlan: { from: { x: 2 } } })))
})

test('reuse: keeps the earlier object where nothing changed, the new one where it did, and the earlier array when all is the same', () => {
  const a = item('a')
  const b = item('b')
  const prev = [node(a), node(b)]
  const next = [node(a), node({ ...b, text: 'B' })]
  const out = reuse(prev, next, sameNode)
  assert.equal(out[0], prev[0])
  assert.equal(out[1], next[1])
  const same = reuse(prev, [node(a), node(b)], sameNode)
  assert.equal(same, prev)
  assert.notEqual(reuse(prev, [node(b), node(a)], sameNode), prev, 'another order is another list')
  assert.deepEqual(reuse(prev, [node(a)], sameNode).map((n) => n.id), ['a'])
  assert.equal(reuse([], next, sameNode), next)
})

test('boardToFlow: a wire keeps its planned sides across a change that moved nothing, and takes new ones when a box moved', () => {
  const board: Board = {
    id: 'b',
    title: 't',
    kind: 'freeform',
    seq: 1,
    items: {
      a: item('a', { x: 0, y: 0 }),
      b: item('b', { x: 400, y: 0 }),
      c: item('c', { x: 200, y: 0 }), // in the way of a straight right → left wire
      w: item('w', { type: 'arrow', from: 'a', to: 'b', w: 0, h: 0 }),
    },
  }
  const sidesOf = (bd: Board) => {
    const e = boardToFlow(bd, new Set(), new Set()).edges.find((x) => x.id === 'w')!
    return [e.sourceHandle, e.targetHandle]
  }
  const first = sidesOf(board)
  const bx = (id: string) => ({ x: board.items[id].x, y: board.items[id].y, w: board.items[id].w, h: board.items[id].h })
  const planned = planSides(bx('a'), bx('b'), [bx('c')])
  assert.deepEqual(first, [planned.fromSide, planned.toSide])
  // a text change: nothing moved, the same sides (from the memo)
  const edited: Board = { ...board, items: { ...board.items, a: { ...board.items.a, text: 'A!' } } }
  assert.deepEqual(sidesOf(edited), first)
  // the box in the way moved out of it: the plain facing sides come back
  const moved: Board = { ...board, items: { ...board.items, c: { ...board.items.c, y: 400 } } }
  assert.deepEqual(sidesOf(moved), ['right', 'left'])
  assert.deepEqual(sidesOf(board), first, 'and back again')
})
