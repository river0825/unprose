import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { alignKanban, kanbanOrigins, snapColumns, KANBAN_GAP, KANBAN_HEADER, KANBAN_PAD } from '../web/src/flow/kanbanAlign.js'

const now = '2026-10-02T00:00:00.000Z'
const item = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 100, h: 100, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...p }) as Item
const board = (items: Item[]): Board => ({ id: 'b', title: 't', kind: 'freeform', seq: 0, items: Object.fromEntries(items.map((i) => [i.id, i])) }) as unknown as Board
const col = (id: string, x: number, y = 100, h = 600, parent = 'f') => item({ id, type: 'lane', role: 'column', x, y, w: 280, h, parent, text: id })
const card = (id: string, parent: string, y: number, h = 96) => item({ id, type: 'card', role: 'card', x: 0, y, w: 240, h, parent })

test('columns stand side by side in left → right order on one row, cards stacked inside', () => {
  const b = board([item({ id: 'f', type: 'frame', x: 0, y: 0, w: 1000, h: 800 }), col('todo', 40), col('doing', 700, 180), col('done', 330, 90), card('c1', 'todo', 500), card('c2', 'todo', 200)])
  const s = alignKanban(b)
  assert.deepEqual(['todo', 'done', 'doing'].map((id) => [s.items[id].x, s.items[id].y]), [[40, 90], [40 + 280 + KANBAN_GAP, 90], [40 + 2 * (280 + KANBAN_GAP), 90]])
  // cards keep their top → bottom order and stack from the header
  assert.equal(s.items.c2.y, 90 + KANBAN_HEADER + KANBAN_GAP)
  assert.equal(s.items.c1.y, s.items.c2.y + 96 + KANBAN_GAP)
  assert.equal(s.items.c1.x, 40 + KANBAN_PAD)
  assert.equal(b.items.todo.x, 40, 'the model is not changed')
})

test('a long column grows to hold its cards, every column as tall as the tallest, and the frame grows too', () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, 'todo', 200 + i * 10))
  const b = board([item({ id: 'f', type: 'frame', x: 0, y: 0, w: 700, h: 700 }), col('todo', 40), col('done', 340), ...cards])
  const s = alignKanban(b)
  const needed = KANBAN_HEADER + KANBAN_GAP + 12 * (96 + KANBAN_GAP) - KANBAN_GAP + KANBAN_PAD
  assert.equal(s.items.todo.h, needed)
  assert.equal(s.items.done.h, needed, 'columns read as one board')
  const lastCard = s.items.c11
  assert.ok(lastCard.y + lastCard.h <= s.items.todo.y + s.items.todo.h, 'the last card is inside its column')
  assert.ok(s.items.f.y + s.items.f.h >= s.items.todo.y + s.items.todo.h, 'the frame holds the columns')
  // never shrinks what the person made bigger
  const tall = alignKanban(board([col('a', 0, 0, 2000, ''), col('b', 300, 0, 600, '')]))
  assert.equal(tall.items.b.h, 2000)
})

test('kanbans in different frames (or loose on the board) are laid out separately', () => {
  const b = board([col('a1', 0, 0, 600, 'f1'), col('a2', 900, 50, 600, 'f1'), col('b1', 0, 1000, 600, 'f2'), col('loose', 2000, 2000, 600, '')])
  const s = alignKanban(b)
  assert.equal(s.items.a2.x, 280 + KANBAN_GAP)
  assert.equal(s.items.b1.y, 1000)
  assert.equal(s.items.loose.x, 2000)
  assert.equal(alignKanban(board([item({ id: 's', type: 'sticky' })])).items.s.x, 0, 'a board without columns is untouched')
})

test('a dropped column snaps into its place; the row still starts where it did', () => {
  const before = board([col('todo', 40), col('doing', 332), col('done', 624), card('c', 'todo', 300)])
  // the person drags "done" to the far left (and a bit down); the drop moved it and its cards
  const after = board([col('todo', 40), col('doing', 332), col('done', -200, 260), card('c', 'todo', 300)])
  const snaps = Object.fromEntries(snapColumns(before, after, ['done']).map((s) => [s.id, s.patch]))
  assert.deepEqual(snaps.done, { x: 40, y: 100 }, 'first in the row, back on the row, at the old start')
  assert.equal(snaps.todo.x, 40 + 280 + KANBAN_GAP)
  assert.equal(snaps.doing.x, 40 + 2 * (280 + KANBAN_GAP))
  assert.equal(snaps.c.x, 40 + 280 + KANBAN_GAP + KANBAN_PAD, 'cards follow their column')
  assert.deepEqual(snapColumns(before, after, ['c']), [], 'dropping a card is handled by the stacking, not here')
  assert.deepEqual(kanbanOrigins(before).get('f'), { x: 40, y: 100 })
})
