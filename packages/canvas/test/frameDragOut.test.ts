// An item can be dragged out of its frame, lane or column (docs/canvas.md "Moving and selecting inside frames"): React
// Flow does not hold it inside its parent, and the drop's `parent: null` reaches the board — JSON drops an `undefined`,
// and the item used to stay in the frame it was dragged out of.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyOps, type Board, type Item } from '../src/model.js'
import { boardToFlow } from '../web/src/flow/boardToFlow.js'
import { startServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'

const now = '2026-10-22T00:00:00.000Z'
const item = (id: string, patch: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 120, h: 60, text: id, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...patch })
const boardOf = (items: Item[]): Board => ({ id: 'b', title: 'Drag out', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) })
const fixture = (): Item[] => [
  item('frame', { type: 'frame', w: 800, h: 600, text: 'Frame' }),
  item('lane', { type: 'lane', x: 20, y: 40, w: 400, h: 300, text: 'Lane', parent: 'frame' }),
  item('sticky', { x: 40, y: 80, parent: 'frame' }),
  item('in-lane', { x: 60, y: 100, parent: 'lane' }),
  item('board', { type: 'lane', role: 'column', x: 1000, y: 0, w: 300, h: 600, text: 'Doing' }),
  item('card', { type: 'card', x: 1010, y: 40, parent: 'board' }),
]

test('an item in a frame or lane is not held inside it; a frame or lane inside another one is', () => {
  const { nodes } = boardToFlow(boardOf(fixture()), new Set(), new Map())
  const extent = (id: string) => nodes.find((n) => n.id === id)!.extent
  assert.equal(extent('sticky'), undefined)
  assert.equal(extent('in-lane'), undefined)
  assert.equal(extent('card'), undefined)
  assert.equal(extent('lane'), 'parent')
  assert.equal(nodes.find((n) => n.id === 'sticky')!.parentId, 'frame')
})

test('parent: null takes an item out of its frame, also after JSON (where undefined is dropped)', () => {
  const ops = JSON.parse(JSON.stringify([{ kind: 'update', id: 'sticky', patch: { x: -300, parent: null } }]))
  const { board, before } = applyOps(boardOf(fixture()), ops, 'user', now)
  assert.equal('parent' in board.items.sticky, false)
  assert.equal(board.items.sticky.x, -300)
  assert.equal(before.sticky?.parent, 'frame')
  // the old way lost the parent change on the wire: the item stayed in the frame
  const lost = JSON.parse(JSON.stringify([{ kind: 'update', id: 'sticky', patch: { x: -300, parent: undefined } }]))
  assert.equal(applyOps(boardOf(fixture()), lost, 'user', now).board.items.sticky.parent, 'frame')
})

test('over HTTP: the drop reaches the stored board', async () => {
  const srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-dragout-')), webDist: '/nonexistent' })
  try {
    const client = new CanvasClient(srv.url)
    const b = await client.createBoard({ title: 'Drag out', kind: 'freeform' })
    await client.apply(b.id, fixture().map((i) => ({ kind: 'add', item: i })), 'user')
    await client.apply(b.id, [{ kind: 'update', id: 'sticky', patch: { x: -300, parent: null } }], 'user')
    const out = (await client.getBoard(b.id)).items.sticky
    assert.equal(out.parent, undefined)
    assert.equal(out.x, -300)
  } finally {
    await srv.close()
  }
})
