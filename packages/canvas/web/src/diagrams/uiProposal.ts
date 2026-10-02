// Changes to a UI mock on the board are proposals (docs/diagrams.md §6c): the board shows what the person
// wants and remembers what the file says in `data.pending`; the file does not change until the AI applies
// the diff this module describes and redraws (the diff itself: uiProposalFile.ts, loaded on demand with the
// yaml parser). Four kinds, one per element at a time:
//   - text: the element's words (`key`), or one value inside it — a table cell or a list item (`sub`)
//   - remove: the element (and what it holds) out of the file; the board keeps it, struck, until then
//   - add: a new element with a fresh explicit id, appended to a container or placed after an element
// Pure (no React), so the tests can use it.
import type { Board, Item, Op } from '../../../src/model'
import { diagramOf } from './frame'

export type UiPath = Array<string | number>

export interface UiTextPending {
  kind: 'text'
  before: { text: string }
  after: { text: string }
  /** the element in the file: ['screens', 0, 'body', 2] */
  path: UiPath
  /** the key holding its words: 'text', 'label', or 'name' (a screen); for a `sub` edit 'rows' / 'items' */
  key: string
  /** one value inside the element: a table cell ['rows', r, c] or a list item ['items', i] */
  sub?: UiPath
  by: 'user'
  at: string
}

export interface UiRemovePending {
  kind: 'remove'
  /** what goes: its type and words, for the request to the AI */
  before: { type: string; text: string }
  path: UiPath
  by: 'user'
  at: string
}

export interface UiAddPending {
  kind: 'add'
  /** the new element as it will be written: `{ type, id, text }` */
  node: { type: string; id: string; text: string }
  /** where it goes: at the end of `parent`'s list (a screen's body, a container's children) … */
  parent?: { element: string; path: UiPath }
  /** … or right after this element, in the same list */
  after?: { element: string; path: UiPath }
  /** where it will sit in the file once added (for the panel; the diff finds the place by the ids) */
  path: UiPath
  /** containers made taller on the board to hold it (their heights before), restored by Undo */
  grew?: Array<{ id: string; h: number }>
  by: 'user'
  at: string
}

export type UiPending = UiTextPending | UiRemovePending | UiAddPending

type UiMeta = { path?: unknown; textKey?: unknown; type?: unknown; container?: unknown; rows?: unknown; items?: unknown; pad?: unknown }
const metaOf = (it: Item | undefined): UiMeta | undefined => (it?.type === 'ui' ? (it.data?.ui as UiMeta | undefined) : undefined)

/** A UI mock element drawn from a file (its place in the file is known), or one proposed for it. */
export function isUiElement(it: Item | undefined): boolean {
  return Array.isArray(metaOf(it)?.path)
}

/** Any proposal on a UI mock element. */
export function uiProposalOf(it: Item | undefined): UiPending | undefined {
  const p = it?.data?.pending as UiPending | undefined
  if (!p || !Array.isArray(p.path)) return undefined
  if (p.kind === 'text' && typeof p.after?.text === 'string') return p
  if (p.kind === 'remove' || (p.kind === 'add' && p.node)) return p
  return undefined
}

/** A text proposal (the element's words, a cell, a list item). */
export function uiPendingOf(it: Item | undefined): UiTextPending | undefined {
  const p = uiProposalOf(it)
  return p?.kind === 'text' ? p : undefined
}

const withoutPending = (it: Item) => {
  const { pending: _old, ...rest } = it.data ?? {}
  return rest
}

