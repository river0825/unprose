// How a wire runs and where its label sits, without a browser — shared by the server snapshot (snapshot.ts) and the
// layout check (layoutCheck.ts), close to what the page draws (web/src/flow/ItemEdge.tsx): orthogonal runs between
// the sides it leaves and enters by, a domain-story activity as a straight line cut at each pictogram, a wire the
// person folded (data.bend) as straight runs through its fold points. A domain-story line that would run through a
// pictogram takes a detour round it (planWires). The label follows edgeLabel.ts. Pure (bundled by the web with layoutCheck).
import type { Board, Item } from './model.js'
import { measure } from './textMetrics.js'
import { EDGE_LABEL, isLabelObstacle, labelControl, labelHits, placeEdgeLabel, type LabelBox, type PlacedLabel, type Pt } from './edgeLabel.js'

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

/** Where the line from box a's centre towards point p leaves box a (plus a small gap): a folded wire's end. */
export function floatingEndTo(a: Box, p: Pt): Pt {
  return floatingEnd(a, { x: p.x, y: p.y, w: 0, h: 0 })
}

/** SVG path data through `pts` (any angles), each inner corner rounded by up to `r` px (0: sharp). */
export function foldedPath(pts: Pt[], r = 8): string {
  const f = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString())
  if (!pts.length) return ''
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
    const k = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2)
    const u = (p: Pt, q: Pt) => {
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1
      return { x: (q.x - p.x) / l, y: (q.y - p.y) / l }
    }
    const [ua, uc] = [u(b, a), u(b, c)]
    d += k > 0 ? `L${f(b.x + ua.x * k)} ${f(b.y + ua.y * k)}Q${f(b.x)} ${f(b.y)} ${f(b.x + uc.x * k)} ${f(b.y + uc.y * k)}` : `L${f(b.x)} ${f(b.y)}`
  }
  const z = pts[pts.length - 1]
  return pts.length > 1 ? `${d}L${f(z.x)} ${f(z.y)}` : d
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
  /** the runs: p1, the points between (via), p2 */
  points: Pt[]
  p1: Pt
  p2: Pt
  /** a domain-story wire: a straight floating line */
  ds: boolean
  /** the points the wire is folded at, between p1 and p2: the person's folds (data.bend), else an automatic detour */
  via: Pt[]
  /** `via` is a detour the board chose (a domain-story line kept off a pictogram), not the person's folds */
  auto?: boolean
}

/**
 * A wire's fold points (`data.bend`): a list of `{ x, y }` in board coordinates, from the source end to the target end.
 * A single `{ x, y }` (what older boards hold) is one fold. Anything that is not a point is left out.
 */
export function foldsOf(data: Record<string, unknown> | undefined): Pt[] {
  const b = data?.bend
  const list = Array.isArray(b) ? b : b && typeof b === 'object' ? [b] : []
  return list.filter((p): p is Pt => typeof (p as Partial<Pt>)?.x === 'number' && typeof (p as Partial<Pt>)?.y === 'number' && Number.isFinite((p as Pt).x) && Number.isFinite((p as Pt).y)).map((p) => ({ x: p.x, y: p.y }))
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString())

/** A wire through `via`: straight runs from p1 to p2, its corners rounded a little (a domain story's barely). */
function folded(p1: Pt, via: Pt[], p2: Pt, ds: boolean, auto?: boolean): WireShape {
  const points = [p1, ...via, p2]
  return { d: foldedPath(points, ds ? 4 : 8), points, p1, p2, ds, via, ...(auto ? { auto } : {}) }
}

export function wireShape(b: Pick<Board, 'items'>, it: Item): WireShape | undefined {
  const from = it.from ? b.items[it.from] : undefined
  const to = it.to ? b.items[it.to] : undefined
  if (!from || !to) return undefined
  const ds = !!it.data?.ds
  // folded by the person: from each end straight towards its nearest fold
  const folds = foldsOf(it.data)
  if (folds.length) return folded(floatingEndTo(from, folds[0]), folds, floatingEndTo(to, folds[folds.length - 1]), ds)
  const auto = autoSides(from, to)
  const s1 = (typeof it.data?.fromSide === 'string' && SIDES.has(it.data.fromSide) ? it.data.fromSide : auto[0]) as Side
  const s2 = (typeof it.data?.toSide === 'string' && SIDES.has(it.data.toSide) ? it.data.toSide : auto[1]) as Side
  const p1 = ds ? floatingEnd(from, to) : anchor(from, s1)
  const p2 = ds ? floatingEnd(to, from) : anchor(to, s2)
  const points = ds ? [p1, p2] : routePoints(p1, s1, p2, s2)
  return { d: points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join(''), points, p1, p2, ds, via: [] }
}

