import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { detourOf, dsSeqAt, foldedPath, floatingEndTo, foldsOf, labelObstacles, planWires, runsThrough, wireShape } from '../src/wireGeometry.js'
import { checkLayout, layoutLines } from '../src/layoutCheck.js'
import { renderSnapshot } from '../src/snapshot.js'

const now = '2026-10-21T00:00:00Z'
const base = { createdBy: 'agent' as const, updatedBy: 'agent' as const, updatedAt: now }
const card = (id: string, x: number, y: number, w = 132, h = 100, data?: Record<string, unknown>): Item => ({ ...base, id, type: 'card', x, y, w, h, text: id, ...(data ? { data } : {}) }) as Item
const picto = (id: string, x: number, y: number, ds = 'object') => card(id, x, y, 132, 100, { ds })
const wire = (id: string, from: string, to: string, extra: Partial<Item> = {}): Item => ({ ...base, id, type: 'arrow', x: 0, y: 0, w: 0, h: 0, from, to, ...extra }) as Item
const boardOf = (items: Item[]): Board => ({ id: 'b', title: 't', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) }) as unknown as Board
const centre = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
/** Distance of p from the segment a→b. */
const off = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2))
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)))
}

test('foldsOf: a list of points, one point (an older board), junk left out', () => {
  assert.deepEqual(foldsOf({ bend: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }), [{ x: 1, y: 2 }, { x: 3, y: 4 }])
  assert.deepEqual(foldsOf({ bend: { x: 5, y: 6 } }), [{ x: 5, y: 6 }])
  assert.deepEqual(foldsOf({ bend: [{ x: 1, y: 2 }, null, 'x', { x: NaN, y: 1 }, { x: 1 }, { x: 7, y: 8, extra: true }] }), [{ x: 1, y: 2 }, { x: 7, y: 8 }])
  assert.deepEqual(foldsOf({ bend: 'here' }), [])
  assert.deepEqual(foldsOf({}), [])
  assert.deepEqual(foldsOf(undefined), [])
})

test('a folded wire runs straight to its fold from each end, cut where it leaves the box, and turns at a rounded corner', () => {
  const a = card('a', 0, 0, 100, 60)
  const z = card('z', 400, 0, 100, 60)
  const fold = { x: 250, y: 200 }
  const b = boardOf([a, z, wire('w', 'a', 'z', { label: 'goes', data: { bend: [fold] } })])
  const s = wireShape(b, b.items.w)!
  assert.deepEqual(s.via, [fold])
  assert.equal(s.auto, undefined)
  assert.equal(s.points.length, 3)
  assert.deepEqual(s.points[1], fold)
  assert.deepEqual(s.p1, floatingEndTo(a, fold))
  assert.deepEqual(s.p2, floatingEndTo(z, fold))
  // each end on the line from its box's centre to the fold, just outside the box
  assert.ok(off(s.p1, centre(a), fold) < 1e-6 && s.p1.y > a.y + a.h)
  assert.ok(off(s.p2, centre(z), fold) < 1e-6 && s.p2.y > z.y + z.h)
  assert.equal(s.d, foldedPath(s.points, 8))
  assert.match(s.d, /^M[^Q]+L[^Q]+Q250 200 /)
  // without folds: the orthogonal route as before, nothing folded
  const plain = wireShape(boardOf([a, z, wire('w', 'a', 'z')]), wire('w', 'a', 'z'))!
  assert.deepEqual(plain.via, [])
  assert.deepEqual(plain.points, [{ x: 100, y: 30 }, { x: 400, y: 30 }])
})

test('a folded domain-story line: the same, its corners barely rounded; the label is placed along its runs', () => {
  const b = boardOf([
    picto('actor', 0, 0, 'actor'),
    picto('obj', 600, 0),
    wire('w', 'actor', 'obj', { role: 'activity', label: 'sends', data: { ds: true, seq: 1, bend: [{ x: 300, y: -200 }, { x: 500, y: -200 }] } }),
  ])
  const plan = planWires(b).get('w')!
  assert.equal(plan.shape.ds, true)
  assert.deepEqual(plan.shape.via, [{ x: 300, y: -200 }, { x: 500, y: -200 }])
  assert.equal(plan.shape.auto, undefined, "the person's folds are not a detour")
  assert.equal(plan.shape.d, foldedPath(plan.shape.points, 4))
  assert.equal((plan.shape.d.match(/Q/g) ?? []).length, 2)
  // the number circle on the first run, a little from the actor
  assert.ok(plan.seq && off(plan.seq, plan.shape.points[0], plan.shape.points[1]) < 0.5)
  assert.deepEqual(plan.seq, dsSeqAt(plan.shape))
  assert.ok(plan.label && plan.label.mode !== 'dot')
})

