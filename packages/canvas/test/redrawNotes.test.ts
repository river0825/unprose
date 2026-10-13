// A redraw removes the notes it drew that the file no longer has — a numbered card, a UI mock screen's own note — unless
// someone answered one: then the discussion stays, as a thread with no number. The layout check finds a card on a card.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyOps, type Board, type Item, type Op } from '../src/model.js'
import { annotationOf, calloutOf } from '../src/annotations.js'
import { stampRouting } from '../src/routing.js'
import { renderUiMock } from '../src/templates/index.js'
import { explainRedraw } from '../src/diagrams/index.js'
import { checkLayout } from '../src/layoutCheck.js'

const NOW = '2026-10-13T10:00:00.000Z'
const MOCK = {
  screens: [
    {
      id: 'home',
      name: 'Home',
      note: 'The first screen after sign-in',
      body: [
        { type: 'heading', id: 'title', text: 'Boards', note: 'Says where you are' },
        { type: 'button', id: 'new', text: 'New board', note: 'Primary: the one thing to do here' },
        { type: 'button', id: 'old', text: 'Import', note: 'Rarely used' },
      ],
    },
  ],
}
const draw = (mock: unknown) => renderUiMock(mock as never, { scope: 'k', now: NOW })
const boardOf = (items: Item[]) => Object.fromEntries(items.map((i) => [i.id, i])) as Record<string, Item & { [k: string]: unknown }>

test('a redraw removes the notes the file no longer has: a renamed element\'s, a note moved off an element, a screen\'s own note', () => {
  const board = boardOf(draw(MOCK))
  assert.ok(board['k.note.home'] && board['k.note.home.old'] && board['k.note.home.new'])
  const next = draw({
    screens: [{ id: 'home', name: 'Home', body: [
      { type: 'heading', id: 'title', text: 'Boards', note: 'Says where you are' },
      { type: 'button', id: 'new', text: 'New board' }, // its note moved to the heading's annotation below
      { type: 'button', id: 'import', text: 'Import', note: 'Rarely used' }, // renamed: old → import
    ] }],
    annotations: [{ on: 'home/title', text: 'Primary: the one thing to do here' }],
  })
  const { ops, plan } = explainRedraw(board as never, next as never, { placed: new Set() }, { prefix: 'k.' })
  const removed = ops.filter((o) => o.kind === 'remove').map((o) => o.id).sort()
  assert.deepEqual(removed, ['k.note.home', 'k.note.home.new', 'k.note.home.old', 'k.ui.home.old'])
  assert.deepEqual(plan.removed.map((l) => l.id).sort(), removed)
  assert.ok(ops.some((o) => o.kind === 'add' && o.item?.id === 'k.note.home.import'))
})

test('... unless someone answered it: it stays as a thread with no number — and the next redraw leaves it be', () => {
  const board = boardOf(draw(MOCK))
  board.r1 = { id: 'r1', type: 'comment', x: 0, y: 0, w: 200, h: 60, text: 'Do we still need import?', target: 'k.note.home.old', createdBy: 'user' } as never
  board.r2 = { id: 'r2', type: 'comment', x: 0, y: 0, w: 200, h: 60, text: 'Yes, for CSV', target: 'r1', createdBy: 'agent' } as never
  const withoutOld = { screens: [{ ...MOCK.screens[0], body: MOCK.screens[0].body.filter((e) => e.id !== 'old') }] }
  const first = explainRedraw(board as never, draw(withoutOld) as never, { placed: new Set() }, { prefix: 'k.' })
  assert.ok(!first.ops.some((o) => o.kind === 'remove' && (o.id === 'k.note.home.old' || o.id === 'r1' || o.id === 'r2')))
  const op = first.ops.find((o) => o.kind === 'update' && o.id === 'k.note.home.old')!
  assert.ok(op, 'the answered note is updated in place')
  assert.match(first.plan.updated.find((l) => l.id === 'k.note.home.old')!.why!, /it has replies, so it stays as a thread/)
  // written as the canvas writes it (a comment's data is merged; null takes a key away): no number, no annotation left
  const stored: Board = { id: 'b', title: 't', kind: 'ui-mock', seq: 0, createdAt: NOW, updatedAt: NOW, items: board as never }
  const ops = stampRouting(stored, [op as Op], [], NOW, (b, o) => applyOps(b, o, 'agent').board)
  const note = applyOps(stored, ops, 'agent').board.items['k.note.home.old']
  assert.deepEqual([calloutOf(note), annotationOf(note), 'callout' in note.data!, 'annotation' in note.data!], [undefined, undefined, false, false])
  assert.equal(note.text, 'Rarely used')
  // a second redraw has nothing to do with it
  const after = { ...board, 'k.note.home.old': note }
  const second = explainRedraw(after as never, draw(withoutOld) as never, { placed: new Set() }, { prefix: 'k.' })
  assert.ok(!second.ops.some((o) => o.id === 'k.note.home.old'))
})

