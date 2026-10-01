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
