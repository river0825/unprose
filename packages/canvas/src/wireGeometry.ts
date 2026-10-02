// How a wire runs and where its label sits, without a browser — shared by the server snapshot (snapshot.ts) and the
// layout check (layoutCheck.ts), close to what the page draws (web/src/flow/ItemEdge.tsx): orthogonal runs between
// the sides it leaves and enters by, a domain-story activity as a straight line cut at each pictogram, a dragged
// bend as a curve through that point. The label follows edgeLabel.ts. Pure (bundled by the web with layoutCheck).
import type { Board, Item } from './model.js'
import { EDGE_LABEL, isLabelObstacle, labelControl, placeEdgeLabel, type LabelBox, type PlacedLabel, type Pt } from './edgeLabel.js'

export type Side = 'top' | 'right' | 'bottom' | 'left'
const SIDES = new Set(['top', 'right', 'bottom', 'left'])
type Box = { x: number; y: number; w: number; h: number }

export function anchor(bx: Box, side: Side): Pt {
  if (side === 'left') return { x: bx.x, y: bx.y + bx.h / 2 }
  if (side === 'right') return { x: bx.x + bx.w, y: bx.y + bx.h / 2 }
  if (side === 'top') return { x: bx.x + bx.w / 2, y: bx.y }
  return { x: bx.x + bx.w / 2, y: bx.y + bx.h }
}

/** Where the line from box a's centre towards box b's centre leaves box a (plus a small gap). */
export function floatingEnd(a: Box, b: Box): Pt {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const dx = b.x + b.w / 2 - ca.x
  const dy = b.y + b.h / 2 - ca.y
  if (!dx && !dy) return ca
  const t = Math.min(dx ? (a.w / 2 + 6) / Math.abs(dx) : Infinity, dy ? (a.h / 2 + 6) / Math.abs(dy) : Infinity)
  return { x: ca.x + dx * t, y: ca.y + dy * t }
}

export function autoSides(a: Box, b: Box): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  const gapX = dx > 0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w)
  const gapY = dy > 0 ? b.y - (a.y + a.h) : a.y - (b.y + b.h)
  if (gapX >= gapY) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/** The orthogonal runs between two sides. */
export function routePoints(p1: Pt, s1: Side, p2: Pt, s2: Side): Pt[] {
  const h1 = s1 === 'left' || s1 === 'right'
  const h2 = s2 === 'left' || s2 === 'right'
  if (h1 && h2) {
    const mx = (p1.x + p2.x) / 2
    return Math.abs(p1.y - p2.y) < 0.5 ? [p1, p2] : [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2]
  }
  if (!h1 && !h2) {
    const my = (p1.y + p2.y) / 2
    return Math.abs(p1.x - p2.x) < 0.5 ? [p1, p2] : [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2]
  }
  return h1 ? [p1, { x: p2.x, y: p1.y }, p2] : [p1, { x: p1.x, y: p2.y }, p2]
}

export interface WireShape {
  /** SVG path data */
  d: string
  /** the runs (for a bend: source, bend, target) */
  points: Pt[]
  p1: Pt
  p2: Pt
  /** a domain-story wire: a straight floating line */
  ds: boolean
  /** the point the person dragged the label to (data.bend) */
  bend?: Pt
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString())

export function wireShape(b: Pick<Board, 'items'>, it: Item): WireShape | undefined {
  const from = it.from ? b.items[it.from] : undefined
  const to = it.to ? b.items[it.to] : undefined
  if (!from || !to) return undefined
  const auto = autoSides(from, to)
  const s1 = (typeof it.data?.fromSide === 'string' && SIDES.has(it.data.fromSide) ? it.data.fromSide : auto[0]) as Side
  const s2 = (typeof it.data?.toSide === 'string' && SIDES.has(it.data.toSide) ? it.data.toSide : auto[1]) as Side
  const ds = !!it.data?.ds
  const p1 = ds ? floatingEnd(from, to) : anchor(from, s1)
  const p2 = ds ? floatingEnd(to, from) : anchor(to, s2)
  const bend = it.data?.bend as { x?: unknown; y?: unknown } | undefined
  if (!ds && typeof bend?.x === 'number' && typeof bend.y === 'number') {
    const bp = { x: bend.x, y: bend.y }
    return { d: `M${n(p1.x)} ${n(p1.y)}Q${n(2 * bp.x - (p1.x + p2.x) / 2)} ${n(2 * bp.y - (p1.y + p2.y) / 2)} ${n(p2.x)} ${n(p2.y)}`, points: [p1, bp, p2], p1, p2, ds, bend: bp }
  }
  const points = ds ? [p1, p2] : routePoints(p1, s1, p2, s2)
  return { d: points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join(''), points, p1, p2, ds }
}

/** A domain-story activity's number circle, a little along the line from its actor. */
export function dsSeqAt(s: WireShape): Pt {
  const len = Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y) || 1
  const along = Math.min(24, len / 3)
  return { x: s.p1.x + ((s.p2.x - s.p1.x) / len) * along, y: s.p1.y + ((s.p2.y - s.p1.y) / len) * along }
}

/** A domain-story verb's first choice: beside its line on the side facing up (or left), past the number. */
export function dsVerbAt(s: WireShape): Pt {
  const len = Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y) || 1
  const ux = (s.p2.x - s.p1.x) / len
  const uy = (s.p2.y - s.p1.y) / len
  let nx = -uy
  let ny = ux
  if (ny > 0 || (ny === 0 && nx > 0)) ((nx = -nx), (ny = -ny))
  const along = Math.min(24, len / 3)
  const t = Math.max(len / 2, Math.min(len - 20, along + 44))
  return { x: s.p1.x + ux * t + nx * 13, y: s.p1.y + uy * t + ny * 13 }
}

/** The text a wire shows: a trace's label shows only while it is selected on the page (never in a snapshot). */
export const wireText = (it: Item): string => (it.role === 'trace' ? '' : (it.label ?? it.text ?? '').trim())

/** Every box on the board a label may not cover (positions as given — pass the shown board). */
export function labelObstacles(b: Pick<Board, 'items'>): Array<LabelBox & { id: string }> {
  return Object.values(b.items)
    .filter((it) => isLabelObstacle(it))
    .map((it) => ({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h }))
}

export interface WireLabel extends PlacedLabel {
  /** the person dragged it here (data.bend): placed as is, whatever it covers */
  dragged?: boolean
}

/** Where a wire's label goes (edgeLabel.ts), or undefined for an unlabelled wire. */
export function wireLabel(it: Item, shape: WireShape, boxes: LabelBox[]): WireLabel | undefined {
  const text = wireText(it)
  if (!text) return undefined
  const ctl = labelControl(it.data)
  const ds = shape.ds && it.role !== 'annotation-link'
  const font = ds ? EDGE_LABEL.dsFont : EDGE_LABEL.font
  if (shape.bend) {
    // the person put it there: shown whole (two lines at most) where they dragged it
    const placed = placeEdgeLabel(text, [shape.bend, { x: shape.bend.x + 0.01, y: shape.bend.y }], [], { font, short: ctl.short })!
    return { ...placed, x: shape.bend.x, y: shape.bend.y, dragged: true }
  }
  const prefer = ds && it.role === 'activity' ? [dsVerbAt(shape)] : undefined
  return placeEdgeLabel(text, shape.points, boxes, { font, at: ctl.at, short: ctl.short, prefer })
}
