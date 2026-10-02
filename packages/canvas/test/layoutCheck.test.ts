import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { checkLayout, layoutLines, LayoutError } from '../src/layoutCheck.js'
import { render, contentSchemas } from '../src/templates/index.js'
import { demoBoards } from '../src/demo.js'

const now = '2026-10-02T00:00:00.000Z'
const item = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 160, h: 110, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...p }) as Item
const board = (items: Item[], kind: Board['kind'] = 'freeform'): Board => ({ id: 'b', title: 't', kind, seq: 0, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) })
const frame = (id: string, key: string, p: Partial<Item> = {}) => item({ id, type: 'frame', role: 'diagram', x: 0, y: 0, w: 1000, h: 800, data: { diagram: { kind: 'event-storming', key } }, ...p })
const of = (b: Board, kind: string) => checkLayout(b).findings.filter((f) => f.kind === kind)

test('overlapping siblings are found once, on the later one, with a move to fix it', () => {
  const b = board([frame('diagram.a', 'a'), item({ id: 's1', type: 'sticky', x: 40, y: 40, text: 'one', parent: 'diagram.a' }), item({ id: 's2', type: 'sticky', x: 120, y: 60, text: 'two', parent: 'diagram.a' })])
  const f = of(b, 'overlap')
  assert.equal(f.length, 1)
  assert.equal(f[0].id, 's2')
  assert.deepEqual(f[0].others, ['s1'])
  assert.match(f[0].suggestion, /move it \d+ px (right|down)/)
  assert.equal(f[0].frame, 'a')
})

test('a container and the item on it, or a hairline touch, is not an overlap', () => {
  const b = board([frame('diagram.a', 'a'), item({ id: 's1', type: 'sticky', x: 40, y: 40, text: 'one' }), item({ id: 's2', type: 'sticky', x: 197, y: 40, text: 'two' })])
  assert.equal(of(b, 'overlap').length, 0)
})

test('a long text in a small sticky is likely clipped, with how much taller to make it', () => {
  const text = 'This sticky says far too much for its little box, sentence after sentence after sentence, until it overflows'
  const f = of(board([item({ id: 's', type: 'sticky', w: 120, h: 80, text })]), 'clipped')
  assert.equal(f.length, 1)
  assert.match(f[0].message, /needs ~\d+ lines/)
  assert.match(f[0].suggestion, /px taller \(h \d+\)/)
  // a short text fits
  assert.equal(of(board([item({ id: 's', type: 'sticky', w: 120, h: 80, text: 'Order placed' })]), 'clipped').length, 0)
})

test('a sticky far outside its frame is outside its parent', () => {
  const b = board([frame('diagram.a', 'a', { w: 600, h: 400 }), item({ id: 's', type: 'sticky', x: 900, y: 100, text: 'lost', parent: 'diagram.a' })])
  const f = of(b, 'outside-parent')
  assert.equal(f.length, 1)
  assert.match(f[0].message, /px past the right/)
  assert.match(f[0].suggestion, /move it to x \d+/)
})

test('a story whose centre is outside its release lane is off its lane', () => {
  const b = board([
    frame('diagram.m', 'm', { data: { diagram: { kind: 'user-story-map', key: 'm' } } }),
    item({ id: 'lane', type: 'lane', role: 'release', x: 20, y: 300, w: 900, h: 150, text: 'Release 1', parent: 'diagram.m' }),
    item({ id: 'story', type: 'card', role: 'story', x: 60, y: 520, w: 150, h: 90, text: 'Pay', parent: 'lane' }),
  ])
  const f = of(b, 'off-lane')
  assert.equal(f.length, 1)
  assert.equal(f[0].id, 'story')
  assert.deepEqual(f[0].others, ['lane'])
})

