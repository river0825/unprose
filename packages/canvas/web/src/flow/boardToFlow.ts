import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { ownLock, type Board, type Item } from '../../../src/model'
import { KANBAN_GAP, KANBAN_HEADER, stackCards } from './kanbanAlign'
import { KIND_NAMES, diagramData } from '../diagrams/frame'
import { findingCount } from '../diagrams/findings'
import { autoSides, planSides, type Box } from './route'
import { catchAllWires, wireBadges, type WireBadge } from './catchAll'

/** A diagram frame's header (docs/diagrams.md §1): its kind, key, and how many grammar findings it has. */
export interface DiagramBadge { kind: string; name: string; key: string; findings?: number }

export type ItemNode = Node<{ item: Item; pulse: boolean; open: boolean; replies: Item[]; childCount?: number; diagram?: DiagramBadge; wireBadges?: WireBadge[] }, Item['type'] | 'dsIcon'>

/** Side of a folded comment's badge. */
export const BADGE = 26

const CONTAINERS = new Set<Item['type']>(['frame', 'lane', 'wireframe'])

/** A wireframe item only contains children when it is a screen. */
export function isContainer(it: Item): boolean {
  if (it.type === 'wireframe') return it.role === 'screen'
  // a UI mock screen, card, section or navbar holds its elements (docs/diagrams.md §6c)
  if (it.type === 'ui') return Boolean((it.data?.ui as { container?: boolean } | undefined)?.container)
  return CONTAINERS.has(it.type)
}

/** The class a container's title bar and border carry: only they start a move (React Flow `dragHandle`). */
export const DRAG_HANDLE = 'drag-handle'

const PASS_UI = new Set(['screen', 'section'])

/**
 * A container whose body lets pointer events through to the canvas, so dragging its empty area draws a selection box
 * (as on the empty canvas) instead of moving it: frames (diagram frames, domain-story groups), lanes, kanban columns,
 * wireframe and UI-mock screens, and a UI mock's sections (layout, mostly empty space). A UI card, navbar or sidebar is
 * an element of the mock and moves like any item.
 */
export function passThrough(it: Item): boolean {
  if (it.type === 'frame' || it.type === 'lane') return true
  if (it.type === 'wireframe') return it.role === 'screen'
  if (it.type === 'ui') return PASS_UI.has((it.data?.ui as { type?: string } | undefined)?.type ?? '')
  return false
}

function nodeClass(it: Item): { className?: string } {
  const c = [
    // an element the agent proposed (a story from EventStorming) is dashed until the file has it
    it.type !== 'comment' && it.data?.pending ? 'node-pending' : '',
    // deleted by the person, still in the file: struck until the file no longer has it (docs/diagrams.md "What a redraw keeps")
    it.type !== 'comment' && (it.data?.pending as { deleted?: unknown } | undefined)?.deleted ? 'node-deleted' : '',
    it.data?.ds === 'group' ? 'ds-group' : it.data?.ds === 'annotation' ? 'ds-annotation' : '',
    passThrough(it) ? 'awd-container' : '',
    ownLock(it) ? 'node-locked' : '',
  ].filter(Boolean)
  return c.length ? { className: c.join(' ') } : {}
}

/** The comment a thread hangs from: follow `target` through comments. A cycle makes each comment its own root. */
export function threadRoot(board: Board, id: string): Item | undefined {
  const start = board.items[id]
  let cur = start
  const seen = new Set<string>()
  while (cur?.type === 'comment') {
    seen.add(cur.id)
    const next = board.items[cur.target ?? '']
    if (next?.type !== 'comment') return cur
    if (seen.has(next.id)) return start
    cur = next
  }
  return cur
}

/** Every thread's messages by root id, root first, then replies in the order they were added. */
export function threads(board: Board): Map<string, Item[]> {
  const out = new Map<string, Item[]>()
  const comments = Object.values(board.items).filter((it) => it.type === 'comment')
  for (const it of comments) if (threadRoot(board, it.id)?.id === it.id) out.set(it.id, [it])
  for (const it of comments) {
    const root = threadRoot(board, it.id)
    if (root && root.id !== it.id) out.get(root.id)?.push(it)
  }
  return out
}