/** Does the segment p→q pass through box b grown by `pad` (shrunk when negative)? (Liang–Barsky clip.) */
export function segmentHits(p: Pt, q: Pt, b: Box, pad = 0): boolean {
  const [x0, y0, x1, y1] = [b.x - pad, b.y - pad, b.x + b.w + pad, b.y + b.h + pad]
  if (x1 <= x0 || y1 <= y0) return false
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  for (const [pp, qq] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]] as const) {
    if (pp === 0) {
      if (qq < 0) return false
      continue
    }
    const r = qq / pp
    if (pp < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return false
  }
  return true
}

/** A line through only this much of a box's edge (its blank margin round a pictogram) does not count as through it. */
const THROUGH_PAD = -6
/** A detour keeps this far off every box. */
const CLEAR_PAD = 2
/** How far beside a box a detour folds. */
const DETOUR_GAP = 30
/** A crossing with another domain-story line costs as much as this much more length. */
const CROSS_COST = 60

type Obstacle = LabelBox & { id: string }

/**
 * The boxes a wire's runs pass through (THROUGH_PAD), its own ends left out where it leaves and enters them — what
 * the layout check reports for a domain-story line no detour could clear, or a line folded through a card.
 */
export function runsThrough(points: Pt[], boxes: Obstacle[], fromId: string | undefined, toId: string | undefined): Obstacle[] {
  const out: Obstacle[] = []
  for (const o of boxes) {
    for (let i = 0; i < points.length - 1; i++) {
      if ((i === 0 && o.id === fromId) || (i === points.length - 2 && o.id === toId)) continue
      if (segmentHits(points[i], points[i + 1], o, THROUGH_PAD)) {
        out.push(o)
        break
      }
    }
  }
  return out
}

const len = (pts: Pt[]) => pts.reduce((v, p, i) => (i ? v + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0)
const samePt = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
const orient = (a: Pt, b: Pt, c: Pt) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))

/** Proper crossings between the runs of `a` and those of each line in `others` (runs sharing an end do not count). */
function crossingsWith(a: Pt[], others: Pt[][]): number {
  let k = 0
  for (const o of others)
    for (let i = 0; i < a.length - 1; i++)
      for (let j = 0; j < o.length - 1; j++) {
        const [p, q, r, s] = [a[i], a[i + 1], o[j], o[j + 1]]
        if (samePt(p, r) || samePt(p, s) || samePt(q, r) || samePt(q, s)) continue
        if (orient(p, q, r) * orient(p, q, s) < 0 && orient(r, s, p) * orient(r, s, q) < 0) k++
      }
  return k
}

const overlapsBox = (o: LabelBox, x0: number, y0: number, x1: number, y1: number) => o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0
const cornersOf = (b: LabelBox, g: number): Pt[] => [
  { x: b.x - g, y: b.y - g },
  { x: b.x + b.w + g, y: b.y - g },
  { x: b.x + b.w + g, y: b.y + b.h + g },
  { x: b.x - g, y: b.y + b.h + g },
]

/**
 * The fold points that take a straight domain-story line from box `from` to box `to` round the boxes it would run
 * through, or undefined when it runs through none (or no detour clears them). One fold where one will do — a corner of a
 * box in the way, or a point beside it — else two (two corners); among those that clear every box (CLEAR_PAD), the
 * shortest, a crossing with another line in `others` counting as CROSS_COST px more. Deterministic: `boxes` in id order.
 */
