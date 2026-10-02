// Redrawing a diagram from its file (docs/diagrams.md §2, docs/studio.md §7): the ops that make the board
// match the drawing while keeping where the person put things and every proposal not yet explained by the
// file. Pure — shared by the CLI (`awd design draw`, `awd graph --canvas`) and the canvas server's remote
// design tools (docs/canvas.md "Remote agents").

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

/** `data` keys that say how an item is shown or read, not what it means — a redraw keeps them. */
const PRESENTATION = ['seenBy', 'seenByAgents', 'agentState', 'fromSide', 'toSide', 'bend']
function withPresentation(drawn: BoardItem, was: BoardItem): BoardItem {
  const kept = Object.fromEntries(PRESENTATION.filter((k) => was.data && k in was.data).map((k) => [k, was.data![k]]))
  return Object.keys(kept).length ? { ...drawn, data: { ...drawn.data, ...kept } } : drawn
}

/** Has the drawing (the files) caught up with what the person proposed? */
export function isResolved(p: Pending, drawn: BoardItem[], itemId?: string): boolean {
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
 * The ops that make the board match the drawing: add/update every drawn item (keeping the
 * geometry of items the person placed), remove template items the drawing no longer has, and
 * leave a wire the person edited exactly as they left it until the files explain it.
 */
export function planRedraw(board: Record<string, BoardItem>, drawn: BoardItem[], placed: Set<string>, scope: RedrawScope = { prefix: SCOPE }): TemplateOp[] {
  const drawnIds = new Set(drawn.map((d) => d.id))
  const held = new Set<string>() // pending, not yet resolved: untouchable
  const ops: TemplateOp[] = []
  // A proposal belongs to this drawing when the item (or both ends of a wire the person drew) is in its scope;
  // another frame's proposals are not ours to settle.
  const owned = (it: BoardItem) =>
    it.id.startsWith(scope.prefix) || (it.type === 'arrow' && !!it.from && !!it.to && [it.from, it.to].every((e) => e.startsWith(scope.prefix) || scope.keep?.has(e)))
  for (const it of Object.values(board)) {
    const p = pendingOf(it)
    if (!p || !owned(it)) continue
    if (!isResolved(p, drawn, it.id)) held.add(it.id)
    else if (!drawnIds.has(it.id)) ops.push({ kind: 'remove', id: it.id }) // resolved: the drawn wire replaces it
  }
  const updates: TemplateOp[] = []
  for (const d of drawn) {
    if (held.has(d.id)) continue
    const was = board[d.id]
    updates.push(was ? { kind: 'update', id: d.id, patch: withPresentation(d, was) } : { kind: 'add', item: d })
  }
  for (const it of Object.values(board)) {
    if (held.has(it.id) || drawnIds.has(it.id) || pendingOf(it) || scope.keep?.has(it.id)) continue
    if (it.id.startsWith(scope.prefix) && it.type !== 'comment') ops.push({ kind: 'remove', id: it.id })
  }
  return [...keepUserLayout(updates, placed), ...ops]
}
