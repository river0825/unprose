import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { checkLayout, layoutLines, LayoutError } from '../src/layoutCheck.js'
import { render, contentSchemas } from '../src/templates/index.js'
import { placeInFrame } from '../src/templates/frame.js'
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

test('comments: a drawn UI mock has none on its screens; a note moved onto the screen covers it; one outside the frame is said so', () => {
  const ui = { screens: [{ id: 'home', name: 'Home', note: 'screen note', body: [{ type: 'heading', id: 'title', text: 'Boards', level: 1, note: 'element note' }, { type: 'button', id: 'go', text: 'Go' }] }] }
  const parsed = contentSchemas['ui-mock'].parse(ui)
  const { items } = placeInFrame({}, { kind: 'ui-mock', key: 'home-ui' }, render('ui-mock', parsed, { now, scope: 'home-ui' }), now)
  const clean = board(items)
  assert.deepEqual([...of(clean, 'comment-covers'), ...of(clean, 'comment-outside')], [])
  // the element note dragged onto the screen, over the heading and the button below it
  const screen = clean.items['home-ui.screen.home']
  const title = clean.items['home-ui.ui.home.title']
  const moved = board(items.map((i) => (i.id === 'home-ui.note.home.title' ? { ...i, x: title.x + 20, y: title.y + 20 } : i)))
  const covers = of(moved, 'comment-covers')
  assert.equal(covers.length, 1)
  assert.equal(covers[0].id, 'home-ui.note.home.title')
  assert.equal(covers[0].severity, 'info')
  assert.equal(covers[0].frame, 'home-ui')
  assert.match(covers[0].message, /^comment "element note" on heading "Boards" covers screen "Home", heading "Boards", button "Go" \(\d+×\d+ px on heading "Boards"\)$/)
  assert.match(covers[0].suggestion, /^move it into the gutter right of screen "Home" \(x \d+, y \d+\) — notes and threads live beside a screen, never on it$/)
  assert.deepEqual(covers[0].others, [screen.id, title.id, "home-ui.ui.home.go"])
  assert.equal(of(moved, 'comment-outside').length, 0)
  // a later comment put beyond the frame's right edge (its target is in the frame)
  const fr = clean.items["diagram.home-ui"]
  const far = board([...items, item({ id: 'c1', type: 'comment', x: fr.x + fr.w + 100, y: fr.y + 60, w: 220, h: 80, text: 'late reply', target: 'home-ui.ui.home.go' })])
  const outside = of(far, 'comment-outside')
  assert.equal(outside.length, 1)
  assert.equal(outside[0].id, 'c1')
  assert.equal(outside[0].severity, 'info')
  assert.match(outside[0].message, /^comment "late reply" on button "Go" is outside its frame diagram "home-ui": \d+ px past the right$/)
  assert.match(outside[0].suggestion, /move it into the gutter right of screen "Home" \(x \d+, y \d+\) — notes and threads live beside a screen, never on it, or grow the frame to hold the gutter/)
  assert.deepEqual(outside[0].others, ['diagram.home-ui', 'home-ui.ui.home.go'])
  assert.equal(of(far, 'comment-covers').length, 0)
  // the frame filter keeps them (the target is in the frame); the lines name the kinds
  assert.equal(checkLayout(far, { frame: 'home-ui' }).counts['comment-outside'], 1)
  assert.ok(layoutLines(checkLayout(far), far).some((l) => l.startsWith('- [comment-outside] comment "late reply"')))
  // outside a UI mock: a comment beside a sticky on the lane is fine, one on the sticky covers it, with a generic fix
  const es = board([frame('diagram.a', 'a'), item({ id: 's1', type: 'sticky', x: 40, y: 40, text: 'one', parent: 'diagram.a' }), item({ id: 'c2', type: 'comment', x: 300, y: 40, w: 220, h: 80, text: 'beside', target: 's1' }), item({ id: 'c3', type: 'comment', x: 60, y: 60, w: 220, h: 80, text: 'on it', target: 's1' })])
  const esCovers = of(es, 'comment-covers')
  assert.deepEqual(esCovers.map((f) => f.id), ['c3'])
  assert.equal(esCovers[0].message, 'comment "on it" on sticky "one" covers sticky "one" (140×80 px on sticky "one")')
  assert.equal(esCovers[0].suggestion, 'move it beside sticky "one" onto free paper, or add it without x/y so the canvas places it')
})

test('a reply is drawn in its thread and a draft annotation waits beside the frame: neither is a comment finding', () => {
  const ev = item({ id: 'a.event.placed', type: 'sticky', x: 40, y: 40, text: 'Order placed', parent: 'diagram.a' })
  const legend = item({ id: 'a.legend', type: 'sticky', x: 40, y: 400, text: 'Legend', parent: 'diagram.a' })
  const todo = item({ id: 'c_todo', type: 'comment', x: 40, y: 170, w: 220, h: 50, text: 'Can a guest order?', target: ev.id, data: { todo: { state: 'done' } } })
  // the answer is stored where the page put it — on the legend — but it is drawn inside the TODO card
  const answer = item({ id: 'c_answer', type: 'comment', x: 40, y: 400, w: 160, h: 64, text: 'Confirmed: yes', target: 'c_todo', data: { todoAnswer: true } })
  const draft = item({ id: 'c_draft', type: 'comment', x: 1100, y: 40, w: 240, h: 66, text: 'Sends the tracking mail', target: ev.id, data: { annotation: { draft: true, on: 'placed' } } })
  const b = board([frame('diagram.a', 'a'), ev, legend, todo, answer, draft])
  assert.deepEqual([...of(b, 'comment-covers'), ...of(b, 'comment-outside')].map((f) => f.id), [])
  // a plain comment out there still is
  const loose = item({ id: 'c_loose', type: 'comment', x: 1100, y: 40, w: 200, h: 64, text: 'hm', target: ev.id })
  assert.deepEqual(of(board([frame('diagram.a', 'a'), ev, loose]), 'comment-outside').map((f) => f.id), ['c_loose'])
})
