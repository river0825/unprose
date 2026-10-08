// Auto-placement for comments the agent adds without coordinates: the agent
// knows *what* it is replying to, never where the pixels are.
import type { Board, Item } from './model.js'
import { isUiScreen, uiGutterOf, UI_GUTTER } from './diagrams/uiMock.js'

const W = 220
const H = 80
const GAP = 12

type Rect = { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * For every freeform `comment` item that names a `target` but gives no `x`/`y`,
 * pick a spot beside the target that does not cover any sticky: right of it
 * first, then below, left, above; several comments on the same target stack.
 * A target in a UI mock (a screen, or an element / row inside one) gets its comment in the screen's gutter
 * (docs/diagrams.md §6c): at the target's height, below whatever is already there, never on the product.
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
    const screen = uiScreenOf(board, t)
    const w = typeof it.w === 'number' ? it.w : W
    const h = typeof it.h === 'number' ? it.h : H
    const spot = screen ? gutterSpot(screen, t, w, h, taken) : findSpot(t, w, h, taken)
    it.x = spot.x
    it.y = spot.y
    it.w = w
    it.h = h
    taken.push({ x: spot.x, y: spot.y, w, h })
  }
  return content
}

/** The UI-mock screen an item is, or is drawn in (its parent chain), else undefined. */
export function uiScreenOf(board: Pick<Board, 'items'>, it: Item | undefined): Item | undefined {
  const seen = new Set<string>()
  let cur: Item | undefined = it
  while (cur && !seen.has(cur.id)) {
    if (isUiScreen(cur)) return cur
    seen.add(cur.id)
    cur = cur.parent ? board.items[cur.parent] : undefined
  }
  return undefined
}

/** In the screen's gutter, at the target's top or the first free spot below it. */
function gutterSpot(screen: Item, t: Item, w: number, h: number, taken: Rect[]): { x: number; y: number } {
  const g = uiGutterOf(screen)
  const x = g.x
  let y = Math.max(t.y, g.y)
  for (let n = 0; n < taken.length + 1; n++) {
    const rect = { x, y, w, h }
    const hit = taken.filter((r) => overlaps(rect, r)).sort((a, b) => a.y + a.h - (b.y + b.h))
    if (!hit.length) return { x, y }
    y = hit[hit.length - 1].y + hit[hit.length - 1].h + UI_GUTTER.noteGap
  }
  return { x, y }
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
