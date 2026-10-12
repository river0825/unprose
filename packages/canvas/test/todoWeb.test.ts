// The person's side of TODOs (web/src/flow/todoView.ts, notesView.ts): which ones are drawn under open / all / none,
// the panel's list (open first, then done), and the ops that write one, check it off — the answer as a reply in its
// thread, nothing to tell without one — and reopen it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { applyOps } from '../src/model.js'
import { todoOf } from '../src/annotations.js'
import { checkOffOps, hasTodos, newTodo, openTodoCount, reopenOps, todoList, todoVisible } from '../web/src/flow/todoView.js'
import { notesShown } from '../web/src/flow/notesView.js'
import { boardToFlow } from '../web/src/flow/boardToFlow.js'

const now = '2026-10-12T00:00:00.000Z'
const item = (id: string, patch: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 120, h: 80, text: id, createdBy: 'user', updatedBy: 'user', updatedAt: now, ...patch })
const todo = (id: string, state: 'open' | 'done', patch: Partial<Item> = {}, extra: Record<string, unknown> = {}) => item(id, { type: 'comment', w: 220, h: 56, data: { todo: { state, ...extra } }, ...patch })
const board = (...items: Item[]): Board => ({ id: 'b', title: 'b', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) }) as Board

const sticky = item('s1', { text: 'Refund requested\nsecond line' })
// ids from newId carry their creation time: c_1 is older than c_2
const t1 = todo(`c_${Date.UTC(2026, 9, 1).toString(36)}a`, 'open', { target: 's1', text: 'How many refunds?' }, { ask: 'PM' })
const t2 = todo(`c_${Date.UTC(2026, 9, 2).toString(36)}b`, 'open', { text: 'Which currency?', createdBy: 'agent', data: { todo: { state: 'open' }, by: 'codex-b' } })
const t3 = todo('c_done', 'done', { target: 's1', text: 'Who approves?' }, { answer: 'The team lead', doneBy: 'person', doneAt: '2026-10-05T00:00:00.000Z' })
const answer = item('c_ans', { type: 'comment', target: 'c_done', text: 'Confirmed: The team lead', data: { todoAnswer: true } })
const plain = item('c_plain', { type: 'comment', target: 's1', text: 'hi' })
const b = board(sticky, t1, t2, t3, answer, plain)

test('todoVisible: open shows the open ones, all every one, none nothing', () => {
  assert.ok(todoVisible({ state: 'open' }, 'open'))
  assert.ok(!todoVisible({ state: 'done' }, 'open'))
  assert.ok(todoVisible({ state: 'done' }, 'all'))
  assert.ok(!todoVisible({ state: 'open' }, 'none'))
})

test('notesShown: a TODO is its card (badge) when shown, its thread once opened; the TODOs switch decides, not the Comments one', () => {
  const view = (todos: 'open' | 'all' | 'none', o: { open?: string[]; expanded?: string[]; mode?: 'all' | 'badges' | 'none' } = {}) => notesShown(b, { mode: o.mode ?? 'all', todos, open: new Set(o.open ?? []), expanded: new Set(o.expanded ?? []) })
  assert.equal(view('open').get(t1.id), 'badge')
  assert.equal(view('open').get('c_done'), 'hidden')
  assert.equal(view('all').get('c_done'), 'badge')
  assert.equal(view('none').get(t1.id), 'hidden')
  assert.equal(view('open', { open: [t1.id] }).get(t1.id), 'open', 'its thread opened')
  assert.equal(view('none', { open: [t1.id] }).get(t1.id), 'hidden', 'the stored open set does not draw a hidden one')
  assert.equal(view('open', { expanded: ['c_done'] }).get('c_done'), 'open', 'shown from the panel in this session')
  assert.equal(view('open', { mode: 'none' }).get(t1.id), 'badge', 'Comments: none leaves TODOs alone')
  assert.equal(view('none', { mode: 'all' }).get('c_plain'), 'badge', 'TODOs: none leaves comments alone')
  assert.equal(notesShown(b, { mode: 'all', open: new Set(), expanded: new Set() }).get('c_done'), 'hidden', 'default: open')
})

