// A server-side picture of a board, a diagram frame or some items — what an agent looks at to judge layout
// (docs/canvas.md "Seeing the board"). Pure: Board → a self-contained SVG (literal colours from the web's
// theme tokens, no CSS variables, no external references), close enough to what the page draws: frames, lanes,
// kanban columns and cards (at the stacked position the page shows, src/shown.ts), stickies with wrapped text
// (src/textMetrics.ts), wireframe primitives, UI mock elements, Domain Storytelling pictograms, wires with
// arrowheads and labels, folded comment badges. A rasterizer (resvg) can turn it into a PNG; that is the
// driving side's job.
import type { Board, ColorToken, Item } from './model.js'
import { shownBoard } from './shown.js'
import { fitText, measure, wrap } from './textMetrics.js'
import { EDGE_LABEL } from './edgeLabel.js'
import { planWires, type WirePlan } from './wireGeometry.js'

export interface SnapshotOptions {
  /** A diagram key (`studio-es`), a frame id (`diagram.studio-es`) or any container item id. */
  frame?: string
  /** Items to show (a container brings its contents). */
  ids?: string[]
  /** Pixels per board unit; default 1, lowered to fit `maxPx`. */
  scale?: number
  theme?: 'light' | 'dark'
  /** Longest side of the image in px (default 2000, at most 4000). */
  maxPx?: number
  /** Padding around the region, in board units (default 24). */
  pad?: number
}

export interface Snapshot {
  svg: string
  width: number
  height: number
  /** The board area drawn (board coordinates, before padding). */
  region: { x: number; y: number; w: number; h: number }
  scale: number
  /** Items drawn (wires and comment badges included). */
  items: number
  notes: string[]
}

export class SnapshotError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const SNAPSHOT_MAX_PX = 4000
const DEFAULT_MAX_PX = 2000
/** Past this many items text is left out (boxes only). */
const TEXT_ITEM_CAP = 3000
const BADGE = 26
const FONT = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace"

interface Palette {
  paper: string
  chrome: string
  chrome2: string
  ink: string
  ink2: string
  ink3: string
  rule: string
  rule2: string
  marker: string
  agent: string
  user: string
  danger: string
  stickyInk: string
  c: Record<ColorToken, string>
}

/** web/src/styles.css: the :root tokens and the dark block. */
const LIGHT: Palette = {
  paper: '#fbfbf9', chrome: '#f0f1f0', chrome2: '#e6e8e6', ink: '#161a1f', ink2: '#444b53', ink3: '#6b727a', rule: '#cfd3d6', rule2: '#aeb4b9',
  marker: '#1f56d6', agent: '#6e3fc4', user: '#1b7f5a', danger: '#b8342a', stickyInk: '#17130f',
  c: { orange: '#ffb648', blue: '#7dbdff', yellow: '#ffe14a', 'pale-yellow': '#fff3b0', lilac: '#d4b4ff', purple: '#c77dff', green: '#9fe39a', pink: '#ffb0cf', red: '#ff7a7a', grey: '#dedcd6', white: '#ffffff' },
}
const DARK: Palette = {
  paper: '#1b2027', chrome: '#12161b', chrome2: '#1a1f26', ink: '#e8eaec', ink2: '#b7bcc3', ink3: '#8a9099', rule: '#2e353d', rule2: '#414a54',
  marker: '#7ea2ff', agent: '#b899f2', user: '#67cfa3', danger: '#f08a7e', stickyInk: '#100d0a',
  c: { orange: '#d9922e', blue: '#4f8fd8', yellow: '#d6ba22', 'pale-yellow': '#c9bd76', lilac: '#a07bd9', purple: '#9d4edd', green: '#66b664', pink: '#d67aa2', red: '#d85a5a', grey: '#6c6b67', white: '#d9d7d0' },
}

/** web/src/ui-mock.css: a UI mock keeps its own theme. */
const UI_LIGHT = { page: '#f6f7f9', surface: '#ffffff', muted: '#f1f3f5', ink: '#111827', ink2: '#4b5563', ink3: '#8b929c', line: '#e6e8eb', line2: '#d3d7dc', ok: '#157f3b', okSoft: '#e3f5e9', warn: '#a15c07', warnSoft: '#fdf1dc', bad: '#c0261b', badSoft: '#fde7e5', info: '#1d5fbf', infoSoft: '#e3eefc' }
const UI_DARK = { page: '#0e1014', surface: '#171a20', muted: '#1f232b', ink: '#f1f3f5', ink2: '#b5bcc6', ink3: '#7e8691', line: '#272c35', line2: '#363c47', ok: '#5fd08a', okSoft: '#173524', warn: '#f2b85b', warnSoft: '#3a2a10', bad: '#ff8a80', badSoft: '#3d1a17', info: '#82b4ff', infoSoft: '#172a47' }
type UiPal = typeof UI_LIGHT

const KIND_NAMES: Record<string, string> = {
  'event-storming': 'EventStorming', 'user-story-map': 'Story map', kanban: 'Kanban', wireframe: 'Wireframe', workflow: 'Workflow',
  'domain-story': 'Domain story', 'user-journey': 'User journey', 'ui-mock': 'UI mock',
}

/** Domain Storytelling glyphs (web/src/flow/nodes/DsIconNode.tsx), 24×24 line drawings. */
const DS_GLYPHS: Record<string, string> = {
  person: '<circle cx="12" cy="7.2" r="3.6"/><path d="M4.6 20.2c0-4.1 3.3-7.2 7.4-7.2s7.4 3.1 7.4 7.2z"/>',
  group: '<circle cx="8.3" cy="8" r="2.8"/><circle cx="15.7" cy="8" r="2.8"/><path d="M2.8 19.4c0-3.3 2.4-5.8 5.5-5.8s5.5 2.5 5.5 5.8z"/><path d="M13.9 13.8c.6-.1 1.2-.2 1.8-.2 3.1 0 5.5 2.5 5.5 5.8h-6.4"/>',
  system: '<rect x="4" y="4.8" width="16" height="11" rx="1.4"/><path d="M2 19.2h20"/><path d="M9.5 19.2l.6-3.4h3.8l.6 3.4"/>',
  document: '<path d="M6.5 2.8h7.6l4.4 4.4v14h-12z"/><path d="M14 2.8v4.5h4.5"/><path d="M9 12h6.5M9 15.5h6.5"/>',
  thing: '<path d="M12 2.8l8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z"/><path d="M3.9 7.4l8.1 4.6 8.2-4.6M12 12v9.2"/>',
  digital: '<ellipse cx="12" cy="5.6" rx="7" ry="2.6"/><path d="M5 5.6v12.8c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V5.6"/><path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>',
  folder: '<path d="M3 6.6c0-.9.7-1.6 1.6-1.6h4.6l2.1 2.3h8.1c.9 0 1.6.7 1.6 1.6v9.3c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6z"/>',
  call: '<path d="M6.7 3.4l2.8.5 1.1 3.4-1.9 1.5a12.2 12.2 0 0 0 6.5 6.5l1.5-1.9 3.4 1.1.5 2.8c.2 1-.6 1.9-1.6 1.9A16.6 16.6 0 0 1 4.8 5c0-1 .9-1.8 1.9-1.6z"/>',
  email: '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3.6 6.4l8.4 6.4 8.4-6.4"/>',
  conversation: '<path d="M4 4.8h16v11.4H10l-4.6 3.8v-3.8H4z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.8v6"/><circle cx="12" cy="7.6" r=".4"/>',
}
DS_GLYPHS.message = DS_GLYPHS.email
DS_GLYPHS.information = DS_GLYPHS.info
const DS_ICONS = new Set(['actor', 'object', 'legend-actor', 'legend-object', 'legend-activity'])