/** The op for editing the words on the board: a proposal; back to what the file says → no longer pending. */
export function uiTextOp(it: Item, text: string, now: string): Op {
  const m = metaOf(it)!
  const cur = uiProposalOf(it)
  const rest = withoutPending(it)
  // a proposed element: its words are part of the proposal
  if (cur?.kind === 'add') return { kind: 'update', id: it.id, patch: { text, data: { ...rest, pending: { ...cur, node: { ...cur.node, text }, at: now } } } }
  // another proposal is open on this element (a removal, a cell): one at a time — nothing changes
  if (cur && (cur.kind !== 'text' || cur.sub)) return { kind: 'update', id: it.id, patch: { text: it.text } }
  const before = cur ? cur.before.text : (it.text ?? '')
  const pending: UiTextPending | undefined =
    text === before ? undefined : { kind: 'text', before: { text: before }, after: { text }, path: m.path as UiPath, key: typeof m.textKey === 'string' ? m.textKey : 'text', by: 'user', at: now }
  return { kind: 'update', id: it.id, patch: { text, data: pending ? { ...rest, pending } : rest } }
}

// ── one value inside an element: a table cell, a list item ───────────────────

/** The words at `sub` as the board shows them: a cell ['rows', r, c], a list item ['items', i]. */
export function uiValueAt(it: Item, sub: UiPath): string {
  const m = metaOf(it)
  if (sub[0] === 'items') {
    const row = (m?.items as Array<{ text?: string } | string> | undefined)?.[Number(sub[1])]
    return typeof row === 'string' ? row : (row?.text ?? '')
  }
  const v = (m?.rows as Array<Array<string | number>> | undefined)?.[Number(sub[1])]?.[Number(sub[2])]
  return v === undefined || v === null ? '' : String(v)
}

/** `data.ui` with the words at `sub` replaced. */
function uiWith(it: Item, sub: UiPath, text: string): Record<string, unknown> {
  const ui = { ...(it.data?.ui as Record<string, unknown>) }
  if (sub[0] === 'items') {
    const items = [...((ui.items as Array<Record<string, unknown> | string>) ?? [])]
    const i = Number(sub[1])
    items[i] = typeof items[i] === 'string' ? text : { ...(items[i] as Record<string, unknown>), text }
    ui.items = items
  } else {
    const rows = ((ui.rows as Array<Array<string | number>>) ?? []).map((r) => [...r])
    const r = Number(sub[1])
    if (rows[r]) rows[r][Number(sub[2])] = text
    ui.rows = rows
  }
  return ui
}

const sameSub = (a: UiPath | undefined, b: UiPath) => !!a && a.length === b.length && a.every((k, i) => String(k) === String(b[i]))

/** Can the value at `sub` be edited now? Not while another proposal is open on the element. */
export function canEditValue(it: Item, sub: UiPath): boolean {
  const cur = uiProposalOf(it)
  return !cur || (cur.kind === 'text' && sameSub(cur.sub, sub))
}

/** Editing a table cell or a list item on the board: a text proposal for exactly that value. */
export function uiValueOp(it: Item, sub: UiPath, text: string, now: string): Op | undefined {
  const m = metaOf(it)
  if (!m || !Array.isArray(m.path) || !canEditValue(it, sub)) return undefined
  const cur = uiPendingOf(it)
  const before = cur ? cur.before.text : uiValueAt(it, sub)
  if (!cur && text === before) return undefined
  const rest = withoutPending(it)
  const ui = uiWith(it, sub, text)
  const pending: UiTextPending | undefined =
    text === before ? undefined : { kind: 'text', before: { text: before }, after: { text }, path: m.path as UiPath, key: String(sub[0]), sub, by: 'user', at: now }
  return { kind: 'update', id: it.id, patch: { data: pending ? { ...rest, ui, pending } : { ...rest, ui } } }
}

// ── remove ───────────────────────────────────────────────────────────────────

/**
 * Deleting UI mock elements on the board: each becomes a removal proposal (the item stays, struck) instead
 * of going away. Its own open proposal is dropped first (the words go back to the file's). A proposed new
 * element is not handled here: deleting it simply takes the proposal back. `handled` = ids the caller must
 * not delete.
 */
