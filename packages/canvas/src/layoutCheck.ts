// The layout check (docs/canvas.md "Seeing the board"): pure geometry on where the web draws things — items that
// overlap their siblings, text that is likely cut off, items outside their parent or off their lane, items far
// larger than their siblings (or than the template's sticky), and items the page draws somewhere other than their
// stored coordinates (kanban stacking). Each finding says what to do in plain words. Shared by the server
// (`GET /api/boards/:id/layout`, MCP `canvas_check_layout`) and the web's frame panel.
import { diagramFrameId, diagramOf, type Board, type Item } from './model.js'
import { shownBoard, shownDifferences } from './shown.js'
import { fitText, measure } from './textMetrics.js'
import { EDGE_LABEL, labelControl, labelHits, labelLines, labelSize } from './edgeLabel.js'
import { labelObstacles, wireLabel, wireShape, wireText } from './wireGeometry.js'
/** The template sticky (templates/util.ts STICKY_W × STICKY_H) — not imported: util.ts pulls node:crypto, and the web bundles this file. */
const STICKY_W = 160
const STICKY_H = 110

export type LayoutKind = 'overlap' | 'clipped' | 'label' | 'outside-parent' | 'off-lane' | 'oversized' | 'moved-by-layout'

export interface LayoutFinding {
  /** the item the finding is about */
  id: string
  kind: LayoutKind
  message: string
  /** what to do, in plain words */
  suggestion: string
  /** the other items involved (an overlap's partner) */
  others?: string[]
  /** the diagram key the item belongs to */
  frame?: string
}

export interface LayoutReport {
  findings: LayoutFinding[]
  /** how many items were looked at */
  checked: number
  frame?: string
  /** findings per kind, before `limit` */
  counts: Record<LayoutKind, number>
}

export class LayoutError extends Error {
  constructor(
    message: string,
    public status = 404,
  ) {
    super(message)
  }
}

const KINDS: LayoutKind[] = ['clipped', 'overlap', 'label', 'off-lane', 'outside-parent', 'oversized', 'moved-by-layout']

/** Overlaps smaller than this (in both directions) are hairline touches, not overlaps. */
const OVERLAP_TOL = 6
/** Two sibling containers count as overlapping only when this % of the smaller one is covered. */
const CONTAINER_COVER = 25
/** How far a child may stick out of its parent before it counts as outside. */
const OUTSIDE_TOL = 6
/** Area against the median of its siblings (same parent, type and role) that counts as oversized. */
const OVERSIZE_RATIO = 3
/** A sticky or card bigger than this many template stickies (160×110) is oversized whatever its siblings. */
const OVERSIZE_STICKIES = 3
/** Stored vs drawn positions closer than this are not worth a word. */
const MOVED_TOL = 8
/** Markers and decorations: never part of an overlap. */
const DECOR_ROLES = new Set(['pivotal', 'release-cut', 'phase', 'legend-title', 'scope'])
/** Roles whose size follows their content by design (a backbone activity spans its steps). */
const SPANNING_ROLES = new Set(['activity', 'phase', 'legend-title', 'scope', 'release-cut', 'title', 'heading', 'annotation'])

const isContainer = (it: Item) =>
  it.type === 'frame' || it.type === 'lane' || (it.type === 'wireframe' && it.role === 'screen') || (it.type === 'ui' && Boolean((it.data?.ui as { container?: boolean } | undefined)?.container))
const isLane = (it: Item | undefined) => !!it && it.type === 'lane'

const short = (s: string | undefined, n = 40) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const nameOf = (it: Item) => {
  const t = short(it.text)
  return t ? `${it.role ?? it.type} "${t}"` : `${it.role ?? it.type}`
}
const r = Math.round

