// Deleted by the person > the file (docs/diagrams.md "What a redraw keeps"): a wire or item the person deleted on the
// board is not brought back by a redraw while the file still has it — it stays marked (a proposal to remove it from
// the file), the dry run lists it as "kept removed", and the mark goes once the file no longer has it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { explainRedraw, planLines, redrawInputs, removedByUser, type BoardItem, type LoggedChange } from '../src/diagrams/redraw.js'
import { pendingTag } from '../src/outline.js'
import { deletedOf, diagramRemoveOps, isFileDrawn, undoDeleteOps } from '../web/src/diagrams/deleteProposal.js'
import type { Board, Item } from '../src/model.js'

const frame = (): BoardItem => ({ id: 'diagram.k', type: 'frame', x: 0, y: 0, w: 900, h: 300, text: 'K', data: { diagram: { kind: 'event-storming', key: 'k', source: 'design/k.es.yaml' } } })
const sticky = (id: string, x: number, extra: Partial<BoardItem> = {}): BoardItem => ({ id, type: 'sticky', x, y: 20, w: 160, h: 110, parent: 'diagram.k', text: id, createdBy: 'agent', ...extra })
const wire = (id: string, from: string, to: string, extra: Partial<BoardItem> = {}): BoardItem => ({ id, type: 'arrow', x: 0, y: 0, w: 0, h: 0, from, to, label: 'then', role: 'triggers', createdBy: 'agent', ...extra })
const scope = { prefix: 'k.', keep: new Set(['diagram.k']), frame: 'diagram.k' }
const drawn = () => [frame(), sticky('k.policy.p', 20), sticky('k.command.c', 300), wire('k.arrow.p-c', 'k.policy.p', 'k.command.c')]
const drawLog: LoggedChange = { author: 'agent', note: 'design_draw: k.es.yaml', ops: drawn().map((item) => ({ kind: 'add', item })) }

test('a wire the person deleted (change log) comes back only as the mark of that deletion — listed as kept removed', () => {
  const board: Record<string, BoardItem> = { 'diagram.k': frame(), 'k.policy.p': sticky('k.policy.p', 20), 'k.command.c': sticky('k.command.c', 300) }
  const changes: LoggedChange[] = [drawLog, { author: 'user', ts: '2026-10-01T10:00:00.000Z', ops: [{ kind: 'remove', id: 'k.arrow.p-c' }] }]
  const { ops, plan } = explainRedraw(board, drawn(), redrawInputs(changes), scope)
  const add = ops.find((o) => o.kind === 'add' && o.item?.id === 'k.arrow.p-c')!
  assert.deepEqual(add.item!.data!.pending, { kind: 'remove', deleted: 'wire', by: 'user', at: '2026-10-01T10:00:00.000Z' })
  assert.deepEqual(plan.keptRemoved.map((l) => l.id), ['k.arrow.p-c'])
  assert.equal(plan.added.length, 0, 'not an ordinary add')
  const text = planLines(plan).join('\n')
  assert.match(text, /kept removed \(1\):/)
  assert.match(text, /x k\.arrow\.p-c {2}"then" — you deleted it — the file still has it; propose the file change\?/)
})

test('a marked deletion is held as it is while the file has it, and removed for good once the file drops it', () => {
  const marked = wire('k.arrow.p-c', 'k.policy.p', 'k.command.c', { data: { pending: { kind: 'remove', deleted: 'wire', by: 'user', at: 't' } } })
  const board: Record<string, BoardItem> = { 'diagram.k': frame(), 'k.policy.p': sticky('k.policy.p', 20), 'k.command.c': sticky('k.command.c', 300), 'k.arrow.p-c': marked }
  const still = explainRedraw(board, drawn(), redrawInputs([drawLog]), scope)
  assert.equal(still.ops.some((o) => (o.id ?? o.item?.id) === 'k.arrow.p-c'), false, 'untouched: no update, no remove')
  assert.deepEqual(still.plan.keptRemoved.map((l) => l.id), ['k.arrow.p-c'])
  assert.equal(still.plan.held.length, 0)
  // the file holder removed the subscription from the file: the mark is cleared with the wire
  const gone = explainRedraw(board, drawn().filter((d) => d.id !== 'k.arrow.p-c'), redrawInputs([drawLog]), scope)
  assert.ok(gone.ops.some((o) => o.kind === 'remove' && o.id === 'k.arrow.p-c'))
  assert.match(gone.plan.settled[0].why!, /no longer has it: gone for good \(the "kept removed" mark is cleared\)/)
  assert.equal(gone.plan.keptRemoved.length, 0)
})