// ── helpers ──────────────────────────────────────────────────────────────────

/** XML text: escaped, without the control characters XML forbids. */
export function esc(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString())

type Box = { x: number; y: number; w: number; h: number }

interface Ctx {
  b: Board
  p: Palette
  text: boolean
  out: string[]
  /** every wire's shape, label and number circle, placed for the whole board (wireGeometry.ts planWires; computed once) */
  plan?: Map<string, WirePlan>
}

const uiOf = (it: Item | undefined) => (it?.type === 'ui' ? (it.data?.ui as Record<string, unknown> | undefined) : undefined)
const isUiBox = (it: Item) => Boolean(uiOf(it)?.container)

function isContainer(it: Item): boolean {
  if (it.type === 'frame' || it.type === 'lane') return true
  if (it.type === 'wireframe') return it.role === 'screen'
  return isUiBox(it)
}

/** Containers with a title drawn above them (frames, screens): the region reaches up to hold it. */
function titledAbove(it: Item): boolean {
  return it.type === 'frame' || (it.type === 'wireframe' && it.role === 'screen') || uiOf(it)?.type === 'screen'
}

function depthOf(b: Board, it: Item): number {
  let d = 0
  let cur = it.parent ? b.items[it.parent] : undefined
  const seen = new Set<string>([it.id])
  while (cur && !seen.has(cur.id) && d < 50) {
    seen.add(cur.id)
    d++
    cur = cur.parent ? b.items[cur.parent] : undefined
  }
  return d
}

function isInside(b: Board, it: Item, ancestor: string): boolean {
  let cur = it.parent ? b.items[it.parent] : undefined
  const seen = new Set<string>([it.id])
  while (cur && !seen.has(cur.id)) {
    if (cur.id === ancestor) return true
    seen.add(cur.id)
    cur = cur.parent ? b.items[cur.parent] : undefined
  }
  return false
}

/** A text block: wrapped lines from `y` (top of the first line box), only as many as fit `maxLines`. */
function textBlock(lines: string[], o: { x: number; y: number; font: number; lh: number; weight?: number; fill: string; anchor?: 'start' | 'middle' | 'end'; family?: string; maxLines?: number; italic?: boolean }): string {
  const shown = lines.slice(0, Math.max(1, o.maxLines ?? lines.length))
  if (!shown.length || shown.every((l) => !l)) return ''
  const base = (o.lh - o.font) / 2 + o.font * 0.8 // baseline inside the line box
  const tspans = shown.map((l, i) => `<tspan x="${n(o.x)}" ${i === 0 ? `y="${n(o.y + base)}"` : `dy="${n(o.lh)}"`}>${esc(l)}</tspan>`).join('')
  return `<text font-size="${n(o.font)}"${o.weight && o.weight !== 400 ? ` font-weight="${o.weight}"` : ''} fill="${o.fill}"${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}${o.family ? ` font-family="${esc(o.family)}"` : ''}${o.italic ? ' font-style="italic"' : ''}>${tspans}</text>`
}

/** One line, cut to `maxW` px with an ellipsis. */
function oneLine(s: string, maxW: number, font: number, weight = 400): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (measure(t, font, weight) <= maxW) return t
  let out = ''
  for (const ch of t) {
    if (measure(out + ch + '…', font, weight) > maxW) break
    out += ch
  }
  return out + '…'
}

const rect = (bx: Box, attrs: string, rx = 0) => `<rect x="${n(bx.x)}" y="${n(bx.y)}" width="${n(Math.max(0, bx.w))}" height="${n(Math.max(0, bx.h))}"${rx ? ` rx="${n(rx)}"` : ''} ${attrs}/>`

// ── region and selection ─────────────────────────────────────────────────────

interface Selection {
  ids: Set<string>
  region: Box
  /** the container the snapshot is of (frame option) */
  root?: Item
}

function boxOf(it: Item): Box {
  if (it.type === 'comment') return { x: it.x, y: it.y, w: BADGE, h: BADGE }
  return { x: it.x, y: it.y, w: it.w, h: it.h }
}

