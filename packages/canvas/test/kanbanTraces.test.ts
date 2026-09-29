import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderKanban } from '../src/templates/kanban.js'
import { renderUserStoryMap } from '../src/templates/user-story-map.js'
import { traceWires } from '../src/templates/frame.js'

const now = '2026-09-29T00:00:00Z'

test('kanban cards carry data.element and their traces (docs/diagrams.md §2, §6)', () => {
  const items = renderKanban(
    {
      columns: [{ name: 'Backlog' }, { name: 'Doing', wip: 1 }],
      cards: [
        { id: 'release-1', title: 'Release 1', column: 'Backlog', stories: ['sm/receipts', 'sm/proposals'] },
        { title: 'Fix login', column: 'Doing', traces: [{ from: 'es/login-failed', rel: 'derived-from' }] },
      ],
    },
    { scope: 'kb', now },
  )
  const r1 = items.find((i) => i.id === 'kb.card.release-1')!
  assert.equal(r1.data?.element, 'release-1')
  assert.deepEqual(r1.data?.traces, [
    { from: 'sm/receipts', rel: 'groups' },
    { from: 'sm/proposals', rel: 'groups' },
  ])
  assert.deepEqual(r1.data?.stories, ['sm/receipts', 'sm/proposals'], 'the tracker adapter still reads data.stories')
  const fix = items.find((i) => i.text === 'Fix login')!
  assert.equal(fix.id, 'kb.card.Fix-login', 'item ids are unchanged, so existing boards keep their cards')
  assert.equal(fix.data?.element, 'fix-login')
  assert.deepEqual(fix.data?.traces, [{ from: 'es/login-failed', rel: 'derived-from' }])
  assert.equal(items.find((i) => i.role === 'column' && i.text === 'Doing')!.data?.element, 'doing')
})

test('a kanban card that groups stories draws 組成 trace wires to them', () => {
  const sm = renderUserStoryMap(
    { releases: ['R1'], activities: [{ id: 'ask', text: 'Ask', steps: [{ id: 'sel', text: 'Select', stories: [{ id: 'receipts', text: 'Receipts', release: 'R1' }] }] }] },
    { scope: 'sm', now },
  )
  const kb = renderKanban({ columns: [{ name: 'Backlog' }], cards: [{ id: 'r1', title: 'Release 1', column: 'Backlog', stories: ['sm/receipts', 'sm/missing'] }] }, { scope: 'kb', now })
  const board = Object.fromEntries(sm.map((i) => [i.id, i]))
  const wires = traceWires(kb, board, now)
  assert.equal(wires.length, 1, 'only traces whose target is on the board become wires')
  assert.equal(wires[0].from, 'kb.card.r1')
  assert.equal(wires[0].to, sm.find((i) => i.data?.element === 'receipts')!.id)
  assert.equal(wires[0].role, 'trace')
  assert.equal(wires[0].label, '組成')
})
