// TODOs on the board (docs/canvas.md → "Notes"; the data: src/annotations.ts): something still to be confirmed with
// someone else, on an item or on the whole board. They live on the board only and wake no agent when written; checked
// off with an answer, the answer is posted in the TODO's thread and goes to the board's Answered by agent. Which ones
// a viewer sees, the panel's list, and the ops that write, check off and reopen one. Pure (no React), tested.
import type { Board, Item, Op } from '../../../src/model'
import { todoAnswerText, todoOf, type TodoMark } from '../../../src/annotations'
import { agentOf, displayName } from '../../../src/routing'
import { wrap } from '../../../src/textMetrics'

/** `open`: the open TODOs (the default); `all`: the done ones too, muted; `none`: no TODO on the board (the panel still lists them). */
export type TodosMode = 'open' | 'all' | 'none'
export const TODOS_MODES: TodosMode[] = ['open', 'all', 'none']
export const DEFAULT_TODOS_MODE: TodosMode = 'open'
export const TODOS_MODE_NAMES: Record<TodosMode, string> = { open: 'Open', all: 'All', none: 'None' }

/** Is a TODO drawn under `mode`? */
export const todoVisible = (todo: TodoMark, mode: TodosMode): boolean => mode === 'all' || (mode === 'open' && todo.state === 'open')

/** A TODO's root: a comment carrying `data.todo` that is not a reply. */
export const isTodoRoot = (board: Board, it: Item | undefined): boolean => Boolean(todoOf(it) && board.items[it?.target ?? '']?.type !== 'comment')

/** Does the board have a TODO? The TODOs switch is shown only then. */
export function hasTodos(board: Board): boolean {
  for (const it of Object.values(board.items)) if (isTodoRoot(board, it)) return true
  return false
}

/** One TODO as the panel lists it. */
export interface TodoRow {
  id: string
  text: string
  done: boolean
  ask?: string
  answer?: string
  /** the agent that opened it ("by codex-b"); absent when the person did */
  by?: string
  /** the item it is about, and how it is named; absent for a TODO about the whole board */
  target?: string
  targetName?: string
  /** replies in its thread */
  replies: number
  /** when it was written or last changed, for the order */
  at: string
}

