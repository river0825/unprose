// route.ts counts crossings by intervals instead of box by box (bestTurn, bestLoop), and `hits` builds no
// arrays: the answers must be the very same. The reference below is the code as it was, verbatim; thousands of seeded
// random cases — ends exactly on box edges and on the edges ±2, right → left runs, near ends, thin boxes,
// no boxes, NaN and Infinity — are compared with it, and so is planSides over random boards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchor, autoSides, bend, bestLoop, bestTurn, bestTurnY, crossings, hits, isHorizontal, planSides, routeLength, type Box, type Point, type Side } from '../web/src/flow/route.js'

// ---- the reference: route.ts before the interval count (verbatim, `ref` prefixed)

type Seg = { x1: number; y1: number; x2: number; y2: number }
const PAD = 6

function refHits(s: Seg, b: Box): boolean {
  const [x1, x2] = s.x1 < s.x2 ? [s.x1, s.x2] : [s.x2, s.x1]
  const [y1, y2] = s.y1 < s.y2 ? [s.y1, s.y2] : [s.y2, s.y1]
  return x2 > b.x + 2 && x1 < b.x + b.w - 2 && y2 > b.y + 2 && y1 < b.y + b.h - 2
}

const refCount = (segs: Seg[], boxes: Box[]) => {
  let n = 0
  for (const b of boxes) if (segs.some((s) => refHits(s, b))) n++
  return n
}

