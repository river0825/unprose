// Redrawing a diagram from its file (docs/diagrams.md §2, docs/studio.md §7): the ops that make the board
// match the drawing while keeping where the person put things and every proposal not yet explained by the
// file. Pure — shared by the CLI (`awd design draw`, `awd graph --canvas`) and the canvas server's remote
// design tools (docs/canvas.md "Remote agents").
import { annotationOf, calloutOf } from '../annotations.js'
import { layoutLock, withoutHints } from '../model.js'
import { growFrame } from './designFile.js'

export type TemplateOp = { kind: string; id?: string; patch?: Record<string, unknown>; item?: BoardItem }
export type BoardItem = { id: string; type: string; from?: string; to?: string; data?: Record<string, unknown>; [k: string]: unknown }
const GEOMETRY = ['x', 'y', 'w', 'h', 'parent', 'order', 'fontSize']

export type UserChange = { ops: TemplateOp[] }

/** Items the person has ever moved or resized — from the change log, since every update rewrites `updatedBy`. */
export function placedByUser(changes: UserChange[]): Set<string> {
  const ids = new Set<string>()
  for (const ch of changes) for (const op of ch.ops) if (op.kind === 'update' && op.id && op.patch && GEOMETRY.some((k) => k in op.patch!)) ids.add(op.id)
  return ids
}

/**
 * A redraw refreshes what a block says, never where the person put it: an update for an
 * item the user has placed keeps its geometry (the file changed, not the layout).
 */
export function keepUserLayout(ops: TemplateOp[], placed: Set<string>): TemplateOp[] {
  return ops.map((op) => {
    if (op.kind !== 'update' || !op.id || !placed.has(op.id) || !op.patch) return op
    const patch = Object.fromEntries(Object.entries(op.patch).filter(([k]) => !GEOMETRY.includes(k) && k !== 'updatedBy' && k !== 'createdBy'))
    return { ...op, patch }
  })
}

// ── Complete redraw with pending wire edits (docs/studio.md §7) ──────────────

/** Items the workflow template owns: its scope prefix. Comments and hand-drawn items never start with it. */
const SCOPE = 'wf.'

export interface RedrawScope {
  /** Id prefix of the items this drawing owns: `wf.` for a workflow board, `<key>.` for a diagram frame. */
  prefix: string
  /** Ids the drawing owns without the prefix (e.g. the diagram frame itself) — never removed as stale. */
  keep?: Set<string>
  /** The diagram frame's id: what is inside it but not from the file is listed as foreign; it grows to fit. */
  frame?: string
}

export interface WireEnd { from: string; to: string; event?: string; condition?: string }
export interface Pending {
  kind: 'rewire' | 'add' | 'remove' | 'relabel' | 'text'
  before?: WireEnd & { text?: string }
  after?: WireEnd & { text?: string }
  /** a proposed element: the trace that explains it */
  trace?: { from: string; rel: string }
  /** a UI mock proposal (docs/diagrams.md §6c): where the element sits in the file */
  path?: Array<string | number>
  /** a UI mock text proposal for one value inside the element: a table cell ['rows', r, c] or a list item ['items', i] */
  sub?: Array<string | number>
  /**
   * The person deleted this file-drawn item or wire on the board (docs/diagrams.md "What a redraw keeps"): it stays
   * marked (`kind: 'remove'`) until the file no longer has it — a redraw never brings it back as it was.
   */
  deleted?: 'item' | 'wire'
  by?: string
  at?: string
}

/** The words a UI mock element shows at `sub` (a table cell, a list item), as the board draws them. */
function uiValueAt(it: BoardItem, sub: Array<string | number>): string {
  const ui = it.data?.ui as Record<string, unknown> | undefined
  if (sub[0] === 'items') {
    const row = (ui?.items as Array<{ text?: string } | string> | undefined)?.[Number(sub[1])]
    return typeof row === 'string' ? row : (row?.text ?? '')
  }
  const v = sub.reduce<unknown>((o, k) => (o as Record<string | number, unknown> | undefined)?.[k], ui)
  return v === undefined || v === null ? '' : String(v)
}

const pendingOf = (it: BoardItem | undefined): Pending | undefined => {
  const p = it?.data?.pending as Pending | undefined
  return p && typeof p.kind === 'string' ? p : undefined
}
/** `plan` and `wf.node.plan` name the same block. */
const node = (id: string) => id.replace(/^wf\.node\./, '')
const wireOf = (it: BoardItem) => it.data?.event as WireEnd | undefined
const sameWire = (drawn: BoardItem, want: WireEnd) => {
  const w = wireOf(drawn)
  return !!w && node(w.from) === node(want.from) && node(w.to) === node(want.to) && (want.event === undefined || w.event === want.event)
}

