// Annotations on the board (docs/canvas.md → "Notes"; the data: src/annotations.ts): which pins and TODO markers
// each item carries, which pin to light while its card is pointed at, the number a board-only annotation takes, and
// what the person's annotation becomes — a draft for the holder of the files, carrying the edit to the design file,
// or a card on the board itself when no file is behind the item. Pure (no React), so the rules can be tested; the
// shape of flow/notesView.ts. The draft itself (it needs the yaml parser) is built in flow/annotationDraft.ts.
import { diagramOf, diagramSpecOf, type Board, type Item } from '../../../src/model'
import { annotationOf, annotationRefOf, calloutOf, isAnnotationDraft, todoOf } from '../../../src/annotations'
import { displayName, holderOfFile, holderOfItem } from '../../../src/routing'
import { uiCalloutSize } from '../../../src/diagrams/uiMock'
import { autoPlaceComments } from '../../../src/place'
import { threads } from './boardToFlow'
import { isSettled } from './notesView'
import type { TodosMode } from './todoView'

/**
 * - `all`: every annotation as a numbered pin on its item and a card with the same number beside it; the person's
 *   drafts as a dashed ✎ pin and a dashed card;
 * - `pins`: the pins only — the text is the pin's tooltip, a click shows that card (a draft's pin opens its thread);
 * - `none`: no pin and no card (the item's inspector still lists them).
 */
export type AnnotationsMode = 'all' | 'pins' | 'none'
export const ANNOTATIONS_MODES: AnnotationsMode[] = ['all', 'pins', 'none']
export const DEFAULT_ANNOTATIONS_MODE: AnnotationsMode = 'all'
export const ANNOTATIONS_MODE_NAMES: Record<AnnotationsMode, string> = { all: 'All', pins: 'Pins', none: 'None' }

/** An annotation thing on the board: a card (from the file, or on the board only) or the person's draft. */
export const isAnnotation = (it: Item | undefined): boolean => calloutOf(it) !== undefined || isAnnotationDraft(it)

/** Does the board have an annotation (a card, a UI mock callout, a draft)? The Annotations switch is shown only then. */
export function hasAnnotations(board: Board): boolean {
  for (const it of Object.values(board.items)) if (isAnnotation(it)) return true
  return false
}

// ── pins and TODO markers, by the item they are on ──

/** One pin on an item: an annotation card's number — or a draft's ✎ (no number) — and the card it stands for. */
export interface Pin {
  card: string
  n?: number
  text: string
  draft?: true
}

/** One TODO marker on an item: a small square, ticked when the TODO is done. */
export interface TodoPin {
  card: string
  text: string
  done: boolean
  ask?: string
}

export interface ItemMarks {
  pins: Pin[]
  todos: TodoPin[]
}

const byNumber = (a: Pin, b: Pin) => (a.n ?? Infinity) - (b.n ?? Infinity) || (a.card < b.card ? -1 : a.card > b.card ? 1 : 0)

/**
 * The pins and TODO markers of every item, by its id, computed once per board change and handed to the nodes (never
 * a scan of the board per node). A pin comes from an annotation card (`calloutOf`, about its `target`) or a draft not
 * yet settled; a marker from a TODO shown under the TODOs mode. A UI mock element's numbered pins are listed too —
 * UiNode draws them where they belong (corner, entry, row) and takes their text from here. Items with nothing on
 * them are not in the map.
 */
export function marksByTarget(board: Board, view: { annotations: AnnotationsMode; todos: TodosMode }): Map<string, ItemMarks> {
  const out = new Map<string, ItemMarks>()
  const on = (id: string) => {
    let m = out.get(id)
    if (!m) out.set(id, (m = { pins: [], todos: [] }))
    return m
  }
  let byRoot: Map<string, Item[]> | undefined
  for (const it of Object.values(board.items)) {
    if (it.type !== 'comment' || !it.target) continue
    const t = board.items[it.target]
    if (!t || t.type === 'comment' || t.type === 'arrow') continue
    const n = calloutOf(it)
    if (n !== undefined) {
      if (view.annotations !== 'none') on(t.id).pins.push({ card: it.id, n, text: it.text ?? '' })
      continue
    }
    if (isAnnotationDraft(it)) {
      if (view.annotations === 'none') continue
      // applied or declined: the card drawn from the file takes its place (the Chats tab still lists the thread)
      byRoot ??= threads(board)
      if (!isSettled(byRoot.get(it.id) ?? [it])) on(t.id).pins.push({ card: it.id, text: it.text ?? '', draft: true })
      continue
    }
    const todo = todoOf(it)
    if (todo && (view.todos === 'all' || (view.todos === 'open' && todo.state === 'open'))) on(t.id).todos.push({ card: it.id, text: it.text ?? '', done: todo.state === 'done', ...(todo.ask ? { ask: todo.ask } : {}) })
  }
  for (const m of out.values()) {
    m.pins.sort(byNumber)
    m.todos.sort((a, b) => Number(a.done) - Number(b.done) || (a.card < b.card ? -1 : a.card > b.card ? 1 : 0))
  }
  return out
}