test('a domain-story line through a pictogram takes a detour round it; the number circle and the verb follow', () => {
  const items = [
    picto('actor', 0, 0, 'actor'),
    picto('obj', 600, 0),
    picto('blocker', 240, 0),
    wire('w', 'actor', 'obj', { role: 'activity', label: 'sends', data: { ds: true, seq: 1 } }),
  ]
  const b = boardOf(items)
  const straight = wireShape(b, b.items.w)!
  const obstacles = labelObstacles(b)
  assert.deepEqual(runsThrough(straight.points, obstacles, 'actor', 'obj').map((o) => o.id), ['blocker'], 'straight, it runs through the blocker')
  const plan = planWires(b).get('w')!
  assert.equal(plan.shape.auto, true)
  assert.ok(plan.shape.via.length >= 1)
  assert.deepEqual(runsThrough(plan.shape.points, obstacles, 'actor', 'obj'), [], 'the detour clears every pictogram')
  assert.deepEqual(plan.shape.p1, floatingEndTo(b.items.actor, plan.shape.via[0]))
  assert.equal(plan.shape.d, foldedPath(plan.shape.points, 4))
  assert.ok(plan.seq && off(plan.seq, plan.shape.points[0], plan.shape.points[1]) < 0.5, 'the circle sits on the first run')
  assert.ok(plan.label)
  // nothing to report in the layout check
  assert.equal(checkLayout(b).findings.filter((f) => f.kind === 'wire-through').length, 0)
  // deterministic: the same detour whatever order the items come in
  assert.deepEqual(planWires(boardOf([...items].reverse())).get('w')!.shape.via, plan.shape.via)
})

test('a line with nothing in its way gets no detour', () => {
  const b = boardOf([picto('actor', 0, 0, 'actor'), picto('obj', 600, 0), picto('aside', 240, 300), wire('w', 'actor', 'obj', { role: 'activity', label: 'sends', data: { ds: true, seq: 1 } })])
  const plan = planWires(b).get('w')!
  assert.deepEqual(plan.shape.via, [])
  assert.equal(plan.shape.auto, undefined)
  assert.equal(plan.shape.points.length, 2)
})

test('a detour goes round on the side where it crosses no other line', () => {
  const actor = { ...picto('actor', 0, 0, 'actor'), id: 'actor' }
  const obj = { ...picto('obj', 600, 0), id: 'obj' }
  const boxes = [actor, obj, { ...picto('blocker', 240, 0), id: 'blocker' }]
  const above = [{ x: 340, y: -300 }, { x: 340, y: -2 }]
  const below = [{ x: 340, y: 102 }, { x: 340, y: 400 }]
  const viaAvoidingAbove = detourOf(actor, obj, boxes, [above])!
  const viaAvoidingBelow = detourOf(actor, obj, boxes, [below])!
  assert.ok(viaAvoidingAbove.every((p) => p.y > 100), JSON.stringify(viaAvoidingAbove))
  assert.ok(viaAvoidingBelow.every((p) => p.y < 0), JSON.stringify(viaAvoidingBelow))
})

test("the person's folds are kept as they are: no detour, and the layout check says the line runs through a pictogram", () => {
  const b = boardOf([
    picto('actor', 0, 0, 'actor'),
    picto('obj', 600, 0),
    picto('blocker', 240, -150),
    wire('w', 'actor', 'obj', { role: 'activity', label: 'sends', data: { ds: true, seq: 1, bend: [{ x: 306, y: -100 }] } }),
  ])
  const plan = planWires(b).get('w')!
  assert.deepEqual(plan.shape.via, [{ x: 306, y: -100 }])
  assert.equal(plan.shape.auto, undefined)
  const r = checkLayout(b)
  const f = r.findings.filter((x) => x.kind === 'wire-through')
  assert.equal(f.length, 1, layoutLines(r, b).join('\n'))
  assert.equal(f[0].id, 'w')
  assert.match(f[0].message, /the line card "actor" → card "obj" runs through card "blocker" \(where it was folded, data\.bend\)/)
  assert.match(f[0].suggestion, /move its folds \(data\.bend\)/)
  assert.match(layoutLines(r, b).join('\n'), /\[wire-through\]/)
})

test('a line no detour can clear stays straight, and the layout check says how to fix it', () => {
  // a pillar across the whole corridor between two walls: there is no way round it
  const b = boardOf([
    picto('actor', 0, 0, 'actor'),
    picto('obj', 600, 0),
    card('wall-top', -300, -700, 1300, 560),
    card('wall-bottom', -300, 240, 1300, 560),
    card('pillar', 330, -140, 60, 380),
    wire('w', 'actor', 'obj', { role: 'activity', label: 'sends', data: { ds: true, seq: 1 } }),
  ])
  const plan = planWires(b).get('w')!
  assert.deepEqual(plan.shape.via, [])
  const f = checkLayout(b).findings.filter((x) => x.kind === 'wire-through')
  assert.equal(f.length, 1)
  assert.match(f[0].message, /the line card "actor" → card "obj" runs through card "pillar"$/)
  assert.match(f[0].suggestion, /move card "pillar" off the line, or fold the line round it \(data\.bend: \[/)
  assert.deepEqual(f[0].others, ['pillar'])
})

test('the snapshot draws a folded wire with its corner, and the annotation link dashed and dark enough to see', () => {
  const b = boardOf([
    card('a', 0, 0, 100, 60),
    card('z', 400, 0, 100, 60),
    wire('w', 'a', 'z', { data: { bend: [{ x: 250, y: 200 }] } }),
    picto('actor', 0, 600, 'actor'),
    { ...base, id: 'note', type: 'text', role: 'annotation', x: 300, y: 600, w: 200, h: 64, text: 'Only in office hours', data: { ds: 'annotation' } } as Item,
    wire('link', 'note', 'actor', { role: 'annotation-link', data: { ds: true } }),
  ])
  const plan = planWires(b)
  const svg = renderSnapshot(b, { maxPx: 4000 }).svg!
  assert.ok(svg.includes(`d="${plan.get('w')!.shape.d}"`))
  assert.match(plan.get('w')!.shape.d, /Q250 200 /)
  assert.match(svg, new RegExp(`<path d="${plan.get('link')!.shape.d}" fill="none" stroke="#444b53" stroke-width="1.5" stroke-dasharray="6 4"/>`))
})
