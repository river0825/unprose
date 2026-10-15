// Shared board model — the contract between the canvas server, the MCP server,
// the templates and the web UI. Keep this file dependency-free.

export type DiagramKind =
  | 'event-storming'
  | 'user-story-map'
  | 'user-journey'
  | 'wireframe'
  | 'workflow'
  | 'kanban'
  | 'domain-story'
  | 'ui-mock'
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
  /** A UI mock element (docs/diagrams.md §6c): drawn from `data.ui` by the web's design system. */
  | 'ui'

export type Author = 'agent' | 'user'

/** What wakes a waiting agent: every change, only changes in meaning (not layout), or only a handoff. */
export type Wake = 'any' | 'meaningful' | 'handoff'

/**
 * The longest one wait may block (canvas_wait timeoutSec, GET /wait timeout): 30 minutes. Every return costs a
 * waiting agent model tokens, so long waits are cheap waits (docs/canvas.md "Watching cheaply").
 */
export const WAIT_MAX_SEC = 1800
/** canvas_wait's default timeoutSec. */
export const WAIT_DEFAULT_SEC = 300

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
  /**
   * Who exactly, when `author` alone does not say it: the name of the agent (an access token or OAuth
   * client — docs/canvas.md "Remote agents" — or UNPROSE_AGENT_NAME for a local agent) or of the signed-in
   * person. Absent for the default local agent and the person on this machine.
   */
  by?: string
  /**
   * Board settings this change set (docs/canvas.md "Several agents on one board"): the new value of each
   * `meta` key it changed (`responder`, `context`, `agentTurns`); null = removed. Such a change has no ops.
   */
  meta?: Record<string, unknown>
}

/**
 * A change trimmed for a list (`GET /api/boards/:id/changes?brief=1`, the page's Changes tab): at most 50 ops, each
 * only what names it — never applied, so it is not a `Change`. `before` holds only the items its removes take.
 */
export interface BriefChange extends Omit<Change, 'ops' | 'before' | 'meta'> {
  ops: BriefOp[]
  before: Record<string, Pick<Item, 'id' | 'type' | 'text'> | null>
  /** the settings keys it set, values null */
  meta?: Record<string, null>
  /** every op of the change, listed or not */
  opCount: number
  /** the distinct items it touched */
  itemCount: number
}

/** An add names its item; an update keeps the keys it set (values null), not the stamps (id, createdBy, updatedBy, updatedAt); a remove is as it was. */
export type BriefOp =
  | { kind: 'add'; item: Pick<Item, 'id' | 'type' | 'role' | 'text'> }
  | { kind: 'update'; id: string; patch: Record<string, null> }
  | { kind: 'remove'; id: string }

/** Wire messages on the board websocket. */
export type WsMessage =
  | { type: 'hello'; board: Board }
  | { type: 'change'; change: Change }
  /** `agents`: the names of the agents waiting on this board right now ('agent' for the default local one). */
  | { type: 'presence'; author: Author; at: string; watching: boolean; agents?: string[]; /** when each agent last watched this board (ISO), for "<name> is away" */ seen?: Record<string, string> }
  /** Saving this board failed (`ok: false`, keep showing it) or works again (`ok: true`). */
  | { type: 'storage'; ok: boolean; message: string; at: string }
  /**
   * "Look here": someone (usually the agent) asks the viewers to bring these items into view. Not a board
   * change — nothing is stored, nothing shows in a diff. `ids` are the items to fit (a frame key resolves to
   * its frame item); empty with `frame` set means a legacy board's whole diagram.
   */
  | { type: 'focus'; ids: string[]; frame?: string; note?: string; author: Author; at: string; /** the agent's name (Change.by) */ by?: string }
  /** Upgrading the canvas itself (docs/canvas.md "Updating"): progress for every open page; `restarting` means reconnect. */
  | { type: 'update'; phase: 'checking' | 'installing' | 'building' | 'restarting' | 'done' | 'failed'; message: string; at: string; version?: string }
  /**
   * An agent or a browser asks to connect (docs/canvas.md "Remote agents"). Sent on the server socket `/ws` to
   * pages that may approve: on this machine (one click) or signed in (with the pairing code the requester shows).
   */
  | { type: 'access-request'; request: AccessRequestView }
  /** A pending request was approved, denied or expired: pages drop its notification. */
  | { type: 'access-resolved'; id: string; status: 'approved' | 'denied' | 'expired' }
  /** The list of connected agents changed (created, revoked, used for the first time): the agents page reloads it. */
  | { type: 'access-changed'; at: string }

