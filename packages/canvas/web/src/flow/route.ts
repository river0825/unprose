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
  const [x1, x2] = s.x1 < s.x2 ? [s.x1, s.x2] : [s.x2, s.x1]
  const [y1, y2] = s.y1 < s.y2 ? [s.y1, s.y2] : [s.y2, s.y1]
  return x2 > b.x + 2 && x1 < b.x + b.w - 2 && y2 > b.y + 2 && y1 < b.y + b.h - 2
}

const count = (segs: Seg[], boxes: Box[]) => {
  let n = 0
  for (const b of boxes) if (segs.some((s) => hits(s, b))) n++
  return n
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
  let best = prefer
  let bestN = Infinity
  for (const cx of cands) {
    if (cx <= sx + 4 || cx >= tx - 4) continue
    const n = count(
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
    for (const y of ys) {
      const n = count(
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
  const s = anchor(a, from, ports.s)
  const t = anchor(b, to, ports.t)
  if (from === to) {
    if (isHorizontal(from)) return undefined
    const l = bestLoop(a, b, boxes, 22, ports.s, ports.t)
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
 * Which sides a wire leaves and enters by when nobody chose them: every pair of sides (and a loop over or
 * under) is tried and the route that crosses the fewest boxes wins, then the shortest. The facing pair
 * (autoSides) wins any near tie (40 px), so a wire only changes sides when that clears a box or saves
 * real length. `boxes` are the other boxes on the board (not the wire's own two).
 */
export function planSides(a: Box, b: Box, boxes: Box[]): { fromSide: Side; toSide: Side; n: number } {
  const auto = autoSides(a, b) as { fromSide: Side; toSide: Side }
  const [x1, x2] = [Math.min(a.x, b.x) - 200, Math.max(a.x + a.w, b.x + b.w) + 200]
  const [y1, y2] = [Math.min(a.y, b.y) - 200, Math.max(a.y + a.h, b.y + b.h) + 200]
  const near = boxes.filter((c) => c.x + c.w > x1 && c.x < x2 && c.y + c.h > y1 && c.y < y2)
  let best: { fromSide: Side; toSide: Side; n: number } | undefined
  let bestScore = Infinity
  // going back along the same row, a straight left → right wire would lie on top of the forward wire
  // between the same two boxes (build → test, test → build): such a wire loops under or over instead
  const rowsOverlap = b.y < a.y + a.h && a.y < b.y + b.h
  for (const [from, to] of [[auto.fromSide, auto.toSide] as [Side, Side], ...PAIRS]) {
    if (rowsOverlap && from === 'left' && to === 'right') continue
    const pts = routeOf(a, b, from, to, near)
    if (!pts) continue
    const n = crossings(pts, near)
    const isAuto = from === auto.fromSide && to === auto.toSide
    const score = n * 1e6 + routeLength(pts) + (isAuto ? 0 : 40)
    if (score < bestScore) ((bestScore = score), (best = { fromSide: from, toSide: to, n }))
  }
  return best ?? { ...auto, n: 0 }
}
