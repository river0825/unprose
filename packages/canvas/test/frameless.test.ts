// A diagram the board still registers (meta.diagrams) whose frame is gone — removed over /ops or on the page — is told to
// agents (canvas_read_board, canvas_context) with the two ways out: the holder redraws it, or drops the entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { framelessDiagrams, framelessLines } from '../src/routing.js'
import { outline } from '../src/outline.js'
import { readBoard } from '../src/read.js'

const T0 = '2026-10-13T10:00:00.000Z'
const it = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: 'frame', x: 0, y: 0, w: 400, h: 300, createdBy: 'agent', updatedBy: 'agent', updatedAt: T0, ...extra })
const board = (items: Item[]): Board => ({
  id: 'b1',
  title: 'shop',
  kind: 'freeform',
  seq: 3,
  createdAt: T0,
  updatedAt: T0,
  meta: {
    diagrams: {
      'shop-es': { kind: 'event-storming', source: 'design/shop.es.yaml', holder: { agent: 'agent-a', at: T0 } },
      'shop-ui': { kind: 'ui-mock', source: 'design/shop.ui.yaml', holder: { agent: 'agent-a', at: T0 } },
      loose: { kind: 'kanban' },
    },
  },
  items: Object.fromEntries(items.map((i) => [i.id, i])),
})

test('the registered diagrams with no frame on the board: by the frame id, or a frame that says it draws the key', () => {
  const b = board([it('diagram.shop-es', { data: { diagram: { kind: 'event-storming', key: 'shop-es' } } }), it('f_moved', { data: { diagram: { kind: 'ui-mock', key: 'shop-ui' } } })])
  assert.deepEqual(framelessDiagrams(b), [{ key: 'loose' }])
  const gone = board([])
  assert.deepEqual(framelessDiagrams(gone).map((d) => [d.key, d.source, d.holder?.agent]), [
    ['shop-es', 'design/shop.es.yaml', 'agent-a'],
    ['shop-ui', 'design/shop.ui.yaml', 'agent-a'],
    ['loose', undefined, undefined],
  ])
  assert.deepEqual(framelessDiagrams({ meta: undefined, items: {} }), [])
})

test('agents are told, with the two ways out', () => {
  const b = board([it('diagram.shop-es', { data: { diagram: { kind: 'event-storming', key: 'shop-es' } } })])
  const lines = framelessLines(b)
  assert.deepEqual(lines, [
    'Diagram shop-ui (design/shop.ui.yaml) is still registered, but its frame is gone from the board — files held by agent-a: its holder redraws it from the file, or drops the entry — PATCH /api/boards/b1 {"meta":{"diagrams":{"shop-ui":null}}} (only the holder may)',
    'Diagram loose is still registered, but its frame is gone from the board: redraw it from the file, or drop the entry — PATCH /api/boards/b1 {"meta":{"diagrams":{"loose":null}}}',
  ])
  // the top of canvas_read_board, in the outline and in the summary
  assert.ok(outline(b).split('\n').slice(0, 8).includes(lines[0]), outline(b))
  assert.ok(readBoard(b, { format: 'summary' }).text.includes(lines[1]))
  // a board whose frames are all there says nothing
  assert.deepEqual(framelessLines({ ...b, meta: { diagrams: { 'shop-es': (b.meta!.diagrams as Record<string, unknown>)['shop-es'] } } }), [])
})
