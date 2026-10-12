// Draft annotations and TODOs as agents meet them (docs/canvas.md "Annotations", "TODOs"): who a draft goes to (the
// holder of the files, with or without the edit), a TODO waking nobody while the answer in its thread reaches the
// board's responder, who checked it off (stamped by the canvas), and the words canvas_read_board / canvas_wait use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyOps, type Board, type Change, type Item, type Op } from '../src/model.js'
import { addressedTo, mentionsMe, openProposals, routeOf, stampRouting, stampTodos } from '../src/routing.js'
import { todoAnswerText } from '../src/annotations.js'
import { addAnnotationToFile } from '../src/annotationFile.js'
import { unifiedDiff } from '../src/patch.js'
import { sha1 } from '../src/proposals.js'
import { outline } from '../src/outline.js'
import { summarize } from '../src/diff.js'
import { readBoard } from '../src/read.js'
import { openDrafts, todoCounts, todoDoneOps, todoLines, todoReopenOp, TodoError } from '../src/todos.js'

const T0 = '2026-10-12T10:00:00.000Z'
const ES = 'events:\n  - id: paid\n    text: Order paid\n'
const it = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 160, h: 110, createdBy: 'agent', updatedBy: 'agent', updatedAt: T0, ...extra })

function shop(meta: Record<string, unknown> = {}): Board {
  const items: Record<string, Item> = {
    'diagram.shop-es': it('diagram.shop-es', { type: 'frame', text: 'Shop flow', w: 900, h: 500, data: { diagram: { kind: 'event-storming', key: 'shop-es', source: 'design/shop.es.yaml' } } }),
    'shop-es.event.paid': it('shop-es.event.paid', { text: 'Order paid', role: 'event', color: 'orange', parent: 'diagram.shop-es', x: 40, y: 60, data: { element: 'paid' } }),
    'shop-es.annotation.paid': it('shop-es.annotation.paid', { type: 'comment', role: 'note', color: 'yellow', text: 'Only after the bank says yes', target: 'shop-es.event.paid', parent: 'diagram.shop-es', x: 40, y: 300, w: 240, h: 30, data: { callout: 1, annotation: { on: 'paid', file: 'design/shop.es.yaml' } } }),
  }
  return {
    id: 'b1', title: 'Shop', kind: 'freeform', seq: 1, createdAt: T0, updatedAt: T0, items,
    meta: { diagrams: { 'shop-es': { kind: 'event-storming', source: 'design/shop.es.yaml', files: { 'design/shop.es.yaml': ES }, holder: { agent: 'agent-a', at: T0 } } }, responder: { mode: 'agent', agent: 'agent-r' }, ...meta },
  }
}

/** Ops as the server stamps them (TODO marks, then routing), applied one change at a time. */
function post(board: Board, ops: Op[], author: Item['createdBy'], who = author === 'user' ? 'person' : 'agent-x', known = ['agent-a', 'agent-r', 'agent-x']): Board {
  const now = new Date(Date.parse(T0) + 60_000 * board.seq).toISOString()
  const stamped = stampRouting(board, stampTodos(board, ops, who, now), known, now, (b, o) => applyOps(b, o, author).board)
  return { ...applyOps(board, stamped, author, now).board, seq: board.seq + 1 }
}
const comment = (id: string, text: string, extra: Partial<Item> = {}, by: Item['createdBy'] = 'user'): Item => it(id, { type: 'comment', text, w: 260, h: 90, createdBy: by, updatedBy: by, ...extra })
const changeOf = (b: Board, id: string, op: Op, author: Item['createdBy'], before: Item | null = null): Change => ({ seq: b.seq, ts: T0, author, boardId: b.id, ops: [op], before: { [id]: before } })

const draftEdit = () => {
  const after = addAnnotationToFile(ES, { on: 'paid', text: 'Refunds start here' })
  return { file: 'design/shop.es.yaml', base: sha1(ES), diff: unifiedDiff(ES, after, 'design/shop.es.yaml') }
}

