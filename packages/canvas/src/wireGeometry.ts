// How a wire runs and where its label sits, without a browser — shared by the server snapshot (snapshot.ts) and the
// layout check (layoutCheck.ts), close to what the page draws (web/src/flow/ItemEdge.tsx): orthogonal runs between
// the sides it leaves and enters by, a domain-story activity as a straight line cut at each pictogram, a dragged
// bend as a curve through that point. The label follows edgeLabel.ts. Pure (bundled by the web with layoutCheck).
import type { Board, Item } from './model.js'
import { measure } from './textMetrics.js'
import { EDGE_LABEL, isLabelObstacle, labelControl, labelHits, labelLines, labelSize, placeEdgeLabel, type LabelBox, type PlacedLabel, type Pt } from './edgeLabel.js'

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

/** A domain-story activity's number circle, a little along the line from its actor (`along` px; default 24). */
export function dsSeqAt(s: WireShape, along = 24): Pt {
  const len = Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y) || 1
  const d = Math.min(along, len / 3)
  return { x: s.p1.x + ((s.p2.x - s.p1.x) / len) * d, y: s.p1.y + ((s.p2.y - s.p1.y) / len) * d }
}

/** The number circle: 22 px on the page (inspector.css .ds-seq), r 11 in the snapshot. */
export const DS_SEQ = 22

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

/** Where a wire's label goes (edgeLabel.ts), or undefined for an unlabelled wire. Alone: it does not know the other wires' labels (planWires does). */
export function wireLabel(it: Item, shape: WireShape, boxes: LabelBox[]): WireLabel | undefined {
  const text = wireText(it)
  if (!text) return undefined
  const ctl = labelControl(it.data)
  const ds = shape.ds && it.role !== 'annotation-link'
  const font = ds ? EDGE_LABEL.dsFont : EDGE_LABEL.font
  if (shape.bend) {
    // the person put it there: shown whole (two lines at most) where they dragged it
    const whole = labelLines(text, EDGE_LABEL.maxW, font)
    const { w, h } = labelSize(whole.lines, font)
    return { mode: whole.cut ? 'cut' : 'full', x: shape.bend.x, y: shape.bend.y, w, h, lines: whole.lines, text: text.replace(/\s+/g, ' ').trim(), font, dragged: true }
  }
  const prefer = ds && it.role === 'activity' ? [dsVerbAt(shape)] : undefined
  return placeEdgeLabel(text, shape.points, boxes, { font, at: ctl.at, short: ctl.short, prefer })
}

export interface WirePlan {
  shape: WireShape
  label?: WireLabel
  /** a domain-story activity's number circle (its centre) */
  seq?: Pt
}

/** A circle's box at centre p. */
export const seqBox = (p: Pt): LabelBox => ({ x: p.x - DS_SEQ / 2, y: p.y - DS_SEQ / 2, w: DS_SEQ, h: DS_SEQ })

/**
 * Every wire's shape, label and (domain story) number circle, placed for the board as a whole — one rule for the page
 * (web ItemEdge via boardToFlow), the snapshot and the layout check. Domain-story wires are placed together so their
 * verbs and number circles keep off each other as well as off the pictograms: first the number circles, in sequence
 * order, each at its arrow's start (moved a little further along when that spot is taken by another circle); then the
 * verbs, in sequence order, each avoiding the pictograms, every circle and the verbs already placed. Other wires' labels
 * are placed on their own, as before (edgeLabel.ts). `b` is the board as the page shows it (shownBoard); `ids` limits
 * the wires (default: all).
 */
export function planWires(b: Pick<Board, 'items'>, ids?: Iterable<string>): Map<string, WirePlan> {
  const out = new Map<string, WirePlan>()
  const wanted = ids ? new Set(ids) : undefined
  const wires = Object.values(b.items)
    .filter((it) => it.type === 'arrow' && (!wanted || wanted.has(it.id)))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  const obstacles = labelObstacles(b)
  const seqOf = (it: Item) => (typeof it.data?.seq === 'number' ? (it.data.seq as number) : Infinity)
  const ds: Array<{ it: Item; shape: WireShape }> = []
  for (const it of wires) {
    const shape = wireShape(b, it)
    if (!shape) continue
    out.set(it.id, { shape })
    if (shape.ds && it.role !== 'annotation-link') ds.push({ it, shape })
    else out.get(it.id)!.label = wireLabel(it, shape, obstacles)
  }
  ds.sort((x, y) => seqOf(x.it) - seqOf(y.it) || (x.it.id < y.it.id ? -1 : 1))
  // a domain-story group's title, above its outline
  const titles: LabelBox[] = Object.values(b.items)
    .filter((g) => g.type === 'frame' && g.data?.ds === 'group' && g.text)
    .map((g) => ({ x: g.x, y: g.y - 24, w: measure(g.text!, 13.5, 600) + 6, h: 20 }))
  // number circles: at the arrow's start, a little further along while another circle, a group title or a pictogram that
  // is not the arrow's own end is in the way
  const circles: LabelBox[] = []
  for (const { it, shape } of ds) {
    if (it.role !== 'activity' || typeof it.data?.seq !== 'number') continue
    const len = Math.hypot(shape.p2.x - shape.p1.x, shape.p2.y - shape.p1.y)
    const others = obstacles.filter((o) => o.id !== it.from && o.id !== it.to)
    const along = (d: number) => ({ x: shape.p1.x + ((shape.p2.x - shape.p1.x) / (len || 1)) * d, y: shape.p1.y + ((shape.p2.y - shape.p1.y) / (len || 1)) * d })
    let at = dsSeqAt(shape)
    for (let d = Math.min(24, len / 3); d <= Math.max(24, len * 0.42); d += 8) {
      const p = along(d)
      if (!labelHits(p.x, p.y, DS_SEQ, DS_SEQ, [...circles, ...titles, ...others], 2).length) {
        at = p
        break
      }
    }
    circles.push(seqBox(at))
    out.get(it.id)!.seq = at
  }
  // verbs: off the pictograms, every circle, the group titles and the verbs placed before
  const placed: LabelBox[] = []
  for (const { it, shape } of ds) {
    const label = wireLabel(it, shape, [...obstacles, ...circles, ...titles, ...placed])
    if (!label) continue
    out.get(it.id)!.label = label
    if (label.mode !== 'dot') placed.push({ x: label.x - label.w / 2, y: label.y - label.h / 2, w: label.w, h: label.h })
  }
  return out
}