export function uiRemoveOps(board: Board, ids: string[], now: string): { ops: Op[]; handled: string[] } {
  const ops: Op[] = []
  const handled: string[] = []
  for (const id of ids) {
    const it = board.items[id]
    if (!it || !isUiElement(it)) continue
    const cur = uiProposalOf(it)
    if (cur?.kind === 'add') continue
    handled.push(id)
    if (cur?.kind === 'remove') continue
    const base = cur ? undoneOf(it, cur) : { text: it.text, data: withoutPending(it) }
    const m = metaOf(it)!
    const pending: UiRemovePending = { kind: 'remove', before: { type: String(m.type ?? it.role ?? 'element'), text: base.text ?? '' }, path: m.path as UiPath, by: 'user', at: now }
    ops.push({ kind: 'update', id, patch: { text: base.text, data: { ...base.data, pending } } })
  }
  return { ops, handled }
}

/** Items shown struck on the board: those proposed for removal and everything inside them. */
export function uiRemovedIds(board: Board): Set<string> {
  const gone = new Set<string>()
  const roots = new Set(Object.values(board.items).filter((it) => uiProposalOf(it)?.kind === 'remove').map((it) => it.id))
  if (!roots.size) return gone
  for (const it of Object.values(board.items)) {
    let p: string | undefined = it.id
    for (let guard = 0; p && guard < 50; guard++) {
      if (roots.has(p)) {
        gone.add(it.id)
        break
      }
      p = board.items[p]?.parent
    }
  }
  return gone
}

// ── add ──────────────────────────────────────────────────────────────────────

/** What can be added from the panel, with the words a new one starts with and its size on the board. */
export const UI_ADDABLE: Array<{ type: string; label: string; text: string; w?: number; h: number }> = [
  { type: 'button', label: 'Button', text: 'New button', w: 120, h: 36 },
  { type: 'input', label: 'Input', text: 'New field', h: 64 },
  { type: 'text', label: 'Text', text: 'New text', h: 21 },
  { type: 'heading', label: 'Heading', text: 'New heading', h: 30 },
  { type: 'link', label: 'Link', text: 'New link', w: 96, h: 21 },
  { type: 'select', label: 'Select', text: 'New choice', h: 64 },
  { type: 'checkbox', label: 'Checkbox', text: 'New option', w: 140, h: 22 },
  { type: 'toggle', label: 'Toggle', text: 'New setting', w: 160, h: 24 },
  { type: 'badge', label: 'Badge', text: 'New', w: 64, h: 22 },
  { type: 'alert', label: 'Alert', text: 'New message', h: 46 },
  { type: 'image', label: 'Image', text: 'Image', h: 160 },
]

const DEFAULT_PAD: Record<string, number> = { screen: 24, card: 16, section: 24, navbar: 16 }
/** A container's padding on the board: its own `pad`, else its type's default. */
function padOf(it: Item | undefined): number {
  const m = metaOf(it)
  if (!m) return 0
  return typeof m.pad === 'number' ? m.pad : (DEFAULT_PAD[String(m.type)] ?? 0)
}
const isContainerEl = (it: Item) => Boolean(metaOf(it)?.container)

/** Where a new element would go for this selection: inside a screen / container, else after the element. */
export function uiAddTarget(board: Board, anchor: Item): { mode: 'append' | 'after'; holder: Item | undefined } {
  if (isContainerEl(anchor)) return { mode: 'append', holder: anchor }
  return { mode: 'after', holder: anchor.parent ? board.items[anchor.parent] : undefined }
}

/**
 * Propose a new element: a dashed board item with a fresh explicit id (the id the drawing will give it once
 * the file has it), inside the selected screen or container (at its end), or right after the selected
 * element. Undefined when the anchor is not a UI mock element or its diagram is unknown.
 */