function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The box an item needs on the image (a frame's title sits above it). */
function needOf(it: Item): Box {
  const bx = boxOf(it)
  return titledAbove(it) ? { x: bx.x, y: bx.y - 28, w: Math.max(bx.w, 120), h: bx.h + 28 } : bx
}

function select(b: Board, opts: SnapshotOptions): Selection {
  const all = Object.values(b.items)
  const drawable = (it: Item) => it.type !== 'arrow' && it.type !== 'comment'
  const within = (it: Item, r: Box) => {
    const cx = it.x + it.w / 2
    const cy = it.y + it.h / 2
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
  }
  let ids = new Set<string>()
  let root: Item | undefined
  if (opts.frame) {
    root = b.items[opts.frame] ?? b.items[`diagram.${opts.frame}`]
    if (!root) {
      if (b.kind !== 'freeform' && opts.frame === b.kind) return select(b, { ...opts, frame: undefined })
      const keys = all.filter((i) => i.type === 'frame' && (i.data?.diagram as { key?: string } | undefined)?.key).map((i) => (i.data!.diagram as { key: string }).key)
      throw new SnapshotError(404, `no frame "${opts.frame}" on this board${keys.length ? ` (diagram keys: ${keys.join(', ')})` : ''}`)
    }
    const r = boxOf(root)
    ids.add(root.id)
    for (const it of all) if (drawable(it) && it.id !== root.id && (isInside(b, it, root.id) || (within(it, r) && !(isContainer(it) && it.w * it.h >= root.w * root.h)))) ids.add(it.id)
  } else if (opts.ids?.length) {
    const missing = opts.ids.filter((i) => !b.items[i])
    if (missing.length) throw new SnapshotError(404, `no item ${missing.map((m) => `"${m}"`).join(', ')} on this board`)
    for (const id of opts.ids) {
      const it = b.items[id]
      if (it.type === 'arrow') {
        for (const end of [it.from, it.to]) if (end && b.items[end]) ids.add(end)
        continue
      }
      ids.add(id)
      if (isContainer(it)) for (const o of all) if (drawable(o) && (isInside(b, o, id) || within(o, boxOf(it)))) ids.add(o.id)
    }
  } else {
    ids = new Set(all.filter(drawable).map((i) => i.id))
  }
  // comment threads (root comments) about drawn items; a loose comment inside the region
  const drawn = [...ids].map((id) => b.items[id])
  let region = union(drawn.map(needOf)) ?? { x: 0, y: 0, w: 400, h: 300 }
  if (root) region = needOf(root)
  for (const c of all) {
    if (c.type !== 'comment') continue
    const target = c.target ? b.items[c.target] : undefined
    if (target?.type === 'comment') continue // a reply: inside its thread's badge
    if ((target && ids.has(target.id)) || (!target && (!opts.frame && !opts.ids?.length ? true : within({ ...c, w: BADGE, h: BADGE }, region)))) ids.add(c.id)
  }
  if (!root) region = union([...ids].map((id) => needOf(b.items[id]))) ?? region
  // wires whose both ends are drawn
  for (const a of all) if (a.type === 'arrow' && a.from && a.to && ids.has(a.from) && ids.has(a.to)) ids.add(a.id)
  return { ids, region, root }
}

// ── drawing ──────────────────────────────────────────────────────────────────

function pendingMark(c: Ctx, it: Item, bx: Box): string {
  const kind = (it.data?.pending as { kind?: string } | undefined)?.kind
  const label = kind === 'remove' ? 'remove · proposed' : 'proposed'
  return rect(bx, `fill="none" stroke="${c.p.marker}" stroke-width="1.5" stroke-dasharray="5 4"`, 3) + (c.text ? `<text x="${n(bx.x + bx.w - 4)}" y="${n(bx.y - 4)}" font-size="10" font-weight="600" text-anchor="end" fill="${c.p.marker}">${label}</text>` : '')
}

function drawFrame(c: Ctx, it: Item): string {
  const { p } = c
  const bx = boxOf(it)
  const ds = it.data?.ds === 'group'
  const parts: string[] = []
  if (ds) parts.push(rect(bx, `fill="none" stroke="${p.ink3}" stroke-width="1.6" stroke-dasharray="6 5"`, 18))
  else parts.push(rect(bx, `fill="${p.chrome}" fill-opacity="0.45" stroke="${p.rule2}" stroke-width="1"`, 4))
  if (c.text && it.text) {
    const spec = it.data?.diagram as { kind?: string } | undefined
    let x = bx.x
    if (spec?.kind) {
      const name = KIND_NAMES[spec.kind] ?? spec.kind
      const bw = measure(name, 11, 600) + 12
      parts.push(rect({ x, y: bx.y - 22, w: bw, h: 17 }, `fill="${p.chrome}" stroke="${p.rule}"`, 4))
      parts.push(`<text x="${n(x + 6)}" y="${n(bx.y - 9.5)}" font-size="11" font-weight="600" fill="${p.ink2}">${esc(name)}</text>`)
      x += bw + 6
    }
    parts.push(`<text x="${n(x)}" y="${n(bx.y - 9)}" font-size="13.5" font-weight="600" fill="${p.ink2}">${esc(oneLine(it.text, Math.max(bx.w + 400, 200), 13.5, 600))}</text>`)
  }
  return parts.join('')
}

function drawLane(c: Ctx, it: Item): string {
  const { p, b } = c
  const bx = boxOf(it)
  if (it.role === 'column') {
    const count = Object.values(b.items).filter((o) => o.type === 'card' && o.parent === it.id).length
    const wip = typeof it.data?.wip === 'number' ? (it.data.wip as number) : undefined
    const over = wip !== undefined && count > wip
    const countText = wip !== undefined ? `${count}/${wip}${over ? ' over' : ''}` : String(count)
    const cw = measure(countText, 12) + 4
    return [
      rect(bx, `fill="${p.chrome}" fill-opacity="0.55" stroke="${p.rule}"`, 4),
      rect({ x: bx.x, y: bx.y, w: bx.w, h: 44 }, `fill="${p.chrome}"`, 4),
      `<line x1="${n(bx.x)}" y1="${n(bx.y + 44)}" x2="${n(bx.x + bx.w)}" y2="${n(bx.y + 44)}" stroke="${p.rule}"/>`,
      c.text ? `<text x="${n(bx.x + 12)}" y="${n(bx.y + 27)}" font-size="13.5" font-weight="600" fill="${p.ink}">${esc(oneLine(it.text ?? '', bx.w - 32 - cw, 13.5, 600))}</text>` : '',
      c.text ? `<text x="${n(bx.x + bx.w - 12)}" y="${n(bx.y + 27)}" font-size="12" text-anchor="end" font-family="${esc(MONO)}" fill="${over ? p.danger : p.ink2}"${over ? ' font-weight="600"' : ''}>${esc(countText)}</text>` : '',
    ].join('')
  }
  return rect(bx, `fill="${p.chrome}" fill-opacity="0.3" stroke="${p.rule}"`) + (c.text && it.text ? `<text x="${n(bx.x + 10)}" y="${n(bx.y + 21)}" font-size="13.5" font-weight="600" fill="${p.ink2}">${esc(oneLine(it.text, Math.max(bx.w * 3, 300), 13.5, 600))}</text>` : '')
}

/** The words inside a sticky / card / text item: wrapped like the page, cut where the box ends. */
function itemText(c: Ctx, it: Item, fill: string, bx: Box = boxOf(it)): string {
  if (!c.text || !it.text) return ''
  const f = fitText({ ...it, w: bx.w, h: bx.h })
  const { box } = f
  const lines = f.lines
  const max = Math.max(1, f.fits)
  if (box.center) {
    const used = Math.min(lines.length, max) * box.lineHeight
    const top = bx.y + Math.max(box.padTop, (bx.h - used) / 2)
    return textBlock(lines, { x: bx.x + bx.w / 2, y: top, font: box.font, lh: box.lineHeight, weight: box.weight, fill, anchor: 'middle', maxLines: max })
  }
  return textBlock(lines, { x: bx.x + box.padLeft, y: bx.y + box.padTop, font: box.font, lh: box.lineHeight, weight: box.weight, fill, maxLines: max })
}

function roleLabel(c: Ctx, it: Item, fill: string): string {
  if (!c.text || !it.role || it.w < 70) return ''
  return `<text x="${n(it.x + it.w - 6)}" y="${n(it.y + it.h - 4)}" font-size="10.5" font-weight="500" text-anchor="end" fill="${fill}" fill-opacity="0.6">${esc(it.role.replace(/-/g, ' '))}</text>`
}

function drawSticky(c: Ctx, it: Item): string {
  const { p } = c
  const bx = boxOf(it)
  const fill = p.c[it.color ?? 'yellow'] ?? p.c.yellow
  const body = [
    rect(bx, `fill="${fill}"`, 2),
    `<line x1="${n(bx.x)}" y1="${n(bx.y + bx.h - 0.5)}" x2="${n(bx.x + bx.w)}" y2="${n(bx.y + bx.h - 0.5)}" stroke="#000" stroke-opacity="0.08"/>`,
    itemText(c, it, p.stickyInk),
    it.role !== 'actor' ? roleLabel(c, it, p.stickyInk) : '',
  ].join('')
  return it.role === 'hotspot' ? `<g transform="rotate(-3 ${n(bx.x + bx.w / 2)} ${n(bx.y + bx.h / 2)})">${body}</g>` : body
}

function drawCard(c: Ctx, it: Item): string {
  const { p } = c
  const bx = boxOf(it)
  if (it.role === 'card') {
    const labels = Array.isArray(it.data?.labels) ? (it.data.labels as unknown[]).filter((l): l is string => typeof l === 'string') : []
    const size = typeof it.data?.size === 'string' ? it.data.size : undefined
    const assignee = typeof it.data?.assignee === 'string' ? it.data.assignee : undefined
    const hasMeta = labels.length > 0 || !!size || !!assignee
    const parts = [rect(bx, `fill="${p.paper}" stroke="${p.rule2}"`, 4), `<line x1="${n(bx.x + 2)}" y1="${n(bx.y + bx.h + 0.5)}" x2="${n(bx.x + bx.w - 2)}" y2="${n(bx.y + bx.h + 0.5)}" stroke="${p.rule}"/>`]
    parts.push(itemText(c, it, p.ink, hasMeta ? { ...bx, h: bx.h - 24 } : bx))
    if (c.text && hasMeta) {
      const y = bx.y + bx.h - 10 - 16
      let x = bx.x + 12
      for (const l of labels) {
        const w = measure(l, 11.5) + 12
        if (x + w > bx.x + bx.w - 12 - (size ? 30 : 0)) break
        const risk = /^risk:(high|highest)$/i.test(l)
        parts.push(rect({ x, y, w, h: 16 }, `fill="${p.chrome}" stroke="${risk ? p.danger : p.rule2}"`, 3), `<text x="${n(x + 6)}" y="${n(y + 12)}" font-size="11.5" fill="${risk ? p.danger : p.ink2}">${esc(l)}</text>`)
        x += w + 6
      }
      if (assignee) parts.push(`<text x="${n(x)}" y="${n(y + 12)}" font-size="11.5" fill="${p.agent}">${esc(oneLine(assignee, Math.max(20, bx.x + bx.w - x - 40), 11.5))}</text>`)
      if (size) {
        const w = measure(size, 11.5) + 10
        parts.push(rect({ x: bx.x + bx.w - 12 - w, y, w, h: 16 }, `fill="none" stroke="${p.rule2}"`, 3), `<text x="${n(bx.x + bx.w - 12 - w / 2)}" y="${n(y + 12)}" font-size="11.5" text-anchor="middle" font-family="${esc(MONO)}" fill="${p.ink}">${esc(size)}</text>`)
      }
    }
    return parts.join('')
  }
  const accent = it.color ? p.c[it.color] : p.marker
  const tinted = it.color && it.color !== 'white'
  return [
    rect(bx, `fill="${p.chrome}" stroke="${p.rule2}"`, 2),
    tinted ? rect(bx, `fill="${accent}" fill-opacity="0.18"`, 2) : '',
    rect({ x: bx.x, y: bx.y, w: 3, h: bx.h }, `fill="${accent}"`),
    itemText(c, it, p.ink),
    roleLabel(c, it, p.ink),
  ].join('')
}

function drawText(c: Ctx, it: Item): string {
  const { p } = c
  const bx = boxOf(it)
  if (it.data?.ds === 'annotation') {
    const path = `M${n(bx.x + bx.w)} ${n(bx.y)}H${n(bx.x)}V${n(bx.y + bx.h)}H${n(bx.x + bx.w)}`
    // the page's text box for an annotation (textMetrics.ts): what is cut there is cut here
    const fit = fitText(it)
    const lines = c.text && it.text ? fit.lines : []
    return `<path d="${path}" fill="none" stroke="${p.ink2}" stroke-width="2"/>` + textBlock(lines, { x: bx.x + fit.box.padLeft, y: bx.y + fit.box.padTop, font: fit.box.font, lh: fit.box.lineHeight, fill: p.ink, maxLines: Math.max(1, fit.fits) })
  }
  if (it.role === 'release-cut') return `<line x1="${n(bx.x)}" y1="${n(bx.y + bx.h / 2)}" x2="${n(bx.x + bx.w)}" y2="${n(bx.y + bx.h / 2)}" stroke="${p.ink3}" stroke-width="1.5" stroke-dasharray="8 5"/>` + (c.text && it.text ? `<text x="${n(bx.x + 4)}" y="${n(bx.y + bx.h / 2 - 4)}" font-size="11" fill="${p.ink3}">${esc(it.text)}</text>` : '')
  return itemText(c, it, p.ink)
}

function drawWireframe(c: Ctx, it: Item): string {
  const { p } = c
  const bx = boxOf(it)
  const role = it.role ?? 'box'
  const t = it.text ?? ''
  const mid = (s: string, fill: string, weight = 400) => (c.text && s ? `<text x="${n(bx.x + bx.w / 2)}" y="${n(bx.y + bx.h / 2 + 4.5)}" font-size="13" text-anchor="middle" font-weight="${weight}" fill="${fill}">${esc(oneLine(s, bx.w - 10, 13, weight))}</text>` : '')
  switch (role) {
    case 'screen':
      return rect(bx, `fill="${p.chrome}" stroke="${p.ink2}" stroke-width="1.5"`, 4) + (c.text && t ? `<text x="${n(bx.x)}" y="${n(bx.y - 9)}" font-size="13.5" font-weight="600" fill="${p.ink2}">${esc(t)}</text>` : '')
    case 'button':
      return rect(bx, `fill="${p.ink2}"`, 4) + mid(t, p.paper, 500)
    case 'input':
      return rect(bx, `fill="${p.paper}" stroke="${p.ink2}"`, 4) + (c.text ? `<text x="${n(bx.x + 8)}" y="${n(bx.y + bx.h / 2 + 4.5)}" font-size="13" fill="${p.ink3}">${esc(oneLine(t || 'Input', bx.w - 16, 13))}</text>` : '')
    case 'heading':
      return c.text ? textBlock(wrap(t, bx.w - 8, 17, 600), { x: bx.x + 4, y: bx.y + 2, font: 17, lh: 22, weight: 600, fill: p.ink, maxLines: Math.max(1, Math.floor((bx.h - 4) / 22)) }) : ''
    case 'paragraph': {
      const lines: string[] = []
      for (let y = bx.y + 4; y < bx.y + bx.h - 2; y += 9) lines.push(`<rect x="${n(bx.x + 4)}" y="${n(y)}" width="${n(bx.w - 8)}" height="2" fill="${p.rule2}"/>`)
      return lines.join('') + (c.text && t ? textBlock(wrap(t, bx.w - 8, 13), { x: bx.x + 4, y: bx.y + 2, font: 13, lh: 19.5, fill: p.ink2, maxLines: Math.max(1, Math.floor((bx.h - 4) / 19.5)) }) : '')
    }
    case 'image':
      return rect(bx, `fill="${p.chrome}" stroke="${p.ink2}"`) + `<path d="M${n(bx.x)} ${n(bx.y)}L${n(bx.x + bx.w)} ${n(bx.y + bx.h)}M${n(bx.x + bx.w)} ${n(bx.y)}L${n(bx.x)} ${n(bx.y + bx.h)}" stroke="${p.rule2}" stroke-width="1.5"/>` + mid(t || 'Image', p.ink3)
    case 'nav': {
      const items = (t || 'Home, About').split(/\s*[·|,]\s*/)
      let x = bx.x + 12
      const words = c.text ? items.map((s) => { const out = `<text x="${n(x)}" y="${n(bx.y + bx.h / 2 + 4.5)}" font-size="13" font-weight="500" fill="${p.ink}">${esc(s)}</text>`; x += measure(s, 13, 500) + 14; return out }).join('') : ''
      return rect(bx, `fill="${p.chrome}"`) + `<line x1="${n(bx.x)}" y1="${n(bx.y + bx.h)}" x2="${n(bx.x + bx.w)}" y2="${n(bx.y + bx.h)}" stroke="${p.ink2}"/>` + words
    }
    default: {
      const dashed = role === 'box' ? ' stroke-dasharray="5 4"' : ''
      return rect(bx, `fill="${p.paper}" stroke="${p.ink2}"${dashed}`) + (c.text && t ? textBlock(wrap(t, bx.w - 16, 13), { x: bx.x + 8, y: bx.y + 4, font: 13, lh: 19.5, fill: p.ink, maxLines: Math.max(1, Math.floor((bx.h - 8) / 19.5)) }) : '')
    }
  }
}

function drawDsIcon(c: Ctx, it: Item): string {
  const { p } = c
  const bx = boxOf(it)
  const ds = String(it.data?.ds ?? '')
  const legend = ds.startsWith('legend-')
  const parts: string[] = []
  let top = bx.y + 2
  if (ds === 'legend-activity') {
    const x = bx.x + bx.w / 2 - 60
    parts.push(`<g transform="translate(${n(x)} ${n(top)})"><line x1="4" y1="15" x2="108" y2="15" stroke="${p.ink}" stroke-width="1.6"/><path d="M108 10l9 5-9 5z" fill="${p.ink}"/><circle cx="26" cy="15" r="10" fill="${p.paper}" stroke="${p.ink}" stroke-width="1.6"/><text x="26" y="19.5" text-anchor="middle" font-size="12" fill="${p.ink}">1</text><text x="72" y="10" text-anchor="middle" font-size="11" fill="${p.ink}">verb</text></g>`)
    top += 34
  } else {
    const size = legend ? 36 : 52
    const isActor = ds === 'actor' || ds === 'legend-actor'
    const kind = typeof it.data?.kind === 'string' ? it.data.kind : ''
    const glyph = DS_GLYPHS[kind] ?? DS_GLYPHS[isActor ? 'person' : 'document']
    const s = size / 24
    parts.push(`<g transform="translate(${n(bx.x + bx.w / 2 - size / 2)} ${n(top)}) scale(${n(s)})" fill="none" stroke="${p.ink}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`)
    top += size + 4
  }
  if (c.text && it.text) {
    const font = legend ? 11.5 : 13
    const lh = Math.round(font * 1.25 * 10) / 10
    const lines = wrap(it.text, bx.w, font)
    parts.push(textBlock(lines, { x: bx.x + bx.w / 2, y: top, font, lh, fill: legend ? p.ink2 : p.ink, anchor: 'middle', maxLines: Math.max(1, Math.floor((bx.y + bx.h - top) / lh)) }))
  }
  return parts.join('')
}

/** The nearest UI screen up the parent chain: its theme and accent hold for the elements in it. */
function uiContext(b: Board, it: Item): { pal: UiPal; accent: string; radius: number } {
  let theme: unknown
  let accent: unknown
  let radius: unknown
  let cur: Item | undefined = it
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    const u = uiOf(cur)
    if (u) {
      theme ??= u.theme
      accent ??= u.accent
      radius ??= u.radius
    }
    cur = cur.parent ? b.items[cur.parent] : undefined
  }
  return { pal: theme === 'dark' ? UI_DARK : UI_LIGHT, accent: typeof accent === 'string' && /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : '#4f46e5', radius: typeof radius === 'number' ? radius : 8 }
}

