// Obstacle-aware smooth-step wires. A smooth-step wire is three straight runs: out of its source, one
// turn, into its target. Where it turns decides what it crosses, so instead of always turning halfway
// (often right through a column of boxes), try the gaps between boxes and keep the turn that crosses
// the fewest boxes. Labels get the same treatment: the first spot along the wire not on a box.
// Pure geometry (no React), so it can be tested on its own.

export type Box = { x: number; y: number; w: number; h: number }
type Seg = { x1: number; y1: number; x2: number; y2: number }

const PAD = 6

/** Does an axis-aligned segment pass through the box (shrunk a little, so grazing an edge is fine)? */
export function hits(s: Seg, b: Box): boolean {
  // the ends in order without building arrays: this runs for every box on every route planSides tries
  const xUp = s.x1 < s.x2
  const yUp = s.y1 < s.y2
  return (xUp ? s.x2 : s.x1) > b.x + 2 && (xUp ? s.x1 : s.x2) < b.x + b.w - 2 && (yUp ? s.y2 : s.y1) > b.y + 2 && (yUp ? s.y1 : s.y2) < b.y + b.h - 2
}

const count = (segs: Seg[], boxes: Box[]) => {
  let n = 0
  for (const b of boxes)
    for (const s of segs)
      if (hits(s, b)) {
        n++
        break
      }
  return n
}

// Counting every candidate against every box is quadratic: a wire from a UI-mock element has hundreds of
// boxes in its span and two candidates per box. But a three-run route moves only its middle run, so the
// candidates at which it crosses one box form at most three open intervals (one per run, read off `hits`),
// which merge into at most two disjoint ones. With every box's intervals as two sorted lists of ends, the
// boxes crossed at v are #{lo < v} − #{hi ≤ v}: two binary searches per candidate. Same counts, n log n.
type Spans = { lo: number[]; hi: number[] }

/** Add the open interval (lo, hi) unless it is empty; a NaN end makes it empty, as a NaN makes `hits` false. */
const within = (s: Spans, lo: number, hi: number) => {
  if (lo < hi) (s.lo.push(lo), s.hi.push(hi))
}

/** How many of the sorted `xs` are below `v` (or equal to it, with `orEqual`). */
function below(xs: Float64Array, v: number, orEqual: boolean): number {
  let l = 0
  let h = xs.length
  while (l < h) {
    const m = (l + h) >> 1
    if (xs[m] < v || (orEqual && xs[m] === v)) l = m + 1
    else h = m
  }
  return l
}

/** The number of intervals containing v, for finite v (the intervals of one box are disjoint, so: boxes). */
function counter(s: Spans): (v: number) => number {
  const lo = new Float64Array(s.lo).sort()
  const hi = new Float64Array(s.hi).sort()
  return (v) => below(lo, v, false) - below(hi, v, true)
}

/**
 * For bestTurn: how many of `between` the route sx,sy → cx → tx,ty crosses, by cx (sx + 4 < cx < tx − 4).
 * The first run (y = sy, sx → cx) hits a box for cx > l, the middle one (x = cx) for l < cx < r, the last
 * one (y = ty, cx → tx) for cx < r — each when the rest of `hits` holds, which does not depend on cx.
 */
function turnCounter(sx: number, sy: number, tx: number, ty: number, between: Box[]): (cx: number) => number {
  const s: Spans = { lo: [], hi: [] }
  const [y1, y2] = sy < ty ? [sy, ty] : [ty, sy]
  for (const b of between) {
    const l = b.x + 2, r = b.x + b.w - 2, t = b.y + 2, u = b.y + b.h - 2
    const first = sx < r && sy > t && sy < u
    const middle = y2 > t && y1 < u
    const last = tx > l && ty > t && ty < u
    // the middle run's (l, r) lies inside either end run's interval
    if (first && last) {
      if (l < r) within(s, -Infinity, Infinity)
      else (within(s, -Infinity, r), within(s, l, Infinity))
    } else if (first) within(s, l, Infinity)
    else if (last) within(s, -Infinity, r)
    else if (middle) within(s, l, r)
  }
  return counter(s)
}

/**
 * Where a right → left wire should make its vertical run. `prefer` is the turn it would like (just in
 * front of the target, staggered per port); among the turns that cross the fewest boxes, the one closest
 * to `prefer` wins.
 */
