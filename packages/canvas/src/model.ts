// Shared board model — the contract between the canvas server, the MCP server,
// the templates and the web UI. Keep this file dependency-free.

export type DiagramKind =
  | 'event-storming'
  | 'user-story-map'
  | 'user-journey'
  | 'wireframe'
  | 'workflow'
  | 'kanban'
  | 'freeform'

export type ItemType =
  | 'sticky'
  | 'text'
  | 'frame'
  | 'lane'
  | 'arrow'
  | 'comment'
  | 'wireframe'
  | 'card'

export type Author = 'agent' | 'user'

/** What wakes a waiting agent: every change, only changes in meaning (not layout), or only a handoff. */
export type Wake = 'any' | 'meaningful' | 'handoff'

/** Semantic colour tokens; the UI maps them to light/dark values. */
export type ColorToken =
  | 'orange'
  | 'blue'
  | 'yellow'
  | 'pale-yellow'
  | 'lilac'
  | 'green'
  | 'pink'
  | 'red'
  | 'purple'
  | 'grey'
  | 'white'

export interface Item {
  id: string
  type: ItemType
  x: number
  y: number
  w: number
  h: number
  text?: string
  color?: ColorToken
  /** Domain role within the diagram kind, e.g. 'event' | 'command' | 'story' | 'button'. */
  role?: string
  /** Containment: id of a frame / lane / screen. Coordinates are absolute regardless. */
  parent?: string
  from?: string
  to?: string
  label?: string
  /** Comments: the item this comment is about. */
  target?: string
  order?: number
  /** Explicit text size in px; unset means the UI's default for the type/role. Resizing scales it. */
  fontSize?: number
  /** `data.seenBy` (Author[]) records who has read a comment; see `markSeen`. `data.agentState` (AgentState) says what the agent is doing about it. */
  data?: Record<string, unknown>
  createdBy: Author
  updatedBy: Author
  updatedAt: string
}

export interface Board {
  id: string
  title: string
  kind: DiagramKind
  seq: number
  createdAt: string
  updatedAt: string
  items: Record<string, Item>
  meta?: Record<string, unknown>
}

export type Op =
  | { kind: 'add'; item: Item }
  | { kind: 'update'; id: string; patch: Partial<Omit<Item, 'id'>> }
  | { kind: 'remove'; id: string }

export interface Change {
  seq: number
  ts: string
  author: Author
  boardId: string
  ops: Op[]
  /** Snapshot of each touched item before the change (null = did not exist). */
  before: Record<string, Item | null>
  note?: string
}

/** Wire messages on the board websocket. */
export type WsMessage =
  | { type: 'hello'; board: Board }
  | { type: 'change'; change: Change }
  | { type: 'presence'; author: Author; at: string; watching: boolean }
  /** Saving this board failed (`ok: false`, keep showing it) or works again (`ok: true`). */
  | { type: 'storage'; ok: boolean; message: string; at: string }

/** Default sticky colour per event-storming role — the book's palette (hotspots are purple, p.307). */
export const EVENT_STORMING_COLORS: Record<string, ColorToken> = {
  event: 'orange',
  command: 'blue',
  person: 'yellow',
  actor: 'yellow',
  system: 'pink',
  external: 'pink',
  aggregate: 'pale-yellow',
  policy: 'lilac',
  'read-model': 'green',
  hotspot: 'purple',
  opportunity: 'green',
}

// ── Diagram frames (docs/diagrams.md §1) ──────────────────────────────────

/** What a diagram frame can hold: every template kind but freeform, plus kinds drawn by hand for now. */
export type DiagramFrameKind = Exclude<DiagramKind, 'freeform'> | 'domain-story'

/** `data.diagram` on a frame item. */
export interface DiagramSpec {
  kind: DiagramFrameKind
  /** Stable, human-readable, unique on the board ('studio-es'); ids inside are `<key>.<role>.<element id>`. */
  key: string
  /** Repo-relative file behind it ('design/studio.es.yaml'; a workflow: its yaml). */
  source?: string
  /** event-storming: 'big-picture' | 'process' | 'software'. */
  level?: string
}

/** The diagram an item belongs to: its nearest diagram frame, else the legacy board kind. */
export interface DiagramInfo extends DiagramSpec {
  /** The frame item; absent for a legacy board (the whole board is the diagram). */
  frameId?: string
}

/** Item id of the frame for a diagram key. */
export const diagramFrameId = (key: string) => `diagram.${key}`

export function diagramSpecOf(item: Item | undefined): DiagramSpec | undefined {
  const d = item?.type === 'frame' ? (item.data?.diagram as DiagramSpec | undefined) : undefined
  return d && typeof d.kind === 'string' && typeof d.key === 'string' ? d : undefined
}

/**
 * Which diagram is this item in? The nearest ancestor frame with `data.diagram` (an arrow asks for its
 * `from` end); on a board that is not freeform and has no such frame around the item, the whole board is
 * one diagram of the board's kind with key = the kind (legacy boards need no migration).
 */