export function detourOf(from: Obstacle, to: Obstacle, boxes: Obstacle[], others: Pt[][] | (() => Pt[][])): Pt[] | undefined {
  const s = floatingEnd(from, to)
  const t = floatingEnd(to, from)
  const [x0, y0, x1, y1] = [Math.min(s.x, t.x), Math.min(s.y, t.y), Math.max(s.x, t.x), Math.max(s.y, t.y)]
  const hit = boxes.filter((o) => o.id !== from.id && o.id !== to.id && overlapsBox(o, x0 - 1, y0 - 1, x1 + 1, y1 + 1) && segmentHits(s, t, o, THROUGH_PAD))
  if (!hit.length) return undefined
  const L = Math.hypot(t.x - s.x, t.y - s.y) || 1
  const [ux, uy] = [(t.x - s.x) / L, (t.y - s.y) / L]
  const [nx, ny] = [-uy, ux]
  const singles: Pt[] = []
  const beside = (h: LabelBox) => {
    const c = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
    const along = Math.max(0, Math.min(L, (c.x - s.x) * ux + (c.y - s.y) * uy))
    const off = (c.x - s.x) * nx + (c.y - s.y) * ny
    const ext = Math.abs(nx) * (h.w / 2) + Math.abs(ny) * (h.h / 2) + DETOUR_GAP
    return { along, lo: off - ext, hi: off + ext }
  }
  for (const h of hit) {
    singles.push(...cornersOf(h, DETOUR_GAP))
    const { along, lo, hi } = beside(h)
    for (const d of [hi, lo]) singles.push({ x: s.x + ux * along + nx * d, y: s.y + uy * along + ny * d })
  }
  if (hit.length > 1) {
    // beside all of them at once, at their middle
    const bs = hit.map(beside)
    const along = bs.reduce((v, b) => v + b.along, 0) / bs.length
    for (const d of [Math.max(...bs.map((b) => b.hi)), Math.min(...bs.map((b) => b.lo))]) singles.push({ x: s.x + ux * along + nx * d, y: s.y + uy * along + ny * d })
  }
  // the boxes a route through these points can meet
  const pts = [s, t, ...singles]
  const bx0 = Math.min(...pts.map((p) => p.x)) - DETOUR_GAP
  const by0 = Math.min(...pts.map((p) => p.y)) - DETOUR_GAP
  const bx1 = Math.max(...pts.map((p) => p.x)) + DETOUR_GAP
  const by1 = Math.max(...pts.map((p) => p.y)) + DETOUR_GAP
  const near = boxes.filter((o) => overlapsBox(o, bx0, by0, bx1, by1))
  const clear = (route: Pt[]) => {
    for (let i = 0; i < route.length - 1; i++)
      for (const o of near) {
        if ((i === 0 && o.id === from.id) || (i === route.length - 2 && o.id === to.id)) continue
        if (segmentHits(route[i], route[i + 1], o, CLEAR_PAD)) return false
      }
    return true
  }
  const lines = typeof others === 'function' ? others() : others
  let best: { via: Pt[]; score: number } | undefined
  const tryVia = (via: Pt[]) => {
    const route = [floatingEndTo(from, via[0]), ...via, floatingEndTo(to, via[via.length - 1])]
    if (!clear(route)) return
    const score = len(route) + CROSS_COST * crossingsWith(route, lines)
    if (!best || score < best.score - 1e-6) best = { via, score }
  }
  for (const v of singles) tryVia([v])
  if (!best) {
    const corners = hit.flatMap((h) => cornersOf(h, DETOUR_GAP))
    for (const a of corners) for (const b of corners) if (a !== b) tryVia([a, b])
  }
  return best?.via.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
}

/** A domain-story activity's number circle, a little along its first run from its actor (`along` px; default 24). */
export function dsSeqAt(s: WireShape, along = 24): Pt {
  const q = s.points[1] ?? s.p2
  const len = Math.hypot(q.x - s.p1.x, q.y - s.p1.y) || 1
  const d = Math.min(along, len / 3)
  return { x: s.p1.x + ((q.x - s.p1.x) / len) * d, y: s.p1.y + ((q.y - s.p1.y) / len) * d }
}

/** The number circle: 22 px on the page (inspector.css .ds-seq), r 11 in the snapshot. */
export const DS_SEQ = 22

