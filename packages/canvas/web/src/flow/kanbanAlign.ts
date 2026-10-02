// Kanban columns lay themselves out, like the cards inside them (docs/canvas.md "Kanban"): the columns of one
// kanban (same parent — a diagram frame, or the board itself) stand side by side in left → right order on one
// row; cards stack top → bottom in each; every column is tall enough for its cards and as tall as the tallest
// one, and a frame holding them grows to fit. Pure: it returns the board as it is shown, and the moves that
// make a dropped column snap into place. Nothing here shrinks what the person made bigger.
import type { Board, Item } from '../../../src/model'

export const KANBAN_HEADER = 44
export const KANBAN_GAP = 12
export const KANBAN_PAD = 20
const FRAME_PAD = 24

const isColumn = (it: Item) => it.type === 'lane' && it.role === 'column'
const groupKey = (col: Item) => col.parent ?? ''

export type Origins = Map<string, { x: number; y: number }>

/** Where each kanban's row of columns starts: its leftmost and topmost column. */
export function kanbanOrigins(board: Board): Origins {
  const out: Origins = new Map()
  for (const col of Object.values(board.items)) {
    if (!isColumn(col)) continue
    const k = groupKey(col)
    const o = out.get(k)
    out.set(k, o ? { x: Math.min(o.x, col.x), y: Math.min(o.y, col.y) } : { x: col.x, y: col.y })
  }
  return out
}

const cardsOf = (board: Board, col: Item) =>
  Object.values(board.items)
    .filter((it) => it.type === 'card' && it.parent === col.id)
    .sort((a, b) => a.y - b.y || (a.order ?? 0) - (b.order ?? 0))

/**
 * The board as shown: columns side by side, cards stacked, heights grown. `origins` pins where each row starts
 * (used when a column is dropped, so moving the leftmost column does not drag the whole kanban with it).
 */
export function alignKanban(board: Board, origins: Origins = kanbanOrigins(board)): Board {
  const columns = Object.values(board.items).filter(isColumn)
  if (!columns.length) return board
  const patched: Record<string, Item> = {}
  const set = (it: Item, p: Partial<Item>) => {
    const cur = patched[it.id] ?? it
    if (Object.entries(p).every(([k, v]) => (cur as unknown as Record<string, unknown>)[k] === v)) return
    patched[it.id] = { ...cur, ...p }
  }
  const groups = new Map<string, Item[]>()
  for (const c of columns) groups.set(groupKey(c), [...(groups.get(groupKey(c)) ?? []), c])

  for (const [key, cols] of groups) {
    const origin = origins.get(key) ?? { x: Math.min(...cols.map((c) => c.x)), y: Math.min(...cols.map((c) => c.y)) }
    cols.sort((a, b) => a.x - b.x || (a.order ?? 0) - (b.order ?? 0))
    let x = origin.x
    let tallest = 0
    const placed: Array<{ col: Item; x: number }> = []
    for (const col of cols) {
      let y = origin.y + KANBAN_HEADER + KANBAN_GAP
      for (const card of cardsOf(board, col)) {
        set(card, { x: x + KANBAN_PAD, y })
        y += card.h + KANBAN_GAP
      }
      tallest = Math.max(tallest, col.h, y - KANBAN_GAP + KANBAN_PAD - origin.y)
      placed.push({ col, x })
      x += col.w + KANBAN_GAP
    }
    for (const { col, x: cx } of placed) set(col, { x: cx, y: origin.y, h: tallest })
    // the frame around a kanban grows to hold it (never shrinks)
    const frame = key ? board.items[key] : undefined
    if (frame && frame.type === 'frame') {
      const right = x - KANBAN_GAP + FRAME_PAD
      const bottom = origin.y + tallest + FRAME_PAD
      set(frame, { w: Math.max(frame.w, right - frame.x), h: Math.max(frame.h, bottom - frame.y) })
    }
  }
  if (!Object.keys(patched).length) return board
  return { ...board, items: { ...board.items, ...patched } }
}

/**
 * After a drop: the moves (absolute x / y, and h) that put every column of the kanbans the dropped items
 * belong to into its place, with each row starting where it started before the drop.
 */
export function snapColumns(before: Board, after: Board, touched: string[]): Array<{ id: string; patch: Partial<Item> }> {
  const keys = new Set(touched.map((id) => after.items[id]).filter((it): it is Item => !!it && isColumn(it)).map(groupKey))
  if (!keys.size) return []
  const origins = kanbanOrigins(before)
  const shown = alignKanban(after, origins)
  const out: Array<{ id: string; patch: Partial<Item> }> = []
  for (const it of Object.values(shown.items)) {
    const inGroup = isColumn(it) ? keys.has(groupKey(it)) : it.type === 'card' && it.parent ? keys.has(groupKey(after.items[it.parent] ?? it)) && isColumn(after.items[it.parent] ?? it) : false
    if (!inGroup) continue
    const was = after.items[it.id]
    const patch: Partial<Item> = {}
    if (was.x !== it.x) patch.x = it.x
    if (was.y !== it.y) patch.y = it.y
    if (isColumn(it) && was.h !== it.h) patch.h = it.h
    if (Object.keys(patch).length) out.push({ id: it.id, patch })
  }
  return out
}
