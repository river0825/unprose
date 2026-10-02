// The layout lock and the kanban's auto-layout (docs/diagrams.md "What a redraw keeps"): a locked card keeps its
// place and the others stack around it; a locked column stays and the others flow around it; a kanban in a locked
// frame is shown exactly as stored.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { alignKanban, KANBAN_GAP, KANBAN_HEADER, KANBAN_PAD } from '../web/src/flow/kanbanAlign.js'
import { kanbanLayout } from '../web/src/flow/boardToFlow.js'

const now = '2026-10-02T00:00:00.000Z'
const item = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 100, h: 100, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...p }) as Item
const board = (items: Item[]): Board => ({ id: 'b', title: 't', kind: 'freeform', seq: 0, items: Object.fromEntries(items.map((i) => [i.id, i])) }) as unknown as Board
const LOCK = { lock: 'layout' }
const col = (id: string, x: number, extra: Partial<Item> = {}) => item({ id, type: 'lane', role: 'column', x, y: 100, w: 280, h: 600, parent: 'f', text: id, ...extra })
const card = (id: string, parent: string, y: number, extra: Partial<Item> = {}) => item({ id, type: 'card', role: 'card', x: 0, y, w: 240, h: 96, parent, ...extra })
const top = 100 + KANBAN_HEADER + KANBAN_GAP

test('a locked card keeps its place; the other cards in its column stack around it', () => {
  const b = board([item({ id: 'f', type: 'frame', w: 1000, h: 900 }), col('todo', 40), card('a', 'todo', 150), card('pinned', 'todo', 400, { x: 77, data: LOCK }), card('c', 'todo', 500), card('d', 'todo', 600)])
  const s = alignKanban(b)
  assert.deepEqual([s.items.pinned.x, s.items.pinned.y], [77, 400], 'locked: not moved')
  assert.equal(s.items.a.y, top)
  assert.equal(s.items.c.y, top + 96 + KANBAN_GAP, 'c fits between a and the pinned card')
  // d would overlap the pinned card: it goes below it
  assert.equal(s.items.d.y, 400 + 96 + KANBAN_GAP)
  assert.equal(s.items.d.x, 40 + KANBAN_PAD)
  // the board view agrees (boardToFlow's own stacking)
  assert.equal(kanbanLayout(s).has('pinned'), false)
  assert.equal(kanbanLayout(s).get('d')!.y, s.items.d.y)
})

test('a locked column stays where it is (position and height); the others flow around it; its cards still stack inside it', () => {
  const b = board([item({ id: 'f', type: 'frame', w: 2000, h: 900 }), col('todo', 40), col('fixed', 340, { y: 160, h: 300, data: LOCK }), col('done', 900), card('x', 'fixed', 900)])
  const s = alignKanban(b)
  assert.deepEqual([s.items.fixed.x, s.items.fixed.y, s.items.fixed.h], [340, 160, 300])
  assert.equal(s.items.todo.x, 40)
  assert.equal(s.items.done.x, 340 + 280 + KANBAN_GAP, 'the next column flows past the locked one')
  assert.deepEqual([s.items.x.x, s.items.x.y], [340 + KANBAN_PAD, 160 + KANBAN_HEADER + KANBAN_GAP], 'cards stack inside the locked column')
})

test('a kanban in a locked frame is shown exactly as stored: no stacking, no snapping, no growing', () => {
  const b = board([item({ id: 'f', type: 'frame', w: 300, h: 200, data: LOCK }), col('todo', 40), col('done', 700), card('a', 'todo', 555, { x: 13 })])
  const s = alignKanban(b)
  assert.equal(s, b, 'nothing changes')
  assert.equal(kanbanLayout(b).size, 0)
})
