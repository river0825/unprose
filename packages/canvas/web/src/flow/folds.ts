// Folding a wire by hand (docs/canvas.md "Folding a line"), the pure half: a wire's folds are `data.bend`, a list of
// points between its two ends (src/wireGeometry.ts foldsOf), and its runs are [source end, ...folds, target end].
// ItemEdge.tsx drags the handles; these say where a fold goes in, where a dragged one lands (snapped so a run can
// be made exactly straight) and what is stored.
import type { Pt } from '../../../src/edgeLabel'

/** Distance from p to the segment a→b. */
export function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** The run (runs[i] → runs[i + 1]) nearest to p; a fold put into run i goes in at index i of the folds. */
export function nearestRun(runs: Pt[], p: Pt): number {
  let best = 0
  let d = Infinity
  for (let i = 0; i + 1 < runs.length; i++) {
    const e = toSegment(p, runs[i], runs[i + 1])
    if (e < d - 1e-9) ((d = e), (best = i))
  }
  return best
}

/** The folds with fold k at p — put in there (`insert`) or moved there. */
export function withFold(folds: Pt[], k: number, p: Pt, insert: boolean): Pt[] {
  const at = Math.max(0, Math.min(insert ? folds.length : folds.length - 1, k))
  return insert ? [...folds.slice(0, at), p, ...folds.slice(at)] : folds.map((f, i) => (i === at ? p : f))
}

/** The folds without fold k. */
export function removeFold(folds: Pt[], k: number): Pt[] {
  return folds.filter((_, i) => i !== k)
}

/**
 * Where a dragged fold lands: its x snapped to the nearer of its neighbours' x (the fold or end before and after it)
 * when within `tol`, and its y likewise — so the run to that neighbour comes out exactly vertical or horizontal.
 */
export function snapFold(p: Pt, prev: Pt | undefined, next: Pt | undefined, tol: number): Pt {
  const snap = (v: number, cands: number[]) => {
    let best = v
    let d = tol
    for (const c of cands) if (Math.abs(c - v) <= d) ((d = Math.abs(c - v)), (best = c))
    return best
  }
  const ns = [prev, next].filter((q): q is Pt => !!q)
  return { x: snap(p.x, ns.map((q) => q.x)), y: snap(p.y, ns.map((q) => q.y)) }
}

/** The folds as stored: whole board pixels, and a fold on top of the one before it dropped. */
export function roundFolds(folds: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const f of folds) {
    const p = { x: Math.round(f.x), y: Math.round(f.y) }
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  return out
}

/** The middle of every run longer than `minLen`: where a "fold here" handle sits (`i` = the run). */
export function runMiddles(runs: Pt[], minLen = 40): Array<{ i: number; x: number; y: number }> {
  const out: Array<{ i: number; x: number; y: number }> = []
  for (let i = 0; i + 1 < runs.length; i++) {
    const [a, b] = [runs[i], runs[i + 1]]
    if (Math.hypot(b.x - a.x, b.y - a.y) > minLen) out.push({ i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  }
  return out
}

/** A list of folds as a key, to tell whether a plan was made for the folds shown now. */
export const foldsKey = (folds: Pt[]): string => folds.map((f) => `${Math.round(f.x)},${Math.round(f.y)}`).join(';')