export function bestTurn(sx: number, sy: number, tx: number, ty: number, boxes: Box[], prefer: number): number {
  // a right-to-left run (a wire going back, left side → right side) is the same problem mirrored
  if (tx < sx) return -bestTurn(-sx, sy, -tx, ty, boxes.map((b) => ({ ...b, x: -(b.x + b.w) })), -prefer)
  if (tx - sx < 2 * PAD) return prefer
  const between = boxes.filter((b) => b.x + b.w > sx && b.x < tx)
  const cands = new Set<number>([prefer, (sx + tx) / 2, sx + 20, tx - 20])
  for (const b of between) {
    if (b.x - 16 > sx + 8) cands.add(b.x - 16)
    if (b.x + b.w + 16 < tx - 8) cands.add(b.x + b.w + 16)
  }
  const crossed = turnCounter(sx, sy, tx, ty, between)
  let best = prefer
  let bestN = Infinity
  for (const cx of cands) {
    if (cx <= sx + 4 || cx >= tx - 4) continue
    const n = Number.isFinite(cx)
      ? crossed(cx)
      : count(
          [
            { x1: sx, y1: sy, x2: cx, y2: sy },
            { x1: cx, y1: sy, x2: cx, y2: ty },
            { x1: cx, y1: ty, x2: tx, y2: ty },
          ],
          between,
        )
    if (n < bestN || (n === bestN && Math.abs(cx - prefer) < Math.abs(best - prefer))) ((best = cx), (bestN = n))
  }
  return best
}

/**
 * For bestLoop: how many of `span` the loop sx,sy → (sx, y) → (tx, y) → tx,ty crosses, by y. A vertical
 * run from y0 to y hits a box whose x-range holds it for every y when y0 is inside the box, for y beyond
 * its top (y > t) when y0 is above it, for y before its bottom (y < u) when y0 is below; the run along
 * (x1 → x2) hits for t < y < u.
 */
function loopCounter(sx: number, sy: number, tx: number, ty: number, x1: number, x2: number, boxes: Box[]): (y: number) => number {
  const s: Spans = { lo: [], hi: [] }
  const [h1, h2] = x1 < x2 ? [x1, x2] : [x2, x1]
  for (const c of boxes) {
    const l = c.x + 2, r = c.x + c.w - 2, t = c.y + 2, u = c.y + c.h - 2
    const v = upDown(sx, sy, l, r, t, u) | upDown(tx, ty, l, r, t, u)
    // 3 is one end inside the box (then t < u) or one above and one below it: every y, unless the box is thinner than the shrink
    if (v === 3) {
      if (t < u) within(s, -Infinity, Infinity)
      else (within(s, -Infinity, u), within(s, t, Infinity))
    } else if (v === 1) within(s, t, Infinity)
    else if (v === 2) within(s, -Infinity, u)
    // the run along: its (t, u) lies inside any of the above
    else if (h2 > l && h1 < r) within(s, t, u)
  }
  return counter(s)
}

/** The y a vertical run at x from y0 hits the box (l, r, t, u) for: 0 none, 1 y > t (y0 above it), 2 y < u (below it), 3 every y (inside it). */
const upDown = (x: number, y0: number, l: number, r: number, t: number, u: number) =>
  !(x > l && x < r) ? 0 : y0 > t && y0 < u ? 3 : y0 < u ? 1 : y0 > t ? 2 : 0

/**
 * A loop that leaves one box and comes back into another behind it (a fix round going back to build):
 * down out of the bottom of both and along underneath, or up out of the top of both and along above.
 * Tries the gaps under (or over) every box in the way and returns the run that crosses the fewest boxes,
 * then the shortest. `a` and `b` are the two boxes; `as`/`bs` shift the ends along their sides (ports).
 */
export function bestLoop(a: Box, b: Box, boxes: Box[], min: number, as = 0, bs = 0): { side: 'bottom' | 'top'; y: number; sx: number; sy: number; tx: number; ty: number; n: number } {
  const sx = a.x + a.w / 2 + as
  const tx = b.x + b.w / 2 + bs
  const [x1, x2] = sx < tx ? [sx, tx] : [tx, sx]
  const span = boxes.filter((c) => c.x + c.w > x1 && c.x < x2)
  let best: ReturnType<typeof bestLoop> | undefined
  let bestLen = Infinity
  for (const side of ['bottom', 'top'] as const) {
    const sy = side === 'bottom' ? a.y + a.h : a.y
    const ty = side === 'bottom' ? b.y + b.h : b.y
    const edge = side === 'bottom' ? Math.max(sy, ty) + min : Math.min(sy, ty) - min
    const ys = [edge, ...span.map((c) => (side === 'bottom' ? c.y + c.h + 14 : c.y - 14))].filter((y) => (side === 'bottom' ? y >= edge : y <= edge))
    const crossed = loopCounter(sx, sy, tx, ty, x1, x2, span)
    for (const y of ys) {
      const n = Number.isFinite(y)
        ? crossed(y)
        : count(
            [
              { x1: sx, y1: sy, x2: sx, y2: y },
              { x1, y1: y, x2, y2: y },
              { x1: tx, y1: ty, x2: tx, y2: y },
            ],
            span,
          )
      const len = Math.abs(y - sy) + Math.abs(y - ty)
      if (!best || n < best.n || (n === best.n && len < bestLen)) ((best = { side, y, sx, sy, tx, ty, n }), (bestLen = len))
    }
  }
  return best!
}