/** The whole thread `id` belongs to (just the item itself when it is not a comment). */
export function threadOf(board: Board, id: string): Item[] {
  const root = threadRoot(board, id)
  return root ? (threads(board).get(root.id) ?? [root]) : []
}

/**
 * Items → React Flow nodes/edges. Only a thread's root comment becomes a node; its replies render inside it. Model coordinates are absolute; React Flow wants
 * children positioned relative to their parent, and parents to appear first.
 */
/** `data.ds` values drawn as Domain Storytelling pictograms. */
const DS_ICONS = new Set(['actor', 'object', 'legend-actor', 'legend-object', 'legend-activity'])

/** How catch-all wires are shown (flow/catchAll.ts): as badges (the default) or drawn; `expanded` holds the wires of badges clicked open. */
export interface CatchAllView { show: boolean; expanded: Set<string> }

export function boardToFlow(board: Board, pulse: Set<string>, openComments: Set<string>, catchAll: CatchAllView = { show: false, expanded: new Set() }): { nodes: ItemNode[]; edges: Edge[] } {
  const items = Object.values(board.items)
  const byId = board.items
  const nodes: ItemNode[] = []
  const edges: Edge[] = []
  const visited = new Set<string>()
  const byRoot = threads(board)
  const stacked = kanbanLayout(board)
  let obs: Array<Box & { id: string }> | undefined
  const boxes = () => (obs ??= obstacles(board, stacked))
  // catch-all listeners become badges on their blocks instead of long wires, unless the viewer shows them
  const catchAllIds = catchAll.show ? new Map() : catchAllWires(board)
  const badges = wireBadges(board, catchAllIds, catchAll.expanded)
  const collapsed = (id: string) => catchAllIds.has(id) && !catchAll.expanded.has(id)

  const push = (it: Item) => {
    if (visited.has(it.id)) return
    visited.add(it.id)
    // a comment belongs to its target (the tether shows it), never to a frame: it can sit anywhere on the board
    const parent = it.type !== 'comment' && it.parent && byId[it.parent] && it.parent !== it.id ? byId[it.parent] : undefined
    if (parent) push(parent)
    const thread = byRoot.get(it.id) ?? []
    const open = it.type !== 'comment' || openComments.has(it.id)
    const at = stacked.get(it.id) ?? { x: it.x, y: it.y }
    nodes.push({
      id: it.id,
      // a domain story's actors and work objects are pictograms, not boxes (docs/diagrams.md §6b)
      type: typeof it.data?.ds === 'string' && DS_ICONS.has(it.data.ds) ? 'dsIcon' : it.type,
      position: parent ? { x: at.x - parent.x, y: at.y - parent.y } : { x: at.x, y: at.y },
      width: open ? it.w : BADGE,
      height: it.type === 'comment' ? (open ? undefined : BADGE) : it.h,
      initialHeight: it.h,
      parentId: parent?.id,
      // a kanban card must be able to leave its column; drag-stop re-parents it by where it lands
      extent: parent && !(it.type === 'card' && parent.role === 'column') ? 'parent' : undefined,
      zIndex: isContainer(it) ? -1 : it.type === 'comment' ? 10 : 1,
      data: { item: it, pulse: pulse.has(it.id) || thread.some((m) => pulse.has(m.id)), open, replies: thread.slice(1), childCount: it.role === 'column' ? items.filter((c) => c.type === 'card' && c.parent === it.id).length : undefined, diagram: badgeOf(board, it), ...(badges.has(it.id) ? { wireBadges: badges.get(it.id) } : {}) },
      ...nodeClass(it),
      // a frame, lane, column or screen moves by its title bar or border; a drag on its body draws a selection box (docs/canvas.md)
      ...(passThrough(it) ? { dragHandle: `.${DRAG_HANDLE}` } : {}),
      // a locked item stays put until the person unlocks it (docs/diagrams.md "What a redraw keeps")
      draggable: !ownLock(it),
      selectable: true,
      connectable: it.type !== 'comment',
    })
  }

  for (const it of items) {
    if (it.type === 'arrow') {
      if (it.from && it.to && byId[it.from] && byId[it.to]) {
        edges.push({
          id: it.id,
          source: it.from,
          target: it.to,
          ...wireSides(it, byId, stacked, boxes),
          label: it.label ?? it.text,
          type: 'item',
          ...(collapsed(it.id) ? { hidden: true } : {}),
          // a trace joins two diagrams (來自 / 組成 / 畫面): dotted, muted, never re-pointed as flow (docs/diagrams.md §2)
          ...(it.role === 'trace' ? { className: 'wire-trace', reconnectable: false } : {}),
          // a workflow wire edited on the board is a proposal until the AI changes the file (docs/studio.md §7)
          ...(it.data?.pending && it.role !== 'trace' ? { className: (it.data.pending as { kind?: string }).kind === 'remove' ? 'wire-pending remove' : 'wire-pending' } : {}),
          // ownership / delegation links on the workflow board are intent, not flow: draw them dashed and quieter
          // a domain story's annotation link: a dashed line to what the note explains, no arrowhead
          ...(it.data?.ds && it.role === 'annotation-link' ? { className: 'ds-note-link', style: { strokeDasharray: '5 5', stroke: 'var(--ink-3)', strokeWidth: 1.2 } } : {}),
          ...(it.data?.ds && it.role === 'annotation-link'
            ? {}
            : it.data?.ds
            ? { className: 'ds-activity', style: { stroke: 'var(--ink)', strokeWidth: 1.6 }, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--ink)' } }
            : it.role === 'trace'
            ? { markerEnd: { type: MarkerType.ArrowClosed, width: 9, height: 9, color: 'var(--ink-3)' } }
            : it.role === 'owns' || it.role === 'delegates'
            ? { style: { strokeDasharray: it.role === 'owns' ? '3 5' : '6 4', stroke: 'var(--agent)', opacity: 0.7 }, markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: 'var(--agent)' } }
            : { markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--ink-2)' } }),
          data: { item: it },
        })
      }
      continue
    }
    if (it.type === 'comment' && !byRoot.has(it.id)) continue
    push(it)
    const about = it.type === 'comment' && it.target ? byId[it.target] : undefined
    if (about && about.type !== 'arrow' && about.type !== 'comment') {
      edges.push({
        id: `tether:${it.id}`,
        source: it.id,
        target: about.id,
        sourceHandle: 'tether',
        targetHandle: 'tether',
        type: 'tether',
        selectable: false,
        focusable: false,
        deletable: false,
        reconnectable: false,
      })
    }
  }
  spreadPorts(edges, byId, stacked)
  return { nodes, edges }
}

