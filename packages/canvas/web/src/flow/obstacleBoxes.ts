// The boxes a wire keeps off (route.ts, edgeLabel.ts), read from React Flow's store once per change of the
// nodes instead of once per wire per render — and handed to a wire only when a box it can meet has moved.
// Every wire used to subscribe to the whole `nodes` array, so a hover, a selection or a drag anywhere
// re-routed and re-labelled every wire on the board. The pure parts (sameBoxes, boxesNear) are tested on their own.
import { useCallback } from 'react'
import { useStore, type ReactFlowState } from '@xyflow/react'
import type { Item } from '../../../src/model'
import { isLabelObstacle } from '../../../src/edgeLabel'
import { isContainer } from './boardToFlow'
import type { Box } from './route'

export type ObstacleBox = Box & { id: string }

/** Equal when the same boxes stand at the same places, whatever the array identity. */
export function sameBoxes(a: readonly ObstacleBox[], b: readonly ObstacleBox[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = b[i]
    if (p.id !== q.id || p.x !== q.x || p.y !== q.y || p.w !== q.w || p.h !== q.h) return false
  }
  return true
}

/**
 * How far from a wire's two ends a box can still matter, in px: a label is tried within EDGE_LABEL.maxW (168)
 * of the wire's runs, a loop or a turn only meets boxes in the span between the ends (route.ts).
 */
export const NEAR = 200

/**
 * The boxes a wire between (sx, sy) and (tx, ty) can meet: those whose x-range overlaps the wire's (±NEAR),
 * or whose y-range does. route.ts only counts boxes in the span between the ends (bestTurn and bestLoop
 * by x, bestTurnY by y) and edgeLabel.ts only those within maxW of the runs, so a box outside both bands
 * never changes the route or the label — leaving it out changes nothing but how often the wire re-renders.
 * Returns `boxes` itself when every box is near.
 */
export function boxesNear<B extends Box>(boxes: B[], sx: number, sy: number, tx: number, ty: number): B[] {
  const x1 = Math.min(sx, tx) - NEAR
  const x2 = Math.max(sx, tx) + NEAR
  const y1 = Math.min(sy, ty) - NEAR
  const y2 = Math.max(sy, ty) + NEAR
  const out: B[] = []
  for (const b of boxes) if ((b.x + b.w > x1 && b.x < x2) || (b.y + b.h > y1 && b.y < y2)) out.push(b)
  return out.length === boxes.length ? boxes : out
}

// one list per `nodes` array (React Flow replaces the array whenever a node changes; the lookup is kept in step before)
const cache = new WeakMap<object, ObstacleBox[]>()

/** Every box a wire should not run through or put its label on: not containers, comments or thin markers. */
export function obstacleBoxes(s: ReactFlowState): ObstacleBox[] {
  const key = s.nodes
  const hit = cache.get(key)
  if (hit) return hit
  const out: ObstacleBox[] = []
  for (const n of s.nodeLookup.values()) {
    const it = (n.data as { item?: Item } | undefined)?.item
    if (n.hidden || !it || isContainer(it) || !isLabelObstacle(it)) continue
    out.push({ id: n.id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured?.width ?? n.width ?? it.w, h: n.measured?.height ?? n.height ?? it.h })
  }
  cache.set(key, out)
  return out
}

/**
 * The boxes near the wire whose ends are at (sx, sy) and (tx, ty), from React Flow's store. The wire re-renders
 * only when one of those boxes moves, appears or goes — not when a box elsewhere does, nor on selection or hover.
 */
export function useBoxesNear(sx: number, sy: number, tx: number, ty: number): ObstacleBox[] {
  return useStore(
    useCallback((s: ReactFlowState) => boxesNear(obstacleBoxes(s), sx, sy, tx, ty), [sx, sy, tx, ty]),
    sameBoxes,
  )
}
