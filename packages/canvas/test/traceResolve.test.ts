import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTraces, traceTarget } from '../src/templates/frame.js'
import { renderKanban } from '../src/templates/kanban.js'
import { parseTraceRef, TRACE_LABEL, traceSchema } from '../src/diagrams/ids.js'
import type { Item } from '../src/model.js'

const now = '2026-09-29T00:00:00Z'
const item = (id: string, data: Record<string, unknown> = {}, type = 'card'): Item => ({ id, type, x: 0, y: 0, w: 10, h: 10, data, createdBy: 'agent', updatedBy: 'agent', updatedAt: now }) as Item
const board = (...items: Item[]) => Object.fromEntries(items.map((i) => [i.id, i]))

test('#6: a target drawn before data.element existed is found by the id convention', () => {
  // an older kanban: cards without data.element, ids `<key>.card.<sanitised id or title>`
  const old = board(item('old-kanban.card.fix-queue'), item('old-kanban.card.Retry-errors'), item('old-es.event.order-placed', {}, 'sticky'))
  const kb = renderKanban({ columns: [{ name: 'Backlog' }], cards: [{ id: 'n', title: 'New', column: 'Backlog', traces: [
    { from: 'old-kanban/fix-queue', rel: 'derived-from' },
    { from: 'old-kanban/Retry errors', rel: 'groups' },
    { from: 'old-es/order-placed', rel: 'relates' },
    { from: 'old-kanban/nope', rel: 'groups' },
  ] }] }, { scope: 'new-kanban', now })
  const { wires, unresolved } = resolveTraces(kb, old, now)
  assert.deepEqual(wires.map((w) => w.to).sort(), ['old-es.event.order-placed', 'old-kanban.card.Retry-errors', 'old-kanban.card.fix-queue'])
  assert.deepEqual(unresolved, [{ item: 'new-kanban.card.n', trace: { from: 'old-kanban/nope', rel: 'groups' }, reason: 'not-found' }])
})

test('#6: data.element still wins, and repeated occurrences are skipped', () => {
  const pool = [item('es.person.you-2', { element: 'you', occurrence: true }), item('es.person.you', { element: 'you' })]
  assert.equal(traceTarget(pool, { key: 'es', element: 'you' })!.id, 'es.person.you')
})

test('#7: a ref without an element targets the whole diagram (its frame); relates is 相關', () => {
  assert.deepEqual(parseTraceRef('sub-board'), { key: 'sub-board' })
  assert.equal(parseTraceRef('Not A Key'), undefined)
  assert.equal(parseTraceRef('/x'), undefined)
  assert.equal(TRACE_LABEL.relates, '相關')
  assert.ok(traceSchema.safeParse({ from: 'k', rel: 'relates' }).success)
  const frame = item('diagram.sub-board', { diagram: { kind: 'kanban', key: 'sub-board' } }, 'frame')
  const kb = renderKanban({ columns: [{ name: 'A' }], cards: [{ id: 'epic', title: 'Epic', column: 'A', traces: [{ from: 'sub-board', rel: 'groups' }] }] }, { scope: 'top', now })
  const { wires, unresolved } = resolveTraces(kb, board(frame), now)
  assert.equal(unresolved.length, 0)
  assert.equal(wires[0].to, 'diagram.sub-board')
  assert.equal(wires[0].label, '組成')
})

test('#7: traces between elements of the same diagram are drawn (a card relates to a card)', () => {
  const kb = renderKanban({ columns: [{ name: 'A' }], cards: [
    { id: 'a', title: 'Retry in the queue', column: 'A', traces: [{ from: 'k/b', rel: 'relates' }] },
    { id: 'b', title: 'Retry in the mailer', column: 'A' },
  ] }, { scope: 'k', now })
  const { wires } = resolveTraces(kb, {}, now)
  assert.equal(wires.length, 1)
  assert.equal(wires[0].from, 'k.card.a')
  assert.equal(wires[0].to, 'k.card.b')
  assert.equal(wires[0].label, '相關')
})

test('#6: a malformed ref is reported, not thrown', () => {
  const kb = renderKanban({ columns: [{ name: 'A' }], cards: [{ id: 'a', title: 'A', column: 'A', traces: [{ from: '/bad', rel: 'groups' }] }] }, { scope: 'k', now })
  assert.equal(resolveTraces(kb, {}, now).unresolved[0].reason, 'bad-ref')
})
