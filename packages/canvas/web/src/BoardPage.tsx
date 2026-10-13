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
  useStoreApi,
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
import { isUnread, markSeen, newId, ownLock, layoutLock, LAYOUT_LOCK } from '../../src/model'
import { ContextMenu, type MenuState } from './components/ContextMenu'
import { Rail, type Tool } from './components/Rail'
import { ShortcutsSheet } from './components/ShortcutsSheet'
import { SidePanel } from './components/SidePanel'
import { EditContext, type EditApi } from './flow/EditContext'
import { absolutePosition, boardToFlow, containerAt, isContainer, threadOf, threadRoot, type ItemNode } from './flow/boardToFlow'
import { alignKanban, snapColumns } from './flow/kanbanAlign'
import { bandSelection, rectBetween, type BandNode } from './flow/bandSelect'
import { SCALES_FONT, scaledFont } from './flow/font'
import { edgeTypes } from './flow/ItemEdge'
import { nodeTypes } from './flow/nodes'
import { useStoredSet } from './flow/storedSet'
import { AnnotationsControls, NotesControls, TodosControls, TraceControls, TRACE_MODE_NAMES, WireBadgeContext, WireControls, MODE_NAMES, useAnnotationsMode, useNotesMode, useTodosMode, useTraceView, useWireView } from './flow/WireControls'
import { applyTraceView, traceCounts, TRACE_MODES } from './flow/traceView'
import { calloutCommentOf, hasComments, notesShown, NOTES_MODE_NAMES, type CommentShown, type NotesMode } from './flow/notesView'
import { annotateHint, annotateWhere, ANNOTATIONS_MODE_NAMES, besideItem, boardAnnotation, freeSpotBeside, draftHolder, draftSize, hasAnnotations, isAnnotation, litMarks, marksByTarget, type AnnotationsMode, type ItemMarks } from './flow/annotationsView'
import { checkOffOps, hasTodos, newTodo, reopenOps, todoSize, todoVisible, TODOS_MODE_NAMES, type TodosMode } from './flow/todoView'
import { todoOf } from '../../src/annotations'
import { displayName, responderName, responderOf } from '../../src/routing'
import { api } from './api'
import { sha1 } from './inspector/diff'
import { MarkInput, type MarkInputState } from './components/MarkInput'
import { itemLink } from './itemLink'
import { copyText } from './clipboard'
import { sameWorkObject } from './diagrams/sameObject'
import { applyWireMode, catchAllWires, type WireBadge } from './flow/catchAll'
import { useBoard } from './store'
import { RunOverlay } from './run/RunOverlay'
import { PanelResizer, usePanelWidth } from './components/PanelResizer'
import { isUiElement, uiRemoveOps, uiRemovedIds, uiTextOp, uiUndoOps } from './diagrams/uiProposal'
import { deletedOf, diagramRemoveOps, undoDeleteOps } from './diagrams/deleteProposal'
import { addWire, isFlowWire, pendingOf, pickEventOp, relabelOp, removeOps, rewireOp, undoOps } from './inspector/pending'
import { StudioControl } from './components/StudioControl'
import { ResponderControl } from './components/BoardAgents'
import { isWorkflowScope } from './diagrams/frame'
import { FrozenHeaders } from './flow/FrozenHeaders'
import { captureIds, copySelectionAsImage, imageFileName } from './flow/copyImage'
import { GoToPalette } from './components/GoToPalette'
import { FocusBanner, readFollow, writeFollow } from './components/FocusBanner'
import { EmptyBoardHint } from './components/AskHints'
import type { FocusRequest } from './store'
import { ReplayBar } from './components/ReplayBar'
import { applyReplay, replay, replayFrameOf, useReplay } from './flow/replay'
import { buildReplay } from './diagrams/replay'
import { reuse, sameEdge, sameNode } from './flow/reuse'
import { useViewHistory } from './flow/useViewHistory'
import { PlayBar } from './components/PlayBar'
import { applyPlay, play, playFrameOf, usePlay } from './flow/uiPlay'
import { buildPlay, reconcilePlay } from './diagrams/uiPlay'
import { boardClickTags, clickTags, uiMockFrames, type ClickTag } from './diagrams/uiClickable'
import { applyClickable, clickable, clickHint, clickLooks, useClickable, useClickHint, type ClickOn } from './flow/clickableView'

const GRID: [number, number] = [10, 10]
const MULTI_SELECT_KEYS = ['Meta', 'Control', 'Shift']