/**
 * `data` keys that say how an item is shown or read, not what it means — a redraw keeps them. Two are the redraw's own
 * records: `renamedFrom` (the item this one replaced, whose place it took — see renamedNotes) and `placedNear` (it was
 * added next to where the person put that item, and keeps that place).
 */
const PRESENTATION = ['seenBy', 'seenByAgents', 'agentState', 'fromSide', 'toSide', 'bend', 'lock', 'lockedBy', 'hidden', 'renamedFrom', 'placedNear']
function withPresentation(drawn: BoardItem, was: BoardItem): BoardItem {
  const kept = Object.fromEntries(PRESENTATION.filter((k) => was.data && k in was.data).map((k) => [k, was.data![k]]))
  return Object.keys(kept).length ? { ...drawn, data: { ...drawn.data, ...kept } } : drawn
}

/** Has the drawing (the files) caught up with what the person proposed? */
export function isResolved(p: Pending, drawn: BoardItem[], itemId?: string): boolean {
  // An item or wire the person deleted is explained once the file no longer draws it.
  if (p.kind === 'remove' && p.deleted) return !(itemId && drawn.some((d) => d.id === itemId))
  // A text edit on a UI mock element (docs/diagrams.md §6c) is explained once the file says the new text —
  // or once the element is gone from the drawing (renamed or removed in the file: nothing left to hold).
  if (p.kind === 'text') {
    const now = itemId ? drawn.find((d) => d.id === itemId) : undefined
    if (now && p.sub) return uiValueAt(now, p.sub) === (p.after?.text ?? '')
    return !now || (now.text ?? '') === (p.after?.text ?? '')
  }
  // A UI mock element proposed for removal is explained once the drawing no longer has it; a proposed new
  // element (it carries the explicit id it will have in the file) once the drawing has it.
  if (p.path && (p.kind === 'remove' || p.kind === 'add')) {
    const now = itemId ? drawn.some((d) => d.id === itemId) : false
    return p.kind === 'remove' ? !now : now
  }
  // A proposed element (a story from EventStorming, §4) is explained once an element with the same trace is drawn.
  if (p.trace) return drawn.some((d) => ((d.data?.traces as Array<{ from: string; rel: string }> | undefined) ?? []).some((t) => t.from === p.trace!.from && t.rel === p.trace!.rel))
  const wires = drawn.filter((d) => d.type === 'arrow' && wireOf(d))
  if (p.kind === 'remove') return !!p.before && !wires.some((w) => sameWire(w, p.before!))
  return !!p.after && wires.some((w) => sameWire(w, p.after!))
}

/**
 * The ops that make the board match the drawing: add every drawn item the board lacks, update those that differ (keeping
 * the geometry of items the person placed or locked), remove template items the drawing no longer has, and
 * leave a wire the person edited exactly as they left it until the files explain it.
 */
export function planRedraw(board: Record<string, BoardItem>, drawn: BoardItem[], placed: Set<string>, scope: RedrawScope = { prefix: SCOPE }): TemplateOp[] {
  return explainRedraw(board, drawn, { placed }, scope).ops
}

// ── What a redraw keeps, and the preview (docs/diagrams.md "What a redraw keeps") ───────────
//
// Each item's geometry follows, in order: a lock (`data.lock: 'layout'` on it or on its frame) > where the person
// moved or resized it (the change log) > the file. Content (text, colour, data) always follows the file. Items in the
// frame that this file did not draw — the person's stickies, another agent's cards, comments — are kept and listed.
// A new item the template placed next to another (`near`) lands next to where that one is on the board, and keeps
// that place (`data.placedNear`); a note renamed by the file takes the old one's place (`data.renamedFrom`).

/** Who added an item: the last `add` of its id in the change log. */
export interface ItemOrigin { author: string; by?: string; note?: string }
/** A change of the board's log, as `GET /api/boards/:id/changes` returns it. */
export interface LoggedChange { author?: string; by?: string; note?: string; ts?: string; ops: TemplateOp[] }

/**
 * Items the person deleted and nobody added back since — from the change log, oldest first. A page that knows
 * the rule marks a deletion instead (`data.pending.deleted`); this covers deletions made before, or over the API.
 */
export function removedByUser(changes: LoggedChange[]): Map<string, { at?: string }> {
  const out = new Map<string, { at?: string }>()
  for (const ch of changes)
    for (const op of ch.ops) {
      if (op.kind === 'remove' && op.id && ch.author === 'user') out.set(op.id, ch.ts ? { at: ch.ts } : {})
      else if (op.kind === 'add' && op.item?.id) out.delete(op.item.id)
    }
  return out
}

