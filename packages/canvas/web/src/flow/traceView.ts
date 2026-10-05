// Which trace wires a viewer sees (docs/canvas.md → "Traces"). Traces say how elements of different diagrams
// belong together, but a board with several diagrams has more of them than anyone can read at once, so the
// viewer chooses: all, faded, bundled per pair of diagrams, only those of the selection, or none — with a small
// badge on every element that has traces, and a filter by relation. Pure (no React), so the rules can be tested.
import type { Edge } from '@xyflow/react'
import type { Board, Item } from '../../../src/model'
import { relOf, type TraceRel } from '../diagrams/traces'

/**
 * - `all`: every trace is drawn;
 * - `faded`: every trace is drawn faintly, those of the selection (or the hovered element) in full;
 * - `bundled`: one line per pair of diagrams, labelled with how many traces it stands for — click it to draw them all;
 * - `selected`: only the traces of the selected (or hovered) elements;
 * - `none`: no trace.
 * A trace that is itself selected (picked in the Inspector's Traces list) is drawn in every mode.
 */
export type TraceMode = 'all' | 'faded' | 'bundled' | 'selected' | 'none'
export const TRACE_MODES: TraceMode[] = ['all', 'faded', 'bundled', 'selected', 'none']
export const TRACE_RELS: TraceRel[] = ['derived-from', 'groups', 'shows', 'relates']

export interface TraceView {
  mode: TraceMode
  /** a small "↗ n" on every element that has traces, so hidden traces can still be found */
  badges: boolean
  /** relations that are drawn and counted; a trace with no known relation counts as `relates` */
  rels: Record<TraceRel, boolean>
}
export const DEFAULT_TRACE_VIEW: TraceView = { mode: 'selected', badges: true, rels: { 'derived-from': true, groups: true, shows: true, relates: true } }

const isTrace = (it: Item | undefined): it is Item => it?.type === 'arrow' && it.role === 'trace'
const relOn = (view: TraceView, it: Item) => view.rels[relOf(it) ?? 'relates'] !== false

/** The diagram an item belongs to: its nearest frame with `role: diagram` (the frame itself for a frame), else ''. */
export function diagramOf(board: Board, id: string | undefined): string {
  let it = id ? board.items[id] : undefined
  for (let i = 0; it && i < 20; i++) {
    if (it.type === 'frame' && it.role === 'diagram') return it.id
    it = it.parent ? board.items[it.parent] : undefined
  }
  return ''
}

/** The pair of diagrams a trace joins (`a|b`, sorted), or '' when it stays inside one diagram or has a loose end. */
export function bundleKey(board: Board, wire: Item): string {
  const [a, b] = [diagramOf(board, wire.from), diagramOf(board, wire.to)]
  return a && b && a !== b ? [a, b].sort().join('|') : ''
}

/** How many traces (of the relations shown) each element has: element id → count. */
export function traceCounts(board: Board, view: TraceView): Map<string, number> {
  const out = new Map<string, number>()
  for (const it of Object.values(board.items)) {
    if (!isTrace(it) || !it.from || !it.to || !board.items[it.from] || !board.items[it.to] || !relOn(view, it)) continue
    for (const end of [it.from, it.to]) out.set(end, (out.get(end) ?? 0) + 1)
  }
  return out
}

/**
 * Apply the viewer's trace view to the drawn edges. `picked` are the selected and hovered elements; `open` the
 * bundles the viewer clicked. Only trace wires change; returns the same array when nothing does.
 */
export function applyTraceView(edges: Edge[], view: TraceView, picked: Iterable<string>, board: Board, open: ReadonlySet<string> = new Set()): Edge[] {
  const on = new Set(picked)
  // bundled: per pair of diagrams, the traces it stands for (those of the relations shown), smallest id first
  const bundles = new Map<string, string[]>()
  if (view.mode === 'bundled') {
    for (const e of edges) {
      const it = board.items[e.id]
      if (e.type !== 'item' || e.hidden || !isTrace(it) || !relOn(view, it)) continue
      const key = bundleKey(board, it)
      if (key) bundles.set(key, [...(bundles.get(key) ?? []), e.id].sort())
    }
  }
  let changed = false
  const out = edges.map((e) => {
    const it = board.items[e.id]
    if (e.type !== 'item' || !isTrace(it)) return e
    const touching = on.has(e.source) || on.has(e.target)
    const key = view.mode === 'bundled' ? bundleKey(board, it) : ''
    const group = key ? bundles.get(key) : undefined
    const stands = !!group && group.length > 1 && group[0] === e.id
    const shown =
      !!e.selected ||
      (!e.hidden &&
        relOn(view, it) &&
        (view.mode === 'all' || view.mode === 'faded' || (view.mode === 'selected' && touching) || (view.mode === 'bundled' && (touching || !group || group.length === 1 || stands || open.has(key)))))
    const faded = shown && view.mode === 'faded' && !touching && !e.selected
    const bundle = shown && stands ? { key, count: group!.length, open: open.has(key) } : undefined
    const cls = `wire-trace${faded ? ' trace-faded' : ''}${bundle ? ` trace-bundle${bundle.open ? ' open' : ''}` : ''}`
    const had = (e.data as { bundle?: { key: string; count: number; open: boolean } } | undefined)?.bundle
    if (shown === !e.hidden && cls === (e.className ?? 'wire-trace') && !bundle && !had) return e
    changed = true
    const { bundle: _drop, ...data } = (e.data ?? {}) as Record<string, unknown>
    return { ...e, hidden: !shown, className: cls, data: bundle ? { ...data, bundle } : data, ...(bundle ? { label: `${bundle.count} traces` } : {}) }
  })
  return changed ? out : edges
}