export function diagramOf(board: Pick<Board, 'kind' | 'items'>, item: Item | undefined): DiagramInfo | undefined {
  let cur = item?.type === 'arrow' && item.from ? board.items[item.from] : item
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    const spec = diagramSpecOf(cur)
    if (spec) return { ...spec, frameId: cur.id }
    cur = cur.parent ? board.items[cur.parent] : undefined
  }
  return board.kind !== 'freeform' ? { kind: board.kind as DiagramFrameKind, key: board.kind } : undefined
}

/** Every diagram frame on the board, in board order. */
export function diagramFrames(board: Pick<Board, 'items'>): Array<DiagramSpec & { frameId: string }> {
  return Object.values(board.items).flatMap((it) => {
    const spec = diagramSpecOf(it)
    return spec ? [{ ...spec, frameId: it.id }] : []
  })
}

export function applyOps(board: Board, ops: Op[], author: Author, now = new Date().toISOString()): { board: Board; before: Record<string, Item | null> } {
  const items = { ...board.items }
  const before: Record<string, Item | null> = {}
  for (const op of ops) {
    if (op.kind === 'add') {
      if (!(op.item.id in before)) before[op.item.id] = items[op.item.id] ?? null
      items[op.item.id] = { ...op.item, createdBy: op.item.createdBy ?? author, updatedBy: author, updatedAt: now }
    } else if (op.kind === 'update') {
      const cur = items[op.id]
      if (!cur) continue
      if (!(op.id in before)) before[op.id] = cur
      items[op.id] = isSeenOnly(op, cur) ? { ...cur, ...op.patch, id: cur.id } : { ...cur, ...op.patch, id: cur.id, updatedBy: author, updatedAt: now }
    } else if (op.kind === 'remove') {
      const cur = items[op.id]
      if (!cur) continue
      if (!(op.id in before)) before[op.id] = cur
      delete items[op.id]
    }
  }
  return { board: { ...board, items, updatedAt: now }, before }
}

/** What the agent is doing about a comment (written by `awd studio` from the session's herdr state). */
export interface AgentState {
  state: 'starting' | 'working' | 'idle' | 'blocked' | 'failed'
  /** herdr session / tab the work happens in. */
  session?: string
  tab?: string
  at: string
}

export function agentStateOf(item: Item): AgentState | undefined {
  const s = item.data?.agentState as AgentState | undefined
  return s && typeof s.state === 'string' ? s : undefined
}

export function seenBy(item: Item): Author[] {
  const s = item.data?.seenBy
  return Array.isArray(s) ? s.filter((a): a is Author => a === 'agent' || a === 'user') : []
}

/** The op recording that `who` has read `item`, or undefined when already recorded. */
export function markSeen(item: Item, who: Author): Op | undefined {
  const seen = seenBy(item)
  if (seen.includes(who)) return undefined
  return { kind: 'update', id: item.id, patch: { data: { ...item.data, seenBy: [...seen, who] } } }
}

/** Unread for `viewer`: a comment the other side wrote that `viewer` has not opened yet. */
export function isUnread(item: Item, viewer: Author): boolean {
  return item.type === 'comment' && item.createdBy !== viewer && !seenBy(item).includes(viewer)
}

/** `data` keys that are receipts, not meaning: who read a comment, and what the agent is doing about it. */
const RECEIPTS = new Set(['seenBy', 'agentState'])

const withoutSeen = (data: Record<string, unknown> | undefined) =>
  JSON.stringify(Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !RECEIPTS.has(k))))

const PRESENTATION_DATA = new Set(['seenBy', 'agentState', 'fromSide', 'toSide', 'bend'])
const GEOMETRY = new Set(['x', 'y', 'w', 'h', 'parent', 'fontSize'])

/** `data` without the keys that are presentation, not meaning: read receipts and how a wire is drawn. */
export function meaningOf(data: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !PRESENTATION_DATA.has(k)))
}

/** An update that only moves, resizes or reroutes an item (or records who read it): layout, not meaning. */
export function isLayoutOnly(op: Op, before: Item | null | undefined): boolean {
  if (op.kind !== 'update' || !before) return false
  const unchanged = (k: string, v: unknown) => JSON.stringify(v) === JSON.stringify(before[k as keyof Item])
  return Object.entries(op.patch).every(
    ([k, v]) => GEOMETRY.has(k) || unchanged(k, v) || (k === 'data' && JSON.stringify(meaningOf(v as Record<string, unknown>)) === JSON.stringify(meaningOf(before.data))),
  )
}

/** An update that only changes `data.seenBy` / `data.agentState`: receipt bookkeeping, not an edit. */
export function isSeenOnly(op: Op, before: Item | null | undefined): boolean {
  if (op.kind !== 'update' || !before) return false
  const keys = Object.keys(op.patch)
  return keys.length === 1 && keys[0] === 'data' && withoutSeen(op.patch.data) === withoutSeen(before.data)
}

/** A change made only of read receipts; diffs and waits ignore it. */
export function isBookkeeping(change: Change): boolean {
  return change.ops.length > 0 && change.ops.every((op) => op.kind === 'update' && isSeenOnly(op, change.before[op.id]))
}

let counter = 0
export function newId(prefix = 'i'): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
