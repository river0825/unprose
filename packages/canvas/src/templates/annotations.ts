// Annotations on a drawing (docs/diagrams.md "Annotations"): the file's top-level `annotations:` list — `{ id?, on, text }`,
// what an item is for — drawn as numbered cards in a gutter beside the drawing, never on it. A card is a comment with role
// `note`, `data.callout` (its number: 1…n in the reading order of what the cards are about) and `data.annotation` (`on` as
// the file writes it, and the file when the drawing knows it); the web draws a pin with the same number on the item the
// card is about (src/annotations.ts). The timeline kinds (EventStorming, story map, journey, kanban, workflow) get their
// cards in a band below the drawing from render(); a wireframe and a UI mock keep theirs right of each screen (their
// templates use the helpers here); a domain story keeps Egon.io's notes (text + dashed line). Pure.
import type { DiagramKind, Item } from '../model.js'
import { annotationRefOf } from '../annotations.js'
import { idAllocator } from '../diagrams/ids.js'
import { uiCalloutSize, UI_GUTTER } from '../diagrams/uiMock.js'
import { make } from './util.js'

/** An annotation as a file writes it (entries without `on` or `text` are left out: the schema reports them). */
export interface AnnotationIn {
  id?: string
  on: string
  text: string
}

/** The `annotations:` entries of a diagram's content that can be drawn. */
export function annotationsIn(content: unknown): AnnotationIn[] {
  const list = (content as { annotations?: unknown } | undefined)?.annotations
  if (!Array.isArray(list)) return []
  return list.flatMap((a) => {
    const o = a as Partial<AnnotationIn> | undefined
    if (!o || typeof o.on !== 'string' || !o.on.trim() || typeof o.text !== 'string' || !o.text.trim()) return []
    return [{ ...(typeof o.id === 'string' && o.id.trim() ? { id: o.id.trim() } : {}), on: o.on, text: o.text }]
  })
}

/** The card ids of a file's annotations, stable across redraws: `<scope>.annotation.<id, else the slug of on>` (-2, -3 … on a clash). */
export function annotationIds(list: AnnotationIn[], scope: string): string[] {
  const alloc = idAllocator()
  return list.map((a) => `${scope}.annotation.${alloc(a.id, a.on, 'annotation')}`)
}

type Drawn = Pick<Item, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'> & { role?: string; text?: string; data?: Record<string, unknown> }

/** Marks of a drawing nobody annotates: the line before a pivotal event, a release cut, the legend. */
const MARKS = new Set(['pivotal', 'release-cut', 'legend', 'legend-title'])
const annotatable = (it: Drawn) => it.type !== 'arrow' && it.type !== 'comment' && !MARKS.has(it.role ?? '')

/**
 * The item an annotation's `on` names: a full item id; an id inside the diagram (`<scope>.` taken off — what
 * annotationRefOf writes for an item that draws no element); the element it draws (`data.element`); else an item with
 * exactly that text (an EventStorming element by its text, a kanban card by its title). A repeated occurrence of an
 * element (`data.occurrence`: a person or system drawn again) only when nothing else matches. Undefined when nothing does.
 */
export function resolveOn<T extends Drawn>(items: readonly T[], on: string, scope: string): T | undefined {
  const want = on.trim()
  if (!want) return undefined
  const pool = items.filter(annotatable)
  const pick = (hits: T[]) => hits.find((i) => !i.data?.occurrence) ?? hits[0]
  return pool.find((i) => i.id === want) ?? pool.find((i) => i.id === `${scope}.${want}`) ?? pick(pool.filter((i) => i.data?.element === want)) ?? pick(pool.filter((i) => typeof i.text === 'string' && i.text.trim() === want))
}

/** What `on` may name, per kind — said when it names nothing. */
const ON_NAMES: Partial<Record<DiagramKind, string>> = {
  'event-storming': 'an element by its id or its text',
  'user-story-map': 'an activity, step or story by its id or its text, or a release lane (release.<slug>)',
  'user-journey': 'a stage or one of its stickies by its id (`checkout`, `checkout/pay`) or its text',
  wireframe: 'a screen (`<screen>`) or an element (`<screen>/<element>`: the slug of its text, else its role) by id, or its text',
  'ui-mock': 'a screen (`<screen>`) or an element (`<screen>/<element>`) — a stack, row or grid is not drawn: name an element in it',
  kanban: 'a card by its id (else the slug of its title) or its title, or a column by the slug of its name',
  workflow: 'a step or a trigger by its id',
}

/**
 * `awd design lint`'s findings on annotations: each `on` that names nothing in the drawing is an error (the draw leaves
 * that card out), with what `on` may name and some of the names this drawing has. `items` is the drawing, rendered with
 * `scope` (the diagram key).
 */
export function unresolvedAnnotations(kind: DiagramKind, content: unknown, items: readonly Drawn[], scope: string): Array<{ severity: 'error'; element: string; message: string }> {
  const list = annotationsIn(content)
  if (!list.length || kind === 'domain-story' || kind === 'freeform') return []
  const names = [...new Set(items.filter(annotatable).map((it) => annotationRefOf(it, scope)))].slice(0, 8)
  return list.flatMap((a, i) =>
    resolveOn(items, a.on, scope)
      ? []
      : [{ severity: 'error' as const, element: `annotations[${i}]`, message: `on "${a.on}" matches nothing in this diagram, so its card is not drawn — name ${ON_NAMES[kind] ?? 'an element by its id'}, or an item id on the board${names.length ? ` (e.g. ${names.join(', ')})` : ''}` }],
  )
}

/** Anchors this close read as one line (a row, or a column): left → right then the file's order, or top → bottom. */
const LINE = 16

