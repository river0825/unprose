import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keepUserLayout, placedByUser } from '../src/graphCanvas.js'

test('a redraw keeps the geometry of items the person moved, and refreshes everything else', () => {
  const placed = placedByUser([
    { ops: [{ kind: 'update', id: 'wf.node.plan', patch: { x: 900, y: 40 } }] },
    { ops: [{ kind: 'update', id: 'wf.node.confirm', patch: { text: 'renamed' } }] },
  ])
  assert.deepEqual([...placed], ['wf.node.plan'])
  const ops = keepUserLayout(
    [
      { kind: 'update', id: 'wf.node.plan', patch: { x: 10, y: 10, w: 180, text: 'plan', data: { detail: {} } } },
      { kind: 'update', id: 'wf.node.confirm', patch: { x: 20, y: 20, text: 'confirm' } },
      { kind: 'add', patch: { x: 1 } },
    ],
    placed,
  )
  assert.deepEqual(ops[0].patch, { text: 'plan', data: { detail: {} } })
  assert.deepEqual(ops[1].patch, { x: 20, y: 20, text: 'confirm' })
  assert.equal(ops[2].kind, 'add')
})

// ── docs/studio.md §7: a redraw is complete, and pending wire edits wait for the files ──
import { isResolved, planRedraw } from '../src/graphCanvas.js'

const wire = (id: string, from: string, to: string, event: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'arrow', from: `wf.node.${from}`, to: `wf.node.${to}`, label: event, data: { event: { event, from, to } }, ...extra,
})
const block = (id: string, extra: Record<string, unknown> = {}) => ({ id: `wf.node.${id}`, type: 'card', x: 0, y: 0, text: id, ...extra })

test('a redraw removes template items the drawing no longer has, never comments or hand-drawn items', () => {
  const board = {
    'wf.node.a': block('a'),
    'wf.node.gone': block('gone'),
    'wf.arrow.old': wire('wf.arrow.old', 'a', 'gone', 'a.done'),
    c1: { id: 'c1', type: 'comment', target: 'wf.node.gone' },
    'wf.c2': { id: 'wf.c2', type: 'comment' },
    s1: { id: 's1', type: 'sticky' },
  }
  const ops = planRedraw(board, [block('a'), block('b')], new Set())
  assert.deepEqual(ops.filter((o) => o.kind === 'remove').map((o) => o.id).sort(), ['wf.arrow.old', 'wf.node.gone'])
  assert.deepEqual(ops.filter((o) => o.kind === 'add').map((o) => o.item!.id), ['wf.node.b'])
  assert.deepEqual(ops.filter((o) => o.kind === 'update').map((o) => o.id), ['wf.node.a'])
})

test('an unresolved pending wire is left exactly as the person left it', () => {
  const moved = wire('wf.arrow.x', 'review', 'plan', 'card-info.done', {
    data: { event: { event: 'card-info.done', from: 'card-info', to: 'plan' }, pending: { kind: 'rewire', before: { from: 'card-info', to: 'plan', event: 'card-info.done' }, after: { from: 'review', to: 'plan', event: 'card-info.done' } } },
  })
  const drawn = [block('plan'), wire('wf.arrow.x', 'card-info', 'plan', 'card-info.done')]
  const ops = planRedraw({ 'wf.node.plan': block('plan'), 'wf.arrow.x': moved }, drawn, new Set())
  assert.equal(ops.some((o) => o.id === 'wf.arrow.x' || o.item?.id === 'wf.arrow.x'), false)
})

test('a pending wire the files now explain is replaced by the drawn one and loses pending', () => {
  const pending = { kind: 'rewire', before: { from: 'card-info', to: 'plan', event: 'card-info.done' }, after: { from: 'review', to: 'plan', event: 'review.done' } }
  const moved = wire('wf.arrow.x', 'review', 'plan', 'card-info.done', { data: { event: { event: 'card-info.done', from: 'card-info', to: 'plan' }, pending } })
  const drawn = [wire('wf.arrow.y', 'review', 'plan', 'review.done')]
  assert.equal(isResolved(pending as never, drawn), true)
  const ops = planRedraw({ 'wf.arrow.x': moved }, drawn, new Set())
  assert.deepEqual(ops.map((o) => [o.kind, o.id ?? o.item!.id]), [['add', 'wf.arrow.y'], ['remove', 'wf.arrow.x']])
})

