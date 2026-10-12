// TODOs on a board (docs/canvas.md "TODOs"), as agents read and write them: a TODO marks something still to be
// confirmed with someone else — a comment carrying `data.todo` (src/annotations.ts), the root of its own thread. It wakes
// nobody when written (routing.ts, route `todo`); checked off with an answer, the answer is a reply in its thread
// (`data.todoAnswer`) and goes where a reply goes — the board's "Answered by" agent. Pure: the lines canvas_read_board,
// canvas_todo and canvas_context show, and the ops canvas_todo writes (the canvas stamps who checked one off, and when).
import { isAnnotationDraft, todoAnswerText, todoOf, type TodoMark } from './annotations.js'
import type { Board, Item, Op } from './model.js'
import { displayName, isSettledThread, LOCAL_AGENT, threadOf, threadRoot } from './routing.js'

const short = (s: string | undefined, n = 120) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const when = (i: Item) => String(i.data?.postedAt ?? i.updatedAt ?? '')

export interface TodoView {
  item: Item
  todo: TodoMark
  /** the item it is about, when there is one on the board */
  on?: Item
  /** who opened it: an agent's name, or `person` */
  by: string
  /** the reply that carries the answer (`data.todoAnswer`), the latest */
  answerReply?: Item
  /** the other replies in its thread */
  replies: Item[]
}

/** Every TODO on the board (the roots carrying `data.todo`), oldest first. */
export function todosOf(board: Pick<Board, 'items'>): TodoView[] {
  return Object.values(board.items)
    .filter((it) => todoOf(it) && threadRoot(board, it).id === it.id)
    .sort((a, b) => when(a).localeCompare(when(b)))
    .map((item) => {
      const thread = threadOf(board, item).slice(1)
      const answers = thread.filter((r) => r.data?.todoAnswer === true)
      const on = item.target ? board.items[item.target] : undefined
      return { item, todo: todoOf(item)!, ...(on ? { on } : {}), by: item.createdBy === 'user' ? 'person' : typeof item.data?.by === 'string' ? (item.data.by as string) : LOCAL_AGENT, ...(answers.length ? { answerReply: answers[answers.length - 1] } : {}), replies: thread.filter((r) => r.data?.todoAnswer !== true) }
    })
}

export const isTodo = (it: Item | undefined): boolean => !!todoOf(it)
const whoText = (name: string) => (name === 'person' ? 'the person' : displayName(name))
/** "event "Order paid"" — what a TODO or an annotation is about, for an agent. */
export const aboutText = (it: Item | undefined): string => (!it ? '' : `${it.type === 'ui' ? String((it.data?.ui as { type?: string } | undefined)?.type ?? 'ui') : (it.role ?? it.type)} "${short(it.text, 40) || it.id}"`)

/** One TODO as a line: ☐ open (with whom to confirm it, what it is about, who opened it) or ☑ done (its answer). */
export function todoLine(t: TodoView): string {
  if (t.todo.state === 'open') {
    const bits = [t.todo.ask ? `ask ${t.todo.ask}` : '', t.on ? `on ${aboutText(t.on)}` : '', `opened by ${whoText(t.by)}`, t.replies.length ? `${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}` : ''].filter(Boolean)
    return `☐ ${short(t.item.text, 200)} [${bits.join(' · ')}]  #${t.item.id}`
  }
  const by = t.todo.doneBy ? ` by ${whoText(t.todo.doneBy)}` : ''
  return `☑ ${short(t.item.text, 120)} — ${t.todo.answer ? `answer: ${short(t.todo.answer, 160)}` : 'checked off without an answer'}${by}  #${t.item.id}`
}

/**
 * The TODOs as lines: the open ones (each with its replies, at most `replies`), then the last `done` checked off. Empty
 * when the board has none.
 */
