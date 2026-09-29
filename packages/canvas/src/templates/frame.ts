// Drawing a template inside a diagram frame (docs/diagrams.md §1), and turning trace links into wires.
// Pure: the server hands in the board's items and the rendered ones, and gets back what to write.
import { diagramFrameId, type DiagramSpec, type Item } from '../model.js'
import { parseTraceRef, TRACE_LABEL, type Trace } from '../diagrams/ids.js'
import { LANE_HEADER, PAD, arrow, fit, make } from './util.js'

export interface FrameRequest extends DiagramSpec {
  /** Frame title; defaults to the key. */
  title?: string
  /** Where a new frame goes; default: to the right of everything on the board. */
  at?: { x: number; y: number }
}

/** Where the frame's content starts: inside the existing frame, or where a new one will go. */
export function frameOrigin(boardItems: Record<string, Item>, req: FrameRequest): { x: number; y: number } {
  const existing = boardItems[diagramFrameId(req.key)]
  if (existing) return { x: existing.x, y: existing.y + LANE_HEADER }
  const at = req.at ?? rightOfEverything(boardItems)
  return { x: at.x, y: at.y + LANE_HEADER }
}

function rightOfEverything(boardItems: Record<string, Item>): { x: number; y: number } {
  const boxes = Object.values(boardItems).filter((i) => i.type !== 'arrow' && i.type !== 'comment')
  if (!boxes.length) return { x: 0, y: 0 }
  return { x: Math.max(...boxes.map((i) => i.x + i.w)) + PAD * 3, y: Math.min(...boxes.map((i) => i.y)) }
}

/**
 * Put rendered items into the diagram frame: top-level items get the frame as parent, a new frame is
 * fitted around them, an existing frame keeps its geometry (a redraw never re-lays out the frame) and only
 * refreshes `data.diagram` and its title when one is given.
 */
export function placeInFrame(boardItems: Record<string, Item>, req: FrameRequest, rendered: Item[], now: string): { frame: Item; items: Item[] } {
  const frameId = diagramFrameId(req.key)
  const children = rendered.map((it) => (it.type === 'arrow' || it.parent ? it : { ...it, parent: frameId }))
  const diagram: DiagramSpec = { kind: req.kind, key: req.key, ...(req.source ? { source: req.source } : {}), ...(req.level ? { level: req.level } : {}) }
  const existing = boardItems[frameId]
  let frame: Item
  if (existing) {
    frame = { ...existing, text: req.title ?? existing.text, data: { ...existing.data, diagram } }
  } else {
    const origin = frameOrigin(boardItems, req)
    const base = make({ id: frameId, type: 'frame', x: origin.x, y: origin.y - LANE_HEADER, w: 0, h: 0, text: req.title ?? req.key, role: 'diagram', color: 'white', data: { diagram } }, now)
    frame = fit(base, children.filter((c) => c.type !== 'arrow'), PAD / 2, LANE_HEADER)
  }
  return { frame, items: [frame, ...children] }
}

/** A trace that could not be drawn: its target is not on the board (or the ref is malformed). */
export interface UnresolvedTrace {
  item: string
  trace: Trace
  reason: 'bad-ref' | 'not-found'
}

/** Kanban's legacy card id suffix: the id (or title) with runs of other characters turned into '-'. */
const legacyCardSuffix = (element: string) => element.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * The item a trace points at. By `data.element` first (the main sticky rather than a repeated
 * person/system occurrence); for items drawn before a template set `data.element`, by the id
 * convention `<key>.<role>.<element>` (kanban: `<key>.card.<sanitised id or title>`). A ref without an
 * element (`'<key>'`) is the diagram's frame.
 */
export function traceTarget(pool: Item[], ref: { key: string; element?: string }): Item | undefined {
  if (!ref.element) return pool.find((i) => i.id === diagramFrameId(ref.key))
  const inDiagram = pool.filter((i) => i.id.startsWith(`${ref.key}.`))
  const byElement = inDiagram.filter((i) => i.data?.element === ref.element)
  const pick = (hits: Item[]) => hits.find((i) => !i.data?.occurrence) ?? hits[0]
  if (byElement.length) return pick(byElement)
  const suffixes = new Set([ref.element, legacyCardSuffix(ref.element)].filter(Boolean))
  // `<key>.<role>.<element>`: exactly one segment (the role) between the key and the element
  const byId = inDiagram.filter((i) => {
    const rest = i.id.slice(ref.key.length + 1)
    const dot = rest.indexOf('.')
    return dot > 0 && suffixes.has(rest.slice(dot + 1))
  })
  return pick(byId)
}

/**
 * Dotted trace wires for every `data.traces` link whose target is drawn (on the board or in this render):
 * from the item that carries the trace to the element it points at, labelled 來自 / 組成 / 畫面 / 相關.
 * Traces between elements of the same diagram are allowed. `unresolved` lists what was not drawn, so the
 * author can be told instead of the link vanishing.
 */
export function resolveTraces(rendered: Item[], boardItems: Record<string, Item>, now: string): { wires: Item[]; unresolved: UnresolvedTrace[] } {
  const pool = [...Object.values(boardItems), ...rendered].filter((i) => i.type !== 'arrow' && i.type !== 'comment')
  const wires: Item[] = []
  const unresolved: UnresolvedTrace[] = []
  for (const it of rendered) {
    const traces = it.data?.traces as Trace[] | undefined
    if (!Array.isArray(traces)) continue
    for (const t of traces) {
      const ref = typeof t?.from === 'string' ? parseTraceRef(t.from) : undefined
      if (!ref) {
        unresolved.push({ item: it.id, trace: t, reason: 'bad-ref' })
        continue
      }
      const target = traceTarget(pool, ref)
      if (!target || target.id === it.id) {
        if (!target) unresolved.push({ item: it.id, trace: t, reason: 'not-found' })
        continue
      }
      const scope = it.id.split('.')[0]
      wires.push(arrow(`${scope}.trace`, it.id, target.id, now, TRACE_LABEL[t.rel] ?? t.rel, 'trace', { key: t.rel, data: { trace: t } }))
    }
  }
  return { wires, unresolved }
}

/** The trace wires alone (see resolveTraces). */
export function traceWires(rendered: Item[], boardItems: Record<string, Item>, now: string): Item[] {
  return resolveTraces(rendered, boardItems, now).wires
}