function drawUi(c: Ctx, it: Item): string {
  const u = uiOf(it) ?? {}
  const type = String(u.type ?? 'box')
  const { pal, accent, radius } = uiContext(c.b, it)
  const bx = boxOf(it)
  const t = it.text ?? ''
  const tx = c.text
  const word = (s: string, x: number, y: number, o: { size?: number; weight?: number; fill?: string; anchor?: string; maxW?: number } = {}) =>
    tx && s ? `<text x="${n(x)}" y="${n(y)}" font-size="${o.size ?? 14}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''} fill="${o.fill ?? pal.ink}">${esc(oneLine(s, o.maxW ?? bx.w - 16, o.size ?? 14, o.weight ?? 400))}</text>` : ''
  const midY = bx.y + bx.h / 2 + 5
  const items = Array.isArray(u.items) ? (u.items as Array<{ text?: string; active?: boolean; meta?: string } | string>).map((x) => (typeof x === 'string' ? { text: x } : x)) : []
  const tone = (k: unknown) => (k === 'success' ? [pal.ok, pal.okSoft] : k === 'warning' ? [pal.warn, pal.warnSoft] : k === 'danger' ? [pal.bad, pal.badSoft] : k === 'info' ? [pal.info, pal.infoSoft] : [pal.ink2, pal.muted])
  switch (type) {
    case 'screen': {
      const phone = u.device === 'phone'
      return (phone ? rect({ x: bx.x - 6, y: bx.y - 6, w: bx.w + 12, h: bx.h + 12 }, 'fill="#1c1f24"', 34) : '') + rect(bx, `fill="${pal.page}" stroke="${pal.line2}"`, phone ? 28 : u.device === 'tablet' ? 18 : 10) + (tx && t ? `<text x="${n(bx.x)}" y="${n(bx.y - (phone ? 15 : 9))}" font-size="13.5" font-weight="600" fill="${c.p.ink2}">${esc(t)}</text>` : '')
    }
    case 'card':
      return rect(bx, `fill="${pal.surface}" stroke="${pal.line}"`, radius) + word(t, bx.x + 16, bx.y + 26, { size: 15, weight: 600 })
    case 'section':
      return u.bg === 'muted' ? rect(bx, `fill="${pal.muted}"`) : u.bg === 'accent' ? rect(bx, `fill="${accent}" fill-opacity="0.11"`) : u.bg === 'surface' ? rect(bx, `fill="${pal.surface}"`) : ''
    case 'navbar': {
      let x = bx.x + 20 + measure(t, 16, 700) + 28
      const links = items.map((l) => { const on = l.text === u.active || l.active; const s = word(l.text ?? '', x, midY, { size: 14, weight: on ? 600 : 500, fill: on ? accent : pal.ink2 }); x += measure(l.text ?? '', 14, 500) + 20; return s }).join('')
      return rect(bx, `fill="${pal.surface}"`) + `<line x1="${n(bx.x)}" y1="${n(bx.y + bx.h)}" x2="${n(bx.x + bx.w)}" y2="${n(bx.y + bx.h)}" stroke="${pal.line}"/>` + word(t, bx.x + 20, midY, { size: 16, weight: 700 }) + links
    }
    case 'sidebar': {
      const rows = items.map((l, i) => { const y = bx.y + 16 + i * 36; const on = l.text === u.active || l.active; return (on ? rect({ x: bx.x + 8, y, w: bx.w - 16, h: 32 }, `fill="${accent}" fill-opacity="0.11"`, radius) : '') + word(l.text ?? '', bx.x + 20, y + 21, { fill: on ? accent : pal.ink2, weight: on ? 600 : 500 }) }).join('')
      return rect(bx, `fill="${pal.surface}"`) + `<line x1="${n(bx.x + bx.w)}" y1="${n(bx.y)}" x2="${n(bx.x + bx.w)}" y2="${n(bx.y + bx.h)}" stroke="${pal.line}"/>` + word(t, bx.x + 20, bx.y + 4, { size: 12, fill: pal.ink3 }) + rows
    }
    case 'heading': {
      const size = [0, 28, 22, 18, 16][Number(u.level) || 2] ?? 18
      return tx && t ? textBlock(wrap(t, bx.w, size, 650), { x: bx.x, y: bx.y, font: size, lh: Math.round(size * 1.3), weight: 650, fill: pal.ink, maxLines: Math.max(1, Math.floor(bx.h / Math.round(size * 1.3))) }) : ''
    }
    case 'text': {
      const size = u.variant === 'small' ? 12.5 : 14
      return tx && t ? textBlock(wrap(t, bx.w, size), { x: bx.x, y: bx.y, font: size, lh: u.variant === 'small' ? 18 : 21, fill: u.variant === 'muted' || u.variant === 'small' ? pal.ink3 : pal.ink2, family: u.variant === 'code' ? MONO : undefined, maxLines: Math.max(1, Math.floor(bx.h / 21)) }) : ''
    }
    case 'link':
      return word(t, bx.x, midY, { fill: accent, weight: 500 })
    case 'button': {
      const v = u.variant ?? 'primary'
      const bg = v === 'primary' ? `fill="${accent}"` : v === 'danger' ? `fill="${pal.bad}"` : v === 'secondary' ? `fill="${pal.surface}" stroke="${pal.line2}"` : 'fill="none"'
      const ink = v === 'primary' || v === 'danger' ? '#ffffff' : v === 'link' || v === 'ghost' ? accent : pal.ink
      return (v === 'link' ? '' : rect(bx, bg, radius)) + word(t, bx.x + bx.w / 2, midY, { anchor: 'middle', weight: 600, fill: ink, maxW: bx.w - 12 })
    }
    case 'input': case 'select': case 'search': case 'textarea': {
      const labelled = t && bx.h >= 56 && type !== 'search'
      const field = labelled ? { x: bx.x, y: bx.y + 24, w: bx.w, h: Math.min(bx.h - 24, type === 'textarea' ? bx.h - 24 : 40) } : bx
      const val = u.value !== undefined && u.value !== '' ? String(u.value) : ''
      const shown = val || String(u.placeholder ?? (type === 'search' ? t || 'Search' : ''))
      return (labelled ? word(t, bx.x, bx.y + 15, { size: 13, weight: 500 }) : '') + rect(field, `fill="${pal.surface}" stroke="${pal.line2}"`, radius) + word(shown, field.x + 12, field.y + (type === 'textarea' ? 24 : field.h / 2 + 5), { fill: val ? pal.ink : pal.ink3, maxW: field.w - 24 }) + (type === 'select' ? `<path d="M${n(field.x + field.w - 22)} ${n(field.y + field.h / 2 - 2)}l5 5 5-5" fill="none" stroke="${pal.ink3}" stroke-width="1.6"/>` : '')
    }
    case 'checkbox': case 'radio': case 'toggle': {
      const on = !!u.checked
      const y = bx.y + bx.h / 2
      const ctl = type === 'toggle'
        ? rect({ x: bx.x, y: y - 10, w: 36, h: 20 }, `fill="${on ? accent : pal.line2}"`, 10) + `<circle cx="${n(bx.x + (on ? 26 : 10))}" cy="${n(y)}" r="7" fill="#ffffff"/>`
        : type === 'radio'
          ? `<circle cx="${n(bx.x + 8)}" cy="${n(y)}" r="8" fill="${pal.surface}" stroke="${on ? accent : pal.line2}" stroke-width="1.5"/>` + (on ? `<circle cx="${n(bx.x + 8)}" cy="${n(y)}" r="4" fill="${accent}"/>` : '')
          : rect({ x: bx.x, y: y - 8, w: 16, h: 16 }, on ? `fill="${accent}"` : `fill="${pal.surface}" stroke="${pal.line2}" stroke-width="1.5"`, 4) + (on ? `<path d="M${n(bx.x + 3.5)} ${n(y)}l3 3 6-6" fill="none" stroke="#fff" stroke-width="1.8"/>` : '')
      return ctl + word(t, bx.x + (type === 'toggle' ? 46 : 26), y + 5, { maxW: bx.w - 48 })
    }
    case 'badge': {
      const [ink, soft] = tone(u.tone)
      const w = Math.min(bx.w, measure(t, 12, 600) + 16)
      return rect({ x: bx.x, y: bx.y + bx.h / 2 - 10, w, h: 20 }, `fill="${soft}"`, 10) + word(t, bx.x + w / 2, bx.y + bx.h / 2 + 4, { size: 12, weight: 600, fill: ink, anchor: 'middle', maxW: w - 8 })
    }
    case 'avatar': {
      const r = Math.min(bx.w, bx.h) / 2
      const initials = t.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase()
      return `<circle cx="${n(bx.x + r)}" cy="${n(bx.y + bx.h / 2)}" r="${n(r)}" fill="${accent}" fill-opacity="0.18"/>` + word(initials, bx.x + r, bx.y + bx.h / 2 + 4.5, { size: Math.max(9, r * 0.8), weight: 600, fill: accent, anchor: 'middle' })
    }
    case 'icon':
      return `<circle cx="${n(bx.x + bx.w / 2)}" cy="${n(bx.y + bx.h / 2)}" r="${n(Math.min(bx.w, bx.h) / 3)}" fill="none" stroke="${pal.ink2}" stroke-width="1.6"/>`
    case 'divider':
      return `<line x1="${n(bx.x)}" y1="${n(bx.y + bx.h / 2)}" x2="${n(bx.x + bx.w)}" y2="${n(bx.y + bx.h / 2)}" stroke="${pal.line}"/>`
    case 'spacer':
      return ''
    case 'image':
      return rect(bx, `fill="${pal.muted}"`, radius) + `<path d="M${n(bx.x + bx.w * 0.3)} ${n(bx.y + bx.h * 0.65)}l${n(bx.w * 0.15)} -${n(bx.h * 0.2)} ${n(bx.w * 0.1)} ${n(bx.h * 0.1)} ${n(bx.w * 0.12)} -${n(bx.h * 0.15)} ${n(bx.w * 0.13)} ${n(bx.h * 0.25)}z" fill="${pal.line2}"/>` + word(t, bx.x + bx.w / 2, bx.y + bx.h - 10, { size: 12, fill: pal.ink3, anchor: 'middle' })
    case 'table': {
      const cols = Array.isArray(u.columns) ? (u.columns as unknown[]).map(String) : []
      const rows = Array.isArray(u.rows) ? (u.rows as unknown[][]) : []
      const rh = Math.min(44, bx.h / Math.max(1, rows.length + 1))
      const cw = bx.w / Math.max(1, cols.length || (rows[0]?.length ?? 1))
      const out = [rect(bx, `fill="${pal.surface}" stroke="${pal.line}"`, radius), rect({ x: bx.x, y: bx.y, w: bx.w, h: rh }, `fill="${pal.muted}"`, radius)]
      cols.forEach((h, i) => out.push(word(h, bx.x + i * cw + 12, bx.y + rh / 2 + 4.5, { size: 12.5, weight: 600, fill: pal.ink2, maxW: cw - 16 })))
      rows.forEach((r, ri) => {
        const y = bx.y + rh * (ri + 1)
        if (y + rh > bx.y + bx.h + 1) return
        out.push(`<line x1="${n(bx.x)}" y1="${n(y)}" x2="${n(bx.x + bx.w)}" y2="${n(y)}" stroke="${pal.line}"/>`)
        ;(Array.isArray(r) ? r : []).forEach((cell, ci) => {
          const s = String(cell ?? '')
          const status = /^\[(.+)\]$/.exec(s)
          if (status) {
            const w = measure(status[1], 12, 600) + 16
            out.push(rect({ x: bx.x + ci * cw + 12, y: y + rh / 2 - 10, w, h: 20 }, `fill="${pal.muted}"`, 10), word(status[1], bx.x + ci * cw + 20, y + rh / 2 + 4, { size: 12, weight: 600, fill: pal.ink2 }))
          } else out.push(word(s, bx.x + ci * cw + 12, y + rh / 2 + 5, { size: 14, fill: ci === 0 ? pal.ink : pal.ink2, weight: ci === 0 ? 500 : 400, maxW: cw - 16 }))
        })
      })
      return out.join('')
    }
    case 'list': {
      const rh = Math.min(56, bx.h / Math.max(1, items.length))
      return rect(bx, `fill="${pal.surface}" stroke="${pal.line}"`, radius) + items.map((l, i) => { const y = bx.y + i * rh; return (i ? `<line x1="${n(bx.x)}" y1="${n(y)}" x2="${n(bx.x + bx.w)}" y2="${n(y)}" stroke="${pal.line}"/>` : '') + word(l.text ?? '', bx.x + 14, y + (l.meta ? rh / 2 - 1 : rh / 2 + 5), { weight: 500 }) + (l.meta ? word(l.meta, bx.x + 14, y + rh / 2 + 15, { size: 13, fill: pal.ink3 }) : '') }).join('')
    }
    case 'stat': {
      const d = u.delta ? String(u.delta) : ''
      return rect(bx, `fill="${pal.surface}" stroke="${pal.line}"`, radius) + word(t, bx.x + 16, bx.y + 26, { size: 13, fill: pal.ink3 }) + word(String(u.value ?? ''), bx.x + 16, bx.y + 58, { size: 26, weight: 700 }) + (d ? word(d, bx.x + bx.w - 16, bx.y + 58, { size: 13, weight: 600, anchor: 'end', fill: d.trim().startsWith('-') ? pal.bad : pal.ok }) : '')
    }
    case 'alert': {
      const [ink, soft] = tone(u.tone ?? 'info')
      return rect(bx, `fill="${soft}"`, radius) + rect({ x: bx.x, y: bx.y, w: 3, h: bx.h }, `fill="${ink}"`) + (tx && t ? textBlock(wrap(t, bx.w - 28, 14), { x: bx.x + 14, y: bx.y + 10, font: 14, lh: 21, fill: pal.ink, maxLines: Math.max(1, Math.floor((bx.h - 16) / 21)) }) : '')
    }
    case 'progress': {
      const v = Math.max(0, Math.min(100, Number(u.value) || 0))
      const y = bx.y + bx.h - 10
      return word(t, bx.x, bx.y + 14, { size: 13, fill: pal.ink2 }) + rect({ x: bx.x, y, w: bx.w, h: 8 }, `fill="${pal.muted}"`, 4) + rect({ x: bx.x, y, w: (bx.w * v) / 100, h: 8 }, `fill="${accent}"`, 4)
    }
    case 'tabs': case 'breadcrumb': case 'pagination': {
      let x = bx.x + (type === 'pagination' ? 0 : 4)
      const list = items.length ? items : t ? [{ text: t }] : []
      const out = type === 'tabs' ? [`<line x1="${n(bx.x)}" y1="${n(bx.y + bx.h - 0.5)}" x2="${n(bx.x + bx.w)}" y2="${n(bx.y + bx.h - 0.5)}" stroke="${pal.line}"/>`] : []
      list.forEach((l, i) => {
        const on = !!l.active || (type === 'breadcrumb' && i === list.length - 1) || l.text === u.active
        out.push(word(l.text ?? '', x, midY, { size: 14, weight: on ? 600 : 500, fill: on ? (type === 'tabs' ? accent : pal.ink) : pal.ink2 }))
        if (on && type === 'tabs') out.push(rect({ x, y: bx.y + bx.h - 2, w: measure(l.text ?? '', 14, 600), h: 2 }, `fill="${accent}"`))
        x += measure(l.text ?? '', 14, 500) + (type === 'breadcrumb' ? 26 : 22)
        if (type === 'breadcrumb' && i < list.length - 1) out.push(word('›', x - 16, midY, { fill: pal.ink3 }))
      })
      return out.join('')
    }
    case 'empty':
      return rect(bx, `fill="none" stroke="${pal.line2}" stroke-dasharray="5 4"`, radius) + word(t, bx.x + bx.w / 2, midY, { anchor: 'middle', fill: pal.ink3 })
    case 'chart': {
      const rows = Array.isArray(u.rows) ? (u.rows as unknown[][]).flat().map(Number).filter((v) => Number.isFinite(v)) : []
      const max = Math.max(1, ...rows)
      const bw = (bx.w - 24) / Math.max(1, rows.length)
      const bars = rows.map((v, i) => rect({ x: bx.x + 12 + i * bw + bw * 0.15, y: bx.y + bx.h - 12 - ((bx.h - 44) * v) / max, w: bw * 0.7, h: ((bx.h - 44) * v) / max }, `fill="${accent}"`, 2)).join('')
      return rect(bx, `fill="${pal.surface}" stroke="${pal.line}"`, radius) + word(t, bx.x + 12, bx.y + 22, { size: 13, weight: 600 }) + bars
    }
    default:
      return rect(bx, `fill="${pal.surface}" stroke="${pal.line}"`, radius) + word(t, bx.x + 10, bx.y + 20)
  }
}