test('a note the person or another agent wrote by hand is never removed; a person\'s comment is never a file note', () => {
  const board = boardOf(draw(MOCK))
  board['k.note.home.mine'] = { id: 'k.note.home.mine', type: 'comment', role: 'note', x: 0, y: 0, w: 200, h: 60, text: 'mine', createdBy: 'user' } as never
  board.c1 = { id: 'c1', type: 'comment', x: 0, y: 0, w: 200, h: 60, text: 'a thread', target: 'k.ui.home.old', createdBy: 'user' } as never
  const { ops } = explainRedraw(board as never, draw({ screens: [{ id: 'home', name: 'Home', body: [] }] }) as never, { placed: new Set() }, { prefix: 'k.' })
  const removed = new Set(ops.filter((o) => o.kind === 'remove').map((o) => o.id))
  assert.ok(!removed.has('k.note.home.mine') && !removed.has('c1'))
  assert.ok(removed.has('k.note.home.title'))
})

test('the layout check finds a card lying on another card, once per pair; a reply is drawn in its thread, never a finding', () => {
  const items = draw(MOCK)
  const cards = items.filter((i) => calloutOf(i) !== undefined)
  const [a, b] = cards
  const stale: Item = { ...a, id: 'k.note.home.gone', text: 'A note the file dropped', x: b.x + 4, y: b.y + 10, data: { ...a.data, callout: 9 } }
  const reply: Item = { id: 'r', type: 'comment', x: b.x, y: b.y, w: b.w, h: b.h, text: 'a reply', target: b.id, createdBy: 'user', updatedBy: 'user', updatedAt: NOW } as Item
  const board: Board = { id: 'b', title: 't', kind: 'ui-mock', seq: 0, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries([...items, stale, reply].map((i) => [i.id, i])) }
  const found = checkLayout(board).findings.filter((f) => f.kind === 'comment-covers')
  assert.equal(found.length, 1, JSON.stringify(found, null, 1))
  assert.ok([stale.id, b.id].includes(found[0].id))
  assert.match(found[0].message, /lies on comment "/)
  assert.deepEqual(found[0].others, [found[0].id === stale.id ? b.id : stale.id])
  // two cards at the very same spot (a stale note under a live one): one finding, on the later id
  const twin: Item = { ...b, id: 'k.note.home.twin' }
  const same: Board = { ...board, items: Object.fromEntries([...items, twin].map((i) => [i.id, i])) }
  const twins = checkLayout(same).findings.filter((f) => f.kind === 'comment-covers')
  const [earlier, later] = [b.id, twin.id].sort()
  assert.deepEqual(twins.map((f) => [f.id, f.others]), [[later, [earlier]]])
  // drawn apart, as the template draws them: nothing
  const clean: Board = { ...board, items: Object.fromEntries(items.map((i) => [i.id, i])) }
  assert.deepEqual(checkLayout(clean).findings.filter((f) => f.kind === 'comment-covers'), [])
})