test('boardToFlow: a folded TODO is drawn as its card and keeps its tether to its item', () => {
  const flow = boardToFlow(b, new Set(), notesShown(b, { mode: 'all', todos: 'open', open: new Set(), expanded: new Set() }))
  const n = flow.nodes.find((x) => x.id === t1.id)!
  assert.equal(n.width, 220)
  assert.equal(n.height, undefined)
  assert.ok(flow.edges.some((e) => e.id === `tether:${t1.id}`))
  assert.ok(!flow.nodes.some((x) => x.id === 'c_done'), 'done, under TODOs: open')
})

test('todoList: open ones oldest first with what they are about, who to ask and who opened them; done ones after, with the answer', () => {
  const { open, done } = todoList(b)
  assert.deepEqual(open.map((r) => r.id), [t1.id, t2.id])
  assert.equal(open[0].targetName, 'Refund requested')
  assert.equal(open[0].ask, 'PM')
  assert.equal(open[0].by, undefined, 'the person wrote it')
  assert.equal(open[1].target, undefined, 'about the board')
  assert.equal(open[1].by, 'codex-b')
  assert.deepEqual(done.map((r) => [r.id, r.answer, r.replies]), [['c_done', 'The team lead', 1]])
  assert.equal(openTodoCount(b), 2)
  assert.ok(hasTodos(b))
  assert.ok(!hasTodos(board(sticky, plain)))
})

test('newTodo: a root comment with data.todo open (and ask), on its item or about the board', () => {
  const t = newTodo(sticky, '  Limit per customer?  ', ' PM ', { id: 'c_new', now, at: { x: 140.4, y: 9.6 } })
  assert.deepEqual({ ...t }, { id: 'c_new', type: 'comment', x: 140, y: 10, w: 220, h: 50, text: 'Limit per customer?', target: 's1', data: { todo: { state: 'open', ask: 'PM' } }, createdBy: 'user', updatedBy: 'user', updatedAt: now })
  assert.ok(newTodo(sticky, 'A much longer question that needs a few lines on the card to be read in full', undefined, { id: 'c_l', now, at: { x: 0, y: 0 } }).h > 50, 'taller for more text')
  const loose = newTodo(undefined, 'Naming?', '', { id: 'c_b', now, at: { x: 0, y: 0 } })
  assert.equal(loose.target, undefined)
  assert.deepEqual(loose.data, { todo: { state: 'open' } })
})

test('checkOffOps: done by the person, with the answer in the TODO and as a todoAnswer reply; without one, no reply', () => {
  const ops = checkOffOps(b, t1.id, '  Three, then a manager  ', { now, replyId: 'c_reply' })
  assert.equal(ops.length, 2)
  const after = applyOps(b, ops, 'user', now).board
  assert.deepEqual(todoOf(after.items[t1.id]), { state: 'done', ask: 'PM', answer: 'Three, then a manager', doneBy: 'person', doneAt: now })
  const r = after.items.c_reply
  assert.equal(r.target, t1.id)
  assert.equal(r.text, 'Confirmed: Three, then a manager')
  assert.deepEqual(r.data, { todoAnswer: true })
  const quiet = checkOffOps(b, t2.id, '   ', { now, replyId: 'c_r2' })
  assert.equal(quiet.length, 1, 'no answer: nobody is told')
  const t = todoOf(applyOps(b, quiet, 'user', now).board.items[t2.id])!
  assert.equal(t.state, 'done')
  assert.equal(t.answer, undefined)
  assert.equal((applyOps(b, quiet, 'user', now).board.items[t2.id].data as { by?: string }).by, 'codex-b', 'the rest of its data stays')
  assert.deepEqual(checkOffOps(b, 'c_done', 'x', { now, replyId: 'c_r3' }), [], 'already done')
  assert.deepEqual(checkOffOps(b, 'c_plain', 'x', { now, replyId: 'c_r4' }), [], 'not a TODO')
})

test('reopenOps: open again, ask kept, answer and who checked it off dropped (the answer reply stays)', () => {
  const after = applyOps(b, reopenOps(b, 'c_done'), 'user', now).board
  assert.deepEqual(todoOf(after.items.c_done), { state: 'open' })
  assert.ok(after.items.c_ans, 'the answer stays in the thread')
  assert.deepEqual(reopenOps(b, t1.id), [], 'already open')
})