const samePin = (a: Pin, b: Pin) => a.card === b.card && a.n === b.n && a.text === b.text && a.draft === b.draft
const sameTodoPin = (a: TodoPin, b: TodoPin) => a.card === b.card && a.text === b.text && a.done === b.done && a.ask === b.ask

/** Do two items carry the same marks (both none counts)? A node whose marks say the same stays the same object (flow/reuse.ts). */
export function sameMarks(a: ItemMarks | undefined, b: ItemMarks | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.pins.length !== b.pins.length || a.todos.length !== b.todos.length) return false
  return a.pins.every((p, i) => samePin(p, b.pins[i])) && a.todos.every((t, i) => sameTodoPin(t, b.todos[i]))
}

/** The card of an annotation, draft or TODO, and its number when it has one: what a lit marker points back to. */
export interface LitMark {
  card: string
  n?: number
}

const NO_LIT: ReadonlyMap<string, LitMark> = new Map()

/**
 * The markers to outline, by the item they are on, for the cards among `ids` (the cards lit through a pin or a panel
 * link, and the card under the pointer). Looks only at `ids`, so a hover costs nothing on a big board; the same
 * empty Map when there is nothing to light.
 */
export function litMarks(board: Board | undefined, ids: readonly string[]): ReadonlyMap<string, LitMark> {
  if (!board || !ids.length) return NO_LIT
  let out: Map<string, LitMark> | undefined
  for (const id of ids) {
    const c = board.items[id]
    if (!c?.target || !(isAnnotation(c) || todoOf(c))) continue
    const n = calloutOf(c)
    ;(out ??= new Map()).set(c.target, { card: c.id, ...(n !== undefined ? { n } : {}) })
  }
  return out ?? NO_LIT
}

// ── a new annotation ──

/** The diagram frame an item is in (its id), else undefined: the scope its annotations are numbered in. */
const frameOf = (board: Board, it: Item | undefined) => (it ? diagramOf(board, it)?.frameId : undefined)

/**
 * The number a new annotation on `target` takes: one more than the highest in its scope — the diagram frame it is
 * in, or the board for an item in none (cards about wires and lost items count in the board's scope).
 */
export function nextCallout(board: Board, target: Item): number {
  const scope = frameOf(board, target)
  let max = 0
  for (const it of Object.values(board.items)) {
    const n = calloutOf(it)
    if (n !== undefined && n > max && frameOf(board, board.items[it.target ?? '']) === scope) max = n
  }
  return max + 1
}

/**
 * Where a new card about `target` goes, `size` big: right of it, at its height, below the cards and comments already
 * there. A UI mock element's card goes right of its screen, so it never sits on the mock; with `gutter` (an annotation,
 * a draft) an item in a diagram frame has its card right of the frame too — beside the drawing, like the cards drawn
 * from the file, not among its stickies.
 */
export function besideItem(board: Board, target: Item, size: { w: number; h: number } = { w: 240, h: 64 }, gutter = false): { x: number; y: number } {
  let box: Item = target
  for (let p = board.items[target.parent ?? ''], guard = 0; p && guard < 50; p = board.items[p.parent ?? ''], guard++) {
    if (p.type === 'ui' && target.type === 'ui') box = p
    else if (gutter && diagramSpecOf(p)) box = p
  }
  const x = box.x + box.w + 24
  let y = target.y
  // what already stands in that column, top to bottom: the card goes in the first gap tall enough
  const column = Object.values(board.items)
    .filter((it) => it.type === 'comment' && !(it.target && board.items[it.target]?.type === 'comment') && it.x < x + size.w && it.x + it.w > x && it.y + it.h > y - 1)
    .sort((a, b) => a.y - b.y)
  for (const it of column) if (it.y < y + size.h + 8 && it.y + it.h + 8 > y) y = it.y + it.h + 8
  return { x: Math.round(x), y: Math.round(y) }
}

/**
 * Where a card that belongs by its item goes (a TODO): on free paper beside it — right, then below, left, above — never
 * on another sticky or card; in a UI mock, in the screen's gutter. The spot an agent's comment gets (src/place.ts).
 */
export function freeSpotBeside(board: Board, target: Item, size: { w: number; h: number }): { x: number; y: number } {
  const [spot] = (autoPlaceComments(board, { items: [{ type: 'comment', target: target.id, w: size.w, h: size.h }] }) as { items: Array<{ x?: number; y?: number }> }).items
  return typeof spot.x === 'number' && typeof spot.y === 'number' ? { x: Math.round(spot.x), y: Math.round(spot.y) } : besideItem(board, target, size)
}

