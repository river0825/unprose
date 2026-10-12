// Annotations and TODOs (docs/canvas.md → "Annotations", "TODOs"): two things on a board that are not a conversation.
//
// - An annotation explains what an item is for. It lives in the design file — an entry of the file's top-level
//   `annotations:` list, `{ on, text }`, in every kind (a UI mock and a wireframe also take `note:` on an element) — and
//   is drawn as a numbered pin on the item and a card with the same number beside the drawing: a comment item with
//   role `note`, `data.callout` (its number) and `data.annotation`. The person writes one on the canvas as a draft: a
//   proposal to the holder of the files (`data.annotation.draft`, with the edit in `data.discuss.edit`), who judges it
//   and applies it. On a board with no file behind the item it is written straight onto the board (`data.annotation.board`).
// - A TODO marks something still to be confirmed with someone else. It lives on the board only (a comment carrying
//   `data.todo`), wakes no agent when it is written, and is checked off by the person or an agent; the answer, when
//   there is one, is posted in its thread (`data.todoAnswer`) and goes to the board's Answered by agent.
//
// Pure (no I/O, no parser): the web, the server and the CLI share it. The file edit a draft proposes is in
// annotationFile.ts, which loads the yaml parser — so the web loads that only when a draft is written.
type ItemLike = { id?: string; type: string; role?: unknown; target?: string; data?: Record<string, unknown> } | undefined

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

// ── annotations ──

/** The number of an annotation card — a comment with role `note` and `data.callout` 1…n — else undefined. */
export function calloutOf(it: ItemLike): number | undefined {
  if (!it || it.type !== 'comment' || it.role !== 'note') return undefined
  const n = it.data?.callout
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined
}

/** `data.annotation` on a comment: an annotation card drawn from the file, the person's draft, or one on the board only. */
export interface AnnotationMark {
  /** what it is about, as the file writes it (`annotations[].on`) */
  on?: string
  /** the person's annotation, proposed to the holder of the files: the root of a proposal thread, not yet in the file */
  draft?: true
  /** the design file it goes into (a draft) or came from */
  file?: string
  /** written on the board itself: there is no file behind the item */
  board?: true
}

/** The annotation a comment carries (`data.annotation`), else undefined. */
export function annotationOf(it: ItemLike): AnnotationMark | undefined {
  if (!it || it.type !== 'comment') return undefined
  const a = it.data?.annotation
  if (!a || typeof a !== 'object' || Array.isArray(a)) return undefined
  const o = a as Record<string, unknown>
  return {
    ...(str(o.on) ? { on: o.on as string } : {}),
    ...(o.draft === true ? { draft: true as const } : {}),
    ...(str(o.file) ? { file: o.file as string } : {}),
    ...(o.board === true ? { board: true as const } : {}),
  }
}

/** The person's annotation, waiting for the holder of the files (the root of its proposal thread). */
export const isAnnotationDraft = (it: ItemLike): boolean => annotationOf(it)?.draft === true

/** A drawn annotation — a numbered card, from the file or on the board only — not a conversation (and not a draft). */
export const isAnnotationCard = (it: ItemLike): boolean => calloutOf(it) !== undefined || (!!annotationOf(it) && !isAnnotationDraft(it) && it?.role === 'note')

/**
 * What an annotation about `item` writes in `on`: the element it draws (`data.element`), else its id inside its
 * diagram (`<key>.` taken off) — a template resolves both.
 */
export function annotationRefOf(item: { id: string; data?: Record<string, unknown> }, key?: string): string {
  const el = str(item.data?.element)
  if (el) return el
  return key && item.id.startsWith(`${key}.`) ? item.id.slice(key.length + 1) : item.id
}

// ── TODOs ──

export type TodoState = 'open' | 'done'

/** `data.todo` on a comment (the root of its thread): what is still to be confirmed, with whom, and how it ended. */
export interface TodoMark {
  state: TodoState
  /** who to confirm it with (free text: "PM", "the backend team") */
  ask?: string
  /** what was found out, when it was checked off with an answer */
  answer?: string
  /** who checked it off: an agent's name, or `person` */
  doneBy?: string
  doneAt?: string
}

/** The TODO a comment carries (`data.todo`), else undefined. */
export function todoOf(it: ItemLike): TodoMark | undefined {
  if (!it || it.type !== 'comment') return undefined
  const t = it.data?.todo
  if (!t || typeof t !== 'object' || Array.isArray(t)) return undefined
  const o = t as Record<string, unknown>
  return {
    state: o.state === 'done' ? 'done' : 'open',
    ...(str(o.ask) ? { ask: o.ask as string } : {}),
    ...(str(o.answer) ? { answer: o.answer as string } : {}),
    ...(str(o.doneBy) ? { doneBy: o.doneBy as string } : {}),
    ...(str(o.doneAt) ? { doneAt: o.doneAt as string } : {}),
  }
}

export const isOpenTodo = (it: ItemLike): boolean => todoOf(it)?.state === 'open'

/** The text of the reply that carries a TODO's answer (posted in its thread with `data.todoAnswer: true`). */
export const todoAnswerText = (answer: string): string => `Confirmed: ${answer.trim()}`
