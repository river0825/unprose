import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { Board, Item } from '../../../src/model'
import { KIND_NAMES, diagramData } from '../diagrams/frame'
import { knownFindings } from '../diagrams/findings'

/** A diagram frame's header (docs/diagrams.md §1): its kind, key, and how many grammar findings it has. */
export interface DiagramBadge { kind: string; name: string; key: string; findings?: number }

export type ItemNode = Node<{ item: Item; pulse: boolean; open: boolean; replies: Item[]; childCount?: number; diagram?: DiagramBadge }, Item['type'] | 'dsIcon'>

/** Side of a folded comment's badge. */
export const BADGE = 26

const CONTAINERS = new Set<Item['type']>(['frame', 'lane', 'wireframe'])

/** A wireframe item only contains children when it is a screen. */
export function isContainer(it: Item): boolean {
  if (it.type === 'wireframe') return it.role === 'screen'
  return CONTAINERS.has(it.type)
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

export function boardToFlow(board: Board, pulse: Set<string>, openComments: Set<string>): { nodes: ItemNode[]; edges: Edge[] } {
  const items = Object.values(board.items)
  const byId = board.items
  const nodes: ItemNode[] = []
  const edges: Edge[] = []
  const visited = new Set<string>()
  const byRoot = threads(board)
  const stacked = kanbanLayout(board)

  const push = (it: Item) => {
    if (visited.has(it.id)) return
    visited.add(it.id)
    const parent = it.parent && byId[it.parent] && it.parent !== it.id ? byId[it.parent] : undefined
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
      data: { item: it, pulse: pulse.has(it.id) || thread.some((m) => pulse.has(m.id)), open, replies: thread.slice(1), childCount: it.role === 'column' ? items.filter((c) => c.type === 'card' && c.parent === it.id).length : undefined, diagram: badgeOf(board, it) },
      // an element the agent proposed (a story from EventStorming) is dashed until the file has it
      ...(it.type !== 'comment' && it.data?.pending ? { className: 'node-pending' } : {}),
      ...(it.data?.ds === 'group' ? { className: 'ds-group' } : it.data?.ds === 'annotation' ? { className: 'ds-annotation' } : {}),
      draggable: true,
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
          sourceHandle: side(it.data?.fromSide, 'right'),
          targetHandle: side(it.data?.toSide, 'left'),
          label: it.label ?? it.text,
          type: 'item',
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
  return { nodes, edges }
}

/** Kanban columns: cards are shown stacked top → bottom in the order of their model `y`, so a dropped card snaps into the pile. */
const KANBAN_HEADER = 44
const KANBAN_GAP = 12
const KANBAN_PAD = 20
export function kanbanLayout(board: Board): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  const columns = Object.values(board.items).filter((it) => it.type === 'lane' && it.role === 'column')
  for (const col of columns) {
    const cards = Object.values(board.items)
      .filter((it) => it.type === 'card' && it.parent === col.id)
      .sort((a, b) => a.y - b.y || (a.order ?? 0) - (b.order ?? 0))
    let y = col.y + KANBAN_HEADER + KANBAN_GAP
    for (const c of cards) {
      out.set(c.id, { x: col.x + KANBAN_PAD, y })
      y += c.h + KANBAN_GAP
    }
  }
  return out
}

const SIDES = new Set(['top', 'right', 'bottom', 'left'])
const side = (v: unknown, fallback: string) => (typeof v === 'string' && SIDES.has(v) ? v : fallback)

/** Absolute bounds of a node after a drag, given the current board. */
export function absolutePosition(board: Board, id: string, rel: { x: number; y: number }): { x: number; y: number } {
  const it = board.items[id]
  const parent = it?.parent ? board.items[it.parent] : undefined
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
  return { kind: d.kind, name: KIND_NAMES[d.kind] ?? d.kind, key: d.key, findings: d.kind === 'event-storming' || d.kind === 'domain-story' ? knownFindings(board, it, d.level, d.kind).length : undefined }
}