/**
 * An annotation written on the board itself (`data.annotation.board`): the item has no file behind it, so there is
 * nobody to propose it to. The same card a template draws — the next free number in its scope, sized like a UI mock
 * callout — right of the item.
 */
export function boardAnnotation(board: Board, target: Item, text: string, stamp: { id: string; now: string }): Item {
  const size = uiCalloutSize(text)
  return {
    id: stamp.id,
    type: 'comment',
    role: 'note',
    target: target.id,
    text,
    ...besideItem(board, target, size, true),
    ...size,
    data: { callout: nextCallout(board, target), annotation: { board: true } },
    createdBy: 'user',
    updatedBy: 'user',
    updatedAt: stamp.now,
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** Where the person's annotation on `item` goes: a draft for the holder of the diagram's file, or the board itself. */
export type AnnotateWhere =
  | {
      kind: 'draft'
      /** the diagram's key and the file behind it, as the board names it */
      key: string
      file?: string
      /** what the entry's `on` says (the element, else the id inside the diagram) */
      on: string
      /** the agent holding the files: the draft goes to it */
      holder?: string
      /** the file's text on the board, when the edit can be made on it */
      text?: string
      /** why the draft cannot carry the edit (the holder then writes it into the file by hand) */
      why?: string
    }
  | { kind: 'board' }

/**
 * An item in a diagram drawn from a file (one with a source, or a holder) gets a draft; anything else — a freeform
 * board, a loose item, a diagram drawn without a file — an annotation on the board only.
 */
export function annotateWhere(board: Board, item: Item): AnnotateWhere {
  const d = diagramOf(board, item)
  if (!d) return { kind: 'board' }
  const meta = board.meta ?? {}
  const diagrams = meta.diagrams as Record<string, { source?: unknown; files?: unknown }> | undefined
  const wf = meta.workflow as { file?: unknown; files?: unknown; truncated?: unknown } | undefined
  const file = str(d.source) ?? str(diagrams?.[d.key]?.source) ?? (d.kind === 'workflow' ? str(wf?.file) : undefined)
  const holder = holderOfItem(board, item)?.agent ?? holderOfFile(meta, file)?.agent
  if (!file && !holder) return { kind: 'board' }
  const base = { kind: 'draft' as const, key: d.key, ...(file ? { file } : {}), on: annotationRefOf(item, d.key), ...(holder ? { holder } : {}) }
  if (!file) return { ...base, why: 'the board does not name the file behind this diagram' }
  const files = { ...(wf?.files && typeof wf.files === 'object' ? (wf.files as Record<string, unknown>) : {}), ...(diagrams?.[d.key]?.files && typeof diagrams[d.key].files === 'object' ? (diagrams[d.key].files as Record<string, unknown>) : {}) }
  const text = files[file]
  if (typeof text !== 'string') return { ...base, why: `the board has no copy of ${file}` }
  if (Array.isArray(wf?.truncated) && wf.truncated.includes(file)) return { ...base, why: `${file} is cut short on the board` }
  return { ...base, text }
}

/** What happens to an annotation written on `where`, in a line under its field. */
export function annotateHint(where: AnnotateWhere): string {
  if (where.kind === 'board') return 'Written on the board: no file is behind this item.'
  const who = where.holder ? displayName(where.holder) : 'the holder of the files'
  if (where.why || !where.file) return `A draft for ${who}, without a diff (${where.why ?? 'no file'}): they write it into the file by hand.`
  return `A draft for ${who}: they add it to ${where.file} and redraw.`
}

/** A draft's card: as wide as an annotation card, a line taller for its status. */
export function draftSize(text: string): { w: number; h: number } {
  const s = uiCalloutSize(text)
  return { w: s.w, h: s.h + 18 }
}

/** The agent a draft goes to: the holder of its file, else of the diagram its item is in. */
export function draftHolder(board: Board, draft: Item): string | undefined {
  const file = annotationOf(draft)?.file
  return holderOfFile(board.meta, file)?.agent ?? holderOfItem(board, board.items[draft.target ?? ''])?.agent
}

/**
 * The status line of a draft's card: waiting for the holder, or that it replied (with how many replies) — the
 * discussion itself is in the thread.
 */
export function draftStatus(replies: readonly Item[], holder: string | undefined): string {
  const who = holder ? displayName(holder) : 'the holder of the files'
  const n = replies.length
  if (!n) return `Draft · waiting for ${who}`
  const count = `${n} ${n === 1 ? 'reply' : 'replies'}`
  return replies.some((r) => r.createdBy === 'agent') ? `${who} replied · ${count}` : `Draft · waiting for ${who} · ${count}`
}