/**
 * A pending connect request as an approving page sees it. The pairing code is NOT here: it is shown only on
 * the requester's side (the agent's authorize page, its tool result, the browser's sign-in page), and the
 * person types it into the canvas — knowing it proves they are looking at the requester.
 */
export interface AccessRequestView {
  id: string
  /** 'oauth': an MCP client through OAuth; 'device': an agent without a browser; 'browser': a page reached from elsewhere. */
  /** 'manage': a signed-in browser asking for the right to manage agents — only a page that manages approves it. */
  via: 'oauth' | 'device' | 'browser' | 'manage'
  /** The client's own name (from its registration / request) or a description of the browser. */
  name: string
  /** Where the agent will be sent back to (its host), for an OAuth request. */
  redirectHost?: string
  /** The scope it asked for. */
  scope: 'read' | 'write'
  ip?: string
  userAgent?: string
  createdAt: string
  expiresAt: string
}

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
export type DiagramFrameKind = Exclude<DiagramKind, 'freeform'>

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

/** The names of the agents that have read a comment (`data.seenByAgents`; the default local agent is 'agent'). */
export function seenByAgents(item: Item): string[] {
  const s = item.data?.seenByAgents
  return Array.isArray(s) ? s.filter((a): a is string => typeof a === 'string') : []
}

/**
 * The op recording that `who` has read `item`, or undefined when already recorded. `agent` names the agent
 * (docs/canvas.md "Remote agents"): each named agent gets its own receipt in `data.seenByAgents`.
 */
export function markSeen(item: Item, who: Author, agent?: string): Op | undefined {
  const seen = seenBy(item)
  const names = seenByAgents(item)
  const needRole = !seen.includes(who)
  const needName = who === 'agent' && !!agent && !names.includes(agent)
  if (!needRole && !needName) return undefined
  const data: Record<string, unknown> = { ...item.data }
  if (needRole) data.seenBy = [...seen, who]
  if (needName) data.seenByAgents = [...names, agent]
  return { kind: 'update', id: item.id, patch: { data } }
}

/** Unread for `viewer`: a comment the other side wrote that `viewer` has not opened yet. */
export function isUnread(item: Item, viewer: Author): boolean {
  return item.type === 'comment' && item.createdBy !== viewer && !seenBy(item).includes(viewer)
}

/** `data` keys that are receipts, not meaning: who read a comment, and what the agent is doing about it. */
const RECEIPTS = new Set(['seenBy', 'seenByAgents', 'agentState'])

const withoutSeen = (data: Record<string, unknown> | undefined) =>
  JSON.stringify(Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !RECEIPTS.has(k))))

// routing stamps (docs/canvas.md "Several agents on one board") are the canvas's bookkeeping too
const PRESENTATION_DATA = new Set(['seenBy', 'seenByAgents', 'agentState', 'fromSide', 'toSide', 'bend', 'to', 'route', 'mention', 'mentionAt', 'paused', 'postedAt'])
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

// ── Layout lock (docs/diagrams.md "What a redraw keeps") ─────────────────────
// `data.lock: 'layout'` on an item: redraws and the kanban's auto-layout never move or resize it. On a frame:
// the same for the frame and everything inside it. Only the person moves a locked item (after unlocking it).

export const LAYOUT_LOCK = 'layout'
type Lockable = { id: string; type?: string; parent?: string; data?: Record<string, unknown> }

/** Is this item's own layout locked (`data.lock: 'layout'`)? */
export const ownLock = (it: Lockable | undefined): boolean => it?.data?.lock === LAYOUT_LOCK

/**
 * Why an item's layout is locked: 'item' (its own lock), 'frame' (a frame around it is locked), else undefined.
 * A locked column or lane does not lock its cards — only a frame locks what is inside it.
 */
export function layoutLock(items: Record<string, Lockable>, id: string): 'item' | 'frame' | undefined {
  const it = items[id]
  if (!it) return undefined
  if (ownLock(it)) return 'item'
  if (it.type === 'comment') return undefined
  const seen = new Set<string>([id])
  for (let p = it.parent ? items[it.parent] : undefined; p && !seen.has(p.id); p = p.parent ? items[p.parent] : undefined) {
    seen.add(p.id)
    if (p.type === 'frame' && ownLock(p)) return 'frame'
  }
  return undefined
}

let counter = 0
export function newId(prefix = 'i'): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