test('items too: a sticky the person deleted stays removed (deleted by the person > the file)', () => {
  const board: Record<string, BoardItem> = { 'diagram.k': frame(), 'k.command.c': sticky('k.command.c', 300) }
  const changes: LoggedChange[] = [drawLog, { author: 'user', ops: [{ kind: 'remove', id: 'k.policy.p' }, { kind: 'remove', id: 'k.arrow.p-c' }] }]
  const { ops, plan } = explainRedraw(board, drawn(), redrawInputs(changes), scope)
  const pol = ops.find((o) => o.kind === 'add' && o.item?.id === 'k.policy.p')!
  assert.equal((pol.item!.data!.pending as { deleted: string }).deleted, 'item')
  assert.deepEqual(plan.keptRemoved.map((l) => l.id).sort(), ['k.arrow.p-c', 'k.policy.p'])
})

test('the change log: a deletion counts until someone adds the item back; an agent deleting it does not count', () => {
  const r = removedByUser([
    { author: 'user', ops: [{ kind: 'remove', id: 'a' }, { kind: 'remove', id: 'b' }] },
    { author: 'agent', ops: [{ kind: 'add', item: { id: 'b', type: 'arrow' } }, { kind: 'remove', id: 'c' }] },
  ])
  assert.deepEqual([...r.keys()], ['a'])
})

// ── the page: deleting a file-drawn item marks it instead ─────────────

const NOW = '2026-10-02T00:00:00.000Z'
const asItem = (b: BoardItem): Item => ({ x: 0, y: 0, w: 0, h: 0, createdBy: 'agent', updatedBy: 'agent', updatedAt: NOW, ...b }) as Item
const page = (extra: BoardItem[] = []): Board => {
  const items = [...drawn(), ...extra].map(asItem)
  return { id: 'b', title: 'B', kind: 'freeform', seq: 1, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(items.map((i) => [i.id, i])) }
}

test('page: Delete on a file-drawn wire or sticky marks it deleted (it stays, struck); hand-drawn items and comments are deleted', () => {
  const b = page([sticky('mine', 600, { createdBy: 'user' }), { id: 'c1', type: 'comment', target: 'k.policy.p', parent: 'diagram.k' }])
  assert.equal(isFileDrawn(b, b.items['k.arrow.p-c']), true)
  assert.equal(isFileDrawn(b, b.items['mine']), false)
  assert.equal(isFileDrawn(b, b.items['c1']), false)
  assert.equal(isFileDrawn(b, b.items['diagram.k']), false)
  const { ops, handled } = diagramRemoveOps(b, ['k.arrow.p-c', 'k.policy.p', 'mine'], NOW)
  assert.deepEqual(handled, ['k.arrow.p-c', 'k.policy.p'])
  assert.deepEqual((ops[0] as { patch: { data: { pending: unknown } } }).patch.data.pending, { kind: 'remove', deleted: 'wire', by: 'user', at: NOW })
  // a frame not drawn from a file (no source) is the person's own drawing: plain deletes
  const noFile = page()
  noFile.items['diagram.k'] = { ...noFile.items['diagram.k'], data: { diagram: { kind: 'event-storming', key: 'k' } } }
  assert.equal(isFileDrawn(noFile, noFile.items['k.arrow.p-c']), false)
})

test('page: Undo takes the deletion back; the outline says what is proposed', () => {
  const b = page()
  const marked = { ...b.items['k.arrow.p-c'], data: { pending: { kind: 'remove', deleted: 'wire', by: 'user', at: NOW } } }
  assert.ok(deletedOf(marked))
  assert.deepEqual(undoDeleteOps(marked), [{ kind: 'update', id: 'k.arrow.p-c', patch: { data: {} } }])
  assert.match(pendingTag(marked)!, /deleted by the person — the file still has it/)
})