test('a draft annotation is a proposal to the holder of the files — with its edit, without it, or by the item it is about', () => {
  const withEdit = comment('d1', 'Refunds start here', { target: 'shop-es.event.paid', data: { annotation: { draft: true, on: 'paid', file: 'design/shop.es.yaml' }, discuss: { about: ['shop-es.event.paid'], edit: draftEdit() } } })
  const noEdit = comment('d2', 'The bank decides', { target: 'shop-es.event.paid', data: { annotation: { draft: true, on: 'paid', file: 'design/shop.es.yaml' }, discuss: { about: ['shop-es.event.paid'] } } })
  const noFile = comment('d3', 'Paid by card only', { target: 'shop-es.event.paid', data: { annotation: { draft: true, on: 'paid' }, discuss: { about: ['shop-es.event.paid'] } } })
  let b = shop()
  for (const d of [withEdit, noEdit, noFile]) b = post(b, [{ kind: 'add', item: d }], 'user')
  for (const id of ['d1', 'd2', 'd3']) {
    assert.deepEqual(b.items[id].data?.to, ['agent-a'], `${id} goes to the holder, not the responder`)
    assert.equal(b.items[id].data?.route, 'proposal')
    assert.equal(mentionsMe(b, changeOf(b, id, { kind: 'add', item: b.items[id] }, 'user'), 'agent-a'), true, `${id} addresses the holder personally (untilMention)`)
  }
  assert.deepEqual(openProposals(b, ['shop-es']), ['d1', 'd2', 'd3'], 'open proposals on the diagram (a handover settles them first)')
  // the holder's reply goes back to the person's thread; the responder is not part of it
  b = post(b, [{ kind: 'add', item: comment('r1', 'Sound — applying it.', { target: 'd2', data: { by: 'agent-a' } }, 'agent') }], 'agent', 'agent-a')
  assert.deepEqual(b.items.r1.data?.to, [])
  assert.deepEqual(openDrafts(b).map((d) => d.id), ['d1', 'd2', 'd3'])
  b = post(b, [{ kind: 'add', item: comment('applied.d2', 'Applied to design/shop.es.yaml', { target: 'd2', data: { by: 'agent-a' } }, 'agent') }], 'agent', 'agent-a')
  assert.deepEqual(openDrafts(b).map((d) => d.id), ['d1', 'd3'], 'answered "Applied to …": settled')
})

test('a TODO wakes nobody — written, edited or checked off; the answer in its thread goes to "Answered by"', () => {
  let b = shop()
  b = post(b, [{ kind: 'add', item: comment('todo.1', 'Confirm the refund limit with finance @agent-a', { target: 'shop-es.event.paid', data: { todo: { state: 'open', ask: 'finance' } } }) }], 'user')
  assert.deepEqual(routeOf(b, b.items['todo.1']), { to: [], route: 'todo' })
  assert.deepEqual(b.items['todo.1'].data?.to, [], 'not even the @mention or the responder')
  assert.equal(b.items['todo.1'].data?.route, 'todo')
  const add = changeOf(b, 'todo.1', { kind: 'add', item: b.items['todo.1'] }, 'user')
  for (const a of ['agent-a', 'agent-r', 'agent-x']) {
    assert.equal(addressedTo(b, add, a), false, `${a} is not woken`)
    assert.equal(mentionsMe(b, add, a), false)
  }
  // an agent opens one too: still nobody
  b = post(b, [{ kind: 'add', item: comment('todo.2', 'Ask legal about storing card numbers', { data: { todo: { state: 'open' }, by: 'agent-x' } }, 'agent') }], 'agent', 'agent-x')
  assert.deepEqual(b.items['todo.2'].data?.to, [])
  // the person checks the first off with an answer: the state change wakes nobody, the reply goes to the responder
  const before = b.items['todo.1']
  const { update, reply } = todoDoneOps(b, 'todo.1', ' Up to 3 refunds a month ')
  b = post(b, [{ ...update, patch: { data: { ...(update as { patch: { data: Record<string, unknown> } }).patch.data, todo: { state: 'done', ask: 'finance', answer: 'Up to 3 refunds a month', doneBy: 'agent-forged' } } } }, { kind: 'add', item: comment('todo.1.answer', reply!.text as string, { target: 'todo.1', data: reply!.data as Record<string, unknown> }) }], 'user')
  const done = b.items['todo.1'].data?.todo as Record<string, string>
  assert.deepEqual({ ...done, doneAt: undefined }, { state: 'done', ask: 'finance', answer: 'Up to 3 refunds a month', doneBy: 'person', doneAt: undefined }, 'who checked it off is the caller, whatever was sent')
  assert.ok(done.doneAt)
  assert.deepEqual(b.items['todo.1'].data?.to, [], 'the state change keeps the TODO routed to nobody')
  assert.equal(addressedTo(b, changeOf(b, 'todo.1', { kind: 'update', id: 'todo.1', patch: { data: b.items['todo.1'].data } }, 'user', before), 'agent-r'), false)
  assert.equal(b.items['todo.1.answer'].text, todoAnswerText('Up to 3 refunds a month'))
  assert.equal(b.items['todo.1.answer'].text, 'Confirmed: Up to 3 refunds a month')
  assert.deepEqual(b.items['todo.1.answer'].data?.to, ['agent-a'], 'a reply: the @mention in the TODO routes it (the person mentioned agent-a)')
  // a reply in an agent's TODO without a mention: the responder, and the agent that opened it
  const { update: u2, reply: r2 } = todoDoneOps(b, 'todo.2', 'Not allowed: use the provider\'s vault')
  b = post(b, [u2, { kind: 'add', item: comment('todo.2.answer', r2!.text as string, { target: 'todo.2', data: r2!.data as Record<string, unknown> }) }], 'user')
  assert.deepEqual(b.items['todo.2.answer'].data?.to, ['agent-r', 'agent-x'])
  assert.equal(b.items['todo.2.answer'].data?.route, 'responder')
  // checked off by an agent: its name; reopened: who and when are forgotten
  b = post(b, [todoReopenOp(b, 'todo.2')], 'agent', 'agent-x')
  assert.deepEqual(b.items['todo.2'].data?.todo, { state: 'open' })
  b = post(b, [todoDoneOps(b, 'todo.2').update], 'agent', 'agent-x')
  assert.equal((b.items['todo.2'].data?.todo as { doneBy?: string }).doneBy, 'agent-x')
  assert.deepEqual(todoCounts(b), { open: 0, done: 2 })
  assert.throws(() => todoDoneOps(b, 'shop-es.event.paid'), TodoError)
  assert.throws(() => todoDoneOps(b, 'nope'), /no item "nope" on this board/)
})