test('an oversized sticky among normal ones is oversized, and the template size is suggested', () => {
  const sib = (id: string, x: number) => item({ id, type: 'sticky', role: 'event', x, y: 40, text: id, parent: 'diagram.a' })
  const b = board([frame('diagram.a', 'a', { w: 3000 }), sib('e1', 40), sib('e2', 240), sib('e3', 440), item({ id: 'big', type: 'sticky', role: 'event', x: 640, y: 40, w: 600, h: 400, text: 'Order placed', parent: 'diagram.a' })])
  const f = of(b, 'oversized')
  assert.deepEqual(f.map((x) => x.id), ['big'])
  assert.match(f[0].suggestion, /use 160×110/)
  // alone, still far bigger than a template sticky with a short text
  const alone = of(board([item({ id: 'big', type: 'sticky', w: 600, h: 400, text: 'Order placed' })]), 'oversized')
  assert.equal(alone.length, 1)
})

test('a kanban card stored somewhere else than the page draws it is reported with how ordering works', () => {
  const b = board([
    item({ id: 'col', type: 'lane', role: 'column', x: 0, y: 0, w: 280, h: 600, text: 'Todo' }),
    item({ id: 'c1', type: 'card', role: 'card', x: 20, y: 400, w: 240, h: 96, text: 'First', parent: 'col' }),
  ])
  const f = of(b, 'moved-by-layout')
  assert.equal(f.length, 1)
  assert.match(f[0].message, /stored at 20,400 but the page draws it at 20,56/)
  assert.match(f[0].suggestion, /set y to reorder/)
})

test('the frame filter keeps findings to one diagram; an unknown frame is a 404', () => {
  const b = board([
    frame('diagram.a', 'a', { w: 600, h: 400 }),
    frame('diagram.b', 'b', { x: 2000, w: 600, h: 400 }),
    item({ id: 'a1', type: 'sticky', x: 40, y: 40, text: 'x', parent: 'diagram.a' }),
    item({ id: 'a2', type: 'sticky', x: 60, y: 50, text: 'y', parent: 'diagram.a' }),
    item({ id: 'b1', type: 'sticky', x: 2040, y: 40, text: 'x', parent: 'diagram.b' }),
    item({ id: 'b2', type: 'sticky', x: 2060, y: 50, text: 'y', parent: 'diagram.b' }),
  ])
  assert.equal(checkLayout(b).findings.length, 2)
  const r = checkLayout(b, { frame: 'b' })
  assert.deepEqual(r.findings.map((f) => f.id), ['b2'])
  assert.equal(r.frame, 'b')
  assert.throws(() => checkLayout(b, { frame: 'nope' }), (e: unknown) => e instanceof LayoutError && e.status === 404)
})

test('limit caps the list but counts keep every finding; lines say how many more', () => {
  const items = [frame('diagram.a', 'a', { w: 5000 })]
  for (let i = 0; i < 10; i++) items.push(item({ id: `s${i}`, type: 'sticky', x: 40 + i * 20, y: 40, text: `s${i}`, parent: 'diagram.a' }))
  const b = board(items)
  const r = checkLayout(b, { limit: 3 })
  assert.equal(r.findings.length, 3)
  assert.ok(r.counts.overlap > 3)
  const lines = layoutLines(r, b, 3)
  assert.match(lines[0], /finding\(s\) — \d+ overlap/)
  assert.match(lines.at(-1)!, /… \d+ more/)
  assert.match(layoutLines(checkLayout(board([])), board([]))[0], /nothing overlaps/)
})

test('template renders are clean: no overlaps, clipped text or oversized items', () => {
  for (const d of demoBoards) {
    const parsed = contentSchemas[d.kind].safeParse(d.content)
    assert.ok(parsed.success)
    const b = board(render(d.kind, parsed.data, { now }), d.kind)
    const bad = checkLayout(b).findings.filter((f) => f.kind === 'overlap' || f.kind === 'clipped' || f.kind === 'oversized')
    assert.deepEqual(bad.map((f) => `${f.kind}: ${f.message}`), [], d.title)
  }
})