const boxOf = (it: Item, stacked: Map<string, { x: number; y: number }>): Box => ({ ...(stacked.get(it.id) ?? { x: it.x, y: it.y }), w: it.w, h: it.h })

/** Boxes a wire should not cross: everything but containers, comments and wires, at the position shown. */
function obstacles(board: Board, stacked: Map<string, { x: number; y: number }>): Array<Box & { id: string }> {
  return Object.values(board.items)
    .filter((it) => it.type !== 'arrow' && it.type !== 'comment' && !isContainer(it))
    .map((it) => ({ id: it.id, ...boxOf(it, stacked) }))
}

/**
 * The sides a wire leaves and enters by: what the person (or a template) chose, else the pair whose
 * route crosses the fewest boxes, then the shortest (route.ts planSides). A domain-story activity floats
 * between its pictograms, so it keeps the plain facing sides.
 */
function wireSides(it: Item, byId: Board['items'], stacked: Map<string, { x: number; y: number }>, boxes: () => Array<Box & { id: string }>): { sourceHandle: string; targetHandle: string } {
  const [a, b] = [boxOf(byId[it.from!], stacked), boxOf(byId[it.to!], stacked)]
  const chosen = typeof it.data?.fromSide === 'string' && typeof it.data?.toSide === 'string'
  const auto = it.data?.ds || chosen ? autoSides(a, b) : planSides(a, b, boxes().filter((c) => c.id !== it.from && c.id !== it.to))
  return { sourceHandle: side(it.data?.fromSide, auto.fromSide), targetHandle: side(it.data?.toSide, auto.toSide) }
}

/** Spacing between wires that share a side of a box, in px. */
const PORT_GAP = 16

/**
 * Wires that share a side of a box no longer meet in its one handle: they are spread along that
 * side (ports), sorted by where their other end is so neighbours do not cross. Each edge gets
 * `data.port = { s, t, si, ti, sn, tn }`: the offsets from the handle along the side, its rank and the count.
 */