/** A change written by a redraw from files (`awd design draw`, design_draw, `awd graph`), not by hand. */
export const isRedrawNote = (note: string | undefined): boolean => !!note && /^(awd design draw|design_draw|awd graph|awd studio)\b/.test(note)

export function originsOf(changes: LoggedChange[]): Map<string, ItemOrigin> {
  const out = new Map<string, ItemOrigin>()
  for (const ch of changes)
    for (const op of ch.ops) {
      const id = op.kind === 'add' ? op.item?.id : undefined
      if (id) out.set(id, { author: ch.author ?? 'agent', ...(ch.by ? { by: ch.by } : {}), ...(ch.note ? { note: ch.note } : {}) })
    }
  return out
}

export interface RedrawInputs {
  /** items the person moved or resized */
  placed: Set<string>
  /** who added each item (absent: decided from `createdBy` alone) */
  origins?: Map<string, ItemOrigin>
  /** items the person deleted (the change log): a redraw does not bring them back as they were */
  removed?: Map<string, { at?: string }>
}

/** The item a redraw's add replaced and took the place of (`data.renamedFrom`, see renamedNotes). */
const renamedFromOf = (it: BoardItem | undefined): string | undefined => (typeof it?.data?.renamedFrom === 'string' ? it.data.renamedFrom : undefined)

/** From the board's whole change log (every author): what the person placed and who added what. */
export function redrawInputs(changes: LoggedChange[]): Required<RedrawInputs> {
  const placed = placedByUser(changes.filter((c) => c.author === 'user') as UserChange[])
  // an item that took the place of one the person placed counts as placed too (oldest first: a rename of a rename)
  for (const ch of changes) for (const op of ch.ops) if (op.kind === 'add' && op.item && placed.has(renamedFromOf(op.item) ?? '')) placed.add(op.item.id)
  return { placed, origins: originsOf(changes), removed: removedByUser(changes) }
}

// ── The same, folded change by change (the canvas keeps it per board: GET /api/boards/:id/redraw-inputs) ──

export const emptyRedrawInputs = (): Required<RedrawInputs> => ({ placed: new Set(), origins: new Map(), removed: new Map() })

/**
 * `redrawInputs` one slice of the log at a time, oldest first: folding the log in any number of slices gives what
 * `redrawInputs` gives for the whole of it. Mutates and returns `acc`.
 */
export function foldRedrawInputs(acc: Required<RedrawInputs>, changes: LoggedChange[]): Required<RedrawInputs> {
  for (const ch of changes)
    for (const op of ch.ops) {
      if (op.kind === 'update') {
        if (ch.author === 'user' && op.id && op.patch && GEOMETRY.some((k) => k in op.patch!)) acc.placed.add(op.id)
      } else if (op.kind === 'add' && op.item?.id) {
        acc.origins.set(op.item.id, { author: ch.author ?? 'agent', ...(ch.by ? { by: ch.by } : {}), ...(ch.note ? { note: ch.note } : {}) })
        acc.removed.delete(op.item.id)
        if (acc.placed.has(renamedFromOf(op.item) ?? '')) acc.placed.add(op.item.id)
      } else if (op.kind === 'remove' && op.id && ch.author === 'user') acc.removed.set(op.id, ch.ts ? { at: ch.ts } : {})
    }
  return acc
}

/**
 * Redraw inputs as JSON, compact for a board of thousands of items: each distinct origin once (`origins`), and each
 * item's index into them (`originOf`); `removed` as `[id, at?]`.
 */
export interface RedrawInputsJson {
  placed: string[]
  origins: ItemOrigin[]
  originOf: Record<string, number>
  removed: Array<[string] | [string, string]>
}

export function redrawInputsToJson(r: Required<RedrawInputs>): RedrawInputsJson {
  const origins: ItemOrigin[] = []
  const index = new Map<string, number>()
  const originOf: Record<string, number> = {}
  for (const [id, o] of r.origins) {
    const key = JSON.stringify([o.author, o.by ?? null, o.note ?? null])
    let i = index.get(key)
    if (i === undefined) index.set(key, (i = origins.push(o) - 1))
    originOf[id] = i
  }
  return { placed: [...r.placed], origins, originOf, removed: [...r.removed].map(([id, v]) => (v.at ? [id, v.at] : [id])) }
}

/** Back from JSON (a canvas's answer: anything missing or malformed reads as empty). */
export function redrawInputsFromJson(j: Partial<RedrawInputsJson> | undefined): Required<RedrawInputs> {
  const out = emptyRedrawInputs()
  for (const id of Array.isArray(j?.placed) ? j.placed : []) if (typeof id === 'string') out.placed.add(id)
  const table = Array.isArray(j?.origins) ? j.origins : []
  for (const [id, i] of Object.entries(j?.originOf && typeof j.originOf === 'object' ? j.originOf : {})) {
    const o = table[i]
    if (o && typeof o.author === 'string') out.origins.set(id, { author: o.author, ...(o.by ? { by: o.by } : {}), ...(o.note ? { note: o.note } : {}) })
  }
  for (const e of Array.isArray(j?.removed) ? j.removed : []) if (Array.isArray(e) && typeof e[0] === 'string') out.removed.set(e[0], typeof e[1] === 'string' ? { at: e[1] } : {})
  return out
}

