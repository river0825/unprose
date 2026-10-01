import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  ConnectionMode,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './select.css'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Board, ColorToken, Item, Op } from '../../src/model'
import { isUnread, markSeen, newId } from '../../src/model'
import { ContextMenu, type MenuState } from './components/ContextMenu'
import { Rail, type Tool } from './components/Rail'
import { ShortcutsSheet } from './components/ShortcutsSheet'
import { SidePanel } from './components/SidePanel'
import { EditContext, type EditApi } from './flow/EditContext'
import { absolutePosition, boardToFlow, containerAt, isContainer, threadOf, threadRoot, type ItemNode } from './flow/boardToFlow'
import { SCALES_FONT, scaledFont } from './flow/font'
import { edgeTypes } from './flow/ItemEdge'
import { nodeTypes } from './flow/nodes'
import { useStoredSet } from './flow/storedSet'
import { useBoard } from './store'
import { RunOverlay } from './run/RunOverlay'
import { PanelResizer, usePanelWidth } from './components/PanelResizer'
import { addWire, isFlowWire, pendingOf, pickEventOp, relabelOp, removeOps, rewireOp, undoOps } from './inspector/pending'
import { StudioControl } from './components/StudioControl'
import { isWorkflowScope } from './diagrams/frame'
import { FrozenHeaders } from './flow/FrozenHeaders'
import { captureIds, copySelectionAsImage, imageFileName } from './flow/copyImage'
import { GoToPalette } from './components/GoToPalette'
import { FocusBanner, readFollow, writeFollow } from './components/FocusBanner'
import { EmptyBoardHint } from './components/AskHints'
import type { FocusRequest } from './store'

const GRID: [number, number] = [10, 10]
const MULTI_SELECT_KEYS = ['Meta', 'Control', 'Shift']

const KIND_NAMES: Record<string, string> = {
  'event-storming': 'Event storming',
  'user-story-map': 'User story map',
  'user-journey': 'User journey',
  wireframe: 'Wireframe',
  workflow: 'Workflow',
  freeform: 'Freeform',
}

const COLOURABLE = new Set<Item['type']>(['sticky', 'card', 'text'])

function makeItem(partial: Partial<Item> & Pick<Item, 'type' | 'x' | 'y' | 'w' | 'h'>): Item {
  const now = new Date().toISOString()
  return { id: newId(partial.type[0]), createdBy: 'user', updatedBy: 'user', updatedAt: now, ...partial }
}

/** Which side of each node a wire is attached to (handle ids are the sides). */
const sides = (c: Connection) => ({ fromSide: c.sourceHandle ?? 'right', toSide: c.targetHandle ?? 'left' })

function isInside(board: Board, id: string, container: string): boolean {
  let cur = board.items[id]
  for (let guard = 0; cur?.parent && guard < 50; guard++) {
    if (cur.parent === container) return true
    cur = board.items[cur.parent]
  }
  return false
}

const snap = (n: number) => Math.round(n / 10) * 10

export function BoardPage({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <BoardInner id={id} />
    </ReactFlowProvider>
  )
}