function refBestTurn(sx: number, sy: number, tx: number, ty: number, boxes: Box[], prefer: number): number {
  if (tx < sx) return -refBestTurn(-sx, sy, -tx, ty, boxes.map((b) => ({ ...b, x: -(b.x + b.w) })), -prefer)
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
    const n = refCount(
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

function refBestLoop(a: Box, b: Box, boxes: Box[], min: number, as = 0, bs = 0): { side: 'bottom' | 'top'; y: number; sx: number; sy: number; tx: number; ty: number; n: number } {
  const sx = a.x + a.w / 2 + as
  const tx = b.x + b.w / 2 + bs
  const [x1, x2] = sx < tx ? [sx, tx] : [tx, sx]
  const span = boxes.filter((c) => c.x + c.w > x1 && c.x < x2)
  let best: ReturnType<typeof refBestLoop> | undefined
  let bestLen = Infinity
  for (const side of ['bottom', 'top'] as const) {
    const sy = side === 'bottom' ? a.y + a.h : a.y
    const ty = side === 'bottom' ? b.y + b.h : b.y
    const edge = side === 'bottom' ? Math.max(sy, ty) + min : Math.min(sy, ty) - min
    const ys = [edge, ...span.map((c) => (side === 'bottom' ? c.y + c.h + 14 : c.y - 14))].filter((y) => (side === 'bottom' ? y >= edge : y <= edge))
    for (const y of ys) {
      const n = refCount(
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

function refBestTurnY(sx: number, sy: number, tx: number, ty: number, boxes: Box[], prefer: number): number {
  return refBestTurn(sy, sx, ty, tx, boxes.map((b) => ({ x: b.y, y: b.x, w: b.h, h: b.w })), prefer)
}

const facing = (side: Side, from: Point, p: Point, m: number) =>
  side === 'right' ? p.x > from.x + m : side === 'left' ? p.x < from.x - m : side === 'bottom' ? p.y > from.y + m : p.y < from.y - m

function refRouteOf(a: Box, b: Box, from: Side, to: Side, boxes: Box[], ports: { s?: number; t?: number } = {}): Point[] | undefined {
  const s = anchor(a, from, ports.s)
  const t = anchor(b, to, ports.t)
  if (from === to) {
    if (isHorizontal(from)) return undefined
    const l = refBestLoop(a, b, boxes, 22, ports.s, ports.t)
    if (l.side !== from) return undefined
    return [{ x: l.sx, y: l.sy }, { x: l.sx, y: l.y }, { x: l.tx, y: l.y }, { x: l.tx, y: l.ty }]
  }
  if (isHorizontal(from) === isHorizontal(to)) {
    if (!facing(from, s, t, 2 * PAD)) return undefined
    if (isHorizontal(from)) {
      const cx = refBestTurn(s.x, s.y, t.x, t.y, boxes, (s.x + t.x) / 2)
      return [s, { x: cx, y: s.y }, { x: cx, y: t.y }, t]
    }
    const cy = refBestTurnY(s.x, s.y, t.x, t.y, boxes, (s.y + t.y) / 2)
    return [s, { x: s.x, y: cy }, { x: t.x, y: cy }, t]
  }
  return bend(s, from, t, to)
}

const PAIRS: Array<[Side, Side]> = [
  ['right', 'left'], ['left', 'right'], ['bottom', 'top'], ['top', 'bottom'],
  ['bottom', 'bottom'], ['top', 'top'],
  ['right', 'top'], ['right', 'bottom'], ['left', 'top'], ['left', 'bottom'],
  ['bottom', 'left'], ['bottom', 'right'], ['top', 'left'], ['top', 'right'],
]

function refPlanSides(a: Box, b: Box, boxes: Box[]): { fromSide: Side; toSide: Side; n: number } {
  const auto = autoSides(a, b) as { fromSide: Side; toSide: Side }
  const [x1, x2] = [Math.min(a.x, b.x) - 200, Math.max(a.x + a.w, b.x + b.w) + 200]
  const [y1, y2] = [Math.min(a.y, b.y) - 200, Math.max(a.y + a.h, b.y + b.h) + 200]
  const near = boxes.filter((c) => c.x + c.w > x1 && c.x < x2 && c.y + c.h > y1 && c.y < y2)
  let best: { fromSide: Side; toSide: Side; n: number } | undefined
  let bestScore = Infinity
  const rowsOverlap = b.y < a.y + a.h && a.y < b.y + b.h
  for (const [from, to] of [[auto.fromSide, auto.toSide] as [Side, Side], ...PAIRS]) {
    if (rowsOverlap && from === 'left' && to === 'right') continue
    const pts = refRouteOf(a, b, from, to, near)
    if (!pts) continue
    const n = crossings(pts, near)
    const isAuto = from === auto.fromSide && to === auto.toSide
    const score = n * 1e6 + routeLength(pts) + (isAuto ? 0 : 40)
    if (score < bestScore) ((bestScore = score), (best = { fromSide: from, toSide: to, n }))
  }
  return best ?? { ...auto, n: 0 }
}

// ---- seeded random cases

/** mulberry32: the same cases on every run. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]
  return { next, int, pick }
}
type R = ReturnType<typeof rng>

// thin boxes (thinner than the 2 px shrink on each side) as well as ordinary ones
const SIZES = [0, 1, 2, 3, 4, 5, 6, 8, 12, 30, 60, 100, 160]
const randomBox = (r: R, spread = 600): Box => ({ x: r.int(0, spread / 10) * 10 + r.pick([0, 0, 0, 2, -2, 4, 0.5]), y: r.int(0, spread / 10) * 10 + r.pick([0, 0, 0, 2, -2, 4, 0.5]), w: r.pick(SIZES), h: r.pick(SIZES) })
const randomBoxes = (r: R, n: number, spread = 600) => Array.from({ length: n }, () => randomBox(r, spread))

/** A coordinate that is often exactly on a box edge, or on an edge ±2 (where `hits` changes its mind), or a candidate turn. */
function coord(r: R, boxes: Box[], axis: 'x' | 'y', spread = 600): number {
  if (!boxes.length || r.next() < 0.3) return r.int(-50, spread + 50) + r.pick([0, 0, 0.5])
  const b = r.pick(boxes)
  const [p, d] = axis === 'x' ? [b.x, b.w] : [b.y, b.h]
  return r.pick([p, p + d]) + r.pick([0, 0, 2, -2, 4, -4, 16, -16, 20, -20, 8, -8, 1, -1])
}

const sizes = (r: R) => (r.next() < 0.05 ? 0 : r.next() < 0.1 ? r.int(100, 300) : r.int(1, 25))

test('hits: the same answer as before, ends in either order, on the edges, NaN and Infinity', () => {
  const r = rng(9)
  const odd = [NaN, Infinity, -Infinity, -0]
  for (let i = 0; i < 20000; i++) {
    const boxes = randomBoxes(r, 3)
    const b = r.next() < 0.05 ? { ...boxes[0], [r.pick(['x', 'y', 'w', 'h'] as const)]: r.pick(odd) } : boxes[0]
    const v = (axis: 'x' | 'y') => (r.next() < 0.03 ? r.pick(odd) : coord(r, [b], axis))
    const [x, y] = [v('x'), v('y')]
    const s = r.next() < 0.5 ? { x1: x, y1: y, x2: v('x'), y2: y } : { x1: x, y1: y, x2: x, y2: v('y') }
    assert.equal(hits(s, b), refHits(s, b), JSON.stringify({ s, b }))
  }
})

test('bestTurn: the same turn as counting box by box, on seeded random cases', () => {
  const r = rng(1)
  let mirrored = 0
  let near = 0
  for (let i = 0; i < 6000; i++) {
    const boxes = randomBoxes(r, sizes(r))
    const sx = coord(r, boxes, 'x')
    const sy = coord(r, boxes, 'y')
    // ends a few px apart (tx − sx < 2·PAD), or anywhere
    const tx = r.next() < 0.1 ? sx + r.pick([-12, -11, -6, 0, 6, 11, 12, 13]) : coord(r, boxes, 'x')
    const ty = r.next() < 0.2 ? sy : coord(r, boxes, 'y')
    const prefer = r.pick([(sx + tx) / 2, tx - 22, tx - 29, coord(r, boxes, 'x'), sx + 5, tx - 5])
    if (tx < sx) mirrored++
    if (Math.abs(tx - sx) < 2 * PAD) near++
    assert.equal(bestTurn(sx, sy, tx, ty, boxes, prefer), refBestTurn(sx, sy, tx, ty, boxes, prefer), JSON.stringify({ sx, sy, tx, ty, prefer, boxes }))
  }
  assert.ok(mirrored > 1000 && near > 300, `mirrored ${mirrored}, near ${near}`)
})

test('bestTurnY: the same horizontal run as counting box by box', () => {
  const r = rng(2)
  for (let i = 0; i < 3000; i++) {
    const boxes = randomBoxes(r, sizes(r))
    const [sx, tx] = [coord(r, boxes, 'x'), coord(r, boxes, 'x')]
    const [sy, ty] = [coord(r, boxes, 'y'), coord(r, boxes, 'y')]
    const prefer = r.pick([(sy + ty) / 2, coord(r, boxes, 'y')])
    assert.equal(bestTurnY(sx, sy, tx, ty, boxes, prefer), refBestTurnY(sx, sy, tx, ty, boxes, prefer), JSON.stringify({ sx, sy, tx, ty, prefer, boxes }))
  }
})

test('bestLoop: the same loop as counting box by box, on seeded random cases', () => {
  const r = rng(3)
  for (let i = 0; i < 6000; i++) {
    const boxes = randomBoxes(r, sizes(r))
    // the two ends: often boxes of the list itself (a wire's own boxes stand in the span), or boxes whose middle is on an edge
    const end = (): Box => {
      if (boxes.length && r.next() < 0.3) return { ...r.pick(boxes) }
      const w = r.pick([20, 40, 100, 160, 7, 0])
      const h = r.pick([20, 60, 110, 7, 0])
      return { x: coord(r, boxes, 'x') - w / 2, y: coord(r, boxes, 'y') - r.pick([0, h]), w, h }
    }
    const [a, b] = [end(), end()]
    // ItemEdge's min is 22 + 9·rank; a negative one puts the run between the ends
    const min = r.pick([22, 31, 40, 0, 2, -10, -40])
    const as = r.pick([undefined, 0, 8, -8, 16, 2.5])
    const bs = r.pick([undefined, 0, 8, -8, -16, 2.5])
    assert.deepEqual(bestLoop(a, b, boxes, min, as, bs), refBestLoop(a, b, boxes, min, as, bs), JSON.stringify({ a, b, min, as, bs, boxes }))
  }
})

test('bestTurn, bestTurnY, bestLoop: no boxes, NaN and Infinity give what they gave before', () => {
  const r = rng(4)
  const odd = [NaN, Infinity, -Infinity, 0, -0]
  for (let i = 0; i < 3000; i++) {
    const boxes = randomBoxes(r, r.int(0, 12)).map((b) => (r.next() < 0.15 ? { ...b, [r.pick(['x', 'y', 'w', 'h'] as const)]: r.pick(odd) } : b))
    const v = (axis: 'x' | 'y') => (r.next() < 0.12 ? r.pick(odd) : coord(r, boxes, axis))
    const [sx, sy, tx, ty, prefer] = [v('x'), v('y'), v('x'), v('y'), v('x')]
    assert.equal(bestTurn(sx, sy, tx, ty, boxes, prefer), refBestTurn(sx, sy, tx, ty, boxes, prefer), JSON.stringify({ sx, sy, tx, ty, prefer, boxes }))
    assert.equal(bestTurnY(sx, sy, tx, ty, boxes, prefer), refBestTurnY(sx, sy, tx, ty, boxes, prefer))
    const a = { x: v('x'), y: v('y'), w: r.pick([40, 0, NaN]), h: r.pick([60, Infinity, 0]) }
    const b = { x: v('x'), y: v('y'), w: 100, h: 60 }
    const min = r.pick([22, Infinity, NaN, -Infinity, 0])
    assert.deepEqual(bestLoop(a, b, boxes, min), refBestLoop(a, b, boxes, min), JSON.stringify({ a, b, min, boxes }))
  }
  assert.equal(bestTurn(0, 0, 500, 100, [], 250), refBestTurn(0, 0, 500, 100, [], 250))
  assert.deepEqual(bestLoop({ x: 400, y: 0, w: 100, h: 60 }, { x: 0, y: 0, w: 100, h: 60 }, [], 22), refBestLoop({ x: 400, y: 0, w: 100, h: 60 }, { x: 0, y: 0, w: 100, h: 60 }, [], 22))
})

test('bestTurn, bestLoop: a box exactly 4 px thick is crossed by every turn but one through its middle', () => {
  // w = 4: shrunk by 2 on each side it has no inside, so the first and the last run together cross it at every
  // turn except exactly at x + 2 (the first run stops there, the last run starts there)
  const thin = { x: 100, y: 0, w: 4, h: 100 }
  const far = { x: 118, y: 1000, w: 10, h: 10 } // only there to make 118 − 16 = 102 a candidate
  assert.equal(refBestTurn(0, 50, 300, 50, [thin, far], 90), 102)
  assert.equal(bestTurn(0, 50, 300, 50, [thin, far], 90), 102)
  assert.equal(bestTurn(300, 50, 0, 50, [thin, far], 210), refBestTurn(300, 50, 0, 50, [thin, far], 210))
  // h = 4, one end above it and one below: every run along it but at y + 2 crosses it
  const flat = { x: 0, y: 100, w: 400, h: 4 }
  const [a, b] = [{ x: 50, y: 0, w: 40, h: 50 }, { x: 300, y: 100, w: 40, h: 50 }]
  const ref = refBestLoop(a, b, [flat], -48)
  assert.deepEqual({ y: ref.y, n: ref.n }, { y: 102, n: 0 })
  assert.deepEqual(bestLoop(a, b, [flat], -48), ref)
})

test('bestTurn, bestLoop: the same on crowded spans (hundreds of boxes, as a UI mock has)', () => {
  const r = rng(5)
  for (let i = 0; i < 60; i++) {
    const boxes = randomBoxes(r, r.int(200, 500), 2000)
    const [sx, tx] = [coord(r, boxes, 'x', 2000), coord(r, boxes, 'x', 2000)]
    const [sy, ty] = [coord(r, boxes, 'y', 2000), coord(r, boxes, 'y', 2000)]
    assert.equal(bestTurn(sx, sy, tx, ty, boxes, tx - 22), refBestTurn(sx, sy, tx, ty, boxes, tx - 22))
    assert.equal(bestTurnY(sx, sy, tx, ty, boxes, (sy + ty) / 2), refBestTurnY(sx, sy, tx, ty, boxes, (sy + ty) / 2))
    const [a, b] = [r.pick(boxes), r.pick(boxes)]
    const [min, as, bs] = [22 + 9 * r.int(0, 3), r.int(-2, 2) * 16, r.int(-2, 2) * 16]
    assert.deepEqual(bestLoop(a, b, boxes, min, as, bs), refBestLoop(a, b, boxes, min, as, bs))
  }
})

test('planSides: the same sides as with the box-by-box count, on random boards', () => {
  const r = rng(6)
  for (let i = 0; i < 2500; i++) {
    const boxes = randomBoxes(r, r.next() < 0.1 ? r.int(60, 150) : r.int(0, 25), 1200)
    const end = (): Box => (boxes.length && r.next() < 0.3 ? { ...r.pick(boxes) } : { x: coord(r, boxes, 'x', 1200), y: coord(r, boxes, 'y', 1200), w: r.pick([40, 100, 160, 12]), h: r.pick([30, 60, 110, 12]) })
    const [a, b] = [end(), end()]
    assert.deepEqual(planSides(a, b, boxes), refPlanSides(a, b, boxes), JSON.stringify({ a, b, boxes }))
  }
})
