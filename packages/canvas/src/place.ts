// Auto-placement for comments the agent adds without coordinates: the agent
// knows *what* it is replying to, never where the pixels are.
import type { Board, Item } from './model.js'

const W = 220
const H = 80
const GAP = 12

type Rect = { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * For every freeform `comment` item that names a `target` but gives no `x`/`y`,
 * pick a spot beside the target that does not cover any sticky: right of it
 * first, then below, left, above; several comments on the same target stack.
 * Mutates and returns `content` so it can be rendered as usual.
 */
export function autoPlaceComments(board: Board, content: unknown): unknown {
  if (!content || typeof content !== 'object' || !Array.isArray((content as { items?: unknown }).items)) return content
  const items = (content as { items: Array<Record<string, unknown>> }).items
  // Containers (lanes, frames) are the paper the comment sits on, not obstacles.
  const taken: Rect[] = Object.values(board.items)
    .filter((i) => i.type !== 'arrow' && i.type !== 'lane' && i.type !== 'frame')
    .map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))
  for (const it of items) {
    if (it.type !== 'comment' || typeof it.target !== 'string' || typeof it.x === 'number' || typeof it.y === 'number') continue
    const t = board.items[it.target]
    if (!t) continue
    const w = typeof it.w === 'number' ? it.w : W
    const h = typeof it.h === 'number' ? it.h : H
    const spot = findSpot(t, w, h, taken)
    it.x = spot.x
    it.y = spot.y
    it.w = w
    it.h = h
    taken.push({ x: spot.x, y: spot.y, w, h })
  }
  return content
}

function findSpot(t: Item, w: number, h: number, taken: Rect[]): { x: number; y: number } {
  const candidates = [
    (n: number) => ({ x: t.x + t.w + GAP, y: t.y + n * (h + GAP / 2) }), // right, stacking down
    (n: number) => ({ x: t.x + n * (w + GAP / 2), y: t.y + t.h + GAP }), // below, stacking right
    (n: number) => ({ x: t.x - w - GAP, y: t.y + n * (h + GAP / 2) }), // left
    (n: number) => ({ x: t.x + n * (w + GAP / 2), y: t.y - h - GAP }), // above
  ]
  for (let n = 0; n < 6; n++) {
    for (const side of candidates) {
      const p = side(n)
      const rect = { ...p, w, h }
      if (!taken.some((r) => overlaps(rect, r))) return p
    }
  }
  // Everything nearby is busy: fall through to the right, further out.
  return { x: t.x + t.w + GAP * 4, y: t.y + t.h + GAP * 4 }
}