export interface PlanLine { id: string; label: string; why?: string }
export interface RedrawPlan {
  /** the drawing's id prefix (`<key>.`, `wf.`) and its frame */
  prefix: string
  frame?: string
  added: PlanLine[]
  /** content or geometry changes; `why` lists the fields */
  updated: PlanLine[]
  unchanged: number
  removed: PlanLine[]
  /** the file would move or resize it, but the person did: their geometry stays, the content is refreshed */
  keptMoved: PlanLine[]
  /** the file would move or resize it, but it (or its frame) is locked */
  keptLocked: PlanLine[]
  /** the person deleted it and the file still has it: kept removed (marked, a proposal to remove it from the file) */
  keptRemoved: PlanLine[]
  /** proposals the files do not explain yet: left exactly as they are */
  held: PlanLine[]
  /** proposals the files now explain: replaced by the drawn element */
  settled: PlanLine[]
  /** items in the frame that this file did not draw: always kept; `why` says who added them */
  foreign: PlanLine[]
}

export interface RedrawResult {
  ops: TemplateOp[]
  plan: RedrawPlan
  /** ids whose geometry the redraw keeps (moved by the person, or locked) */
  keptLayout: Set<string>
}

/**
 * A note the file drew — a numbered card from a file annotation or a UI mock / wireframe note, or a UI mock screen's
 * own note (unnumbered, `<key>.note.<screen>`) — not a draft, not one written on the board.
 */
function isFileNote(it: BoardItem, prefix: string): boolean {
  if (it.type !== 'comment' || it.role !== 'note') return false
  const a = annotationOf(it as never)
  return (calloutOf(it as never) !== undefined || it.id.startsWith(`${prefix}note.`)) && !a?.draft && !a?.board
}

/** Ids of the comments someone answered: the root of every reply, following `target` through comments. */
function repliedTo(board: Record<string, BoardItem>): Set<string> {
  const out = new Set<string>()
  for (const c of Object.values(board)) {
    if (c.type !== 'comment') continue
    const seen = new Set([c.id])
    for (let t = c.target as string | undefined; t && board[t]?.type === 'comment' && !seen.has(t); t = board[t].target as string | undefined) {
      seen.add(t)
      out.add(t)
    }
  }
  return out
}

const label = (it: BoardItem | undefined): string => {
  const t = String(it?.text ?? it?.label ?? '').replace(/\s+/g, ' ').trim()
  return t ? (t.length > 48 ? `${t.slice(0, 47)}…` : t) : String(it?.type ?? '?')
}
const IGNORED = new Set(['id', 'createdBy', 'updatedBy', 'updatedAt'])
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
/** A comment's `data` after an update: the canvas merges it into the stored one, null removing a key (routing.ts stampRouting). */
const mergedData = (was: unknown, patch: unknown): unknown =>
  patch && typeof patch === 'object' ? Object.fromEntries(Object.entries({ ...(was as object | undefined), ...patch }).filter(([, v]) => v !== null)) : patch
const changedKeys = (patch: Record<string, unknown>, was: BoardItem) =>
  Object.keys(patch).filter((k) => !IGNORED.has(k) && !same(k === 'data' && was.type === 'comment' ? mergedData(was.data, patch.data) : patch[k], was[k]))
const lockOf = (board: Record<string, BoardItem>, id: string) => layoutLock(board as never, id)
const KEPT_REMOVED = 'you deleted it — the file still has it; propose the file change?'

// ── A new item next to where the person put its neighbour; a note that was renamed ───────────────────────

type Box = { x: number; y: number; w: number; h: number }
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const boxOf = (it: BoardItem): Box => ({ x: num(it.x), y: num(it.y), w: num(it.w), h: num(it.h) })
/** What a new item must not land on: anything with a body — not a wire, a comment, a frame or a lane (a group outline is a frame). */
const solid = (it: BoardItem) => it.type !== 'arrow' && it.type !== 'comment' && it.type !== 'frame' && it.type !== 'lane'
const GAP = 16