/** The first point along a horizontal run (from x1 to x2 at y) where a label of size w×h sits on no box. */
export function freeLabelSpot(x1: number, x2: number, y: number, w: number, h: number, boxes: Box[]): { x: number; y: number } | undefined {
  for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    const x = x1 + (x2 - x1) * t
    const r = { x: x - w / 2, y: y - h / 2, w, h }
    if (!boxes.some((b) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y)) return { x, y }
  }
  return undefined
}

/**
 * Which sides a wire leaves and enters by. A side the person (or a template) chose is kept; otherwise
 * the wire faces its target: right → left when the target is ahead, a loop under both when it goes back
 * along the same row (a fix round, a bounce), bottom → top / top → bottom when it is above or below.
 * The old fixed right → left made every backward wire leave forwards and wrap across the graph.
 */
export function autoSides(a: Box, b: Box): { fromSide: string; toSide: string } {
  const ahead = b.x >= a.x + a.w + 10
  const behind = b.x + b.w + 10 <= a.x
  const rowsOverlap = b.y < a.y + a.h && a.y < b.y + b.h
  if (ahead) return { fromSide: 'right', toSide: 'left' }
  if (behind && rowsOverlap) return { fromSide: 'bottom', toSide: 'bottom' }
  if (b.y >= a.y + a.h) return { fromSide: 'bottom', toSide: 'top' }
  if (b.y + b.h <= a.y) return { fromSide: 'top', toSide: 'bottom' }
  return behind ? { fromSide: 'left', toSide: 'right' } : { fromSide: 'right', toSide: 'left' }
}

/** bestTurn for a vertical wire (bottom → top, top → bottom): where its horizontal run goes. */
export function bestTurnY(sx: number, sy: number, tx: number, ty: number, boxes: Box[], prefer: number): number {
  return bestTurn(sy, sx, ty, tx, boxes.map((b) => ({ x: b.y, y: b.x, w: b.h, h: b.w })), prefer)
}

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type Point = { x: number; y: number }

/** The middle of one side of a box, shifted `d` along it (a port). */
export function anchor(b: Box, side: Side, d = 0): Point {
  if (side === 'left') return { x: b.x, y: b.y + b.h / 2 + d }
  if (side === 'right') return { x: b.x + b.w, y: b.y + b.h / 2 + d }
  if (side === 'top') return { x: b.x + b.w / 2 + d, y: b.y }
  return { x: b.x + b.w / 2 + d, y: b.y + b.h }
}

export const isHorizontal = (s: string | undefined) => s === 'left' || s === 'right'
/** Is `p` in front of the side `side` that `from` sits on (by more than `m` px)? */
const facing = (side: Side, from: Point, p: Point, m: number) =>
  side === 'right' ? p.x > from.x + m : side === 'left' ? p.x < from.x - m : side === 'bottom' ? p.y > from.y + m : p.y < from.y - m

/** Boxes crossed by a polyline (each box counted once). */
export function crossings(pts: Point[], boxes: Box[]): number {
  const segs: Seg[] = []
  for (let i = 1; i < pts.length; i++) segs.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y })
  return count(segs, boxes)
}

/**
 * The polyline a wire between two boxes takes for a pair of sides, as ItemEdge draws it, or undefined
 * when that pair cannot make a clean route here (a side facing away from the other box):
 * - opposite sides facing each other (right → left, left → right, bottom → top, top → bottom): three runs,
 *   the middle one in the best gap (bestTurn / bestTurnY);
 * - a side into a perpendicular side (right → top …): one bend;
 * - the same vertical side on both (bottom → bottom, top → top): a loop under or over both (bestLoop).
 */
export function routeOf(a: Box, b: Box, from: Side, to: Side, boxes: Box[], ports: { s?: number; t?: number } = {}): Point[] | undefined {
  return route(a, b, from, to, boxes, ports, () => bestLoop(a, b, boxes, 22, ports.s, ports.t))
}

type Loop = ReturnType<typeof bestLoop>

