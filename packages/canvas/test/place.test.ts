import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoPlaceComments } from '../src/place.js'
import { render } from '../src/templates/index.js'
import { placeInFrame } from '../src/templates/frame.js'
import { uiGutterOf, type UiMockContent } from '../src/diagrams/index.js'
import { demoBoards } from '../src/demo.js'
import type { Board, Item } from '../src/model.js'

function boardFrom(items: Item[]): Board {
  return { id: 'b', title: 't', kind: 'event-storming', seq: 1, createdAt: 'x', updatedAt: 'x', items: Object.fromEntries(items.map((i) => [i.id, i])) }
}
const overlaps = (a: Item | { x: number; y: number; w: number; h: number }, b: Item) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('comments without coordinates land beside their target and cover no sticky', () => {
  const items = render('event-storming', demoBoards[0].content, { now: 'x' })
  const board = boardFrom(items)
  const target = items.find((i) => i.role === 'command')!
  const content = { items: [{ type: 'comment', text: 'one', target: target.id }, { type: 'comment', text: 'two', target: target.id }] }
  autoPlaceComments(board, content)
  const placed = content.items as Array<{ x: number; y: number; w: number; h: number }>
  const stickies = items.filter((i) => i.type === 'sticky')
  for (const c of placed) {
    assert.equal(typeof c.x, 'number')
    for (const s of stickies) assert.ok(!overlaps(c, s), `comment covers ${s.role} "${s.text}"`)
    // near the target: within one sticky-width-and-a-bit in either axis
    assert.ok(Math.abs(c.x - target.x) < 500 && Math.abs(c.y - target.y) < 500)
  }
  assert.ok(!overlaps(placed[0], { ...placed[1], id: 'p1', type: 'comment', createdBy: 'agent', updatedBy: 'agent', updatedAt: 'x' } as Item), 'the two comments overlap each other')
})

test('explicit coordinates and unknown targets are left alone', () => {
  const board = boardFrom([])
  const content = { items: [{ type: 'comment', text: 'a', target: 'nope' }, { type: 'comment', text: 'b', target: 'x', x: 5, y: 6 }] }
  autoPlaceComments(board, content)
  assert.equal((content.items[0] as { x?: number }).x, undefined)
  assert.equal((content.items[1] as { x?: number }).x, 5)
})

test('a comment on a UI-mock screen or element lands in the gutter right of the screen, below the notes already there, on no ui item', () => {
  const ui: UiMockContent = {
    screens: [{ id: 'home', name: 'Home', note: 'screen note', body: [{ type: 'heading', id: 'title', text: 'Boards', level: 1, note: 'element note' }, { type: 'section', id: 'body', children: [{ type: 'button', id: 'go', text: 'Go' }] }] }],
  }
  const { frame, items } = placeInFrame({}, { kind: 'ui-mock', key: 'k' }, render('ui-mock', ui, { now: 'x', scope: 'k' }), 'x')
  const board = boardFrom(items)
  const screen = items.find((i) => i.id === 'k.screen.home')!
  const go = items.find((i) => i.id === 'k.ui.home.go')!
  const content = { items: [{ type: 'comment', text: 'on the screen', target: 'k.screen.home' }, { type: 'comment', text: 'on the title', target: 'k.ui.home.title' }, { type: 'comment', text: 'on the button, nested', target: 'k.ui.home.go', w: 260, h: 90 }] }
  autoPlaceComments(board, content)
  const placed = content.items as Array<{ x: number; y: number; w: number; h: number; text: string }>
  const gutter = uiGutterOf(screen)
  const everything = [...items.filter((i) => i.type === 'comment'), ...placed]
  for (const c of placed) {
    assert.equal(c.x, gutter.x, `${c.text} is not in the gutter`)
    assert.ok(c.y >= gutter.y, `${c.text} is above the gutter`)
    assert.ok(c.x + c.w <= frame.x + frame.w && c.y + c.h <= frame.y + frame.h, `${c.text} leaves the frame`)
    for (const u of items.filter((i) => i.type === 'ui')) assert.ok(!overlaps(c, u), `${c.text} covers ${u.id}`)
    for (const o of everything) if (o !== c) assert.ok(!overlaps(c, o as Item), `${c.text} overlaps ${(o as { text?: string }).text}`)
  }
  // never above what it is about; the gutter above the button is taken, so it stacks below the earlier comments
  assert.ok(placed[2].y >= go.y)
  assert.ok(placed[2].y > placed[1].y && placed[1].y > placed[0].y)
  // a target lower down whose gutter is free gets its comment at its own height
  const low = { items: [{ type: "comment", text: "low", target: "k.ui.home.go", x: undefined }] }
  const tall = boardFrom(items.map((i) => (i.id === "k.ui.home.go" ? { ...i, y: i.y + 600 } : i)))
  autoPlaceComments(tall, low)
  assert.equal((low.items[0] as { y: number }).y, go.y + 600)
  // outside a UI mock nothing changes: beside the target, on no sticky
  const es = render('event-storming', demoBoards[0].content, { now: 'x' })
  const t = es.find((i) => i.role === 'command')!
  const other = { items: [{ type: 'comment', text: 'es', target: t.id }] }
  autoPlaceComments(boardFrom(es), other)
  const o = other.items[0] as { x: number; y: number; w: number; h: number }
  assert.ok(Math.abs(o.x - t.x) < 500 && Math.abs(o.y - t.y) < 500)
  for (const st of es.filter((i) => i.type === 'sticky')) assert.ok(!overlaps(o, st))
})