/** The container ids of a frame filter: a diagram key, a container id, or a legacy board's kind (= the whole board). */
function scopeOf(board: Board, frame: string | undefined): { root?: string; key?: string } {
  if (!frame) return {}
  const fid = board.items[diagramFrameId(frame)] ? diagramFrameId(frame) : board.items[frame] && isContainer(board.items[frame]) ? frame : undefined
  if (fid) return { root: fid, key: frame }
  if (board.kind !== 'freeform' && frame === board.kind) return { key: frame }
  throw new LayoutError(`no diagram frame or container "${frame}" on this board`)
}

function inside(board: Board, it: Item, root: string): boolean {
  const seen = new Set<string>()
  let cur: Item | undefined = it
  while (cur?.parent && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.parent === root) return true
    cur = board.items[cur.parent]
  }
  return false
}

export function checkLayout(board: Board, opts: { frame?: string; limit?: number } = {}): LayoutReport {
  const { root, key } = scopeOf(board, opts.frame)
  const shown = shownBoard(board)
  const all = Object.values(shown.items).filter((it) => it.type !== 'arrow' && it.type !== 'comment')
  const items = root ? all.filter((it) => inside(shown, it, root)) : all
  const inScope = new Set(items.map((i) => i.id))
  const found: LayoutFinding[] = []
  const frameOf = (it: Item) => diagramOf(board, board.items[it.id] ?? it)?.key
  const add = (it: Item, f: Omit<LayoutFinding, 'id' | 'frame'>) => found.push({ id: it.id, ...f, ...(frameOf(it) ? { frame: frameOf(it) } : {}) })

  // ---- overlaps among siblings (same parent; top-level items share the board) ----
  const byParent = new Map<string, Item[]>()
  for (const it of items) {
    if (DECOR_ROLES.has(it.role ?? '') || it.w <= 8 || it.h <= 8) continue
    const k = it.parent && shown.items[it.parent] ? it.parent : ''
    byParent.set(k, [...(byParent.get(k) ?? []), it])
  }
  for (const sibs of byParent.values()) {
    for (let i = 0; i < sibs.length; i++) {
      for (let j = i + 1; j < sibs.length; j++) {
        const a = sibs[i]
        const b = sibs[j]
        // a container and an item drawn on it (no parent link) is not an overlap; two containers can be
        if (isContainer(a) !== isContainer(b)) continue
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox <= OVERLAP_TOL || oy <= OVERLAP_TOL) continue
        const [first, second] = byReading(a, b) <= 0 ? [a, b] : [b, a]
        const cover = Math.round((100 * ox * oy) / Math.min(a.w * a.h, b.w * b.h))
        // neighbouring lanes and frames may bleed into each other's padding (the templates' lanes do); only a real cover counts
        if (isContainer(a) && cover < CONTAINER_COVER) continue
        const moveX = second.x >= first.x ? first.x + first.w + 20 - second.x : 0
        const moveY = first.y + first.h + 20 - second.y
        const how = moveX > 0 && moveX <= moveY ? `move it ${r(moveX)} px right` : `move it ${r(Math.max(moveY, 0))} px down`
        add(second, {
          kind: 'overlap',
          message: `${nameOf(second)} overlaps ${nameOf(first)} (${ox > 0 ? r(ox) : 0}×${r(oy)} px, ${cover}% of the smaller one)`,
          suggestion: `${how} (to x ${r(second.x + (moveX > 0 && moveX <= moveY ? moveX : 0))}, y ${r(second.y + (moveX > 0 && moveX <= moveY ? 0 : Math.max(moveY, 0)))}), or make one of them smaller`,
          others: [first.id],
        })
      }
    }
  }

  // ---- text likely cut off ----
  for (const it of items) {
    if (!it.text?.trim() || DECOR_ROLES.has(it.role ?? '') || it.role === 'legend') continue
    if (it.type === 'lane' && it.role === 'column') {
      // a column header: one line, ellipsis when longer than the header (padding 12, the card count at the right)
      const room = it.w - 24 - 40
      const need = measure(it.text.split('\n')[0], 13.5, 600)
      if (need > room + 2) add(it, { kind: 'clipped', message: `column title of ${nameOf(it)} is cut short (needs ~${r(need)} px, the header has ${r(room)})`, suggestion: `make the column ${r(need - room + 4)} px wider (w ${r(it.w + need - room + 4)}) or shorten the title` })
      continue
    }
    if (it.type !== 'sticky' && it.type !== 'card' && it.type !== 'text' && !(it.type === 'wireframe' && it.role !== 'screen' && it.role !== 'image' && it.role !== 'nav')) continue
    if (typeof it.data?.ds === 'string' && it.data.ds !== 'annotation') continue // pictograms draw their label under the icon
    // a kanban card keeps a row for labels / assignee / size under its title
    const meta = it.role === 'card' && (Array.isArray(it.data?.labels) && (it.data.labels as unknown[]).length || it.data?.size || it.data?.assignee) ? 26 : 0
    const fit = fitText({ ...it, h: it.h - meta })
    if (!fit.clipped) continue
    const grow = fit.needH - (it.h - meta)
    add(it, {
      kind: 'clipped',
      message: `text of ${nameOf(it)} likely cut off: needs ~${fit.lines.length} line${fit.lines.length === 1 ? '' : 's'} at ${fit.box.font} px, the ${r(it.w)}×${r(it.h)} box fits ${fit.fits}`,
      suggestion: `make it ${grow} px taller (h ${r(it.h + grow)}), or wider, or shorten the text`,
    })
  }

  // ---- outside the parent, off the lane ----
  for (const it of items) {
    const p = it.parent ? shown.items[it.parent] : undefined
    if (!p || !isContainer(p) || DECOR_ROLES.has(it.role ?? '')) continue
    const out = {
      left: p.x - it.x,
      top: p.y - it.y,
      right: it.x + it.w - (p.x + p.w),
      bottom: it.y + it.h - (p.y + p.h),
    }
    const worst = Math.max(out.left, out.top, out.right, out.bottom)
    if (worst <= OUTSIDE_TOL) continue
    const cx = it.x + it.w / 2
    const cy = it.y + it.h / 2
    const centreIn = cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h
    const sides = (Object.entries(out) as Array<[string, number]>).filter(([, v]) => v > OUTSIDE_TOL).map(([s, v]) => `${r(v)} px past the ${s}`)
    const nx = Math.min(Math.max(it.x, p.x + 10), p.x + p.w - it.w - 10)
    const ny = Math.min(Math.max(it.y, p.y + 10), p.y + p.h - it.h - 10)
    const fitsIn = it.w <= p.w - 20 && it.h <= p.h - 20
    const into = fitsIn ? `move it to x ${r(nx)}, y ${r(ny)}` : `make ${nameOf(p)} bigger (it is ${r(p.w)}×${r(p.h)}, the item ${r(it.w)}×${r(it.h)})`
    if (isLane(p) && !centreIn) add(it, { kind: 'off-lane', message: `${nameOf(it)} belongs to ${nameOf(p)} but is drawn outside it (${sides.join(', ')})`, suggestion: `${into}, or set its parent to the lane it is in`, others: [p.id] })
    else add(it, { kind: 'outside-parent', message: `${nameOf(it)} sticks out of ${nameOf(p)}: ${sides.join(', ')}`, suggestion: `${into}${fitsIn ? '' : ''}`, others: [p.id] })
  }

  // ---- oversized against its siblings, or against the template sticky ----
  const groups = new Map<string, Item[]>()
  for (const it of items) {
    if (isContainer(it) || SPANNING_ROLES.has(it.role ?? '') || DECOR_ROLES.has(it.role ?? '')) continue
    const k = `${it.parent ?? ''}|${it.type}|${it.role ?? ''}`
    groups.set(k, [...(groups.get(k) ?? []), it])
  }
  const template = STICKY_W * STICKY_H
  for (const sibs of groups.values()) {
    const areas = sibs.map((s) => s.w * s.h).sort((a, b) => a - b)
    const median = areas[Math.floor(areas.length / 2)]
    for (const it of sibs) {
      const area = it.w * it.h
      const vsSibs = sibs.length >= 3 && area >= OVERSIZE_RATIO * median
      // far bigger than a template sticky while its text would fill less than half of it: scaled up, not long
      const textH = it.text ? fitText({ ...it, h: 10_000 }).needH : 0
      const vsTemplate = (it.type === 'sticky' || it.type === 'card') && area > OVERSIZE_STICKIES * template && textH <= it.h / 2
      if (!vsSibs && !vsTemplate) continue
      const typical = sibs.length >= 3 ? sibs.find((s) => s.w * s.h === median)! : undefined
      const target = typical && vsSibs ? { w: typical.w, h: typical.h, what: 'like its siblings' } : { w: STICKY_W, h: STICKY_H, what: '(the template sticky)' }
      const atTarget = it.text ? fitText({ ...it, w: target.w, h: 10_000 }).needH : 0
      const size =
        atTarget <= target.h
          ? `use ${r(target.w)}×${r(target.h)} ${target.what}`
          : atTarget <= target.h * 2
            ? `use ${r(target.w)}×${r(atTarget)} (the usual width, tall enough for its text)`
            : `its text is long for one ${it.role ?? it.type}: split it into several, or move the detail into a comment or the file, and use ${r(target.w)}×${r(target.h)}`
      add(it, {
        kind: 'oversized',
        message: vsSibs
          ? `${nameOf(it)} is ${r(it.w)}×${r(it.h)}, ${Math.round((area / median) * 10) / 10}× the area of its ${sibs.length - 1} siblings (typically ${typical ? `${r(typical.w)}×${r(typical.h)}` : '?'})`
          : `${nameOf(it)} is ${r(it.w)}×${r(it.h)}, ${Math.round((area / template) * 10) / 10}× a template sticky (${STICKY_W}×${STICKY_H})`,
        suggestion: `${size}; sizes come from the template — do not scale stickies up to fill space`,
      })
    }
  }

  // ---- wire labels: on a card, cut short, or only a dot (edgeLabel.ts — the page and the snapshot place them alike) ----
  const obstacles = labelObstacles(shown)
  for (const w of Object.values(shown.items)) {
    if (w.type !== 'arrow' || !w.from || !w.to || !inScope.has(w.from) || !inScope.has(w.to)) continue
    const text = wireText(w)
    const shape = text ? wireShape(shown, w) : undefined
    const label = shape ? wireLabel(w, shape, obstacles) : undefined
    if (!label || !shape) continue
    const a = shown.items[w.from]
    const z = shown.items[w.to]
    const what = `label "${short(text, 32)}" of the wire ${nameOf(a)} → ${nameOf(z)}`
    if (label.dragged) {
      const covered = labelHits(label.x, label.y, label.w, label.h, obstacles, 0)
      if (!covered.length) continue
      const names = covered.slice(0, 3).map((b) => nameOf(shown.items[b.id])).join(', ')
      add(w, { kind: 'label', message: `${what} covers ${names}: it was dragged there (data.bend)`, suggestion: 'drag the label onto a free stretch of the wire, or clear data.bend so the label is placed automatically beside the wire', others: covered.map((b) => b.id) })
      continue
    }
    if (label.mode !== 'dot' && label.mode !== 'cut') continue
    // the room between the two ends, and what the whole label needs
    const gapX = Math.max(z.x - (a.x + a.w), a.x - (z.x + z.w))
    const gapY = Math.max(z.y - (a.y + a.h), a.y - (z.y + z.h))
    const whole = labelSize(labelLines(text, EDGE_LABEL.maxW, label.font).lines, label.font)
    const across = gapX >= gapY
    const gap = Math.max(0, across ? gapX : gapY)
    const need = (across ? whole.w : whole.h) + EDGE_LABEL.gap * 2 + 4
    const move = across ? `move ${nameOf(z)} ${r(need - gap)} px ${z.x >= a.x ? 'right' : 'left'} (to x ${r(z.x >= a.x ? z.x + need - gap : z.x - (need - gap))})` : `move ${nameOf(z)} ${r(need - gap)} px ${z.y >= a.y ? 'down' : 'up'} (to y ${r(z.y >= a.y ? z.y + need - gap : z.y - (need - gap))})`
    const fit = Math.max(0, Math.floor((Math.min(gap, EDGE_LABEL.maxW) - EDGE_LABEL.gap * 2 - EDGE_LABEL.padX * 2) / (label.font * 0.55)))
    const shorter = labelControl(w.data).short ? 'a shorter data.label.short' : 'a short form in data.label.short'
    const instead = `${fit >= 3 ? `${shorter} (about ${fit} characters fit)` : shorter}, or shorten the label`
    add(w, {
      kind: 'label',
      message:
        label.mode === 'dot'
          ? `${what} has no free spot beside the wire (the gap is ${r(gap)} px, the label needs ~${r(need)}): the page shows only a dot there, the text on hover`
          : `${what} is cut to "${label.lines.join(' ')}" to stay off the cards (the gap is ${r(gap)} px, the whole label needs ~${r(need)})`,
      suggestion: need - gap > 0 ? `${move} to make room, or give it ${instead}` : `give it ${instead}`,
      others: [a.id, z.id],
    })
  }

  // ---- drawn somewhere else than stored ----
  for (const d of shownDifferences(board)) {
    if (!inScope.has(d.id)) continue
    const it = board.items[d.id]
    const moved = Math.abs(d.stored.x - d.shown.x) > MOVED_TOL || Math.abs(d.stored.y - d.shown.y) > MOVED_TOL
    if (!moved || it.type === 'frame') continue // frames and columns only growing taller are not worth a word
    const card = it.type === 'card'
    add(it, {
      kind: 'moved-by-layout',
      message: `${nameOf(it)} is stored at ${r(d.stored.x)},${r(d.stored.y)} but the page draws it at ${r(d.shown.x)},${r(d.shown.y)} (the kanban layout places ${card ? 'cards' : 'columns'})`,
      suggestion: card
        ? 'kanban cards stack in their column in the order of their stored y: set y to reorder (x is ignored); to change columns, set parent (or use the cards API)'
        : 'kanban columns stand side by side in the order of their stored x: set x to reorder them; their y and height follow the row',
    })
  }

  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<LayoutKind, number>
  for (const f of found) counts[f.kind]++
  const pos = (id: string) => shown.items[id] ?? board.items[id]
  found.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || byReading(pos(a.id), pos(b.id)))
  const limit = opts.limit ?? 200
  return { findings: found.slice(0, limit), checked: items.length, ...(key ? { frame: key } : {}), counts }
}

function byReading(a: Item, b: Item): number {
  const ra = Math.round(a.y / 60)
  const rb = Math.round(b.y / 60)
  return ra !== rb ? ra - rb : a.x - b.x
}

/** Plain-text lines for an agent: a count line, then one line per finding (at most `max`). */
export function layoutLines(report: LayoutReport, _board: Board, max = 60): string[] {
  const total = KINDS.reduce((n, k) => n + report.counts[k], 0)
  const where = report.frame ? ` in ${report.frame}` : ''
  if (!total) return [`Layout${where}: nothing overlaps, sticks out or is cut off (${report.checked} items checked).`]
  const parts = KINDS.filter((k) => report.counts[k]).map((k) => `${report.counts[k]} ${k}`)
  const shown = report.findings.slice(0, max)
  const out = [`Layout${where}: ${total} finding(s) — ${parts.join(', ')} (${report.checked} items checked; positions as the page draws them)`]
  for (const f of shown) out.push(`- [${f.kind}] ${f.message} #${f.id} — ${f.suggestion}`)
  if (total > shown.length) out.push(`… ${total - shown.length} more (pass frame to look at one diagram, or fix these and check again)`)
  return out
}