/** A domain-story verb's first choice: beside its first run on the side facing up (or left), past the number. */
export function dsVerbAt(s: WireShape): Pt {
  const q = s.points[1] ?? s.p2
  const len = Math.hypot(q.x - s.p1.x, q.y - s.p1.y) || 1
  const ux = (q.x - s.p1.x) / len
  const uy = (q.y - s.p1.y) / len
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

export type WireLabel = PlacedLabel

/**
 * Where a wire's label goes (edgeLabel.ts): along its runs — a folded wire's too, never pinned to a fold — or undefined
 * for an unlabelled wire. Alone: it does not know the other wires' labels (planWires does).
 */
export function wireLabel(it: Item, shape: WireShape, boxes: LabelBox[]): WireLabel | undefined {
  const text = wireText(it)
  if (!text) return undefined
  const ctl = labelControl(it.data)
  const ds = shape.ds && it.role !== 'annotation-link'
  const font = ds ? EDGE_LABEL.dsFont : EDGE_LABEL.font
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
 * (web ItemEdge via boardToFlow), the snapshot and the layout check. First every domain-story line the person has not
 * folded that would run through a pictogram (or another card) takes a detour round it (detourOf), in sequence order, each
 * avoiding crossings with the lines planned before. Then domain-story wires are placed together so their verbs and
 * number circles keep off each other as well as off the pictograms: first the number circles, in sequence order, each on
 * its arrow's first run near its start (moved a little further along when that spot is taken by another circle); then the
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
  const obstacles = labelObstacles(b).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  const seqOf = (it: Item) => (typeof it.data?.seq === 'number' ? (it.data.seq as number) : Infinity)
  const bySeq = (x: { it: Item }, y: { it: Item }) => seqOf(x.it) - seqOf(y.it) || (x.it.id < y.it.id ? -1 : 1)
  const lines: Array<{ it: Item; shape: WireShape }> = []
  for (const it of wires) {
    const shape = wireShape(b, it)
    if (!shape) continue
    out.set(it.id, { shape })
    if (shape.ds) lines.push({ it, shape })
  }
  // detours: a domain-story line the person has not folded, kept off the boxes it would run through (only boxes near the
  // domain-story lines can be in the way of one)
  lines.sort(bySeq)
  const byId = new Map(obstacles.map((o) => [o.id, o]))
  const ends = lines.flatMap((l) => [b.items[l.it.from!], b.items[l.it.to!]])
  const reach = 400
  const [lx0, ly0] = [Math.min(...ends.map((e) => e.x)) - reach, Math.min(...ends.map((e) => e.y)) - reach]
  const [lx1, ly1] = [Math.max(...ends.map((e) => e.x + e.w)) + reach, Math.max(...ends.map((e) => e.y + e.h)) + reach]
  const nearLines = lines.length ? obstacles.filter((o) => overlapsBox(o, lx0, ly0, lx1, ly1)) : []
  for (const line of lines) {
    if (line.shape.via.length) continue
    const from = byId.get(line.it.from!) ?? { ...b.items[line.it.from!], id: line.it.from! }
    const to = byId.get(line.it.to!) ?? { ...b.items[line.it.to!], id: line.it.to! }
    const via = detourOf(from, to, nearLines, () => lines.filter((l) => l !== line).map((l) => l.shape.points))
    if (!via) continue
    line.shape = folded(floatingEndTo(from, via[0]), via, floatingEndTo(to, via[via.length - 1]), true, true)
    out.get(line.it.id)!.shape = line.shape
  }
  for (const it of wires) {
    const planned = out.get(it.id)
    if (planned && (!planned.shape.ds || it.role === 'annotation-link')) planned.label = wireLabel(it, planned.shape, obstacles)
  }
  const ds = lines.filter((l) => l.it.role !== 'annotation-link')
  // a domain-story group's title, above its outline
  const titles: LabelBox[] = Object.values(b.items)
    .filter((g) => g.type === 'frame' && g.data?.ds === 'group' && g.text)
    .map((g) => ({ x: g.x, y: g.y - 24, w: measure(g.text!, 13.5, 600) + 6, h: 20 }))
  // number circles: on the arrow's first run near its start, a little further along while another circle, a group title or
  // a pictogram that is not the arrow's own end is in the way
  const circles: LabelBox[] = []
  for (const { it, shape } of ds) {
    if (it.role !== 'activity' || typeof it.data?.seq !== 'number') continue
    const q = shape.points[1] ?? shape.p2
    const len = Math.hypot(q.x - shape.p1.x, q.y - shape.p1.y)
    const others = obstacles.filter((o) => o.id !== it.from && o.id !== it.to)
    const along = (d: number) => ({ x: shape.p1.x + ((q.x - shape.p1.x) / (len || 1)) * d, y: shape.p1.y + ((q.y - shape.p1.y) / (len || 1)) * d })
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
