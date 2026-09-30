// Frozen headers (docs/diagrams.md "Frozen headers"), the pure half: which items head a frame's
// columns and rows, and where their pinned copies go on screen for a given viewport. Templates mark
// the items with `data.header = 'column' | 'row'` (and optionally `data.headerText`).
import { diagramFrames, type Board, type Item } from '../../../src/model'

export interface HeaderGroup {
  /** diagram key ('kanban' on a legacy board-wide diagram) */
  key: string
  title: string
  /** frame box in flow coordinates */
  box: { x: number; y: number; w: number; h: number }
  columns: Item[]
  rows: Item[]
}

const headerOf = (it: Item) => it.data?.header as 'column' | 'row' | undefined
export const headerText = (it: Item) => (typeof it.data?.headerText === 'string' ? it.data.headerText : (it.text ?? '')).replace(/\n+/g, ' ').trim()

function frameOfItem(board: Board, it: Item, frameIds: Set<string>): string | undefined {
  let p = it.parent
  const seen = new Set<string>()
  while (p && !seen.has(p)) {
    if (frameIds.has(p)) return p
    seen.add(p)
    p = board.items[p]?.parent
  }
  return undefined
}

/** Every frame (or legacy board-wide diagram) that has header items. */
export function headerGroups(board: Board): HeaderGroup[] {
  const frames = diagramFrames(board)
  const frameIds = new Set(frames.map((f) => f.frameId))
  const byFrame = new Map<string, Item[]>()
  const loose: Item[] = []
  for (const it of Object.values(board.items)) {
    if (!headerOf(it)) continue
    const f = frameOfItem(board, it, frameIds)
    if (f) byFrame.set(f, [...(byFrame.get(f) ?? []), it])
    else if (board.kind !== 'freeform') loose.push(it)
  }
  const group = (key: string, title: string, box: HeaderGroup['box'], items: Item[]): HeaderGroup => ({
    key,
    title,
    box,
    columns: items.filter((i) => headerOf(i) === 'column').sort((a, b) => a.y - b.y || a.x - b.x),
    rows: items.filter((i) => headerOf(i) === 'row').sort((a, b) => a.y - b.y),
  })
  const out = frames.flatMap((f) => {
    const items = byFrame.get(f.frameId)
    const frame = board.items[f.frameId]
    return items?.length && frame ? [group(f.key, frame.text ?? f.key, { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, items)] : []
  })
  if (loose.length) {
    const boxes = Object.values(board.items).filter((i) => i.type !== 'arrow' && i.type !== 'comment' && !frameOfItem(board, i, frameIds) && !frameIds.has(i.id))
    const x = Math.min(...boxes.map((b) => b.x))
    const y = Math.min(...boxes.map((b) => b.y))
    const box = { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
    out.push(group(board.kind, board.title, box, loose))
  }
  return out
}

export type Viewport = { x: number; y: number; zoom: number }
export interface Cell { id: string; text: string; left: number; top: number; width: number; height: number }
export interface Strips {
  key: string
  /** the frame's visible screen rectangle (strips are clipped to it) */
  clip: { left: number; top: number; right: number; bottom: number }
  top?: { height: number; cells: Cell[] }
  left?: { width: number; cells: Cell[] }
  corner?: string
}

/** Below this zoom the pinned headers would only be noise. */
export const MIN_ZOOM = 0.25
/** A lane / frame used as a column header is a whole column: only its title bar at the top counts. */
const TITLE_BAR = 44
const headH = (it: Item) => (it.type === 'lane' || it.type === 'frame' ? Math.min(it.h, TITLE_BAR) : it.h)
const LEVEL_H = (h: number, z: number) => Math.round(Math.min(40, Math.max(22, h * z)))
const ROW_W = (w: number, z: number) => Math.round(Math.min(200, Math.max(96, w * z)))

/**
 * Where to draw the pinned headers of one group on a `width`×`height` screen area, or undefined when
 * nothing needs pinning (headers still on screen, frame off screen, or zoomed too far out).
 */
export function stripsFor(g: HeaderGroup, vp: Viewport, width: number, height: number): Strips | undefined {
  const z = vp.zoom
  if (z < MIN_ZOOM) return undefined
  const sx = (x: number) => x * z + vp.x
  const sy = (y: number) => y * z + vp.y
  const clip = { left: Math.max(0, sx(g.box.x)), top: Math.max(0, sy(g.box.y)), right: Math.min(width, sx(g.box.x + g.box.w)), bottom: Math.min(height, sy(g.box.y + g.box.h)) }
  if (clip.right - clip.left < 40 || clip.bottom - clip.top < 40) return undefined
  const out: Strips = { key: g.key, clip }

  // Columns: pinned when the header band has scrolled above the top of the screen.
  if (g.columns.length) {
    const bandTop = Math.min(...g.columns.map((c) => c.y))
    const bandBottom = Math.max(...g.columns.map((c) => c.y + headH(c)))
    if (sy(bandTop) < -4 && sy(bandBottom) < clip.bottom - 60) {
      // one strip row per distinct header level (story map: activities above steps)
      const levels = [...new Set(g.columns.map((c) => Math.round(c.y)))].sort((a, b) => a - b)
      const levelH = levels.map((ly) => LEVEL_H(Math.max(...g.columns.filter((c) => Math.round(c.y) === ly).map(headH)), z))
      let top = 0
      const cells: Cell[] = []
      levels.forEach((ly, li) => {
        for (const c of g.columns.filter((cc) => Math.round(cc.y) === ly)) {
          const left = sx(c.x)
          const right = sx(c.x + c.w)
          if (right <= clip.left || left >= clip.right) continue
          cells.push({ id: c.id, text: headerText(c), left, top, width: right - left, height: levelH[li] })
        }
        top += levelH[li]
      })
      if (cells.length) out.top = { height: top, cells }
    }
  }
  // Rows: pinned when the frame's left edge (where row headers read from) has scrolled off to the left.
  if (g.rows.length && sx(g.box.x) < -4) {
    const width = ROW_W(Math.min(240, Math.max(...g.rows.map((r) => Math.min(r.w, 240)))), z)
    const cells: Cell[] = []
    for (const r of g.rows) {
      const top = sy(r.y)
      const bottom = sy(r.y + r.h)
      if (bottom <= clip.top || top >= clip.bottom) continue
      cells.push({ id: r.id, text: headerText(r), left: 0, top, width, height: bottom - top })
    }
    if (cells.length) out.left = { width, cells }
  }
  if (!out.top && !out.left) return undefined
  if (out.top && out.left) out.corner = g.title
  return out
}