export function uiAddOps(board: Board, anchor: Item, type: string, now: string): { ops: Op[]; id: string } | undefined {
  const am = metaOf(anchor)
  const element = typeof anchor.data?.element === 'string' ? anchor.data.element : undefined
  const key = diagramOf(board, anchor)?.key
  const spec = UI_ADDABLE.find((a) => a.type === type)
  if (!am || !Array.isArray(am.path) || !element || !key || !spec || uiProposalOf(anchor)?.kind === 'remove') return undefined
  const screen = element.split('/')[0]
  let n = 1
  let eid = `new-${type}`
  while (board.items[`${key}.ui.${screen}.${eid}`]) eid = `new-${type}-${++n}`
  const id = `${key}.ui.${screen}.${eid}`
  const { mode, holder } = uiAddTarget(board, anchor)
  const pad = padOf(holder)
  const inner = holder ? { x: holder.x + pad, w: Math.max(80, holder.w - pad * 2) } : { x: anchor.x, w: anchor.w }
  const w = Math.min(spec.w ?? inner.w, inner.w)
  let x = inner.x
  let y: number
  let path: UiPath
  if (mode === 'append') {
    const kids = Object.values(board.items).filter((c) => c.parent === anchor.id && c.type === 'ui')
    y = kids.length ? Math.max(...kids.map((c) => c.y + c.h)) + 12 : anchor.y + pad
    const list = am.type === 'screen' ? 'body' : 'children'
    path = [...(am.path as UiPath), list, kids.length]
  } else {
    x = spec.w ? anchor.x : inner.x
    y = anchor.y + anchor.h + 8
    const ap = am.path as UiPath
    path = [...ap.slice(0, -1), Number(ap[ap.length - 1]) + 1]
  }
  const aui = (anchor.data?.ui ?? {}) as Record<string, unknown>
  const look = Object.fromEntries(['theme', 'accent', 'radius', 'font'].filter((k) => aui[k] !== undefined).map((k) => [k, aui[k]]))
  const h = spec.type === 'image' ? Math.round(Math.min(spec.h, (w * 9) / 16)) : spec.h
  // the board keeps a child inside its container: make the containers taller where it would not fit
  const grow: Op[] = []
  const grew: Array<{ id: string; h: number }> = []
  let bottom = Math.round(y) + h + pad
  for (let c = holder, guard = 0; c && (c.type === 'ui' || c.type === 'frame') && guard < 20; c = c.parent ? board.items[c.parent] : undefined, guard++) {
    if (c.y + c.h >= bottom) break
    grew.push({ id: c.id, h: c.h })
    grow.push({ kind: 'update', id: c.id, patch: { h: Math.round(bottom - c.y) } })
    const up = c.parent ? board.items[c.parent] : undefined
    bottom += up?.type === 'frame' ? 20 : padOf(up)
  }
  const pending: UiAddPending = {
    kind: 'add',
    node: { type, id: eid, text: spec.text },
    ...(mode === 'append' ? { parent: { element, path: am.path as UiPath } } : { after: { element, path: am.path as UiPath } }),
    path,
    ...(grew.length ? { grew } : {}),
    by: 'user',
    at: now,
  }
  const item: Item = {
    id,
    type: 'ui',
    role: type,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h,
    text: spec.text,
    parent: holder?.id ?? anchor.parent,
    order: 10_000,
    data: { element: `${screen}/${eid}`, ui: { type, path, textKey: 'text', ...look }, pending },
    createdBy: 'user',
    updatedBy: 'user',
    updatedAt: now,
  }
  return { ops: [...grow, { kind: 'add', item }], id }
}

// ── undo ─────────────────────────────────────────────────────────────────────

/** The item as the file has it: the words (and cell / list values) before the proposal. */
function undoneOf(it: Item, p: UiPending): { text: string | undefined; data: Record<string, unknown> } {
  const rest = withoutPending(it)
  if (p.kind === 'text' && p.sub) return { text: it.text, data: { ...rest, ui: uiWith(it, p.sub, p.before.text) } }
  if (p.kind === 'text') return { text: p.before.text, data: rest }
  return { text: it.text, data: rest }
}

/** Undo: what the file has, and no proposal; a proposed new element goes away. */
export function uiUndoOps(it: Item): Op[] {
  const p = uiProposalOf(it)
  if (!p) return []
  if (p.kind === 'add') return [{ kind: 'remove', id: it.id }, ...(p.grew ?? []).map((g): Op => ({ kind: 'update', id: g.id, patch: { h: g.h } }))]
  const back = undoneOf(it, p)
  return [{ kind: 'update', id: it.id, patch: { text: back.text, data: back.data } }]
}