export function todoLines(board: Pick<Board, 'items'>, o: { only?: Set<string>; done?: number; replies?: number; indent?: string } = {}): string[] {
  const all = todosOf(board).filter((t) => !o.only || o.only.has(t.item.id))
  if (!all.length) return []
  const open = all.filter((t) => t.todo.state === 'open')
  const done = all.filter((t) => t.todo.state === 'done').sort((a, b) => String(b.todo.doneAt ?? '').localeCompare(String(a.todo.doneAt ?? '')))
  const pad = o.indent ?? '  '
  const out = [`## TODOs — ${open.length} open, ${done.length} done (to confirm with someone else: not questions to you; canvas_todo)`]
  for (const t of open) {
    out.push(`${pad}${todoLine(t)}`)
    const rs = t.replies.slice(-(o.replies ?? 2))
    for (const r of rs) out.push(`${pad}  ↳ (${r.createdBy === 'user' ? 'person' : typeof r.data?.by === 'string' ? r.data.by : LOCAL_AGENT}) ${short(r.text, 160)}  #${r.id}`)
  }
  const shown = done.slice(0, o.done ?? 5)
  for (const t of shown) out.push(`${pad}${todoLine(t)}`)
  if (done.length > shown.length) out.push(`${pad}… ${done.length - shown.length} more done`)
  return out
}

/** How many TODOs are open, and done. */
export function todoCounts(board: Pick<Board, 'items'>): { open: number; done: number } {
  const all = todosOf(board)
  return { open: all.filter((t) => t.todo.state === 'open').length, done: all.filter((t) => t.todo.state === 'done').length }
}

/** The draft annotations still waiting for the holder of the files: proposal threads not answered "Applied to …" nor declined. */
export function openDrafts(board: Pick<Board, 'items'>): Item[] {
  return Object.values(board.items).filter((it) => isAnnotationDraft(it) && threadRoot(board, it).id === it.id && !isSettledThread(threadOf(board, it)))
}

export class TodoError extends Error {}

/** The TODO `id` names, or a TodoError saying what is there instead. */
export function todoById(board: Pick<Board, 'items'>, id: string): Item {
  const it = board.items[id]
  if (!it) throw new TodoError(`no item "${id}" on this board — canvas_todo({ board }) lists the open TODOs with their ids`)
  if (!todoOf(it)) throw new TodoError(`"${id}" is not a TODO (it is a ${it.type}${it.role ? ` ${it.role}` : ''}) — canvas_todo({ board }) lists the TODOs`)
  return it
}

/** A new TODO by an agent: open, about `on` when given (the canvas places it beside that item). */
export function newTodo(id: string, text: string, o: { on?: string; ask?: string } = {}): Record<string, unknown> {
  return { id, type: 'comment', text: text.trim(), ...(o.on ? { target: o.on } : {}), data: { todo: { state: 'open', ...(o.ask?.trim() ? { ask: o.ask.trim() } : {}) } } }
}

/**
 * Checking a TODO off: its mark set done (the canvas stamps who and when), and with an answer, the answer as a reply in
 * its thread (`data.todoAnswer`) — that reply is what reaches the board's "Answered by" agent.
 */
export function todoDoneOps(board: Pick<Board, 'items'>, id: string, answer?: string): { update: Op; reply?: Record<string, unknown> } {
  const it = todoById(board, id)
  const was = todoOf(it)!
  const a = answer?.trim()
  const todo = { state: 'done', ...(was.ask ? { ask: was.ask } : {}), ...(a ? { answer: a } : {}) }
  const update: Op = { kind: 'update', id, patch: { data: { ...(it.data ?? {}), todo } } }
  return { update, ...(a ? { reply: { type: 'comment', text: todoAnswerText(a), target: id, data: { todoAnswer: true } } } : {}) }
}

/** Reopening a TODO: open again, who checked it off forgotten. */
export function todoReopenOp(board: Pick<Board, 'items'>, id: string): Op {
  const it = todoById(board, id)
  const was = todoOf(it)!
  return { kind: 'update', id, patch: { data: { ...(it.data ?? {}), todo: { state: 'open', ...(was.ask ? { ask: was.ask } : {}) } } } }
}