test('stampTodos: a new TODO starts open; checking off one already done keeps who did it', () => {
  const b = shop()
  const [add] = stampTodos(b, [{ kind: 'add', item: comment('t', 'x', { data: { todo: { state: 'weird', doneBy: 'me' } } }) }], 'person', T0)
  assert.deepEqual((add as { item: Item }).item.data?.todo, { state: 'open' })
  const was = { ...b, items: { ...b.items, t: comment('t', 'x', { data: { todo: { state: 'done', doneBy: 'agent-a', doneAt: T0 } } }) } }
  const [up] = stampTodos(was, [{ kind: 'update', id: 't', patch: { data: { todo: { state: 'done', answer: 'later edit' } } } }], 'person', '2026-10-13T00:00:00.000Z')
  assert.deepEqual((up as { patch: { data: { todo: unknown } } }).patch.data.todo, { state: 'done', answer: 'later edit', doneBy: 'agent-a', doneAt: T0 })
  const [rm] = stampTodos(was, [{ kind: 'update', id: 't', patch: { data: { todo: null } } }], 'person', T0)
  assert.equal('todo' in (rm as { patch: { data: Record<string, unknown> } }).patch.data, false)
})

test('canvas_read_board: annotations per diagram (not threads), the draft with its holder, the TODOs; the summary counts them', () => {
  let b = shop()
  b = post(b, [{ kind: 'add', item: comment('d2', 'The bank decides', { target: 'shop-es.event.paid', data: { annotation: { draft: true, on: 'paid', file: 'design/shop.es.yaml' }, discuss: { about: ['shop-es.event.paid'] } } }) }], 'user')
  b = post(b, [{ kind: 'add', item: comment('todo.1', 'Confirm the refund limit', { target: 'shop-es.event.paid', data: { todo: { state: 'open', ask: 'finance' } } }) }], 'user')
  b = post(b, [{ kind: 'add', item: comment('todo.2', 'Card brands?', { data: { todo: { state: 'open' }, by: 'agent-x' } }, 'agent') }], 'agent', 'agent-x')
  b = post(b, [todoDoneOps(b, 'todo.2', 'Visa and Mastercard').update], 'agent', 'agent-x')
  const text = outline(b)
  assert.match(text, /## annotations \(1\) — what each item is for, from the file \(not threads\)\n {4}① event "Order paid": Only after the bank says yes {2}#shop-es\.annotation\.paid/)
  assert.match(text, /- event: Order paid \[annotation ①\]/)
  assert.doesNotMatch(text, /💬 \(agent\) Only after the bank says yes/, 'a card is not a thread')
  assert.match(text, /📝 the person's draft annotation on event "Order paid": 'The bank decides' — waiting for agent-a to add it to design\/shop\.es\.yaml \(no edit attached: write the annotations entry by hand\) \(thread d2\) {2}#d2/)
  assert.match(text, /## TODOs — 1 open, 1 done \(to confirm with someone else: not questions to you; canvas_todo\)\n {2}☐ Confirm the refund limit \[ask finance · on event "Order paid" · opened by the person\] {2}#todo\.1\n {2}☑ Card brands\? — answer: Visa and Mastercard by agent-x {2}#todo\.2/)
  assert.doesNotMatch(text, /💬 \(user\) Confirm the refund limit/, 'a TODO is not listed as a thread')
  // one diagram: its annotations and the TODO about its item come along
  const one = readBoard(b, { frame: 'shop-es' }).text
  assert.match(one, /① event "Order paid"/)
  assert.match(one, /☐ Confirm the refund limit/)
  assert.doesNotMatch(one, /Card brands/, 'a TODO about nothing in that frame stays out')
  const summary = readBoard(b, { format: 'summary' }).text
  assert.match(summary, /1 comment thread\(s\), 1 waiting for an answer, 1 edit proposal\(s\) · 1 annotation\(s\)/, 'the draft is a thread (a proposal); the card and the TODOs are not')
  assert.match(summary, /TODOs: 1 open, 1 done/)
  assert.deepEqual(todoLines({ items: {} }), [])
})

test('canvas_wait / canvas_diff lines: a draft, a TODO added, answered, checked off and reopened', () => {
  let b = shop()
  const changes: Change[] = []
  const record = (next: Board, ops: Op[], author: Item['createdBy'], by?: string) => {
    const before = Object.fromEntries(ops.map((o) => { const id = o.kind === 'add' ? o.item.id : o.id; return [id, b.items[id] ?? null] }))
    const applied = ops.map((o) => (o.kind === 'add' ? { ...o, item: next.items[o.item.id] } : o.kind === 'update' ? { ...o, patch: { data: next.items[o.id].data } } : o)) as Op[]
    changes.push({ seq: next.seq, ts: T0, author, ...(by ? { by } : {}), boardId: b.id, ops: applied, before })
    b = next
  }
  const draft: Op = { kind: 'add', item: comment('d1', 'Refunds start here', { target: 'shop-es.event.paid', data: { annotation: { draft: true, on: 'paid', file: 'design/shop.es.yaml' }, discuss: { about: ['shop-es.event.paid'], edit: draftEdit() } } }) }
  record(post(b, [draft], 'user'), [draft], 'user')
  const todo: Op = { kind: 'add', item: comment('todo.1', 'Confirm the refund limit', { target: 'shop-es.event.paid', data: { todo: { state: 'open', ask: 'finance' } } }) }
  record(post(b, [todo], 'user'), [todo], 'user')
  const { update, reply } = todoDoneOps(b, 'todo.1', '3 a month')
  const done: Op[] = [update, { kind: 'add', item: comment('todo.1.answer', reply!.text as string, { target: 'todo.1', data: reply!.data as Record<string, unknown> }) }]
  record(post(b, done, 'user'), done, 'user')
  const reopen = [todoReopenOp(b, 'todo.1')]
  record(post(b, reopen, 'agent', 'agent-x'), reopen, 'agent', 'agent-x')
  const lines = summarize(b, changes)
  assert.equal(lines[0], '[2 user] drafted an annotation on event "Order paid" [shop-es.event.paid]: "Refunds start here" — a proposal to agent-a: judge it, then apply it or say why not [thread d1]')
  assert.equal(lines[1], '[3 user] added a TODO on event "Order paid" [shop-es.event.paid]: "Confirm the refund limit" (ask finance) — to confirm with someone else, not a question to you [todo todo.1]')
  assert.equal(lines[2], '[4 user] TODO "Confirm the refund limit" [todo.1]: checked off by the person — answer: "3 a month"')
  assert.equal(lines[3], '[4 user] answered the TODO "Confirm the refund limit": "Confirmed: 3 a month" — decide whether the design changes [thread todo.1]')
  assert.equal(lines[4], '[5 agent-x] TODO "Confirm the refund limit" [todo.1]: reopened')
  assert.equal(lines.length, 5)
})

test('canvas_read_board types: ["annotation"] picks the numbered cards, ["todo"] the TODOs', () => {
  let b = shop()
  b = post(b, [{ kind: 'add', item: comment('todo.1', 'Confirm the refund limit', { target: 'shop-es.event.paid', data: { todo: { state: 'open' } } }) }], 'user')
  const notes = readBoard(b, { types: ['annotation'] }).text
  assert.match(notes, /① event "Order paid": Only after the bank says yes/)
  assert.doesNotMatch(notes, /Confirm the refund limit/)
  const todos = readBoard(b, { types: ['todo'] }).text
  assert.match(todos, /☐ Confirm the refund limit/)
  assert.doesNotMatch(todos, /Only after the bank says yes/)
})
