// Hiding a frame's contents (docs/canvas.md "Hiding a frame"): `data.hidden: true` on a frame, set by the person from
// its menu, and nothing it holds is drawn — the items under it by `parent` (any depth, nested frames too), the wires
// with an end among them, the comment threads about them. The frame itself stays, collapsed to its header strip,
// saying how many items it holds; the model keeps its size, so showing it again restores it. Pure and shared: the page
// draws the board without them (web/src/flow/hiddenFrames.ts), and the outline, the layout check, the snapshot and the
// thumbnail leave them out too, so agents see what the person sees.
import { diagramSpecOf, type Board, type Item, type Op } from './model.js'

/** Height of a hidden frame as drawn: the strip under its title (the title sits above the box, as on any frame). */
export const HIDDEN_FRAME_H = 44
/** Widest a hidden frame is drawn: a strip as wide as a long row of screens (60 000 px) would keep Fit zoomed out to nothing. */
export const HIDDEN_FRAME_W = 640

/** `data` key the drawn copy of a hidden frame carries: how many items it holds. Never stored. */
const COUNT = 'hiddenItems'

export const isHiddenFrame = (it: Item | undefined): boolean => it?.type === 'frame' && it.data?.hidden === true

export interface Hidden {
  /** every item that is not drawn */
  ids: Set<string>
  /** the hidden frames that are drawn (not inside another hidden frame) → how many items they keep from being drawn (wires and comments too) */
  frames: Map<string, number>
  /** for each item not drawn: the drawn hidden frame it is in, or that what it is about is in */
  frameOf: Map<string, string>
}

/** What hidden frames hide on this board; undefined when no frame is hidden. */
export function hiddenOf(board: Pick<Board, 'items'>): Hidden | undefined {
  const items = Object.values(board.items)
  if (!items.some(isHiddenFrame)) return undefined
  const ids = new Set<string>()
  const frames = new Map<string, number>()
  const frameOf = new Map<string, string>()
  // the outermost hidden frame around an item, by `parent` (comments and wires never sit in a frame)
  const outermost = (it: Item): string | undefined => {
    let top: string | undefined
    const seen = new Set<string>([it.id])
    for (let p = it.parent ? board.items[it.parent] : undefined; p && !seen.has(p.id); p = p.parent ? board.items[p.parent] : undefined) {
      seen.add(p.id)
      if (isHiddenFrame(p)) top = p.id
    }
    return top
  }
  for (const it of items) {
    if (it.type === 'comment' || it.type === 'arrow') continue
    const f = outermost(it)
    if (!f) continue
    ids.add(it.id)
    frameOf.set(it.id, f)
  }
  // a wire with an end not drawn, then a thread about anything not drawn (its root's target: an item or a wire)
  for (const it of items) {
    if (it.type !== 'arrow') continue
    const f = frameOf.get(it.from ?? '') ?? frameOf.get(it.to ?? '')
    if (!f) continue
    ids.add(it.id)
    frameOf.set(it.id, f)
  }
  for (const it of items) {
    if (it.type !== 'comment') continue
    const f = frameOf.get(threadTarget(board, it) ?? '')
    if (!f) continue
    ids.add(it.id)
    frameOf.set(it.id, f)
  }
  for (const it of items) if (isHiddenFrame(it) && !ids.has(it.id)) frames.set(it.id, 0)
  for (const f of frameOf.values()) frames.set(f, (frames.get(f) ?? 0) + 1)
  return { ids, frames, frameOf }
}

/** What a comment's thread is about: follow `target` through comments to the root's target (a cycle: none). */
function threadTarget(board: Pick<Board, 'items'>, c: Item): string | undefined {
  const seen = new Set<string>()
  let cur: Item | undefined = c
  while (cur?.type === 'comment' && !seen.has(cur.id)) {
    seen.add(cur.id)
    const next: Item | undefined = cur.target ? board.items[cur.target] : undefined
    if (next?.type !== 'comment') return cur.target
    cur = next
  }
  return undefined
}