export function spreadPorts(edges: Edge[], byId: Board['items'], stacked: Map<string, { x: number; y: number }>): void {
  const groups = new Map<string, Array<{ e: Edge; end: 's' | 't'; key: number }>>()
  for (const e of edges) {
    if (e.type !== 'item' || e.hidden) continue
    const [src, tgt] = [byId[e.source], byId[e.target]]
    if (!src || !tgt || (e.data as { item?: Item } | undefined)?.item?.data?.ds) continue
    const [sb, tb] = [boxOf(src, stacked), boxOf(tgt, stacked)]
    const along = (side: string, other: Box) => (side === 'left' || side === 'right' ? other.y + other.h / 2 : other.x + other.w / 2)
    for (const [end, id, sideName, other] of [['s', e.source, e.sourceHandle!, tb], ['t', e.target, e.targetHandle!, sb]] as const) {
      const k = `${id}|${sideName}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push({ e, end, key: along(sideName, other) })
    }
  }
  for (const [k, list] of groups) {
    const [id, sideName] = k.split('|')
    const it = byId[id]
    const len = sideName === 'left' || sideName === 'right' ? it.h : it.w
    // a loop under the box: the wire that goes furthest back starts outermost, so loops nest instead of crossing
    list.sort((a, b) => a.key - b.key || (a.e.id < b.e.id ? -1 : 1))
    const gap = Math.min(PORT_GAP, (len * 0.8) / Math.max(1, list.length))
    list.forEach((p, i) => {
      const d = (p.e.data ??= {}) as { port?: Record<string, number> }
      const port = (d.port ??= {})
      port[p.end] = (i - (list.length - 1) / 2) * gap
      port[`${p.end}i`] = i
      port[`${p.end}n`] = list.length
    })
  }
}

/** Kanban columns: cards are shown stacked top → bottom in the order of their model `y`, so a dropped card snaps into the pile. */
export function kanbanLayout(board: Board): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  const columns = Object.values(board.items).filter((it) => it.type === 'lane' && it.role === 'column')
  for (const col of columns) {
    // a kanban in a locked frame is shown as stored (docs/diagrams.md "What a redraw keeps"); locked cards keep their place
    const frame = col.parent ? board.items[col.parent] : undefined
    if (frame?.type === 'frame' && ownLock(frame)) continue
    stackCards(board, col, col.x, col.y + KANBAN_HEADER + KANBAN_GAP, out)
  }
  return out
}

const SIDES = new Set(['top', 'right', 'bottom', 'left'])
const side = (v: unknown, fallback: string) => (typeof v === 'string' && SIDES.has(v) ? v : fallback)

/** Absolute bounds of a node after a drag, given the current board. */
export function absolutePosition(board: Board, id: string, rel: { x: number; y: number }): { x: number; y: number } {
  const it = board.items[id]
  const parent = it?.parent && it.type !== 'comment' ? board.items[it.parent] : undefined
  return parent ? { x: rel.x + parent.x, y: rel.y + parent.y } : rel
}

/** Smallest container whose bounds contain the point, excluding `self` and its descendants. */
export function containerAt(board: Board, x: number, y: number, self: string): Item | undefined {
  let best: Item | undefined
  for (const it of Object.values(board.items)) {
    if (it.id === self || !isContainer(it)) continue
    if (isDescendant(board, it.id, self)) continue
    if (x >= it.x && y >= it.y && x <= it.x + it.w && y <= it.y + it.h) {
      if (!best || it.w * it.h < best.w * best.h) best = it
    }
  }
  return best
}

function isDescendant(board: Board, id: string, ancestor: string): boolean {
  let cur = board.items[id]
  let guard = 0
  while (cur?.parent && guard++ < 50) {
    if (cur.parent === ancestor) return true
    cur = board.items[cur.parent]
  }
  return false
}

/** The header a diagram frame shows on the board; undefined for any other item. */
function badgeOf(board: Board, it: Item): DiagramBadge | undefined {
  const d = diagramData(it)
  if (!d) return undefined
  return { kind: d.kind, name: KIND_NAMES[d.kind] ?? d.kind, key: d.key, findings: findingCount(board, it, d.level, d.kind) }
}