function BoardInner({ id }: { id: string }) {
  const store = useBoard(id)
  const { board, commit, pulse } = store
  const flow = useReactFlow()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectWhenDrawn = useRef<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [color, setColor] = useState<ColorToken>('yellow')
  const [tool, setTool] = useState<Tool>('select')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 900)
  const [panelWidth, setPanelWidth] = usePanelWidth()
  const [nodes, setNodes] = useState<ItemNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [openComments, setOpenComment] = useStoredSet(`awd.canvas.open-comments.${id}`)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [gotoOpen, setGotoOpen] = useState(false)
  const [follow, setFollow] = useState(readFollow)
  const [handed, setHanded] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (board) document.title = `${board.title} — awd canvas`
  }, [board])

  // Derived flow graph; local `nodes` tracks in-progress drags/selection between board updates.
  // a new comment stays local until it has text, so an abandoned empty box never reaches the agent
  const [draftComment, setDraftComment] = useState<Item | null>(null)
  useEffect(() => {
    if (draftComment && editingId !== draftComment.id) setDraftComment(null)
  }, [draftComment, editingId])
  const shown = useMemo(() => (board && draftComment ? { ...board, items: { ...board.items, [draftComment.id]: draftComment } } : board), [board, draftComment])
  const derived = useMemo(() => (shown ? boardToFlow(shown, pulse, openComments) : { nodes: [], edges: [] as Edge[] }), [shown, pulse, openComments])
  useEffect(() => {
    setNodes((prev) => {
      const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id))
      return derived.nodes.map((n) => ({ ...n, selected: sel.has(n.id) }))
    })
    setEdges((prev) => {
      const sel = new Set(prev.filter((e) => e.selected).map((e) => e.id))
      return derived.edges.map((e) => ({ ...e, selected: sel.has(e.id) || e.id === selectWhenDrawn.current }))
    })
    // a wire just drawn is selected once it exists, so the panel can ask which event it is
    const drawn = selectWhenDrawn.current
    if (drawn && derived.edges.some((e) => e.id === drawn)) {
      selectWhenDrawn.current = null
      setSelectedIds([drawn])
    }
  }, [derived])

  // a link under the pointer in the side panel lights up the item(s) it points at on the board
  const [panelHover, setPanelHover] = useState<string[]>([])
  const onHoverItems = useCallback((ids: string[]) => setPanelHover((prev) => (prev.length === ids.length && prev.every((x, i) => x === ids[i]) ? prev : ids)), [])
  // "show it on the board" from a panel link: the view moves there and the item flashes for a moment
  const [flashIds, setFlashIds] = useState<string[]>([])
  const shownNodes = useMemo(() => {
    if (!panelHover.length && !flashIds.length) return nodes
    const on = new Set([...panelHover, ...flashIds])
    return nodes.map((n) => (on.has(n.id) ? { ...n, className: `${n.className ?? ''} panel-hover` } : n))
  }, [nodes, panelHover, flashIds])

  // owns / delegates wires are agent relations, not events: faint unless one of their ends is selected (docs/studio.md §7)
  const shownEdges = useMemo(() => {
    // only workflow diagrams draw owns / delegates wires, on a workflow board or in a workflow frame
    if (!board) return edges
    const sel = new Set(selectedIds)
    const hover = new Set([...panelHover, ...flashIds])
    return edges.map((e) => {
      const role = board.items[e.id]?.role
      const lit = hover.has(e.id) ? ' panel-hover' : ''
      if (role !== 'owns' && role !== 'delegates') return lit ? { ...e, className: `${e.className ?? ''}${lit}` } : e
      const on = e.selected || sel.has(e.source) || sel.has(e.target)
      return { ...e, className: (on ? 'wire-agent on' : 'wire-agent') + lit }
    })
  }, [board, edges, selectedIds, panelHover, flashIds])

  const onNodesChange = useCallback((changes: NodeChange<ItemNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns))
  }, [])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es))
  }, [])

  const onSelectionChange = useCallback(({ nodes: sel, edges: selE }: OnSelectionChangeParams) => {
    setSelectedIds([...sel.map((n) => n.id), ...selE.map((e) => e.id)])
  }, [])

  const select = useCallback(
    (ids: string[]) => {
      setSelectedIds(ids)
      const set = new Set(ids)
      setNodes((ns) => ns.map((n) => ({ ...n, selected: set.has(n.id) })))
      setEdges((es) => es.map((e) => ({ ...e, selected: set.has(e.id) })))
    },
    [],
  )

  const locate = useCallback(
    (ids: string[]) => {
      if (!ids.length) return
      flow.fitView({ nodes: ids.map((i) => ({ id: i })), padding: 0.4, duration: 300, maxZoom: 1.2 })
    },
    [flow],
  )
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reveal = useCallback(
    (ids: string[]) => {
      if (!board) return
      // a wire is shown by its two ends; a block by itself
      const nodesOf = ids.flatMap((i) => (board.items[i]?.type === 'arrow' ? [board.items[i].from, board.items[i].to].filter((x): x is string => !!x) : [i]))
      locate(nodesOf)
      setFlashIds(ids)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlashIds([]), 1600)
    },
    [board, locate],
  )

  // "Take me there": fit the view to these items and select them (the palette, ?frame= links, canvas_focus).
  // No ids = a legacy board's whole diagram → fit everything.
  const goTo = useCallback(
    (ids: string[]) => {
      const known = ids.filter((i) => board?.items[i])
      if (!known.length) {
        flow.fitView({ padding: 0.15, duration: 300 })
        return
      }
      select(known)
      flow.fitView({ nodes: known.map((i) => ({ id: i })), padding: 0.2, duration: 350, maxZoom: 1.2 })
    },
    [board, flow, select],
  )
  const goToRequest = useCallback(
    (r: FocusRequest) => {
      goTo(r.ids)
      store.clearFocus()
    },
    [goTo, store],
  )

  // ---- gestures → ops
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node, dragged: Node[]) => {
      if (!board) return
      const patches = new Map<string, Partial<Item>>()
      const moved = dragged.length ? dragged : [node]
      for (const n of moved) {
        const it = board.items[n.id]
        if (!it) continue
        // n.position is relative to its React Flow parent (which mirrors it.parent)
        const abs = absolutePosition(board, n.id, n.position)
        const patch: Partial<Item> = {}
        if (Math.round(abs.x) !== Math.round(it.x) || Math.round(abs.y) !== Math.round(it.y)) {
          patch.x = Math.round(abs.x)
          patch.y = Math.round(abs.y)
        }
        // comments never join a frame or lane: they belong to their target (an old `parent` on one is ignored)
        if (it.type !== 'comment' && it.type !== 'frame' && it.type !== 'lane') {
          // re-parent when the item's centre lands in a different container
          const cx = abs.x + it.w / 2
          const cy = abs.y + it.h / 2
          const container = containerAt(board, cx, cy, n.id)
          const nextParent = container?.id
          if ((it.parent ?? undefined) !== nextParent) patch.parent = nextParent
        }
        if (Object.keys(patch).length) patches.set(n.id, patch)
      }
      // a container carries everything inside it; the model's coordinates are absolute
      for (const [cid, p] of [...patches]) {
        const c = board.items[cid]
        if (!c || !isContainer(c) || p.x === undefined || p.y === undefined) continue
        const dx = p.x - c.x
        const dy = p.y - c.y
        for (const it of Object.values(board.items)) {
          if (it.type === 'comment' || !isInside(board, it.id, cid) || patches.get(it.id)?.x !== undefined) continue
          patches.set(it.id, { ...patches.get(it.id), x: it.x + dx, y: it.y + dy })
        }
      }
      const ops: Op[] = [...patches].map(([id, patch]) => ({ kind: 'update', id, patch }))
      const names = moved.map((m) => board.items[m.id]?.text?.trim()).filter(Boolean)
      void commit(ops, moved.length === 1 ? `moved ${names[0] ? `'${names[0].slice(0, 40)}'` : 'an item'}` : `moved ${moved.length} items`)
    },
    [board, commit],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return
      // on a workflow board a wire between two steps is a proposed subscription (docs/studio.md §7)
      const flow = board && isWorkflowScope(board, board.items[c.source]) && isWorkflowScope(board, board.items[c.target]) ? addWire(board, c.source, c.target, new Date().toISOString()) : undefined
      const item = makeItem({ type: 'arrow', x: 0, y: 0, w: 0, h: 0, from: c.source, to: c.target, data: { ...sides(c), ...flow?.data }, ...(flow ? { role: flow.role } : {}) })
      if (flow) selectWhenDrawn.current = item.id
      void commit([{ kind: 'add', item }], flow ? 'proposed a new wire' : 'connected two items')
    },
    [board, commit],
  )

  const onReconnect = useCallback(
    (old: Edge, c: Connection) => {
      const it = board?.items[old.id]
      if (!it || !c.source || !c.target || c.source === c.target) return
      const data = { ...it.data, ...sides(c) }
      if (c.source === it.from && c.target === it.to && JSON.stringify(data) === JSON.stringify(it.data ?? {})) return
      if (isFlowWire(board, it) && (c.source !== it.from || c.target !== it.to)) {
        const op = rewireOp(board, it, c.source, c.target, sides(c), new Date().toISOString())
        if (op) return void commit([op], 'proposed a rewire')
      }
      void commit([{ kind: 'update', id: it.id, patch: { from: c.source, to: c.target, data } }], 'reconnected an arrow')
    },
    [board, commit],
  )

  const centre = useCallback(() => {
    const el = wrapRef.current
    const w = el?.clientWidth ?? 800
    const h = el?.clientHeight ?? 600
    const p = flow.screenToFlowPosition({
      x: (el?.getBoundingClientRect().left ?? 0) + w / 2,
      y: (el?.getBoundingClientRect().top ?? 0) + h / 2,
    })
    return { x: snap(p.x), y: snap(p.y) }
  }, [flow])

  /** Add a sticky / text / frame, centred at `at` (flow coords) or the viewport centre, and start editing it. */
  const addItem = useCallback(
    (kind: 'sticky' | 'text' | 'frame', at?: { x: number; y: number }) => {
      if (!board) return
      const c = at ?? centre()
      const jitter = at ? 0 : (Object.keys(board.items).length % 5) * 12
      let item: Item
      if (kind === 'sticky') item = makeItem({ type: 'sticky', x: snap(c.x - 60 + jitter), y: snap(c.y - 60 + jitter), w: 120, h: 120, color, text: '' })
      else if (kind === 'text') item = makeItem({ type: 'text', x: snap(c.x - 80 + jitter), y: snap(c.y - 14 + jitter), w: 200, h: 32, text: '' })
      else item = makeItem({ type: 'frame', x: snap(c.x - 200 + jitter), y: snap(c.y - 140 + jitter), w: 400, h: 280, text: 'Frame' })
      const parent = kind !== 'frame' ? containerAt(board, item.x + item.w / 2, item.y + item.h / 2, item.id) : undefined
      if (parent) item.parent = parent.id
      void commit([{ kind: 'add', item }], `added a ${kind}`)
      select([item.id])
      setEditingId(item.id)
    },
    [board, centre, color, commit, select],
  )

  const addComment = useCallback(
    (targetId: string, text: string, data?: Item['data']) => {
      if (!board) return
      const t = board.items[targetId]
      if (!t) return
      const siblings = Object.values(board.items).filter((i) => i.type === 'comment' && i.target === targetId).length
      const item = makeItem({
        type: 'comment',
        x: t.x + t.w + 16 + siblings * 12,
        y: t.y - 24 + siblings * 26,
        w: 160,
        h: 64,
        text,
        target: targetId,
        ...(data ? { data } : {}),
      })
      setOpenComment(item.id, true)
      if (!text.trim()) {
        setDraftComment(item)
        return { id: item.id }
      }
      void commit([{ kind: 'add', item }], `commented on '${(t.text ?? t.label ?? t.type).slice(0, 40)}'`)
      return { id: item.id }
    },
    [board, commit, setOpenComment],
  )

  /** A loose comment about the whole board (no target), placed near the top-left of the current view. */
  const addBoardComment = useCallback(
    (text: string, data?: Item['data']) => {
      if (!board || !text.trim()) return
      const rect = wrapRef.current?.getBoundingClientRect()
      const at = rect ? flow.screenToFlowPosition({ x: rect.left + 48, y: rect.top + 48 }) : { x: 0, y: 0 }
      const item = makeItem({ type: 'comment', x: at.x, y: at.y, w: 200, h: 64, text, ...(data ? { data } : {}) })
      setOpenComment(item.id, true)
      void commit([{ kind: 'add', item }], 'commented on the board')
      return { id: item.id }
    },
    [board, commit, flow, setOpenComment],
  )

  const setCommentOpen = useCallback(
    (iid: string, open: boolean) => {
      setOpenComment(iid, open)
      const read = open && board ? threadOf(board, iid).flatMap((m) => (isUnread(m, 'user') ? [markSeen(m, 'user')!] : [])) : []
      if (read.length) void commit(read, 'read a comment', { undoable: false })
    },
    [board, commit, setOpenComment],
  )

  // a script block's "open the source": select it, and the Inspector opens the large view (docs/studio.md §9)
  const [sourceRequest, setSourceRequest] = useState<{ id: string; mode: 'view' | 'edit'; n: number } | null>(null)

  const startEdit = useCallback(
    (iid: string) => {
      if (board?.items[iid]?.type === 'comment') setCommentOpen(iid, true)
      setEditingId(iid)
    },
    [board, setCommentOpen],
  )

  const commitLabel = useCallback(
    (iid: string, label: string) => {
      setEditingId(null)
      const it = board?.items[iid]
      if (!it || (it.label ?? it.text ?? '') === label) return
      if (board && isFlowWire(board, it)) return void commit([relabelOp(board, it, label, new Date().toISOString())], `proposed '${label.slice(0, 40)}'`)
      void commit([{ kind: 'update', id: iid, patch: { label } }], `labelled an arrow '${label.slice(0, 40)}'`)
    },
    [board, commit],
  )

  const bend = useCallback(
    (iid: string, point: { x: number; y: number }) => {
      const it = board?.items[iid]
      if (!it) return
      void commit([{ kind: 'update', id: iid, patch: { data: { ...it.data, bend: { x: Math.round(point.x), y: Math.round(point.y) } } } }], 'rerouted an arrow')
    },
    [board, commit],
  )

  const resize = useCallback(
    (iid: string, rect: { x: number; y: number; width: number; height: number }) => {
      const it = board?.items[iid]
      if (!board || !it) return
      const abs = absolutePosition(board, iid, rect)
      const next = { x: Math.round(abs.x), y: Math.round(abs.y), w: Math.round(rect.width), h: Math.round(rect.height) }
      const patch: Partial<Item> = {}
      for (const k of ['x', 'y', 'w', 'h'] as const) if (next[k] !== Math.round(it[k])) patch[k] = next[k]
      if (patch.h !== undefined && SCALES_FONT.has(it.type)) patch.fontSize = scaledFont(it, next.h)
      if (!Object.keys(patch).length) return
      void commit([{ kind: 'update', id: iid, patch }], `resized '${(it.text ?? it.type).slice(0, 40)}'`)
    },
    [board, commit],
  )

  const deleteItems = useCallback(
    (targets: string[]) => {
      if (!board || !targets.length) return
      // a flow wire picked on its own is not removed: its removal is proposed (docs/studio.md §7);
      // one already proposed for removal stays as it is (Undo in the panel takes it back)
      const now = new Date().toISOString()
      const flowWires = targets.filter((t) => isFlowWire(board, board.items[t]))
      const proposed = flowWires.filter((t) => pendingOf(board.items[t])?.kind !== 'remove')
      const ids = new Set<string>()
      for (const sid of targets) {
        if (flowWires.includes(sid)) continue
        if (!board.items[sid]) continue
        ids.add(sid)
        // children and attached comments / arrows go with their container
        for (const it of Object.values(board.items)) {
          if ((it.parent === sid && it.type !== 'comment') || it.target === sid || it.from === sid || it.to === sid) ids.add(it.id)
        }
      }
      for (const it of Object.values(board.items)) if (it.type === 'comment' && ids.has(threadRoot(board, it.id)?.id ?? '')) ids.add(it.id)
      const ops: Op[] = proposed.flatMap((t) => removeOps(board, board.items[t], now))
      for (const i of ids) if (!ops.some((o) => o.kind === 'update' && o.id === i)) ops.push({ kind: 'remove', id: i })
      if (!ops.length) return
      void commit(
        ops,
        proposed.length && ids.size === 0 ? `proposed removing ${proposed.length} wire${proposed.length === 1 ? '' : 's'}` : `deleted ${ids.size} item${ids.size === 1 ? '' : 's'}`,
      )
      // keep a wire whose removal was just proposed selected, so the panel shows the proposal
      select(ids.size === 0 ? flowWires : [])
    },
    [board, commit, select],
  )
  const deleteSelection = useCallback(() => deleteItems(selectedIds), [deleteItems, selectedIds])

  // "Copy as image": the given items (a frame with its contents, the wires between them) as a PNG on the clipboard
  const copyAsImage = useCallback(
    async (ids: string[]) => {
      const root = wrapRef.current?.querySelector<HTMLElement>('.react-flow')
      if (!board || !root || !ids.length) return
      const { nodes, edges } = captureIds(board, ids)
      if (!nodes.size) return
      const bounds = flow.getNodesBounds([...nodes])
      try {
        const how = await copySelectionAsImage({ root, nodes, edges, bounds, fileName: imageFileName(board.title) })
        store.toast(how === 'copied' ? 'Copied as image' : 'Downloaded as image (the clipboard is not available here)')
      } catch (err) {
        store.toast(`Could not make an image: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    },
    [board, flow, store],
  )

  const undoWire = useCallback(
    (iid: string) => {
      const it = board?.items[iid]
      if (!board || !it) return
      const ops = undoOps(board, it)
      if (ops.length) void commit(ops, 'undid a wire proposal')
    },
    [board, commit],
  )
  const pickWireEvent = useCallback(
    (iid: string, event: string) => {
      const it = board?.items[iid]
      const op = board && it ? pickEventOp(board, it, event, new Date().toISOString()) : undefined
      if (op) void commit([op], `picked '${event.slice(0, 40)}' for a wire`)
    },
    [board, commit],
  )

  /** Copy items with new ids, offset +20/+20, keeping colour and parent. Arrows between copied items are copied too. */
  const duplicate = useCallback(
    (targets: string[]) => {
      if (!board) return
      const map = new Map<string, string>()
      const ops: Op[] = []
      const now = new Date().toISOString()
      const src = targets.map((t) => board.items[t]).filter((it): it is Item => Boolean(it) && it.type !== 'arrow' && it.type !== 'comment')
      for (const it of src) map.set(it.id, newId(it.type[0]))
      for (const it of src) {
        const parent = it.parent && map.has(it.parent) ? map.get(it.parent) : it.parent
        ops.push({ kind: 'add', item: { ...it, id: map.get(it.id)!, x: it.x + 20, y: it.y + 20, parent, createdBy: 'user', updatedBy: 'user', updatedAt: now } })
      }
      for (const it of Object.values(board.items)) {
        if (it.type === 'arrow' && it.from && it.to && map.has(it.from) && map.has(it.to)) {
          ops.push({ kind: 'add', item: { ...it, id: newId('a'), from: map.get(it.from), to: map.get(it.to), createdBy: 'user', updatedBy: 'user', updatedAt: now } })
        }
      }
      if (!ops.length) return
      void commit(ops, `duplicated ${src.length} item${src.length === 1 ? '' : 's'}`)
      select([...map.values()])
    },
    [board, commit, select],
  )

  // keyboard alternative to dragging: nudge the selection
  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!board) return
      const ops: Op[] = []
      for (const sid of selectedIds) {
        const it = board.items[sid]
        if (!it || it.type === 'arrow') continue
        ops.push({ kind: 'update', id: sid, patch: { x: it.x + dx, y: it.y + dy } })
      }
      if (ops.length) void commit(ops, `nudged ${ops.length} item${ops.length === 1 ? '' : 's'}`)
    },
    [board, selectedIds, commit],
  )

  const moveToContainer = useCallback(
    (iid: string, containerId: string | null) => {
      if (!board) return
      const it = board.items[iid]
      if (!it) return
      const patch: Partial<Item> = { parent: containerId ?? undefined }
      const c = containerId ? board.items[containerId] : undefined
      if (c && isContainer(c)) {
        const inside = it.x >= c.x && it.y >= c.y && it.x + it.w <= c.x + c.w && it.y + it.h <= c.y + c.h
        if (!inside) {
          patch.x = c.x + 16
          patch.y = c.y + 40
        }
      }
      void commit([{ kind: 'update', id: iid, patch }], c ? `moved '${(it.text ?? it.type).slice(0, 40)}' into '${c.text ?? c.type}'` : `took '${(it.text ?? it.type).slice(0, 40)}' out of its lane`)
    },
    [board, commit],
  )

  const recolor = useCallback(
    (iid: string, c: ColorToken) => {
      const it = board?.items[iid]
      if (!it || it.color === c) return
      void commit([{ kind: 'update', id: iid, patch: { color: c } }], `recoloured '${(it.text ?? it.type).slice(0, 40)}' ${c}`)
    },
    [board, commit],
  )

  const handoff = useCallback(async () => {
    if (!store.agentWatching) return
    await store.handoff()
    setHanded(true)
    setTimeout(() => setHanded(false), 2000)
  }, [store])

  /** "Ask agent": comment on the item, then hand the board over so the agent wakes now. */
  const askAgent = useCallback(
    (iid: string) => {
      const r = addComment(iid, '')
      if (!r) return
      setTool('select')
      select([iid])
      setEditingId(r.id)
      pendingAsk.current = r.id
    },
    [addComment, select],
  )
  // the comment created by "Ask agent" hands off once its text is saved
  const pendingAsk = useRef<string | null>(null)

  // the current selection, read by openMenu without re-creating the edit API on every selection change
  const selectedRef = useRef<string[]>([])
  selectedRef.current = selectedIds
  const openMenu = useCallback(
    (iid: string, x: number, y: number) => {
      // right-clicking inside a multi-selection keeps it, so the menu (e.g. "Copy 3 items as image") acts on all of it
      if (!selectedRef.current.includes(iid)) select([iid])
      setMenu({ itemId: iid, x, y, returnTo: document.activeElement as HTMLElement | null })
    },
    [select],
  )

  const editApi = useMemo<EditApi>(
    () => ({
      editingId,
      startEdit,
      commitLabel,
      resize,
      bend,
      setCommentOpen,
      cancelEdit: () => {
        pendingAsk.current = null
        setEditingId(null)
      },
      commitText: (iid, text, andContinue) => {
        setEditingId(null)
        const draft = draftComment?.id === iid ? draftComment : undefined
        const it = board?.items[iid] ?? draft
        if (!it) return
        const changed = (it.text ?? '') !== text && (!draft || Boolean(text.trim()))
        const patch: Partial<Item> = it.type === 'comment' && it.createdBy === 'user' ? { text, data: { ...it.data, seenBy: [] } } : { text }
        const saved = !changed
          ? Promise.resolve(undefined)
          : draft
            ? commit([{ kind: 'add', item: { ...draft, text } }], `commented '${text.slice(0, 40)}'`)
            : commit([{ kind: 'update', id: iid, patch }], `edited '${text.slice(0, 40)}'`)
        if (pendingAsk.current === iid) {
          pendingAsk.current = null
          if (text.trim()) void saved.then(() => handoff())
        }
        if (andContinue && (it.type === 'sticky' || it.type === 'card')) {
          const sib = makeItem({ ...it, id: newId(it.type[0]), y: it.y + it.h + 12, text: '', createdBy: 'user', updatedBy: 'user' })
          void commit([{ kind: 'add', item: sib }], 'added a sticky below')
          select([sib.id])
          setEditingId(sib.id)
        }
      },
      attachTarget:
        tool === 'comment'
          ? (iid) => {
              const r = addComment(iid, '')
              setTool('select')
              if (r) setEditingId(r.id)
            }
          : null,
      openMenu,
      reply: (rootId, text) => {
        if (text.trim()) addComment(rootId, text.trim())
      },
      openSource: (iid, mode) => {
        select([iid])
        setSourceRequest({ id: iid, mode, n: Date.now() })
      },
    }),
    [editingId, board, draftComment, commit, tool, addComment, openMenu, handoff, select, startEdit, commitLabel, resize, bend, setCommentOpen],
  )

  // ---- keyboard (capture phase so arrow keys reach us before React Flow's own handler)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)
      if (menu || helpOpen) return
      // A text view or the source dialog handles its own keys (arrows move lines, not items; ⌘Z is the editor's).
      if (target?.closest?.('[data-no-board-keys]')) return
      if (e.key === 'Escape') {
        setEditingId(null)
        setTool('select')
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setGotoOpen(true)
        return
      }
      if (typing || editingId) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c' && selectedIds.length) {
        e.preventDefault()
        void copyAsImage(selectedIds)
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicate(selectedIds)
        return
      }
      if (e.key.startsWith('Arrow') && selectedIds.length) {
        e.preventDefault()
        e.stopPropagation()
        const step = e.shiftKey ? 50 : 10
        if (e.key === 'ArrowLeft') nudge(-step, 0)
        else if (e.key === 'ArrowRight') nudge(step, 0)
        else if (e.key === 'ArrowUp') nudge(0, -step)
        else if (e.key === 'ArrowDown') nudge(0, step)
        return
      }
      if (e.key === 'Enter' && !mod && selectedIds.length === 1 && board?.items[selectedIds[0]]) {
        e.preventDefault()
        e.stopPropagation()
        startEdit(selectedIds[0])
        return
      }
      if (e.key === 'F10' && e.shiftKey && selectedIds.length === 1 && board) {
        const it = board.items[selectedIds[0]]
        if (it) {
          e.preventDefault()
          const p = flow.flowToScreenPosition({ x: it.x + it.w / 2, y: it.y + it.h / 2 })
          openMenu(it.id, p.x, p.y)
        }
        return
      }
      if (mod || e.altKey) return
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
      } else if (e.key === 's') addItem('sticky')
      else if (e.key === 't') addItem('text')
      else if (e.key === 'f') addItem('frame')
      else if (e.key === 'c') setTool((t) => (t === 'comment' ? 'select' : 'comment'))
      else if (e.key === '1') flow.fitView({ padding: 0.15, duration: 300 })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editingId, deleteSelection, addItem, flow, nudge, selectedIds, store, duplicate, menu, helpOpen, board, openMenu, startEdit, copyAsImage])

  // first load → fit, or centre the deep-linked item (?focus=<id>)
  const fitted = useRef(false)
  useEffect(() => {
    if (!board || fitted.current || !derived.nodes.length) return
    fitted.current = true
    const params = new URLSearchParams(location.search)
    const focus = params.get('focus')
    const frameKey = params.get('frame')
    const it = focus ? board.items[focus] : undefined
    const frame = frameKey ? board.items[`diagram.${frameKey}`] : undefined
    setTimeout(() => {
      if (frame && !it) {
        goTo([frame.id])
      } else if (it) {
        select([it.id])
        flow.setCenter(it.x + it.w / 2, it.y + it.h / 2, { zoom: 1 })
      } else {
        flow.fitView({ padding: 0.15 })
      }
    }, 30)
  }, [board, derived.nodes.length, flow, select, goTo])

  // double-click on empty paper → sticky at the cursor, in edit mode
  const onWrapDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.classList.contains('react-flow__pane')) return
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addItem('sticky', p)
    },
    [flow, addItem],
  )

  if (store.error) {
    return (
      <div className="app">
        <Header store={store} title="Board" kind="" panelOpen={false} setPanelOpen={() => undefined} onHandoff={handoff} handed={false} />
        <div className="list-page" style={{ gridColumn: '1 / -1' }}>
          <div className="empty">Could not load this board: {store.error}</div>
        </div>
      </div>
    )
  }
  if (!board) {
    return (
      <div className="app">
        <Header store={store} title="Loading board" kind="" panelOpen={false} setPanelOpen={() => undefined} onHandoff={handoff} handed={false} />
      </div>
    )
  }

  const selectedId = selectedIds.length === 1 && board.items[selectedIds[0]] ? selectedIds[0] : null
  const menuItem = menu ? board.items[menu.itemId] : undefined

  return (
    <div className={`app ${panelOpen ? 'panel-open' : ''}`} style={{ '--panel-w': `${panelWidth}px` } as CSSProperties}>
      <Header store={store} title={board.title} kind={KIND_NAMES[board.kind] ?? board.kind} panelOpen={panelOpen} setPanelOpen={setPanelOpen} onHandoff={handoff} handed={handed} onGoTo={() => setGotoOpen(true)} />
      <Rail
        color={color}
        setColor={setColor}
        tool={tool}
        setTool={setTool}
        onToast={(t) => store.toast(t)}
        onAdd={(k) => addItem(k)}
        onDelete={deleteSelection}
        selectedCount={selectedIds.length}
        onFit={() => flow.fitView({ padding: 0.15, duration: 300 })}
        onUndo={store.undo}
        onRedo={store.redo}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        onHelp={() => setHelpOpen(true)}
      />
      <div className="canvas-wrap" ref={wrapRef} onDoubleClick={onWrapDoubleClick}>
        <EditContext.Provider value={editApi}>
          <ReactFlow
            nodes={shownNodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onReconnect={onReconnect}
            connectionMode={ConnectionMode.Loose}
            onEdgeDoubleClick={(e, edge) => {
              e.stopPropagation()
              startEdit(edge.id)
            }}
            onSelectionChange={onSelectionChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onNodeContextMenu={(e, n) => {
              e.preventDefault()
              openMenu(n.id, e.clientX, e.clientY)
            }}
            onSelectionContextMenu={(e, sel) => {
              e.preventDefault()
              if (sel[0]) openMenu(sel[0].id, e.clientX, e.clientY)
            }}
            onPaneClick={() => {
              setEditingId(null)
              if (tool === 'comment') setTool('select')
            }}
            elevateEdgesOnSelect
            snapToGrid
            snapGrid={GRID}
            minZoom={0.05}
            maxZoom={3}
            deleteKeyCode={null}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnDrag={[1]}
            multiSelectionKeyCode={MULTI_SELECT_KEYS}
            panOnScroll
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
            style={{ cursor: tool === 'comment' ? 'crosshair' : undefined }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--paper-dot)" />
            <Controls showInteractive={false} position="bottom-right" />
            <FrozenHeaders board={board} />
            <MiniMap pannable zoomable position="bottom-left" nodeColor={(n) => `var(--c-${(n.data as { item?: Item })?.item?.color ?? 'grey'})`} />
          </ReactFlow>
        </EditContext.Provider>
        {Object.keys(board.items).length === 0 && !draftComment && <EmptyBoardHint />}
        <RunOverlay board={board} />
        <FocusBanner
          board={board}
          request={store.focusRequest}
          follow={follow}
          onFollow={(on) => {
            setFollow(on)
            writeFollow(on)
          }}
          onGo={goToRequest}
          onDismiss={store.clearFocus}
        />
        <GoToPalette board={board} open={gotoOpen} onClose={() => setGotoOpen(false)} onGo={(t) => goTo([t.id])} />
        {tool === 'comment' && <div className="hint">Click an item to comment on it. Esc cancels.</div>}
        {store.storageError && (
          <div className="storage-banner" role="alert">
            Changes are not being saved: {store.storageError}. Keep this tab open and check the canvas server's boards folder.
          </div>
        )}
        <div className="toasts" aria-live="polite">
          {store.toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
              {t.text}
            </div>
          ))}
        </div>
      </div>
      <div className="panel-slot">
        <PanelResizer width={panelWidth} onWidth={setPanelWidth} />
        <SidePanel
          board={board}
          changes={store.changes}
          selectedId={selectedId}
          selectedIds={selectedIds}
          sourceRequest={sourceRequest}
          onHoverItems={onHoverItems}
          onReveal={reveal}
          onComment={(tid, text) => void addComment(tid, text)}
          onChat={(ids, text, model) => void (ids.length ? addComment(ids[0], text, { discuss: { model, about: ids } }) : addBoardComment(text, { discuss: { model, about: [] } }))}
          onWireChat={(ids, text, model, proposal) => void addComment(ids[0], text, { discuss: { model, about: ids, proposal } })}
          onUndoWire={undoWire}
          onDismiss={(id) => void commit([{ kind: 'remove', id }], 'dismissed a proposed story')}
          onPickWireEvent={pickWireEvent}
          onReply={(rootId, text) => void addComment(rootId, text)}
          onAnchoredComment={(target, text, anchor, discuss) => void addComment(target, text, { anchor, ...(discuss ? { discuss: { model: discuss.model, about: [target], ...(discuss.edit ? { edit: discuss.edit } : {}) } } : {}) })}
          onEditText={(iid, text) => (board.items[iid]?.type === 'arrow' ? commitLabel(iid, text) : editApi.commitText(iid, text))}
          onMoveToContainer={moveToContainer}
          onLocate={(ids) => {
            locate(ids)
            select(ids)
          }}
          onToast={(t) => store.toast(t)}
          onSelect={(sid) => {
            select(sid ? [sid] : [])
            if (sid) {
              const it = board.items[sid]
              // a wire has no place of its own on the board: show its two ends
              if (it?.type === 'arrow') locate([it.from, it.to].filter((x): x is string => !!x))
              else if (it) flow.setCenter(it.x + it.w / 2, it.y + it.h / 2, { zoom: Math.max(flow.getZoom(), 0.8), duration: 300 })
            }
          }}
        />
      </div>
      {menu && menuItem && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onComment={(iid) => {
            const r = addComment(iid, '')
            if (r) setEditingId(r.id)
          }}
          onAsk={askAgent}
          onEdit={startEdit}
          onColor={recolor}
          onDuplicate={(iid) => duplicate([iid])}
          onDelete={(iid) => deleteItems([iid])}
          onCopyImage={(iid) => void copyAsImage(selectedIds.includes(iid) ? selectedIds : [iid])}
          copyCount={selectedIds.includes(menu.itemId) ? selectedIds.length : 1}
          canColor={COLOURABLE.has(menuItem.type)}
          askEnabled={store.agentWatching}
        />
      )}
      {helpOpen && <ShortcutsSheet onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

function Header({
  store,
  title,
  kind,
  panelOpen,
  setPanelOpen,
  onHandoff,
  handed,
  onGoTo,
}: {
  store: ReturnType<typeof useBoard>
  title: string
  kind: string
  panelOpen: boolean
  setPanelOpen: (b: boolean) => void
  onHandoff: () => void
  handed: boolean
  onGoTo?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const canEdit = Boolean(store.board)
  return (
    <header className="header">
      <a
        className="home back"
        href="/"
        onClick={(e) => {
          e.preventDefault()
          navigate('/')
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Boards
      </a>
      {editing ? (
        <input
          className="title-input"
          aria-label="Board title"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              if (draft.trim() && draft.trim() !== title) void store.setTitle(draft)
              setEditing(false)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="title-btn"
          disabled={!canEdit}
          aria-label={`Board title: ${title}. Click to rename`}
          onClick={() => {
            setDraft(title)
            setEditing(true)
          }}
        >
          <span className="title" title={title}>
            {title}
          </span>
        </button>
      )}
      {kind && <span className="kind">{kind}</span>}
      <span className="spacer" />
      <span className="presence" role="status">
        <span className={`dot ${store.agentWatching ? 'watching' : ''}`} aria-hidden="true" />
        <span className="label">{store.agentWatching ? 'Agent is watching' : 'Agent is away'}</span>
      </span>
      {store.board && <StudioControl boardId={store.board.id} />}
      {handed ? (
        <span className="handed" role="status">
          Handed to agent
        </span>
      ) : (
        <button
          type="button"
          className="primary handoff"
          disabled={!store.agentWatching}
          data-tip="Agent is not watching"
          onClick={onHandoff}
        >
          Hand to agent
        </button>
      )}
      {onGoTo && (
        <button type="button" className="ghost goto-btn" onClick={onGoTo} aria-keyshortcuts="Meta+K Control+K" title="Go to a frame or item (⌘K / Ctrl+K)">
          Go to…
        </button>
      )}
      <a className="home" href="/docs">
        Docs
      </a>
      <span className="status seq" title="Number of changes so far">
        <span className="mono">seq {store.board?.seq ?? 0}</span>
      </span>
      <span className="status" role="status">
        <span className={`dot ${store.connected ? 'on' : 'off'}`} aria-hidden="true" />
        {store.connected ? 'live' : 'offline'}
      </span>
      <button className="ghost" aria-pressed={panelOpen} aria-controls="board-panel" onClick={() => setPanelOpen(!panelOpen)}>
        {panelOpen ? 'Hide panel' : 'Show panel'}
      </button>
    </header>
  )
}

export function navigate(path: string) {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