function drawComment(c: Ctx, it: Item): string {
  const { p, b } = c
  const msgs = 1 + Object.values(b.items).filter((o) => o.type === 'comment' && o.id !== it.id && rootOf(b, o) === it.id).length
  const ink = it.createdBy === 'agent' ? p.agent : p.user
  const cx = it.x + BADGE / 2
  const cy = it.y + BADGE / 2
  const parts = [
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${BADGE / 2 - 1}" fill="${p.paper}" stroke="${ink}" stroke-width="1.5"/>`,
    `<path d="M${n(cx - 6)} ${n(cy - 5)}h12v8h-7l-3.5 3v-3h-1.5z" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>`,
  ]
  if (msgs > 1 && c.text) {
    const w = Math.max(14, measure(String(msgs), 10, 600) + 6)
    parts.push(rect({ x: it.x + BADGE - 7 - w / 2 + 5, y: it.y + BADGE - 9, w, h: 14 }, `fill="${p.paper}" stroke="${ink}"`, 7), `<text x="${n(it.x + BADGE - 2)}" y="${n(it.y + BADGE + 1.5)}" font-size="10" font-weight="600" text-anchor="middle" fill="${ink}">${msgs}</text>`)
  }
  return parts.join('')
}

function rootOf(b: Board, it: Item): string {
  let cur = it
  const seen = new Set<string>()
  while (!seen.has(cur.id)) {
    seen.add(cur.id)
    const next = cur.target ? b.items[cur.target] : undefined
    if (next?.type !== 'comment') return cur.id
    cur = next
  }
  return it.id
}