/** A card to place: its id and text, what it is about (`target`), where that is (its top-left) and its place in the file (`seq`). */
export interface AnnotationNote {
  id: string
  text: string
  target: string
  anchorX: number
  anchorY: number
  seq: number
  /** `on` as the file writes it */
  on: string
  data?: Record<string, unknown>
}

/**
 * Reading order down a page: by the top of what they are about — tops within 16 px are one line, read left to right —
 * and, for the same spot, in the order of the file (a screen's notes; the UI mock template's callouts).
 */
export function readingOrder<T extends { anchorX: number; anchorY: number; seq: number }>(notes: readonly T[]): T[] {
  const byTop = [...notes].sort((a, b) => a.anchorY - b.anchorY || a.seq - b.seq)
  const lines: T[][] = []
  for (const n of byTop) {
    const line = lines[lines.length - 1]
    if (line && n.anchorY - line[0].anchorY <= LINE) line.push(n)
    else lines.push([n])
  }
  return lines.flatMap((l) => l.sort((a, b) => a.anchorX - b.anchorX || a.seq - b.seq))
}

/**
 * Reading order along a timeline: by the left edge of what they are about — left edges within 16 px are one column,
 * read top to bottom — and the file's order for the same spot. A band of cards below the drawing then runs in the same
 * order as the numbers.
 */
export function timelineOrder<T extends { anchorX: number; anchorY: number; seq: number }>(notes: readonly T[]): T[] {
  const byLeft = [...notes].sort((a, b) => a.anchorX - b.anchorX || a.seq - b.seq)
  const cols: T[][] = []
  for (const n of byLeft) {
    const col = cols[cols.length - 1]
    if (col && n.anchorX - col[0].anchorX <= LINE) col.push(n)
    else cols.push([n])
  }
  return cols.flatMap((c) => c.sort((a, b) => a.anchorY - b.anchorY || a.seq - b.seq))
}

/** A numbered card: a comment with role `note`, `data.callout` and `data.annotation` (src/annotations.ts). */
export function annotationCard(n: AnnotationNote & { callout: number }, at: { x: number; y: number }, now: string, file?: string): Item {
  const size = uiCalloutSize(n.text)
  return make(
    { id: n.id, type: 'comment', x: at.x, y: at.y, w: size.w, h: size.h, text: n.text, role: 'note', color: 'yellow', target: n.target, data: { ...n.data, callout: n.callout, annotation: { on: n.on, ...(file ? { file } : {}) } } },
    now,
  )
}

/**
 * Cards in a column (right of a screen: a wireframe's, a UI mock's), in their order: each at the height of what it is
 * about when that is free, else right below the one before — never on each other. `below`: the bottom of what the
 * column already holds (a UI mock screen's own note).
 */
export function cardsInColumn(notes: Array<AnnotationNote & { callout: number }>, gutter: { x: number; y: number }, now: string, o: { file?: string; below?: number; gap?: number } = {}): Item[] {
  const out: Item[] = []
  let bottom = o.below ?? -Infinity
  let gap = o.gap ?? UI_GUTTER.calloutGap
  for (const n of notes) {
    const y = Math.max(n.anchorY, gutter.y, bottom + gap)
    const card = annotationCard(n, { x: gutter.x, y }, now, o.file)
    out.push(card)
    bottom = y + card.h
    gap = UI_GUTTER.calloutGap
  }
  return out
}

/**
 * Cards in a band below a drawing, in their order: each under what it is about when that is free, else right of the one
 * before; a card that would run past the drawing's right edge starts a new row below — never on each other, never on
 * the drawing.
 */
export function cardsInBand(notes: Array<AnnotationNote & { callout: number }>, band: { left: number; top: number; right: number }, now: string, file?: string): Item[] {
  const out: Item[] = []
  const gap = UI_GUTTER.noteGap
  let top = band.top
  let rowRight = -Infinity
  let rowH = 0
  for (const n of notes) {
    const size = uiCalloutSize(n.text)
    const under = (from: number) => Math.max(from, Math.min(n.anchorX, band.right - size.w), band.left)
    let x = under(rowRight + gap)
    if (rowRight > -Infinity && x + size.w > Math.max(band.right, band.left + size.w)) {
      top += rowH + gap
      rowH = 0
      x = under(-Infinity)
    }
    const card = annotationCard(n, { x, y: top }, now, file)
    out.push(card)
    rowRight = x + card.w
    rowH = Math.max(rowH, card.h)
  }
  return out
}

/**
 * The timeline kinds' annotations (render() adds them): every `annotations:` entry whose `on` names an item of the
 * drawing becomes a numbered card in a band below it, numbered left to right along the drawing (top to bottom where
 * several are about one column). An entry that names nothing is left out — `awd design lint` reports it.
 */
export function withAnnotationBand(items: Item[], content: unknown, o: { scope: string; now: string; file?: string }): Item[] {
  const list = annotationsIn(content)
  if (!list.length) return items
  const ids = annotationIds(list, o.scope)
  const notes: AnnotationNote[] = list.flatMap((a, i) => {
    const t = resolveOn(items, a.on, o.scope)
    return t ? [{ id: ids[i], text: a.text, on: a.on, target: t.id, anchorX: t.x, anchorY: t.y, seq: i }] : []
  })
  const boxes = items.filter((it) => it.type !== 'arrow')
  if (!notes.length || !boxes.length) return items
  const band = { left: Math.min(...boxes.map((b) => b.x)), top: Math.max(...boxes.map((b) => b.y + b.h)) + UI_GUTTER.gap, right: Math.max(...boxes.map((b) => b.x + b.w)) }
  const numbered = timelineOrder(notes).map((n, i) => ({ ...n, callout: i + 1 }))
  return [...items, ...cardsInBand(numbered, band, o.now, o.file)]
}