test('a proposed removal holds until the event is gone from the files; a drawn update keeps presentation data', () => {
  const pending = { kind: 'remove', before: { from: 'a', to: 'b', event: 'a.done' } }
  const w = wire('wf.arrow.ab', 'a', 'b', 'a.done', { data: { event: { event: 'a.done', from: 'a', to: 'b' }, pending, bend: { x: 3 } } })
  const stillThere = planRedraw({ 'wf.arrow.ab': w }, [wire('wf.arrow.ab', 'a', 'b', 'a.done')], new Set())
  assert.equal(stillThere.length, 0)
  const gone = planRedraw({ 'wf.arrow.ab': w }, [], new Set())
  assert.deepEqual(gone, [{ kind: 'remove', id: 'wf.arrow.ab' }])
  const plain = wire('wf.arrow.ab', 'a', 'b', 'a.done', { data: { event: { event: 'a.done', from: 'a', to: 'b' }, bend: { x: 3 }, seenBy: ['user'] } })
  const [op] = planRedraw({ 'wf.arrow.ab': plain }, [wire('wf.arrow.ab', 'a', 'b', 'a.done')], new Set())
  assert.deepEqual((op.patch as { data: unknown }).data, { event: { event: 'a.done', from: 'a', to: 'b' }, bend: { x: 3 }, seenBy: ['user'] })
})

// ── docs/diagrams.md §2: a diagram frame's redraw only touches that frame ─────────

test('a frame-scoped redraw removes stale items of its own frame only, never the frame, other frames, or their proposals', () => {
  const board = {
    'studio-es': { id: 'studio-es', type: 'frame', data: { diagram: { kind: 'event-storming', key: 'studio-es' } } },
    'studio-es.event.asked': { id: 'studio-es.event.asked', type: 'sticky', text: 'Asked' },
    'studio-es.event.gone': { id: 'studio-es.event.gone', type: 'sticky', text: 'Gone' },
    'studio-usm.story.a': { id: 'studio-usm.story.a', type: 'card', text: 'A' },
    'wf.arrow.x': { id: 'wf.arrow.x', type: 'arrow', from: 'wf.node.a', to: 'wf.node.b', data: { pending: { kind: 'remove', before: { from: 'a', to: 'b', event: 'a.done' } } } },
  }
  const drawn = [
    { id: 'studio-es', type: 'frame', data: { diagram: { kind: 'event-storming', key: 'studio-es' } } },
    { id: 'studio-es.event.asked', type: 'sticky', text: 'Asked' },
  ]
  const ops = planRedraw(board, drawn, new Set(), { prefix: 'studio-es.', keep: new Set(['studio-es']) })
  const removed = ops.filter((o) => o.kind === 'remove').map((o) => o.id)
  assert.deepEqual(removed, ['studio-es.event.gone']) // not the other frame's story, not the workflow's proposal
})

test('a proposed story is held until an element with the same trace is drawn, then it is replaced', () => {
  const proposal = { id: 'studio-usm.proposed.ask-ai', type: 'card', text: 'As you I ask AI', data: { pending: { kind: 'add', trace: { from: 'studio-es/ask-ai', rel: 'derived-from' } } } }
  const board = { [proposal.id]: proposal }
  const scope = { prefix: 'studio-usm.' }
  const before = planRedraw(board, [{ id: 'studio-usm.story.other', type: 'card' }], new Set(), scope)
  assert.ok(!before.some((o) => o.id === proposal.id)) // untouched: the file does not have it yet
  const after = planRedraw(board, [{ id: 'studio-usm.story.ask-ai', type: 'card', data: { traces: [{ from: 'studio-es/ask-ai', rel: 'derived-from' }] } }], new Set(), scope)
  assert.ok(after.some((o) => o.kind === 'remove' && o.id === proposal.id))
})