/** The nearest spot to `b` that keeps GAP off every box: rings of growing radius, 12 directions each, the first away from `from`. */
function freeSpot(b: Box, boxes: Box[], from: { x: number; y: number }): { box: Box; nudged: boolean } {
  const hit = (c: Box) => boxes.some((o) => c.x < o.x + o.w + GAP && o.x < c.x + c.w + GAP && c.y < o.y + o.h + GAP && o.y < c.y + c.h + GAP)
  if (!hit(b)) return { box: b, nudged: false }
  const a0 = Math.atan2(b.y + b.h / 2 - from.y, b.x + b.w / 2 - from.x)
  const step = Math.max(40, Math.round(Math.min(b.w, b.h) / 2))
  for (let ring = 1; ring <= 30; ring++)
    for (let k = 0; k < 12; k++) {
      // alternate sides of the start direction: 0, +30°, -30°, +60° …
      const a = a0 + (Math.ceil(k / 2) * (k % 2 ? 1 : -1) * Math.PI) / 6
      const c = { ...b, x: Math.round(b.x + Math.cos(a) * ring * step), y: Math.round(b.y + Math.sin(a) * ring * step) }
      if (!hit(c)) return { box: c, nudged: true }
    }
  return { box: b, nudged: false }
}

/** A note a file drew as an item of its own, about `data.on` (a domain story's annotation — not a numbered card). */
const isOnNote = (it: BoardItem) => it.type !== 'comment' && it.role === 'annotation' && typeof it.data?.on === 'string'

/**
 * Drawn notes the board lacks, matched to the stale notes of this drawing they replace (new id → old id): the same
 * `data.on` and text, else the same `data.on` when only one is left on each side — and the dashed line from such a note
 * to what it is on (new line → old line). A domain story's notes were `note-1`, `note-2` … in file order before they
 * were named after what they are on (`note-<element>`): this carries the person's placement over to the new ids.
 */
function renamedNotes(board: Record<string, BoardItem>, drawn: BoardItem[], drawnIds: Set<string>, prefix: string): Map<string, string> {
  const fresh = drawn.filter((d) => !board[d.id] && isOnNote(d))
  const stale = Object.values(board).filter((it) => it.id.startsWith(prefix) && !drawnIds.has(it.id) && isOnNote(it) && !pendingOf(it))
  const on = (it: BoardItem) => it.data!.on as string
  const out = new Map<string, string>()
  const used = new Set<string>()
  const match = (d: BoardItem, o: BoardItem | undefined) => void (o && (out.set(d.id, o.id), used.add(o.id)))
  for (const d of fresh) match(d, stale.find((o) => !used.has(o.id) && on(o) === on(d) && o.text === d.text))
  for (const d of fresh) {
    if (out.has(d.id)) continue
    const mine = fresh.filter((x) => !out.has(x.id) && on(x) === on(d))
    const theirs = stale.filter((o) => !used.has(o.id) && on(o) === on(d))
    if (mine.length === 1 && theirs.length === 1) match(d, theirs[0])
  }
  const links = Object.values(board).filter((a) => a.type === 'arrow' && !drawnIds.has(a.id))
  for (const d of drawn) {
    const from = d.type === 'arrow' && !board[d.id] && d.from ? out.get(d.from) : undefined
    if (from) match(d, links.find((a) => a.from === from && a.to === d.to && !used.has(a.id)))
  }
  return out
}