const KIND_NAMES: Record<string, string> = {
  'event-storming': 'Event storming',
  'user-story-map': 'User story map',
  'user-journey': 'User journey',
  'ui-mock': 'UI mock',
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
const NO_PULSE: ReadonlySet<string> = new Set()
const NO_COMMENTS: ReadonlyMap<string, CommentShown> = new Map()
const NO_MARKS: ReadonlyMap<string, ItemMarks> = new Map()
const NO_CLICK_TAGS: ReadonlyMap<string, ClickTag> = new Map()
const sameShown = (a: ReadonlyMap<string, CommentShown>, b: ReadonlyMap<string, CommentShown>) => {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}
const PRO_OPTIONS = { hideAttribution: true }
const CROSSHAIR: CSSProperties = { cursor: 'crosshair' }
const miniMapColor = (n: Node) => `var(--c-${(n.data as { item?: Item })?.item?.color ?? 'grey'})`

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
  // a callout card a pin click asked for (Notes: badges draws it only then): selected, alone, once it is drawn
  const cardWhenDrawn = useRef<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [color, setColor] = useState<ColorToken>('yellow')
  const [tool, setTool] = useState<Tool>('select')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 900)
  const [panelWidth, setPanelWidth] = usePanelWidth()
  // connect notifications (AccessCenter) sit in the canvas area: below the header, left of the open panel
  useEffect(() => {
    const root = document.documentElement.style
    const phone = window.matchMedia('(max-width: 720px)').matches
    root.setProperty('--access-top', 'calc(var(--header-h) + 12px)')
    root.setProperty('--access-right', panelOpen && !phone ? `${panelWidth}px` : '0px')
    return () => {
      root.removeProperty('--access-top')
      root.removeProperty('--access-right')
    }
  }, [panelOpen, panelWidth])
  const [nodes, setNodes] = useState<ItemNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [openComments, setOpenComment] = useStoredSet(`awd.canvas.open-comments.${id}`)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [gotoOpen, setGotoOpen] = useState(false)
  const [follow, setFollow] = useState(readFollow)
  const [handed, setHanded] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // which wires this viewer sees (all / selected / none) and whether catch-all listeners are drawn or badges
  const [wireView, setWireView, cycleWires] = useWireView()
  const [expandedWires, setExpandedWires] = useState<Set<string>>(() => new Set())
  // which traces this viewer sees (flow/traceView.ts); a hovered element shows its traces like a selected one
  const [traceView, setTraceView] = useTraceView()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [openBundles, setOpenBundles] = useState<Set<string>>(() => new Set())
  // which comments this viewer sees (flow/notesView.ts): all / badges / none; `expandedNotes` are the threads opened
  // in this session beyond the stored set — a settled proposal's ✓, a badge in `badges` mode, a card shown from its
  // pin — and empty again on a mode change. Annotations (all / pins / none) and TODOs (open / all / none) have their own.
  const [notesMode, setNotesModeStored, cycleNotesStored] = useNotesMode()
  const [annotationsMode, setAnnotationsModeStored, cycleAnnotationsStored] = useAnnotationsMode()
  const [todosMode, setTodosModeStored, cycleTodosStored] = useTodosMode()
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(() => new Set())
  const foldAll = useCallback(() => setExpandedNotes((prev) => (prev.size ? new Set() : prev)), [])
  const setNotesMode = useCallback(
    (m: NotesMode) => {
      setNotesModeStored(m)
      foldAll()
    },
    [setNotesModeStored, foldAll],
  )
  const cycleNotes = useCallback(() => {
    foldAll()
    return cycleNotesStored()
  }, [cycleNotesStored, foldAll])
  const setAnnotationsMode = useCallback(
    (m: AnnotationsMode) => {
      setAnnotationsModeStored(m)
      foldAll()
    },
    [setAnnotationsModeStored, foldAll],
  )
  const cycleAnnotations = useCallback(() => {
    foldAll()
    return cycleAnnotationsStored()
  }, [cycleAnnotationsStored, foldAll])
  const setTodosMode = useCallback(
    (m: TodosMode) => {
      setTodosModeStored(m)
      foldAll()
    },
    [setTodosModeStored, foldAll],
  )
  const cycleTodos = useCallback(() => {
    foldAll()
    return cycleTodosStored()
  }, [cycleTodosStored, foldAll])
  const toggleBadge = useCallback(
    (b: WireBadge) =>
      setExpandedWires((prev) => {
        const next = new Set(prev)
        for (const w of b.wires) if (b.open) next.delete(w)
        else next.add(w)
        return next
      }),
    [],
  )

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
  // kanban columns line up and grow to hold their cards, as shown (flow/kanbanAlign.ts); geometry for drags and resizes is read from this too
  const laid = useMemo(() => (shown ? alignKanban(shown) : shown), [shown])
  // the agent-change wash (pulse) is laid over the nodes below (shownNodes), so its coming and going (1.2 s later)
  // does not rebuild the whole flow graph — only the washed nodes change
  // how each thread is drawn, computed once per change (flow/notesView.ts); the same Map while it says the same, so
  // starting or ending an edit that changes nothing here does not rebuild the flow graph
  const shownRef = useRef(NO_COMMENTS)
  const commentsShown = useMemo(() => {
    const next = laid ? notesShown(laid, { mode: notesMode, annotations: annotationsMode, todos: todosMode, open: openComments, expanded: expandedNotes, editing: editingId }) : NO_COMMENTS
    if (sameShown(shownRef.current, next)) return shownRef.current
    return (shownRef.current = next)
  }, [laid, notesMode, annotationsMode, todosMode, openComments, expandedNotes, editingId])
  // the annotation pins and TODO markers on every item, once per board change (flow/annotationsView.ts): node data, so
  // only the items whose marks changed are drawn again
  const marks = useMemo(() => (laid ? marksByTarget(laid, { annotations: annotationsMode, todos: todosMode }) : NO_MARKS), [laid, annotationsMode, todosMode])
  const derived = useMemo(() => (laid ? boardToFlow(laid, NO_PULSE, commentsShown, { show: wireView.catchAll, expanded: expandedWires }, marks) : { nodes: [], edges: [] as Edge[] }), [laid, commentsShown, wireView.catchAll, expandedWires, marks])
  const hasCatchAll = useMemo(() => (board ? catchAllWires(board).size > 0 : false), [board])
  const anyComments = useMemo(() => (board ? hasComments(board) : false), [board])
  const anyAnnotations = useMemo(() => (board ? hasAnnotations(board) : false), [board])
  const anyTodos = useMemo(() => (board ? hasTodos(board) : false), [board])
  useEffect(() => {
    const card = cardWhenDrawn.current && derived.nodes.some((n) => n.id === cardWhenDrawn.current) ? cardWhenDrawn.current : null
    if (card) cardWhenDrawn.current = null
    // a node or wire that says the same as before stays the same object (flow/reuse.ts), so React Flow re-measures
    // and re-renders only what the change touched
    setNodes((prev) => {
      const sel = card ? new Set([card]) : new Set(prev.filter((n) => n.selected).map((n) => n.id))
      const next = reuse(prev, derived.nodes.map((n) => ({ ...n, selected: sel.has(n.id) })), sameNode)
      // reuse keeps an earlier node whatever its `selected`: the card is selected alone
      return card ? next.map((n) => (Boolean(n.selected) === sel.has(n.id) ? n : { ...n, selected: sel.has(n.id) })) : next
    })
    setEdges((prev) => {
      const sel = card ? new Set<string>() : new Set(prev.filter((e) => e.selected).map((e) => e.id))
      const next = reuse(prev, derived.edges.map((e) => ({ ...e, selected: sel.has(e.id) || e.id === selectWhenDrawn.current })), sameEdge)
      return card ? next.map((e) => (e.selected ? { ...e, selected: false } : e)) : next
    })
    if (card) setSelectedIds([card])
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
  // annotations, drafts and TODOs (flow/annotationsView.ts; a UI mock's callouts, docs/diagrams.md §6c): a marker under
  // the pointer lights its card through panelHover, a card under the pointer outlines its marker; only the item holding
  // that marker gets a new node (`markLit`, and `calloutLit` for a UI mock element's numbered pin)
  const [cardHover, setCardHover] = useState<string | null>(null)
  const litPins = useMemo(() => litMarks(board ?? undefined, cardHover ? [...panelHover, cardHover] : panelHover), [board, panelHover, cardHover])
  // a marker or card that goes away under the pointer (Shift+N / A / T) never says it was left: nothing stays lit
  useEffect(() => {
    setCardHover(null)
    onHoverItems([])
  }, [notesMode, annotationsMode, todosMode, onHoverItems])
  // "show it on the board" from a panel link: the view moves there and the item flashes for a moment
  const [flashIds, setFlashIds] = useState<string[]>([])
  const hasTraces = useMemo(() => (board ? Object.values(board.items).some((it) => it.type === 'arrow' && it.role === 'trace') : false), [board])
  const traceBadges = useMemo(() => (board && hasTraces && traceView.badges ? traceCounts(board, traceView) : undefined), [board, hasTraces, traceView])
  // the elements pointing at which changes what is drawn: an end of a trace while the trace view follows the
  // selection (faded / selected / bundled), and a domain story's work objects; a hover anywhere else is not tracked,
  // so it does not re-render the board (the view would come out the same)
  const hoverable = useMemo(() => {
    const out = new Set<string>()
    if (!board) return out
    const traces = hasTraces && traceView.mode !== 'all' && traceView.mode !== 'none'
    for (const it of Object.values(board.items)) {
      if (it.data?.ds === 'object') out.add(it.id)
      else if (traces && it.type === 'arrow' && it.role === 'trace') {
        if (it.from) out.add(it.from)
        if (it.to) out.add(it.to)
      }
    }
    return out
  }, [board, hasTraces, traceView.mode])
  // a domain story draws one work object once per sentence: selecting or pointing at one lights up the others
  const sameObject = useMemo(() => {
    const out = new Set<string>()
    if (board) for (const id of hoverId ? [...selectedIds, hoverId] : selectedIds) for (const o of sameWorkObject(board, board.items[id])) out.add(o.id)
    return out
  }, [board, selectedIds, hoverId])
  // nodes the agent touched a moment ago get the wash: an item itself, or a thread's root for any message in it
  const pulsed = useMemo(() => {
    const out = new Set<string>()
    if (board) for (const id of pulse) out.add(board.items[id]?.type === 'comment' ? (threadRoot(board, id)?.id ?? id) : id)
    return out
  }, [board, pulse])
  const shownNodes = useMemo(() => {
    if (!panelHover.length && !flashIds.length && !traceBadges?.size && !sameObject.size && !pulsed.size && !litPins.size) return nodes
    const on = new Set([...panelHover, ...flashIds])
    return nodes.map((n) => {
      const count = traceBadges?.get(n.id)
      if (pulsed.has(n.id)) n = { ...n, data: { ...n.data, pulse: true } }
      const lit = litPins.get(n.id)
      if (lit !== undefined) n = { ...n, data: { ...n.data, markLit: lit.card, ...(lit.n !== undefined ? { calloutLit: lit.n } : {}) } }
      if (sameObject.has(n.id)) n = { ...n, className: `${n.className ?? ''} same-object` }
      if (!on.has(n.id) && !count) return n
      // the badge is drawn by CSS from the count (styles.css .has-traces), so every kind of node gets it
      return { ...n, className: `${n.className ?? ''}${on.has(n.id) ? ' panel-hover' : ''}${count ? ' has-traces' : ''}`, ...(count ? { style: { ...n.style, '--trace-badge': `"↗ ${count}"` } as CSSProperties } : {}) }
    })
  }, [nodes, panelHover, flashIds, traceBadges, sameObject, pulsed, litPins])

  // owns / delegates wires are agent relations, not events: faint unless one of their ends is selected (docs/studio.md §7)
  const shownEdges = useMemo(() => {
    // only workflow diagrams draw owns / delegates wires, on a workflow board or in a workflow frame
    if (!board) return edges
    const sel = new Set(selectedIds)
    const hover = new Set([...panelHover, ...flashIds])
    // the viewer's wire mode (flow/catchAll.ts applyWireMode): hidden wires are not drawn, so a copied image follows too
    const traced = hasTraces ? applyTraceView(edges, traceView, hoverId ? [...selectedIds, hoverId] : selectedIds, board, openBundles) : edges
    return applyWireMode(traced, wireView.mode, selectedIds, board).map((e) => {
      const role = board.items[e.id]?.role
      const lit = hover.has(e.id) ? ' panel-hover' : ''
      if (role !== 'owns' && role !== 'delegates') return lit ? { ...e, className: `${e.className ?? ''}${lit}` } : e
      const on = e.selected || sel.has(e.source) || sel.has(e.target)
      return { ...e, className: (on ? 'wire-agent on' : 'wire-agent') + lit }
    })
  }, [board, edges, selectedIds, panelHover, flashIds, wireView.mode, hasTraces, traceView, hoverId, openBundles])

  // a domain story being replayed (flow/replay.ts): only this viewer's view changes, nothing is stored
  const replayView = useReplay()
  const replayModel = useMemo(() => (replayView && laid ? buildReplay(laid, replayView.frameId) : undefined), [laid, replayView?.frameId])
  const played = useMemo(() => applyReplay(shownNodes, shownEdges, replayModel, replayView), [shownNodes, shownEdges, replayModel, replayView])
  const replayOn = useRef(false)
  replayOn.current = Boolean(replayView && replayModel?.steps.length)
  useEffect(() => {
    // a story that lost its sentences (or its frame) stops; a shorter one keeps its step inside the story
    if (replayView && replayModel && !replayModel.steps.length) replay.stop()
    else if (replayView && replayModel && replayView.step > replayModel.steps.length) replay.update({ step: replayModel.steps.length })
  }, [replayView, replayModel])
  useEffect(() => () => replay.stop(), [id])

  // a UI mock being played (flow/uiPlay.ts): the same — this viewer's view only; a replay and a play never run together
  const playState = usePlay()
  const playModel = useMemo(() => (playState && laid ? buildPlay(laid, playState.frameId) : undefined), [laid, playState?.frameId])
  const playedUi = useMemo(() => applyPlay(played.nodes, played.edges, playModel, playState), [played, playModel, playState])
  const playOn = useRef(false)
  playOn.current = Boolean(playState && playModel?.screens.length)
  useEffect(() => {
    // the first screen when play starts; a redraw that lost the screen on view goes back to one that exists, or stops
    if (!playState || !playModel) return
    const next = reconcilePlay(playModel, playState)
    if (!next) play.stop()
    else if (next !== playState) play.set(next)
  }, [playState, playModel])
  useEffect(() => {
    if (playState) replay.stop()
  }, [playState?.frameId])
  useEffect(() => {
    if (replayView) play.stop()
  }, [replayView?.frameId])
  useEffect(() => () => play.stop(), [id])
  // the screen on view while a mock plays: a click on the paper inside it led nowhere (Play's hint, below)
  const playScreen = useRef<Item | undefined>(undefined)
  playScreen.current = playOn.current && playState ? laid?.items[playState.screen] : undefined

  // Clickable (flow/clickableView.ts): every UI mock element a click leads from, outlined and tagged with its screen,
  // for this viewer only; in the frame being played Play's own look wins — its hint flashes the screen's hotspots
  // for a moment after a click that led nowhere, whether the switch is on or not
  const clickOn = useClickable()
  const hinting = useClickHint()
  const allClickTags = useMemo(() => (clickOn && laid ? boardClickTags(laid) : NO_CLICK_TAGS), [clickOn, laid])
  const hintIds = useMemo(() => {
    if (!hinting || !laid || !playModel || !playState) return undefined
    return [...clickTags(laid, playModel).keys()].filter((i) => playModel.screenOf.get(i) === playState.screen)
  }, [hinting, laid, playModel, playState?.screen])
  const playedFrame = playState && playModel?.screens.length ? playModel.screenOf : undefined
  const clickLook = useMemo(() => clickLooks(allClickTags, { on: clickOn, played: playedFrame, hint: hintIds }), [allClickTags, clickOn, playedFrame, hintIds])
  const clickCache = useRef(new WeakMap<ItemNode, { look: ClickOn; out: ItemNode }>())
  const viewNodes = useMemo(() => applyClickable(playedUi.nodes, clickLook, clickCache.current), [playedUi.nodes, clickLook])

  // ---- rubber band (flow/bandSelect.ts): a band drawn inside a frame selects the items in it, not the frame; Shift adds
  const rf = useStoreApi()
  const band = useRef<{ before: string[]; additive: boolean } | null>(null)
  const pointerAt = useRef<{ x: number; y: number } | null>(null)
  const pressed = useRef<{ before: string[]; additive: boolean }>({ before: [], additive: false })
  const onNodesChange = useCallback(
    (changes: NodeChange<ItemNode>[]) => {
      const b = band.current
      const start = rf.getState().userSelectionRect
      if (!b || !pointerAt.current || !start || !laid || !changes.some((c) => c.type === 'select')) {
        setNodes((ns) => applyNodeChanges(changes, ns))
        return
      }
      // the band in board coordinates: from where the drag began (startX/Y are flow coordinates) to the pointer
      const rect = rectBetween({ x: start.startX, y: start.startY }, flow.screenToFlowPosition(pointerAt.current))
      setNodes((ns) => {
        const next = applyNodeChanges(changes, ns)
        const info = new Map<string, BandNode>()
        for (const n of next) {
          const it = laid.items[n.id]
          if (it) info.set(n.id, { id: n.id, container: isContainer(it), rect: { x: it.x, y: it.y, w: it.w, h: it.h } })
        }
        const keep = bandSelection(next.filter((n) => n.selected).map((n) => n.id), info, rect, b.before, b.additive)
        return next.map((n) => (Boolean(n.selected) === keep.has(n.id) ? n : { ...n, selected: keep.has(n.id) }))
      })
    },
    [rf, laid, flow],
  )
  const onSelectionStart = useCallback(() => {
    band.current = pressed.current
    if (!band.current.additive) return
    // React Flow clears the selection when a band starts; with Shift the earlier selection stays
    const before = new Set(band.current.before)
    setNodes((ns) => ns.map((n) => (before.has(n.id) && !n.selected ? { ...n, selected: true } : n)))
  }, [])
  const onSelectionEnd = useCallback(() => {
    band.current = null
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

  // every jump below marks where the view was, so ⌥← can bring it back (flow/viewHistory.ts)
  const views = useViewHistory()
  const locate = useCallback(
    (ids: string[]) => {
      if (!ids.length) return
      views.mark()
      flow.fitView({ nodes: ids.map((i) => ({ id: i })), padding: 0.4, duration: 300, maxZoom: 1.2 })
    },
    [flow, views],
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
      views.mark()
      if (!known.length) {
        flow.fitView({ padding: 0.15, duration: 300 })
        return
      }
      select(known)
      flow.fitView({ nodes: known.map((i) => ({ id: i })), padding: 0.2, duration: 350, maxZoom: 1.2 })
    },
    [board, flow, select, views],
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
        const abs = absolutePosition(laid ?? board, n.id, n.position)
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
          const container = containerAt(laid ?? board, cx, cy, n.id)
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
      // a dropped kanban column snaps into its place in the row (and the others make room)
      if (moved.some((m) => board.items[m.id]?.type === 'lane' && board.items[m.id]?.role === 'column')) {
        const after: Board = { ...board, items: { ...board.items } }
        for (const [id, p] of patches) after.items[id] = { ...after.items[id], ...p }
        for (const { id, patch } of snapColumns(board, after, moved.map((m) => m.id))) patches.set(id, { ...patches.get(id), ...patch })
      }
      const ops: Op[] = [...patches].map(([id, patch]) => ({ kind: 'update', id, patch }))
      const names = moved.map((m) => board.items[m.id]?.text?.trim()).filter(Boolean)
      void commit(ops, moved.length === 1 ? `moved ${names[0] ? `'${names[0].slice(0, 40)}'` : 'an item'}` : `moved ${moved.length} items`)
    },
    [board, laid, commit],
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

  // ---- annotations and TODOs (docs/canvas.md → "Notes"; flow/annotationsView.ts, flow/todoView.ts)

  /**
   * The person's annotation on an item: drawn from a file → a draft for the holder of the files, carrying the edit to
   * the file when the board has the whole file (else without it: the holder writes it in by hand); no file behind it →
   * a numbered card on the board itself.
   */
  const addAnnotation = useCallback(
    async (targetId: string, text: string) => {
      const t = board?.items[targetId]
      if (!board || !t || !text.trim()) return
      const name = (t.text ?? t.label ?? t.type).split('\n')[0].slice(0, 40)
      const now = new Date().toISOString()
      if (annotateWhere(board, t).kind === 'board') {
        void commit([{ kind: 'add', item: boardAnnotation(board, t, text.trim(), { id: newId('c'), now }) }], `annotated '${name}'`)
        return
      }
      // the file as the board has it now: meta does not travel over the websocket (inspector/useFreshMeta.ts); the
      // draft is built with the yaml parser, loaded now
      const [fresh, { annotationDraft, withBase }] = await Promise.all([
        api.getBoard(board.id).then(
          (b) => ({ ...board, meta: b.meta }),
          () => board,
        ),
        import('./flow/annotationDraft'),
      ])
      const plan = annotationDraft(fresh, t, text.trim())
      if (!plan) return
      const data = plan.baseText !== undefined ? withBase(plan, await sha1(plan.baseText)) : plan.data
      const size = draftSize(text.trim())
      const item = makeItem({ type: 'comment', ...besideItem(board, t, size, true), ...size, text: text.trim(), target: targetId, data })
      void commit([{ kind: 'add', item }], `proposed an annotation on '${name}'`)
      const who = plan.holder ? displayName(plan.holder) : 'the holder of the files'
      store.toast(plan.why ? `Draft for ${who}, without a diff (${plan.why}): they write it into the file by hand` : `Draft for ${who}: they add it to ${plan.file}`)
    },
    [board, commit, store],
  )

  /** A TODO on an item (beside it, on free paper) or about the whole board (near the top-left of the view). Wakes no agent. */
  const addTodo = useCallback(
    (targetId: string | undefined, text: string, ask?: string) => {
      if (!board || !text.trim()) return
      const t = targetId ? board.items[targetId] : undefined
      const rect = wrapRef.current?.getBoundingClientRect()
      const at = t ? freeSpotBeside(board, t, todoSize(text)) : rect ? flow.screenToFlowPosition({ x: rect.left + 48, y: rect.top + 48 }) : { x: 0, y: 0 }
      const item = newTodo(t, text, ask, { id: newId('c'), now: new Date().toISOString(), at })
      void commit([{ kind: 'add', item }], t ? `added a TODO on '${(t.text ?? t.label ?? t.type).split('\n')[0].slice(0, 40)}'` : 'added a TODO about the board')
    },
    [board, commit, flow],
  )

  /** Check a TODO off; with an answer, the answer is posted in its thread (and goes to the Answered by agent). */
  const checkTodo = useCallback(
    (iid: string, answer?: string) => {
      if (!board) return
      const ops = checkOffOps(board, iid, answer, { now: new Date().toISOString(), replyId: newId('c') })
      if (ops.length) void commit(ops, answer?.trim() ? `checked off a TODO: '${answer.trim().slice(0, 40)}'` : 'checked off a TODO')
    },
    [board, commit],
  )
  const reopenTodo = useCallback(
    (iid: string) => {
      const ops = board ? reopenOps(board, iid) : []
      if (ops.length) void commit(ops, 'reopened a TODO')
    },
    [board, commit],
  )

  /**
   * Show the card of an annotation, draft or TODO: select it and bring it into view when it is off screen (`center`:
   * always). A card the switches do not draw (Annotations: pins, a done TODO under TODOs: open) is drawn for this
   * viewer first; with `toggle`, a second click on its marker puts it away again.
   */
  const revealCard = useCallback(
    (cardId: string, o: { toggle?: boolean; center?: boolean } = {}) => {
      const c = board?.items[cardId]
      if (!c) return
      const todo = todoOf(c)
      const onDemand = isAnnotation(c) ? annotationsMode !== 'all' : todo ? !todoVisible(todo, todosMode) : false
      if (onDemand && o.toggle && expandedNotes.has(cardId)) {
        setExpandedNotes((prev) => {
          const next = new Set(prev)
          next.delete(cardId)
          return next
        })
        if (selectedRef.current.includes(cardId)) select([])
        return
      }
      if (onDemand && !expandedNotes.has(cardId)) {
        setExpandedNotes((prev) => new Set(prev).add(cardId))
        cardWhenDrawn.current = cardId
      } else select([cardId])
      const r = wrapRef.current?.getBoundingClientRect()
      if (!r) return
      const [a, b] = [flow.flowToScreenPosition({ x: c.x, y: c.y }), flow.flowToScreenPosition({ x: c.x + c.w, y: c.y + c.h })]
      if (!o.center && a.x >= r.left && a.y >= r.top && b.x <= r.right && b.y <= r.bottom) return
      views.mark()
      flow.setCenter(c.x + c.w / 2, c.y + c.h / 2, { zoom: o.center ? Math.max(flow.getZoom(), 0.8) : flow.getZoom(), duration: 300 })
      if (o.center) {
        setFlashIds([cardId])
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlashIds([]), 1600)
      }
    },
    [board, annotationsMode, todosMode, expandedNotes, select, flow, views],
  )
  const [markInput, setMarkInput] = useState<MarkInputState | null>(null)
  const closeMarkInput = useCallback(() => setMarkInput(null), [])

  const setCommentOpen = useCallback(
    (iid: string, open: boolean) => {
      setOpenComment(iid, open)
      // a settled proposal's ✓, or a badge while every comment is folded, opens for this viewer only (not stored)
      setExpandedNotes((prev) => {
        if (prev.has(iid) === open) return prev
        const next = new Set(prev)
        if (open) next.add(iid)
        else next.delete(iid)
        return next
      })
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
      const abs = absolutePosition(laid ?? board, iid, rect)
      const next = { x: Math.round(abs.x), y: Math.round(abs.y), w: Math.round(rect.width), h: Math.round(rect.height) }
      const patch: Partial<Item> = {}
      for (const k of ['x', 'y', 'w', 'h'] as const) if (next[k] !== Math.round(it[k])) patch[k] = next[k]
      if (patch.h !== undefined && SCALES_FONT.has(it.type)) patch.fontSize = scaledFont(it, next.h)
      if (!Object.keys(patch).length) return
      void commit([{ kind: 'update', id: iid, patch }], `resized '${(it.text ?? it.type).slice(0, 40)}'`)
    },
    [board, laid, commit],
  )

  const deleteItems = useCallback(
    (targets: string[]) => {
      if (!board || !targets.length) return
      // a flow wire picked on its own is not removed: its removal is proposed (docs/studio.md §7);
      // one already proposed for removal stays as it is (Undo in the panel takes it back)
      const now = new Date().toISOString()
      // a UI mock element is not removed either: its removal from the file is proposed (docs/diagrams.md §6c)
      const ui = uiRemoveOps(board, targets, now)
      targets = targets.filter((t) => !ui.handled.includes(t))
      // an item or wire a diagram file drew is not removed either: it is marked deleted (struck) — the person's
      // deletion beats the file on a redraw, and the file holder is asked to remove it (docs/diagrams.md "What a redraw keeps")
      const drawn = diagramRemoveOps(board, targets, now)
      targets = targets.filter((t) => !drawn.handled.includes(t))
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
      const ops: Op[] = [...ui.ops, ...drawn.ops, ...proposed.flatMap((t) => removeOps(board, board.items[t], now))]
      for (const i of ids) if (!ops.some((o) => o.kind === 'update' && o.id === i)) ops.push({ kind: 'remove', id: i })
      if (!ops.length) return
      void commit(
        ops,
        drawn.ops.length && ids.size === 0 && !proposed.length && !ui.ops.length
          ? `deleted ${drawn.ops.length} item${drawn.ops.length === 1 ? '' : 's'} the file still has (proposed removing ${drawn.ops.length === 1 ? 'it' : 'them'} from the file)`
          : ui.ops.length && ids.size === 0 && !proposed.length
          ? `proposed removing ${ui.ops.length} element${ui.ops.length === 1 ? '' : 's'}`
          : proposed.length && ids.size === 0 ? `proposed removing ${proposed.length} wire${proposed.length === 1 ? '' : 's'}` : `deleted ${ids.size} item${ids.size === 1 ? '' : 's'}`,
      )
      // keep a wire (or UI element) whose removal was just proposed selected, so the panel shows the proposal
      select(ids.size === 0 ? [...ui.handled, ...drawn.handled, ...flowWires] : [])
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
      const ops = deletedOf(it) ? undoDeleteOps(it) : undoOps(board, it)
      if (ops.length) void commit(ops, deletedOf(it) ? 'took back a deletion' : 'undid a wire proposal')
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

  // depends on the two fields it reads, not on the store object: it feeds the edit context every node and wire reads
  const { agentWatching, handoff: sendHandoff } = store
  const handoff = useCallback(async () => {
    if (!agentWatching) return
    await sendHandoff()
    setHanded(true)
    setTimeout(() => setHanded(false), 2000)
  }, [agentWatching, sendHandoff])

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

  // the same Set while the same ids are in it, so the edit context below holds across board changes
  const uiRemovedRef = useRef(new Set<string>())
  const uiRemoved = useMemo(() => {
    const next = board ? uiRemovedIds(board) : new Set<string>()
    const prev = uiRemovedRef.current
    if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev
    return (uiRemovedRef.current = next)
  }, [board])
  // The edit API every node and wire reads. Its actions close over the current board, so they are rebuilt on every
  // change — but the context value hands out stable wrappers that call the latest ones, and changes only with its
  // state (what is being edited, the comment tool, the struck UI elements): a board change alone re-renders no node.
  const actions = {
    startEdit,
    commitLabel,
    resize,
    bend,
    setCommentOpen,
    cancelEdit: () => {
      pendingAsk.current = null
      setEditingId(null)
    },
    commitText: (iid: string, text: string, andContinue?: boolean) => {
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
          : isUiElement(it)
            ? // a UI mock element's words: a proposal until the AI applies it to the file (docs/diagrams.md §6c)
              commit([uiTextOp(it, text, new Date().toISOString())], `proposed '${text.slice(0, 40)}'`)
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
        ? (iid: string) => {
            const r = addComment(iid, '')
            setTool('select')
            if (r) setEditingId(r.id)
          }
        : null,
    openMenu,
    reply: (rootId: string, text: string) => {
      if (text.trim()) addComment(rootId, text.trim())
    },
    openSource: (iid: string, mode: 'view' | 'edit') => {
      select([iid])
      setSourceRequest({ id: iid, mode, n: Date.now() })
    },
    commitOps: (ops: Op[], label: string) => void commit(ops, label),
    // a marker under the pointer lights up its card, like a panel link does; its card under the pointer outlines the marker
    hoverMark: (cardId: string, on: boolean, from: 'pin' | 'card') => {
      if (from === 'pin') onHoverItems(on ? [cardId] : [])
      else setCardHover(on ? cardId : null)
    },
    // a click on a marker selects its card — nothing else — and brings it into view when it is off screen; in
    // Annotations: pins the card is drawn for this viewer only after that click, and a second click puts it away
    showMark: (cardId: string) => revealCard(cardId, { toggle: true }),
    // a UI mock element's numbered pins name their card by element and number
    hoverCallout: (elementId: string, n: number, on: boolean, from: 'pin' | 'card') => {
      const c = on && board ? calloutCommentOf(board, elementId, n) : undefined
      if (from === 'pin') onHoverItems(c ? [c.id] : [])
      else setCardHover(c ? c.id : null)
    },
    showCallout: (elementId: string, n: number) => {
      const c = board ? calloutCommentOf(board, elementId, n) : undefined
      if (c) revealCard(c.id, { toggle: true })
    },
    checkTodo,
    reopenTodo,
    holderOf: (draftId: string) => {
      const d = board?.items[draftId]
      const h = board && d ? draftHolder(board, d) : undefined
      return h ? displayName(h) : undefined
    },
    answeredBy: () => {
      const r = responderName(responderOf(board?.meta))
      return r ? displayName(r) : undefined
    },
  }
  const latest = useRef(actions)
  latest.current = actions
  const editApi = useMemo<EditApi>(
    () => ({
      editingId,
      startEdit: (id) => latest.current.startEdit(id),
      commitLabel: (id, label) => latest.current.commitLabel(id, label),
      resize: (id, rect) => latest.current.resize(id, rect),
      bend: (id, point) => latest.current.bend(id, point),
      setCommentOpen: (id, open) => latest.current.setCommentOpen(id, open),
      cancelEdit: () => latest.current.cancelEdit(),
      commitText: (id, text, andContinue) => latest.current.commitText(id, text, andContinue),
      attachTarget: tool === 'comment' ? (id) => latest.current.attachTarget?.(id) : null,
      openMenu: (id, x, y) => latest.current.openMenu(id, x, y),
      reply: (rootId, text) => latest.current.reply(rootId, text),
      openSource: (id, mode) => latest.current.openSource(id, mode),
      commitOps: (ops, label) => latest.current.commitOps(ops, label),
      hoverCallout: (elementId, n, on, from) => latest.current.hoverCallout(elementId, n, on, from),
      showCallout: (elementId, n) => latest.current.showCallout(elementId, n),
      hoverMark: (cardId, on, from) => latest.current.hoverMark(cardId, on, from),
      showMark: (cardId) => latest.current.showMark(cardId),
      checkTodo: (iid, answer) => latest.current.checkTodo(iid, answer),
      reopenTodo: (iid) => latest.current.reopenTodo(iid),
      holderOf: (draftId) => latest.current.holderOf(draftId),
      answeredBy: () => latest.current.answeredBy(),
      uiRemoved,
    }),
    [editingId, tool, uiRemoved],
  )

  // ---- keyboard (capture phase so arrow keys reach us before React Flow's own handler)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)
      if (menu || helpOpen || markInput) return
      // a replay has its own keys (components/ReplayBar.tsx); the board's edit keys wait until it stops
      if ((replayOn.current || playOn.current) && !(e.metaKey || e.ctrlKey)) return
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
      if (e.altKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        e.stopPropagation()
        if (!(e.key === 'ArrowLeft' ? views.back() : views.forward())) store.toast(e.key === 'ArrowLeft' ? 'No earlier view' : 'No later view')
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
      else if (e.key === '2') {
        if (selectedIds.length) locate(selectedIds)
        else store.toast('Nothing selected')
      }
      else if (e.key === 'w') store.toast(`Lines: ${MODE_NAMES[cycleWires()].toLowerCase()}`)
      else if (e.key === 'W') {
        const next = TRACE_MODES[(TRACE_MODES.indexOf(traceView.mode) + 1) % TRACE_MODES.length]
        setTraceView({ mode: next })
        store.toast(`Traces: ${TRACE_MODE_NAMES[next].toLowerCase()}`)
      } else if (e.key === 'N') store.toast(`Comments: ${NOTES_MODE_NAMES[cycleNotes()].toLowerCase()}`)
      else if (e.key === 'A') store.toast(`Annotations: ${ANNOTATIONS_MODE_NAMES[cycleAnnotations()].toLowerCase()}`)
      else if (e.key === 'T') store.toast(`TODOs: ${TODOS_MODE_NAMES[cycleTodos()].toLowerCase()}`)
      else if (e.key === 'G') store.toast(`Clickable: ${clickable.toggle() ? 'on' : 'off'}${board && !uiMockFrames(board).length ? ' (this board has no UI mock)' : ''}`)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editingId, deleteSelection, addItem, flow, nudge, selectedIds, store, duplicate, menu, helpOpen, markInput, board, openMenu, startEdit, copyAsImage, cycleWires, traceView.mode, setTraceView, cycleNotes, cycleAnnotations, cycleTodos, views, locate])

  // React Flow hands these to every node and wire (and writes the tracked ones into its store, waking every
  // subscriber), so a new function on each render re-rendered the whole board: the same functions are given every
  // time and read what they need from `live`, which holds this render's values.
  const live = useRef({ hoverable, hoverId, tool, startEdit, openMenu, onNodesChange, onNodeDragStop, onConnect, onReconnect })
  live.current = { hoverable, hoverId, tool, startEdit, openMenu, onNodesChange, onNodeDragStop, onConnect, onReconnect }
  const handlers = useMemo(
    () => ({
      onNodesChange: (changes: NodeChange<ItemNode>[]) => live.current.onNodesChange(changes),
      onNodeDragStop: (e: unknown, node: Node, dragged: Node[]) => live.current.onNodeDragStop(e, node, dragged),
      onConnect: (c: Connection) => live.current.onConnect(c),
      onReconnect: (old: Edge, c: Connection) => live.current.onReconnect(old, c),
      onEdgeDoubleClick: (e: React.MouseEvent, edge: Edge) => {
        e.stopPropagation()
        live.current.startEdit(edge.id)
      },
      onNodeMouseEnter: (_: React.MouseEvent, n: Node) => live.current.hoverable.has(n.id) && setHoverId(n.id),
      onNodeMouseLeave: () => live.current.hoverId !== null && setHoverId(null),
      onEdgeClick: (_: React.MouseEvent, edge: Edge) => {
        // a bundle stands for all the traces between two diagrams: a click draws them, another folds them back
        const key = (edge.data as { bundle?: { key: string } } | undefined)?.bundle?.key
        if (key) setOpenBundles((prev) => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next })
      },
      onNodeContextMenu: (e: React.MouseEvent, n: Node) => {
        e.preventDefault()
        // a mock being played is operated, not edited: no menu on its screens
        if ((n.data as { play?: unknown }).play) return
        live.current.openMenu(n.id, e.clientX, e.clientY)
      },
      onSelectionContextMenu: (e: React.MouseEvent, sel: Node[]) => {
        e.preventDefault()
        if (sel[0]) live.current.openMenu(sel[0].id, e.clientX, e.clientY)
      },
      onPaneClick: (e: React.MouseEvent) => {
        setEditingId(null)
        if (live.current.tool === 'comment') setTool('select')
        // while a mock plays, the paper of the screen on view (its empty area lets the click through) leads nowhere
        const s = playScreen.current
        if (s) {
          const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false })
          if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) clickHint.show()
        }
      },
    }),
    [],
  )

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
        // a comment or a card opens for this viewer, whatever the switches say (a reply's link opens its thread)
        const root = it.type === 'comment' ? (threadRoot(board, it.id) ?? it) : it
        if (root.type === 'comment') {
          setExpandedNotes((prev) => new Set(prev).add(root.id))
          cardWhenDrawn.current = root.id
        }
        select([root.id])
        flow.setCenter(root.x + root.w / 2, root.y + root.h / 2, { zoom: 1 })
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
      <div
        // Annotations: none hides the callout pins of UI mocks too (ui-mock.css), so Copy as image leaves them out as well
        className={`canvas-wrap notes-${notesMode} annotations-${annotationsMode} todos-${todosMode}`}
        ref={wrapRef}
        onDoubleClick={onWrapDoubleClick}
        // what a rubber band needs (flow/bandSelect.ts): the selection when the drag began, Shift, and where the pointer is
        onPointerDownCapture={(e) => {
          pressed.current = { before: selectedRef.current, additive: e.shiftKey || e.metaKey || e.ctrlKey }
          pointerAt.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMoveCapture={(e) => {
          pointerAt.current = { x: e.clientX, y: e.clientY }
        }}
      >
        <EditContext.Provider value={editApi}>
        <WireBadgeContext.Provider value={toggleBadge}>
          <ReactFlow
            nodes={viewNodes}
            edges={playedUi.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={handlers.onNodesChange}
            onEdgesChange={onEdgesChange}
            onReconnect={handlers.onReconnect}
            connectionMode={ConnectionMode.Loose}
            onEdgeDoubleClick={handlers.onEdgeDoubleClick}
            onSelectionChange={onSelectionChange}
            onNodeMouseEnter={handlers.onNodeMouseEnter}
            onNodeMouseLeave={handlers.onNodeMouseLeave}
            onEdgeClick={handlers.onEdgeClick}
            onSelectionStart={onSelectionStart}
            onSelectionEnd={onSelectionEnd}
            onNodeDragStop={handlers.onNodeDragStop}
            onConnect={handlers.onConnect}
            onNodeContextMenu={handlers.onNodeContextMenu}
            onSelectionContextMenu={handlers.onSelectionContextMenu}
            onPaneClick={handlers.onPaneClick}
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
            proOptions={PRO_OPTIONS}
            style={tool === 'comment' ? CROSSHAIR : undefined}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--paper-dot)" />
            <Controls showInteractive={false} position="bottom-right" />
            <WireControls
              view={wireView}
              onChange={setWireView}
              hasCatchAll={hasCatchAll}
              traces={hasTraces ? TRACE_MODE_NAMES[traceView.mode].toLowerCase() : undefined}
              notes={[
                ...(anyComments ? [['Comments', NOTES_MODE_NAMES[notesMode].toLowerCase()] as [string, string]] : []),
                ...(anyAnnotations ? [['Annotations', ANNOTATIONS_MODE_NAMES[annotationsMode].toLowerCase()] as [string, string]] : []),
                ...(anyTodos ? [['TODOs', TODOS_MODE_NAMES[todosMode].toLowerCase()] as [string, string]] : []),
              ]}
              after={
                <>
                  {anyComments ? <NotesControls mode={notesMode} onChange={setNotesMode} /> : null}
                  {anyAnnotations ? <AnnotationsControls mode={annotationsMode} onChange={setAnnotationsMode} /> : null}
                  {anyTodos ? <TodosControls mode={todosMode} onChange={setTodosMode} /> : null}
                </>
              }
            >
              {hasTraces ? <TraceControls view={traceView} onChange={setTraceView} /> : null}
            </WireControls>
            <FrozenHeaders board={laid ?? board} />
            <MiniMap pannable zoomable position="bottom-left" nodeColor={miniMapColor} />
          </ReactFlow>
        </WireBadgeContext.Provider>
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
        {replayView && replayModel?.steps.length ? <ReplayBar model={replayModel} view={replayView} title={board.items[replayView.frameId]?.text ?? 'Domain story'} /> : null}
        {playState && playState.screen && playModel?.screens.length ? <PlayBar model={playModel} state={playState} title={board.items[playState.frameId]?.text ?? 'UI mock'} /> : null}
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
          onEditChat={(ids, text, model, edit) => void addComment(ids[0], text, { discuss: { model, about: ids, edit } })}
          onUndoUiText={(iid) => {
            const it = board.items[iid]
            if (it) void commit(uiUndoOps(it), 'undid a proposal')
          }}
          onUiOps={(ops, label, sel) => {
            // select what was just added once it is on the board
            void commit(ops, label).then(() => {
              if (sel) select([sel])
            })
          }}
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
          onAnnotate={(iid, text) => void addAnnotation(iid, text)}
          onAddTodo={(iid, text, ask) => addTodo(iid ?? undefined, text, ask)}
          onCheckTodo={checkTodo}
          onReopenTodo={reopenTodo}
          onShowMark={(cid) => revealCard(cid, { center: true })}
          onSelect={(sid) => {
            select(sid ? [sid] : [])
            if (sid) {
              const it = board.items[sid]
              // a wire has no place of its own on the board: show its two ends
              if (it?.type === 'arrow') locate([it.from, it.to].filter((x): x is string => !!x))
              else if (it) {
                views.mark()
                flow.setCenter(it.x + it.w / 2, it.y + it.h / 2, { zoom: Math.max(flow.getZoom(), 0.8), duration: 300 })
              }
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
          onAnnotate={menuItem.type === 'comment' || menuItem.type === 'arrow' ? undefined : (iid) => setMarkInput({ kind: 'annotate', itemId: iid, x: menu.x, y: menu.y })}
          onTodo={menuItem.type === 'comment' || menuItem.type === 'arrow' ? undefined : (iid) => setMarkInput({ kind: 'todo', itemId: iid, x: menu.x, y: menu.y })}
          copyCount={selectedIds.includes(menu.itemId) ? selectedIds.length : 1}
          onCopyLink={(iid) => {
            const url = itemLink(board, board.items[iid], location.origin)
            void copyText(url).then((ok) => store.toast(ok ? 'Link copied' : `Copy this link: ${url}`))
          }}
          canColor={COLOURABLE.has(menuItem.type)}
          askEnabled={store.agentWatching}
          onPlayStory={replayFrameOf(board, menuItem) ? () => replay.start(replayFrameOf(board, menuItem)!) : undefined}
          onPlayMock={playFrameOf(board, menuItem) ? () => play.start(playFrameOf(board, menuItem)!) : undefined}
          lock={menuItem.type === 'comment' || menuItem.type === 'arrow' ? undefined : { locked: ownLock(menuItem), frame: menuItem.type === 'frame', byFrame: !ownLock(menuItem) && layoutLock(board.items, menuItem.id) === 'frame' }}
          onToggleLock={(iid) => {
            const it = board.items[iid]
            if (!it) return
            const on = !ownLock(it)
            const data = { ...(it.data ?? {}) }
            if (on) Object.assign(data, { lock: LAYOUT_LOCK, lockedBy: 'person' })
            else {
              delete data.lock
              delete data.lockedBy
            }
            const what = it.type === 'frame' ? 'the layout of' : 'the position of'
            void commit([{ kind: 'update', id: iid, patch: { data } }], `${on ? 'locked' : 'unlocked'} ${what} '${(it.text ?? it.type).slice(0, 40)}'`)
          }}
        />
      )}
      {markInput && (markInput.itemId === undefined || board.items[markInput.itemId]) ? (
        <MarkInput
          state={markInput}
          title={`${markInput.kind === 'annotate' ? 'Annotate' : 'TODO on'} ${markInput.itemId ? `‘${(board.items[markInput.itemId].text ?? board.items[markInput.itemId].label ?? board.items[markInput.itemId].type).split('\n')[0].slice(0, 40)}’` : 'the board'}`}
          hint={markInput.kind === 'annotate' && markInput.itemId ? annotateHint(annotateWhere(board, board.items[markInput.itemId])) : 'On the board only; it wakes no agent. Checked off with an answer, the answer goes to the board’s Answered by agent.'}
          onSubmit={(text, ask) => {
            if (markInput.kind === 'annotate' && markInput.itemId) void addAnnotation(markInput.itemId, text)
            else if (markInput.kind === 'todo') addTodo(markInput.itemId, text, ask)
          }}
          onClose={closeMarkInput}
        />
      ) : null}
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
      <span className="presence" role="status" title={store.agentNames.length > 1 ? `Watching: ${store.agentNames.join(', ')}` : undefined}>
        <span className={`dot ${store.agentWatching ? 'watching' : ''}`} aria-hidden="true" />
        <span className="label">{watchingLabel(store.agentWatching, store.agentNames)}</span>
      </span>
      {store.board && <ResponderControl board={store.board} watching={store.agentNames} seen={store.agentSeen} onToast={store.toast} />}
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
      <a
        className="home"
        href="/agents"
        aria-label="Connected agents"
        title="Connected agents: tokens, connect requests"
        onClick={(e) => {
          e.preventDefault()
          navigate('/agents')
        }}
      >
        Agents
      </a>
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

/** "Agent is watching", "codex-laptop is watching", "2 agents are watching". */
export function watchingLabel(watching: boolean, names: string[]): string {
  if (!watching) return 'Agent is away'
  const named = names.filter((n) => n !== 'agent')
  if (names.length > 1) return `${names.length} agents are watching`
  return named.length === 1 ? `${named[0]} is watching` : 'Agent is watching'
}

export function navigate(path: string) {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