/** The board without what its hidden frames hide; each hidden frame stays as stored. The same object when no frame is hidden. */
export function withoutHidden(board: Board, h: Hidden | undefined = hiddenOf(board)): Board {
  if (!h) return board
  const items: Board['items'] = {}
  for (const [id, it] of Object.entries(board.items)) if (!h.ids.has(id)) items[id] = it
  return { ...board, items }
}

/**
 * The board as drawn: without what hidden frames hide, each hidden frame collapsed to its header strip and carrying how
 * many items it holds (hiddenCountOf) — in this copy only. The same object when no frame is hidden.
 */
export function drawnBoard(board: Board, h: Hidden | undefined = hiddenOf(board)): Board {
  if (!h) return board
  const out = withoutHidden(board, h)
  for (const [id, n] of h.frames) {
    const f = out.items[id]
    out.items[id] = { ...f, w: Math.min(f.w, HIDDEN_FRAME_W), h: Math.min(f.h, HIDDEN_FRAME_H), data: { ...f.data, [COUNT]: n } }
  }
  return out
}

/** How many items a drawn hidden frame holds; undefined for any other item. */
export function hiddenCountOf(it: Item | undefined): number | undefined {
  const n = it?.data?.[COUNT]
  return isHiddenFrame(it) && typeof n === 'number' ? n : undefined
}

/** The update that hides a frame's contents or shows them again (an ordinary, undoable op). */
export function hiddenOp(frame: Item, hide: boolean): Op {
  const data = { ...frame.data }
  delete data[COUNT]
  if (hide) data.hidden = true
  else delete data.hidden
  return { kind: 'update', id: frame.id, patch: { data } }
}

/** "1 item", "2681 items". */
export const itemCount = (n: number) => `${n} item${n === 1 ? '' : 's'}`

const title = (f: Item) => (f.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || f.id

/** A drawn hidden frame as agents are told about it. */
export interface HiddenFrame {
  id: string
  /** its diagram key, for a diagram frame */
  key?: string
  title: string
  /** how many items it keeps from being drawn (wires and comments about them too) */
  items: number
}

/** What a reader is told about hidden frames: which there are, and whether what they hold is listed anyway (includeHidden). */
export interface HiddenView {
  list: HiddenFrame[]
  listed: boolean
}

/** The drawn hidden frames, in reading order. */
export function hiddenFrameList(board: Pick<Board, 'items'>, h: Hidden | undefined = hiddenOf(board)): HiddenFrame[] {
  if (!h) return []
  return [...h.frames]
    .map(([id, items]) => ({ f: board.items[id], items }))
    .sort((a, b) => a.f.y - b.f.y || a.f.x - b.f.x)
    .map(({ f, items }) => {
      const key = diagramSpecOf(f)?.key
      return { id: f.id, ...(key ? { key } : {}), title: title(f), items }
    })
}

/** For a board header's item count: ", 2681 more in hidden frames" while their contents are left out. */
export function hiddenTotal(v: HiddenView): string {
  const n = v.list.reduce((sum, f) => sum + f.items, 0)
  return n && !v.listed ? `, ${n} more in hidden frames` : ''
}

/** One line naming the hidden frames, for agents (the outline's header, the summary, canvas_context); none when nothing is hidden. */
export function hiddenFramesLine(list: HiddenFrame[], listed = false): string[] {
  if (!list.length) return []
  const names = list.map((f) => `${[f.key, f.title !== f.key ? `"${f.title}"` : ''].filter(Boolean).join(' ')} (${itemCount(f.items)})`)
  return [`Hidden frames: ${names.join(', ')} — the person hid their contents on the board (not drawn for anyone); ${listed ? 'listed here because of includeHidden: true' : 'canvas_read_board with includeHidden: true lists them'}`]
}