function drawArrow(c: Ctx, it: Item): string {
  const { p } = c
  const planned = (c.plan ??= planWires(c.b)).get(it.id)
  if (!planned) return ''
  const shape = planned.shape
  const ds = shape.ds
  const pending = !!it.data?.pending && it.role !== 'trace'
  let stroke = p.ink2
  let width = 1.4
  let dash = ''
  let marker = 'ink2'
  if (ds && it.role === 'annotation-link') ((stroke = p.ink3), (dash = '5 5'), (marker = ''))
  else if (ds) ((stroke = p.ink), (width = 1.6), (marker = 'ink'))
  else if (it.role === 'trace') ((stroke = p.ink3), (dash = '2 4'), (marker = 'ink3'), (width = 1.2))
  else if (it.role === 'owns' || it.role === 'delegates') ((stroke = p.agent), (dash = it.role === 'owns' ? '3 5' : '6 4'), (marker = 'agent'))
  if (pending) ((stroke = p.marker), (dash = '6 4'), (marker = 'marker'))
  const parts = [`<path d="${shape.d}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}${marker ? ` marker-end="url(#ah-${marker})"` : ''}${it.role === 'trace' || it.role === 'owns' ? ' stroke-opacity="0.8"' : ''}/>`]
  if (ds && it.role === 'activity' && c.text && typeof it.data?.seq === 'number' && planned.seq) {
    // the sequence number sits a little along the line, clear of the actor and of the other numbers
    const at = planned.seq
    parts.push(`<circle cx="${n(at.x)}" cy="${n(at.y)}" r="11" fill="${p.paper}" stroke="${p.ink}" stroke-width="1.6"/><text x="${n(at.x)}" y="${n(at.y + 4.2)}" font-size="12" font-weight="600" text-anchor="middle" fill="${p.ink}">${it.data.seq}</text>`)
  }
  // the label: smaller than card text, on a light backing, never on a card (edgeLabel.ts); a dot when it fits nowhere
  const label = c.text ? planned.label : undefined
  if (label?.mode === 'dot') {
    parts.push(`<circle cx="${n(label.x)}" cy="${n(label.y)}" r="${n(EDGE_LABEL.dot / 2 - 1)}" fill="${p.paper}" stroke="${ds ? p.ink : p.ink2}" stroke-width="1.4"><title>${esc(label.text)}</title></circle>`)
  } else if (label) {
    const lh = (label.h - 2 * EDGE_LABEL.padY) / Math.max(1, label.lines.length)
    const top = label.y - label.h / 2
    parts.push(
      rect({ x: label.x - label.w / 2, y: top, w: label.w, h: label.h }, `fill="${p.paper}" fill-opacity="0.78"`, 3),
      textBlock(label.lines, { x: label.x, y: top + EDGE_LABEL.padY, font: label.font, lh, fill: ds ? p.ink : p.ink2, anchor: 'middle' }),
    )
  }
  return parts.join('')
}

