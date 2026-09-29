import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoPlaceComments } from '../src/place.js'
import { render } from '../src/templates/index.js'
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