/** The redraw's ops and, for the preview, what it does to each item and why. Pure: nothing is written. */
export function explainRedraw(board: Record<string, BoardItem>, given: BoardItem[], inputs: RedrawInputs, scope: RedrawScope = { prefix: SCOPE }): RedrawResult {
  const { placed, origins, removed } = inputs
  // a template's hints (`near`) are read here and never written: taken off every drawn item before anything is compared
  const hints = new Map<string, string>()
  const drawn = given.map((d) => {
    if (typeof d.near === 'string') hints.set(d.id, d.near)
    return withoutHints(d)
  })
  const drawnIds = new Set(drawn.map((d) => d.id))
  const held = new Set<string>() // pending, not yet resolved: untouchable
  const ops: TemplateOp[] = []
  const plan: RedrawPlan = { prefix: scope.prefix, ...(scope.frame ? { frame: scope.frame } : {}), added: [], updated: [], unchanged: 0, removed: [], keptMoved: [], keptLocked: [], keptRemoved: [], held: [], settled: [], foreign: [] }
  // A proposal belongs to this drawing when the item (or both ends of a wire the person drew) is in its scope;
  // another frame's proposals are not ours to settle.
  const owned = (it: BoardItem) =>
    it.id.startsWith(scope.prefix) || (it.type === 'arrow' && !!it.from && !!it.to && [it.from, it.to].every((e) => e.startsWith(scope.prefix) || scope.keep?.has(e)))
  for (const it of Object.values(board)) {
    const p = pendingOf(it)
    if (!p || !owned(it)) continue
    if (!isResolved(p, drawn, it.id)) {
      held.add(it.id)
      if (p.kind === 'remove' && p.deleted) plan.keptRemoved.push({ id: it.id, label: label(it), why: KEPT_REMOVED })
      else plan.held.push({ id: it.id, label: label(it), why: `a proposal (${p.kind}) the file does not explain yet` })
    } else if (!drawnIds.has(it.id)) {
      ops.push({ kind: 'remove', id: it.id }) // resolved: the drawn element replaces it
      plan.settled.push({ id: it.id, label: label(it), why: p.kind === 'remove' && p.deleted ? 'you deleted it and the file no longer has it: gone for good (the "kept removed" mark is cleared)' : 'the file now has it' })
    }
  }
  // in the frame (or on a frameless drawing's board)
  const inFrame = (it: BoardItem): boolean => {
    if (!scope.frame) return scope.prefix === SCOPE // a workflow board is one drawing; a frame-less diagram lists nothing
    const seen = new Set<string>()
    for (let p = it.parent ? board[it.parent as string] : undefined; p && !seen.has(p.id); p = p.parent ? board[p.parent as string] : undefined) {
      if (p.id === scope.frame) return true
      seen.add(p.id)
    }
    return false
  }
  // geometry: a lock > the person's move > the file; an item added next to where the person put another keeps its place
  const keepOf = (id: string): 'locked' | 'moved' | 'near' | undefined =>
    !board[id] ? undefined : lockOf(board, id) ? 'locked' : placed.has(id) ? 'moved' : typeof board[id].data?.placedNear === 'string' ? 'near' : undefined
  const renamed = renamedNotes(board, drawn, drawnIds, scope.prefix)
  const renamedTo = new Map([...renamed].map(([to, from]) => [from, to]))
  const drawnById = new Map(drawn.map((d) => [d.id, d]))
  // new items that land elsewhere than drawn (next to their neighbour, or where the note they replace was)
  const landed = new Map<string, BoardItem>()
  // where an item ends up: kept on the board, landed elsewhere, else as drawn
  const at = (id: string): BoardItem | undefined => landed.get(id) ?? (keepOf(id) ? board[id] : (drawnById.get(id) ?? board[id]))
  // how far the board has an item from where it is drawn (the person moved it, or it is locked where it was)
  const shiftOf = (id: string): { dx: number; dy: number } | undefined => {
    const d = drawnById.get(id)
    const f = at(id)
    if (!d || !f || f === d) return undefined
    const [dx, dy] = [num(f.x) - num(d.x), num(f.y) - num(d.y)]
    return dx || dy ? { dx, dy } : undefined
  }
  // what a new item must not land on: this drawing's items where they end up, and what else is in the frame
  const obstacles = (self: string): Box[] => [
    ...drawn.filter((d) => d.id !== self && solid(d)).map((d) => boxOf(at(d.id) ?? d)),
    ...Object.values(board).filter((it) => !drawnIds.has(it.id) && !it.id.startsWith(scope.prefix) && solid(it) && inFrame(it)).map(boxOf),
  ]
  const keptLayout = new Set<string>()
  const updates: TemplateOp[] = []
  for (const d of drawn) {
    if (held.has(d.id)) continue
    const was = board[d.id]
    if (!was && removed?.has(d.id)) {
      // the person deleted it (the change log) and the file still has it: it comes back only as the mark of that
      // deletion — a removal proposal, drawn struck — never as it was
      const pending: Pending = { kind: 'remove', deleted: d.type === 'arrow' ? 'wire' : 'item', by: 'user', ...(removed.get(d.id)?.at ? { at: removed.get(d.id)!.at } : {}) }
      updates.push({ kind: 'add', item: { ...d, data: { ...(d.data ?? {}), pending } } })
      plan.keptRemoved.push({ id: d.id, label: label(d), why: KEPT_REMOVED })
      continue
    }
    if (!was) {
      // a renamed note takes over the old one's presentation and, when that was kept, its place (`renamedFrom` makes
      // it count as placed from then on: redrawInputs)
      const from = renamed.get(d.id)
      const old = from ? board[from] : undefined
      let item = old ? withPresentation(d, old) : d
      const why: string[] = []
      if (old && from) {
        if (d.type !== 'arrow') item = { ...item, data: { ...(item.data ?? {}), renamedFrom: from } }
        why.push(`replaces ${from} (${d.type === 'arrow' ? 'the line of a renamed note' : 'the same note, renamed'})`)
        const kept = keepOf(from)
        if (kept && d.type !== 'arrow') {
          item = { ...item, ...Object.fromEntries(GEOMETRY.filter((k) => k in old).map((k) => [k, old[k]])) }
          landed.set(d.id, item)
          why.push(kept === 'moved' ? 'keeps where you put it' : kept === 'locked' ? 'keeps its place (locked)' : 'keeps its place')
        }
      }
      // a new item drawn next to another (the template's `near`) lands next to where that one is on the board — moved
      // by the person, or locked where it was — not where the drawing has it, and off what is already there
      const anchor = hints.get(d.id)
      const shift = !landed.has(d.id) && anchor && solid(d) ? shiftOf(anchor) : undefined
      if (anchor && shift) {
        const a = boxOf(at(anchor)!)
        const spot = freeSpot({ ...boxOf(d), x: num(d.x) + shift.dx, y: num(d.y) + shift.dy }, obstacles(d.id), { x: a.x + a.w / 2, y: a.y + a.h / 2 })
        item = { ...item, x: spot.box.x, y: spot.box.y, data: { ...(item.data ?? {}), placedNear: anchor } }
        landed.set(d.id, item)
        why.push(`placed next to "${label(board[anchor] ?? drawnById.get(anchor))}", where ${placed.has(anchor) ? 'you put it' : 'it is on the board'}${spot.nudged ? ' (moved aside to a free spot)' : ''}`)
      }
      updates.push({ kind: 'add', item })
      plan.added.push({ id: d.id, label: label(d), ...(why.length ? { why: why.join('; ') } : {}) })
      continue
    }
    const patch = withPresentation(d, was) as Record<string, unknown>
    const lock = lockOf(board, d.id)
    const keep = keepOf(d.id)
    if (keep) keptLayout.add(d.id)
    const geometry = GEOMETRY.filter((k) => k in patch && !same(patch[k], was[k]))
    if (keep && geometry.length) {
      const near = keep === 'near' ? `placed next to "${label(board[String(was.data?.placedNear)])}" when it was added` : ''
      const line = { id: d.id, label: label(was), why: keep === 'locked' ? `${lock === 'frame' ? 'its frame is locked' : 'locked'}: keeps ${geometry.join(', ')}` : `${near || 'you moved it'}: keeps ${geometry.join(', ')}` }
      ;(keep === 'locked' ? plan.keptLocked : plan.keptMoved).push(line)
    }
    const op: TemplateOp = { kind: 'update', id: d.id, patch }
    const final = keep ? keepUserLayout([op], new Set([d.id]))[0] : op
    const changed = changedKeys(final.patch ?? {}, was)
    if (!changed.length) {
      // no op: it would only restamp updatedBy / updatedAt (thousands of ops, each logged with its `before`, for a big
      // UI mock) — and make the person's undo of their own move say the agent changed it since
      plan.unchanged++
      continue
    }
    plan.updated.push({ id: d.id, label: label(was), why: changed.join(', ') })
    updates.push(final)
  }
  // a thread about a renamed note follows it (its first comment's `target`)
  for (const c of Object.values(board)) {
    const to = c.type === 'comment' && typeof c.target === 'string' ? renamedTo.get(c.target) : undefined
    if (!to || held.has(c.id)) continue
    updates.push({ kind: 'update', id: c.id, patch: { target: to } })
    plan.updated.push({ id: c.id, label: label(c), why: `its thread was on ${c.target}, which is now ${to}: it follows` })
  }
  // stale: items of this drawing the file no longer has. An item the person added — or another agent added by hand —
  // with this drawing's prefix is not stale: it is kept with the foreign items.
  const drawers = new Set([...(origins?.values() ?? [])].filter((o) => o.author === 'agent' && isRedrawNote(o.note)).map((o) => o.by ?? ''))
  const addedBy = (it: BoardItem): string => {
    const o = origins?.get(it.id)
    if (o) return o.author === 'user' ? `the person${o.by ? ` (${o.by})` : ''}` : (o.by ?? 'an agent')
    return it.createdBy === 'user' ? 'the person' : 'an agent'
  }
  const byHand = (it: BoardItem): boolean => {
    const o = origins?.get(it.id)
    if (!o) return it.createdBy === 'user'
    if (o.author === 'user') return true
    return !isRedrawNote(o.note) && drawers.size > 0 && !drawers.has(o.by ?? '')
  }
  const foreign = new Set<string>()
  const answered = repliedTo(board)
  for (const it of Object.values(board)) {
    if (held.has(it.id) || drawnIds.has(it.id) || pendingOf(it) || scope.keep?.has(it.id)) continue
    // comments stay (threads are the person's), but for the notes the file drew: gone from the file, gone
    if (!it.id.startsWith(scope.prefix) || (it.type === 'comment' && !isFileNote(it, scope.prefix))) continue
    if (byHand(it)) {
      foreign.add(it.id)
      continue
    }
    // ... unless someone answered it: the discussion stays, as a thread about the same item — no number, no pin
    if (it.type === 'comment' && answered.has(it.id)) {
      if (calloutOf(it as never) === undefined && !it.data?.annotation) continue // kept as a thread by an earlier redraw
      // null, not left out: the canvas merges a comment's data, and null is how a key goes (routing.ts stampRouting)
      ops.push({ kind: 'update', id: it.id, patch: { data: { ...it.data, callout: null, callouts: null, annotation: null } } })
      plan.updated.push({ id: it.id, label: label(it), why: 'no longer in the file; it has replies, so it stays as a thread (no number)' })
      continue
    }
    ops.push({ kind: 'remove', id: it.id })
    const lock = lockOf(board, it.id)
    plan.removed.push({ id: it.id, label: label(it), why: renamedTo.has(it.id) ? `renamed: now ${renamedTo.get(it.id)}` : `no longer in the file${lock ? ' (a lock keeps the position, not the item)' : ''}` })
  }
  // foreign: in the frame (or on a frameless drawing's board), not drawn by this file, not a comment or a proposal
  const endIn = (id: string | undefined) => !!id && (id.startsWith(scope.prefix) || id === scope.frame || (!!board[id] && inFrame(board[id])))
  for (const it of Object.values(board)) {
    if (it.type === 'comment' || drawnIds.has(it.id) || held.has(it.id) || scope.keep?.has(it.id) || it.id === scope.frame) continue
    if (pendingOf(it) && owned(it)) continue
    const mine = foreign.has(it.id)
    const inside = mine || (!it.id.startsWith(scope.prefix) && (it.type === 'arrow' ? endIn(it.from) && endIn(it.to) : inFrame(it)))
    if (!inside) continue
    plan.foreign.push({ id: it.id, label: label(it), why: `added by ${addedBy(it)}${mine ? ' with this file\'s prefix' : ''}, not from this file: kept` })
  }
  const result = [...keepUserLayout(updates, keptLayout), ...ops]
  // a frame the person never resized (and nobody locked) grows to hold what was drawn
  const frame = scope.frame ? board[scope.frame] : undefined
  if (frame) {
    // what the redraw placed next to the person's items counts where it is (when added, and on every redraw after)
    const grow = growFrame(frame, drawn.map((d) => landed.get(d.id) ?? (keepOf(d.id) === 'near' ? board[d.id] : d)), keptLayout)
    if (grow) {
      result.push(grow)
      if (!plan.updated.some((l) => l.id === frame.id)) {
        plan.updated.push({ id: frame.id, label: label(frame), why: `grows to ${grow.patch.w}×${grow.patch.h}` })
        if (plan.unchanged > 0 && drawnIds.has(frame.id)) plan.unchanged--
      }
    }
  }
  return { ops: result, plan, keptLayout }
}