function drawItem(c: Ctx, it: Item): string {
  let s: string
  if (typeof it.data?.ds === 'string' && DS_ICONS.has(it.data.ds)) s = drawDsIcon(c, it)
  else if (it.type === 'frame') s = drawFrame(c, it)
  else if (it.type === 'lane') s = drawLane(c, it)
  else if (it.type === 'sticky') s = drawSticky(c, it)
  else if (it.type === 'card') s = drawCard(c, it)
  else if (it.type === 'text') s = drawText(c, it)
  else if (it.type === 'wireframe') s = drawWireframe(c, it)
  else if (it.type === 'ui') s = drawUi(c, it)
  else if (it.type === 'comment') s = drawComment(c, it)
  else if (it.type === 'arrow') s = it.from && it.to && c.b.items[it.from] && c.b.items[it.to] ? drawArrow(c, it) : drawSticky(c, it)
  else s = drawSticky(c, it)
  if (it.type !== 'comment' && it.type !== 'arrow' && it.data?.pending) s += pendingMark(c, it, boxOf(it))
  return s ? `<g data-id="${esc(it.id)}">${s}</g>` : ''
}

// ── the snapshot ─────────────────────────────────────────────────────────────

export function renderSnapshot(board: Board, opts: SnapshotOptions = {}): Snapshot {
  if (opts.theme !== undefined && opts.theme !== 'light' && opts.theme !== 'dark') throw new SnapshotError(400, "theme must be 'light' or 'dark'")
  if (opts.scale !== undefined && !(Number.isFinite(opts.scale) && opts.scale > 0 && opts.scale <= 4)) throw new SnapshotError(400, 'scale must be a number above 0 and at most 4')
  if (opts.maxPx !== undefined && !(Number.isFinite(opts.maxPx) && opts.maxPx >= 50)) throw new SnapshotError(400, `maxPx must be a number from 50 to ${SNAPSHOT_MAX_PX}`)
  if (opts.ids !== undefined && !(Array.isArray(opts.ids) && opts.ids.every((i) => typeof i === 'string'))) throw new SnapshotError(400, 'ids must be a list of item ids')
  const notes: string[] = []
  const maxPx = Math.min(SNAPSHOT_MAX_PX, Math.round(opts.maxPx ?? DEFAULT_MAX_PX))
  if ((opts.maxPx ?? 0) > SNAPSHOT_MAX_PX) notes.push(`maxPx is at most ${SNAPSHOT_MAX_PX}`)
  const pad = Math.max(0, Math.min(200, opts.pad ?? 24))
  // the board as the page draws it (kanban cards stacked in their columns)
  const b = shownBoard(board)
  const sel = select(b, opts)
  const region = sel.region
  const vw = region.w + pad * 2
  const vh = region.h + pad * 2
  let scale = opts.scale ?? 1
  const fit = maxPx / Math.max(vw, vh)
  if (vw * scale > maxPx || vh * scale > maxPx) {
    scale = Math.floor(fit * 1000) / 1000
    notes.push(`scaled to ${scale} to fit ${maxPx} px; ask for a frame or ids (or a larger maxPx) for detail`)
  }
  if (scale < 0.35) notes.push('text is small at this scale; a frame or a few ids give a readable picture')
  const width = Math.max(1, Math.round(vw * scale))
  const height = Math.max(1, Math.round(vh * scale))
  const p = opts.theme === 'dark' ? DARK : LIGHT
  const items = [...sel.ids].map((id) => b.items[id]).filter(Boolean)
  const text = items.length <= TEXT_ITEM_CAP
  if (!text) notes.push(`${items.length} items: drawn as boxes without text (more than ${TEXT_ITEM_CAP}); ask for a frame or ids`)
  const c: Ctx = { b, p, text, out: [] }
  const byPos = (x: Item, y: Item) => x.y - y.y || x.x - y.x || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
  const containers = items.filter((i) => i.type !== 'arrow' && i.type !== 'comment' && isContainer(i)).sort((x, y) => depthOf(b, x) - depthOf(b, y) || y.w * y.h - x.w * x.h || byPos(x, y))
  const plain = items.filter((i) => i.type !== 'arrow' && i.type !== 'comment' && !isContainer(i)).sort((x, y) => depthOf(b, x) - depthOf(b, y) || byPos(x, y))
  const wires = items.filter((i) => i.type === 'arrow').sort((x, y) => (x.id < y.id ? -1 : 1))
  const comments = items.filter((i) => i.type === 'comment').sort(byPos)
  const body = [...containers, ...plain, ...wires, ...comments].map((it) => drawItem(c, it)).join('\n')
  const head = (name: string, col: string) => `<marker id="ah-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${col}"/></marker>`
  const title = sel.root ? `${board.title} — ${sel.root.text ?? sel.root.id}` : board.title
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(region.x - pad)} ${n(region.y - pad)} ${n(vw)} ${n(vh)}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs>${head('ink', p.ink)}${head('ink2', p.ink2)}${head('ink3', p.ink3)}${head('agent', p.agent)}${head('marker', p.marker)}</defs>
<rect x="${n(region.x - pad)}" y="${n(region.y - pad)}" width="${n(vw)}" height="${n(vh)}" fill="${p.paper}"/>
<g font-family="${esc(FONT)}" font-size="13">
${body}
</g>
</svg>`
  return { svg, width, height, region, scale, items: items.length, notes }
}