/** routeOf with its loop under or over both boxes given: planSides tries bottom → bottom and top → top on one loop. */
function route(a: Box, b: Box, from: Side, to: Side, boxes: Box[], ports: { s?: number; t?: number }, loop: () => Loop): Point[] | undefined {
  const s = anchor(a, from, ports.s)
  const t = anchor(b, to, ports.t)
  if (from === to) {
    if (isHorizontal(from)) return undefined
    const l = loop()
    if (l.side !== from) return undefined
    return [{ x: l.sx, y: l.sy }, { x: l.sx, y: l.y }, { x: l.tx, y: l.y }, { x: l.tx, y: l.ty }]
  }
  if (isHorizontal(from) === isHorizontal(to)) {
    // opposite sides: the source side must face the target (and so the target side faces back)
    if (!facing(from, s, t, 2 * PAD)) return undefined
    if (isHorizontal(from)) {
      const cx = bestTurn(s.x, s.y, t.x, t.y, boxes, (s.x + t.x) / 2)
      return [s, { x: cx, y: s.y }, { x: cx, y: t.y }, t]
    }
    const cy = bestTurnY(s.x, s.y, t.x, t.y, boxes, (s.y + t.y) / 2)
    return [s, { x: s.x, y: cy }, { x: t.x, y: cy }, t]
  }
  return bend(s, from, t, to)
}

/** A one-bend route from s (leaving by side `from`) into t (entering by side `to`), or undefined when it would double back. */
export function bend(s: Point, from: Side, t: Point, to: Side): Point[] | undefined {
  const corner = isHorizontal(from) ? { x: t.x, y: s.y } : { x: s.x, y: t.y }
  if (!facing(from, s, corner, 2 * PAD)) return undefined
  // the last run arrives from outside the target: entering its top means coming down onto it
  if (!facing(to, t, corner, 2 * PAD)) return undefined
  return [s, corner, t]
}

const PAIRS: Array<[Side, Side]> = [
  ['right', 'left'], ['left', 'right'], ['bottom', 'top'], ['top', 'bottom'],
  ['bottom', 'bottom'], ['top', 'top'],
  ['right', 'top'], ['right', 'bottom'], ['left', 'top'], ['left', 'bottom'],
  ['bottom', 'left'], ['bottom', 'right'], ['top', 'left'], ['top', 'right'],
]

export const routeLength = (pts: Point[]) => pts.slice(1).reduce((n, p, i) => n + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0)

/**
 * The only boxes planSides looks at: those overlapping the bounds of the wire's two boxes, 200 px around
 * (`has`). boardToFlow keeps a wire's sides while the boxes in its window stay put.
 */
export function planWindow(a: Box, b: Box): { x1: number; y1: number; x2: number; y2: number; has: (c: Box) => boolean } {
  const [x1, x2] = [Math.min(a.x, b.x) - 200, Math.max(a.x + a.w, b.x + b.w) + 200]
  const [y1, y2] = [Math.min(a.y, b.y) - 200, Math.max(a.y + a.h, b.y + b.h) + 200]
  return { x1, y1, x2, y2, has: (c) => c.x + c.w > x1 && c.x < x2 && c.y + c.h > y1 && c.y < y2 }
}

/**
 * Which sides a wire leaves and enters by when nobody chose them: every pair of sides (and a loop over or
 * under) is tried and the route that crosses the fewest boxes wins, then the shortest. The facing pair
 * (autoSides) wins any near tie (40 px), so a wire only changes sides when that clears a box or saves
 * real length. `boxes` are the other boxes on the board (not the wire's own two); only those in
 * planWindow count, and the routes (routeOf, crossings) are given only those.
 */
export function planSides(a: Box, b: Box, boxes: Box[]): { fromSide: Side; toSide: Side; n: number } {
  const auto = autoSides(a, b) as { fromSide: Side; toSide: Side }
  const { has } = planWindow(a, b)
  const near = boxes.filter((c) => has(c))
  let best: { fromSide: Side; toSide: Side; n: number } | undefined
  let bestScore = Infinity
  // going back along the same row, a straight left → right wire would lie on top of the forward wire
  // between the same two boxes (build → test, test → build): such a wire loops under or over instead
  const rowsOverlap = b.y < a.y + a.h && a.y < b.y + b.h
  // each pair once: the facing pair first (tried again it would score the same, and only a lower score wins), and
  // bottom → bottom and top → top on the one loop (bestLoop tries under and over both)
  let loop: Loop | undefined
  const loopOnce = () => (loop ??= bestLoop(a, b, near, 22))
  for (const [from, to] of [[auto.fromSide, auto.toSide] as [Side, Side], ...PAIRS.filter(([f, t]) => f !== auto.fromSide || t !== auto.toSide)]) {
    if (rowsOverlap && from === 'left' && to === 'right') continue
    const pts = route(a, b, from, to, near, {}, loopOnce)
    if (!pts) continue
    const n = crossings(pts, near)
    const isAuto = from === auto.fromSide && to === auto.toSide
    const score = n * 1e6 + routeLength(pts) + (isAuto ? 0 : 40)
    if (score < bestScore) ((bestScore = score), (best = { fromSide: from, toSide: to, n }))
  }
  return best ?? { ...auto, n: 0 }
}
