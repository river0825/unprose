// Where the view was before a jump. A link in the panel, "take me there", ⌘K or a deep link moves the viewport
// somewhere else; ⌥← brings it back to where it was, ⌥→ forward again — like a browser. Only jumps are
// recorded (a wheel or a drag is not a place anyone wants to return to), and a jump that lands where the view
// already is does not push a duplicate. This half is pure; useViewHistory.ts ties it to React Flow.
import type { Viewport } from '@xyflow/react'

export interface ViewHistory {
  /** the places the view came from, oldest first */
  back: Viewport[]
  /** the places ⌥← left, nearest first */
  forward: Viewport[]
}

export const VIEW_HISTORY_MAX = 20

export const emptyHistory = (): ViewHistory => ({ back: [], forward: [] })

export function sameView(a: Viewport, b: Viewport): boolean {
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.zoom - b.zoom) < 0.001
}

/** Before a jump: remember where the view is now; a new jump forgets any forward places. */
export function pushView(h: ViewHistory, from: Viewport): ViewHistory {
  const last = h.back[h.back.length - 1]
  if (last && sameView(last, from)) return h.forward.length ? { back: h.back, forward: [] } : h
  return { back: [...h.back, from].slice(-VIEW_HISTORY_MAX), forward: [] }
}

/** ⌥←: the place to go back to, and the history after going there (the current view goes forward). */
export function goBack(h: ViewHistory, from: Viewport): { to: Viewport; next: ViewHistory } | null {
  const to = h.back[h.back.length - 1]
  if (!to) return null
  return { to, next: { back: h.back.slice(0, -1), forward: [from, ...h.forward].slice(0, VIEW_HISTORY_MAX) } }
}

/** ⌥→: the place ⌥← came from. */
export function goForward(h: ViewHistory, from: Viewport): { to: Viewport; next: ViewHistory } | null {
  const to = h.forward[0]
  if (!to) return null
  return { to, next: { back: [...h.back, from].slice(-VIEW_HISTORY_MAX), forward: h.forward.slice(1) } }
}