// ── The preview as text (awd design draw --dry-run, design_draw { dryRun: true }) ─────────────

const SECTIONS: Array<[keyof RedrawPlan, string, string]> = [
  ['added', '+', 'added'],
  ['updated', '~', 'updated'],
  ['removed', '-', 'removed'],
  ['keptMoved', '=', 'kept where the person moved it'],
  ['keptLocked', '#', 'kept: locked'],
  ['keptRemoved', 'x', 'kept removed'],
  ['held', '?', 'proposals held'],
  ['settled', '>', 'proposals settled'],
  ['foreign', '*', 'not from this file (kept)'],
]

/** Counts in one line: "3 added · 1 updated · 40 unchanged · …" (only the non-zero ones). */
export function planSummary(plan: RedrawPlan): string {
  const parts = SECTIONS.map(([k, , name]) => [(plan[k] as PlanLine[]).length, name] as const).filter(([n]) => n > 0).map(([n, name]) => `${n} ${name}`)
  if (plan.unchanged) parts.splice(Math.min(2, parts.length), 0, `${plan.unchanged} unchanged`)
  return parts.length ? parts.join(' · ') : 'nothing to change'
}

/** The preview: a heading, the counts, then up to `limit` lines per section ("… and N more"). */
export function planLines(plan: RedrawPlan, o: { title?: string; limit?: number } = {}): string[] {
  const limit = o.limit ?? 8
  const out = [`${o.title ?? `Redraw preview — ${plan.frame ?? plan.prefix.replace(/\.$/, '')}`} (dry run: nothing written)`, `  ${planSummary(plan)}`]
  for (const [k, mark, name] of SECTIONS) {
    const lines = plan[k] as PlanLine[]
    if (!lines.length) continue
    out.push(`  ${name} (${lines.length}):`)
    for (const l of lines.slice(0, limit)) out.push(`    ${mark} ${l.id}  "${l.label}"${l.why ? ` — ${l.why}` : ''}`)
    if (lines.length > limit) out.push(`    … and ${lines.length - limit} more`)
  }
  return out
}
