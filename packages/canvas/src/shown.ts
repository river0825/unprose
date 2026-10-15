// Where the web draws things, when that differs from the stored coordinates (docs/canvas.md "Seeing the board").
// Kanban columns lay themselves out, like the cards inside them: the columns of one kanban (same parent — a
// diagram frame, or the board itself) stand side by side in left → right order on one row; cards stack top →
// bottom in each; every column is tall enough for its cards and as tall as the tallest one, and a frame holding
// them grows to fit — except what a layout lock keeps in place (docs/diagrams.md "What a redraw keeps"). Pure: it
// returns the board as it is shown, and the moves that make a dropped column snap into place. Nothing here shrinks
// what the person made bigger. Shared by the web (flow/kanbanAlign.ts), the server-side snapshot, the outline and
// the layout check, so all of them agree on where a card really is. What a hidden frame holds is not drawn (hidden.ts).
import { drawnBoard, isHiddenFrame } from './hidden.js'
import { layoutLock, ownLock, type Board, type Item } from './model.js'

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
    // a locked column does not say where the row starts (it stays where it is; the others flow around it)
    if (!isColumn(col) || ownLock(col)) continue
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

// Layout lock (docs/diagrams.md "What a redraw keeps"): a kanban in a locked frame is shown exactly as stored; a
// locked column keeps its place and height (its cards still stack inside it, the other columns flow around it); a
// locked card keeps its place (the other cards in its column stack around it).
const lockedKanban = (board: Board, key: string) => {
  const f = key ? board.items[key] : undefined
  return !!f && f.type === 'frame' && ownLock(f)
}

/** The first position ≥ start where [p, p + size + gap) overlaps none of the fixed spans. */
function nextFree(start: number, size: number, fixed: Array<[number, number]>): number {
  let p = start
  for (let moved = true; moved; ) {
    moved = false
    for (const [a, b] of fixed)
      if (p < b && p + size + KANBAN_GAP > a) {
        p = b
        moved = true
      }
  }
  return p
}

/** Where each card of a column goes (cards stack top → bottom from `top`, around locked cards); returns the bottom. */
export function stackCards(board: Board, col: Item, x: number, top: number, out: Map<string, { x: number; y: number }>): number {
  const cards = cardsOf(board, col)
  const fixed = cards.filter(ownLock).map((c): [number, number] => [c.y, c.y + c.h + KANBAN_GAP])
  let y = top
  let bottom = top
  for (const card of cards) {
    if (ownLock(card)) {
      bottom = Math.max(bottom, card.y + card.h + KANBAN_GAP)
      continue
    }
    y = nextFree(y, card.h, fixed)
    out.set(card.id, { x: x + KANBAN_PAD, y })
    y += card.h + KANBAN_GAP
    bottom = Math.max(bottom, y)
  }
  return bottom
}

/**
 * The board as shown: columns side by side, cards stacked, heights grown. `origins` pins where each row starts
 * (used when a column is dropped, so moving the leftmost column does not drag the whole kanban with it).
 */
export function alignKanban(board: Board, origins: Origins = kanbanOrigins(board)): Board {
  const columns = Object.values(board.items).filter((c) => isColumn(c) && !lockedKanban(board, groupKey(c)))
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
    // a locked column stays where it is; the others flow left → right around it
    const fixed = cols.filter(ownLock).map((c): [number, number] => [c.x, c.x + c.w + KANBAN_GAP])
    let x = origin.x
    let right = origin.x
    let tallest = 0
    const placed: Array<{ col: Item; x: number }> = []
    for (const col of cols) {
      const locked = ownLock(col)
      const cx = locked ? col.x : nextFree(x, col.w, fixed)
      const top = (locked ? col.y : origin.y) + KANBAN_HEADER + KANBAN_GAP
      const cards = new Map<string, { x: number; y: number }>()
      const bottom = stackCards(board, col, cx, top, cards)
      for (const [id, at] of cards) set(board.items[id], at)
      if (!locked) {
        tallest = Math.max(tallest, col.h, bottom - KANBAN_GAP + KANBAN_PAD - origin.y)
        placed.push({ col, x: cx })
        x = cx + col.w + KANBAN_GAP
      }
      right = Math.max(right, cx + col.w + KANBAN_GAP)
    }
    for (const { col, x: cx } of placed) set(col, { x: cx, y: origin.y, h: tallest })
    // the frame around a kanban grows to hold it (never shrinks)
    const frame = key ? board.items[key] : undefined
    if (frame && frame.type === 'frame') {
      const edge = right - KANBAN_GAP + FRAME_PAD
      const bottom = Math.max(origin.y + tallest, ...cols.filter(ownLock).map((c) => c.y + c.h)) + FRAME_PAD
      set(frame, { w: Math.max(frame.w, edge - frame.x), h: Math.max(frame.h, bottom - frame.y) })
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

/** The board as the web draws it: kanban alignment, then hidden frames collapsed without what they hold (hidden.ts). */
export function shownBoard(board: Board): Board {
  return drawnBoard(alignKanban(board))
}

/** Items whose drawn box differs from the stored one, with both boxes and why. */
export function shownDifferences(board: Board): Array<{ id: string; stored: Pick<Item, 'x' | 'y' | 'w' | 'h'>; shown: Pick<Item, 'x' | 'y' | 'w' | 'h'>; why: string }> {
  const shown = shownBoard(board)
  if (shown === board) return []
  const out: Array<{ id: string; stored: Pick<Item, 'x' | 'y' | 'w' | 'h'>; shown: Pick<Item, 'x' | 'y' | 'w' | 'h'>; why: string }> = []
  for (const it of Object.values(board.items)) {
    // a locked item is drawn where it is stored (the layout lock); never "drawn elsewhere" — nor is a hidden frame (collapsed)
    if (layoutLock(board.items, it.id) || isHiddenFrame(it)) continue
    const s = shown.items[it.id]
    if (!s || (s.x === it.x && s.y === it.y && s.w === it.w && s.h === it.h)) continue
    const why =
      it.type === 'card' && it.parent && isColumn(board.items[it.parent] ?? it)
        ? `kanban cards stack in their column in the order of their stored y: drawn at ${s.x},${s.y}, stored at ${it.x},${it.y}`
        : isColumn(it)
          ? 'kanban columns stand side by side and are as tall as the tallest column'
          : it.type === 'frame'
            ? 'the frame grows to hold its kanban'
            : 'drawn elsewhere by the kanban layout'
    out.push({ id: it.id, stored: { x: it.x, y: it.y, w: it.w, h: it.h }, shown: { x: s.x, y: s.y, w: s.w, h: s.h }, why })
  }
  return out
}