/** A short name for an item: its first line, else its type. */
const nameOf = (it: Item, max = 32) => {
  const t = (it.label ?? it.text ?? '').split('\n')[0].trim() || it.role?.replace(/-/g, ' ') || it.type
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Who opened a TODO, when an agent did: its name as people read it. */
export const todoBy = (it: Item): string | undefined => {
  const a = agentOf(it)
  return a ? displayName(a) : undefined
}

/** When an item was written: ids from `newId` start with their creation time; others fall back to the last change. */
function writtenAt(it: Item): string {
  const m = /^[a-z]+_([0-9a-z]{8})/.exec(it.id)
  const t = m ? parseInt(m[1], 36) : NaN
  return t > Date.UTC(2020, 0) && t < Date.UTC(2100, 0) ? new Date(t).toISOString() : it.updatedAt
}

/** Every TODO on the board: the open ones (oldest first: the longest waiting on top), then the done ones (latest first). */
export function todoList(board: Board): { open: TodoRow[]; done: TodoRow[] } {
  const replies = new Map<string, number>()
  for (const it of Object.values(board.items)) if (it.type === 'comment' && it.target && todoOf(board.items[it.target])) replies.set(it.target, (replies.get(it.target) ?? 0) + 1)
  const open: TodoRow[] = []
  const done: TodoRow[] = []
  for (const it of Object.values(board.items)) {
    if (!isTodoRoot(board, it)) continue
    const t = todoOf(it)!
    const target = it.target ? board.items[it.target] : undefined
    const by = todoBy(it)
    const row: TodoRow = {
      id: it.id,
      text: it.text ?? '',
      done: t.state === 'done',
      ...(t.ask ? { ask: t.ask } : {}),
      ...(t.answer ? { answer: t.answer } : {}),
      ...(by ? { by } : {}),
      ...(target ? { target: target.id, targetName: nameOf(target) } : {}),
      replies: replies.get(it.id) ?? 0,
      at: t.state === 'done' ? (t.doneAt ?? it.updatedAt) : writtenAt(it),
    }
    ;(row.done ? done : open).push(row)
  }
  open.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  done.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return { open, done }
}

/** How many TODOs are open: the count on the panel's tab. */
export function openTodoCount(board: Board): number {
  let n = 0
  for (const it of Object.values(board.items)) if (isTodoRoot(board, it) && todoOf(it)!.state === 'open') n++
  return n
}

/**
 * A TODO card's size: 220 wide, as tall as its text wrapped beside the box (12.5 px on 17 px lines, about 175 px
 * wide) and the ask / by line under it — so the next card placed below it does not sit on it.
 */
export function todoSize(text: string): { w: number; h: number } {
  const lines = Math.max(1, wrap(text.trim(), 168, 12.5).length)
  return { w: 220, h: Math.ceil(lines * 17 + 33) }
}

/**
 * A new TODO written by the person: a root comment with `data.todo = { state: 'open', ask? }`, at `at` (beside its
 * item, or near the top-left of the view for one about the whole board).
 */
export function newTodo(target: Item | undefined, text: string, ask: string | undefined, stamp: { id: string; now: string; at: { x: number; y: number } }): Item {
  const who = ask?.trim()
  return {
    id: stamp.id,
    type: 'comment',
    x: Math.round(stamp.at.x),
    y: Math.round(stamp.at.y),
    ...todoSize(text),
    text: text.trim(),
    ...(target ? { target: target.id } : {}),
    data: { todo: { state: 'open', ...(who ? { ask: who } : {}) } },
    createdBy: 'user',
    updatedBy: 'user',
    updatedAt: stamp.now,
  }
}

/**
 * Check a TODO off: `data.todo` becomes `{ state: 'done', answer?, doneBy: 'person', doneAt }`; with an answer, a
 * reply carrying it (`data.todoAnswer`) is added to its thread — that reply is what goes to the Answered by agent.
 * Without one nobody is told. No ops for something that is not an open TODO.
 */
export function checkOffOps(board: Board, id: string, answer: string | undefined, stamp: { now: string; replyId: string }): Op[] {
  const it = board.items[id]
  const raw = it?.data?.todo
  if (!it || todoOf(it)?.state !== 'open' || !raw || typeof raw !== 'object') return []
  const said = answer?.trim()
  const todo = { ...(raw as Record<string, unknown>), state: 'done', ...(said ? { answer: said } : {}), doneBy: 'person', doneAt: stamp.now }
  if (!said) delete todo.answer
  const ops: Op[] = [{ kind: 'update', id, patch: { data: { ...it.data, todo } } }]
  if (said)
    ops.push({
      kind: 'add',
      item: { id: stamp.replyId, type: 'comment', x: it.x, y: it.y + it.h + 8, w: 160, h: 64, text: todoAnswerText(said), target: id, data: { todoAnswer: true }, createdBy: 'user', updatedBy: 'user', updatedAt: stamp.now },
    })
  return ops
}

/** Reopen a done TODO: open again, its answer and who checked it off dropped (the answer stays in the thread). */
export function reopenOps(board: Board, id: string): Op[] {
  const it = board.items[id]
  const raw = it?.data?.todo
  if (!it || todoOf(it)?.state !== 'done' || !raw || typeof raw !== 'object') return []
  const todo: Record<string, unknown> = { ...(raw as Record<string, unknown>), state: 'open' }
  delete todo.answer
  delete todo.doneBy
  delete todo.doneAt
  return [{ kind: 'update', id, patch: { data: { ...it.data, todo } } }]
}
