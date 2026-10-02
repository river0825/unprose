// Where a wire's label goes, and how much of it is shown (docs/canvas.md "Wires" → labels). One rule for the page
// (web/src/flow/ItemEdge.tsx), the server snapshot (snapshot.ts) and the layout check (layoutCheck.ts):
// - a label is smaller than the text on the cards (EDGE_LABEL.font) and sits on a light backing;
// - it never covers a card: it is tried along the wire's runs (a run out of the source first), then nudged off the
//   line beside it; if it does not fit it is wrapped to two lines, then cut with "…" (the full text stays in the
//   tooltip / the panel); when not even a short cut fits, only a small dot sits on the wire and shows the label on
//   hover or selection;
// - agents steer it with `data.label: { at?: 0..1, short?: string }` — `at` is where along the wire to try first,
//   `short` a shorter text used when the full one does not fit.
// Pure geometry on the text metrics (textMetrics.ts): no DOM, bundled by the web.
import { measure, wrap } from './textMetrics.js'

export type Pt = { x: number; y: number }
export type LabelBox = { x: number; y: number; w: number; h: number }

/** Sizes of a wire label, in board units. Cards use 13 px text (textMetrics.ts); a label is smaller. */
export const EDGE_LABEL = {
  /** label text on a wire */
  font: 11,
  /** a domain-story verb (it carries the sentence, so a little larger — still under the 12.5 px pictogram names) */
  dsFont: 12,
  lineHeight: 14,
  padX: 4,
  padY: 1,
  /** widest a label gets before it wraps */
  maxW: 168,
  /** at most this many lines; the rest is cut with … */
  maxLines: 2,
  /** air kept between a label and any card */
  gap: 3,
  /** the dot shown when the label fits nowhere */
  dot: 10,
} as const

/** The supported label controls in `data.label` (anything else there is ignored). */
export interface LabelControl {
  /** where along the wire to try first, 0 = at its source, 1 = at its target */
  at?: number
  /** a shorter text, used when the whole label does not fit */
  short?: string
}

export function labelControl(data: Record<string, unknown> | undefined): LabelControl {
  const l = data?.label
  if (!l || typeof l !== 'object' || Array.isArray(l)) return {}
  const o = l as Record<string, unknown>
  const out: LabelControl = {}
  if (typeof o.at === 'number' && Number.isFinite(o.at)) out.at = Math.min(1, Math.max(0, o.at))
  if (typeof o.short === 'string' && o.short.trim()) out.short = o.short.trim()
  return out
}

export interface PlacedLabel {
  /** full: the whole text · short: data.label.short · cut: wrapped / cut with … · dot: only a dot on the wire */
  mode: 'full' | 'short' | 'cut' | 'dot'
  /** centre of the label (or the dot) */
  x: number
  y: number
  w: number
  h: number
  /** the lines drawn (empty for a dot) */
  lines: string[]
  /** the whole label, for the tooltip */
  text: string
  font: number
}

/** Something a label may not cover: a card, a sticky, a pictogram — not containers, comments, wires or thin markers. */
export function isLabelObstacle(it: { type: string; role?: string; w: number; h: number; data?: Record<string, unknown> }): boolean {
  if (it.type === 'arrow' || it.type === 'comment' || it.type === 'frame' || it.type === 'lane') return false
  if (it.type === 'wireframe' && it.role === 'screen') return false
  if (it.type === 'ui' && (it.data?.ui as { container?: boolean } | undefined)?.container) return false
  if (DECOR.has(it.role ?? '') || it.w <= 8 || it.h <= 8) return false
  return true
}
const DECOR = new Set(['pivotal', 'release-cut', 'phase', 'legend-title', 'scope'])

/** One line cut to `maxW` with an ellipsis. */
export function cutLine(s: string, maxW: number, font: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (measure(t, font) <= maxW) return t
  let out = ''
  for (const ch of t) {
    if (measure(out + ch + '…', font) > maxW) break
    out += ch
  }
  return out.trimEnd() + '…'
}

/** The text wrapped to at most `maxLines` lines of `width`; the last one cut with … when there is more. */
export function labelLines(text: string, width: number, font: number = EDGE_LABEL.font, maxLines: number = EDGE_LABEL.maxLines): { lines: string[]; cut: boolean } {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return { lines: [], cut: false }
  if (measure(t, font) <= width) return { lines: [t], cut: false }
  const all = wrap(t, width, font)
  if (all.length <= maxLines) return { lines: all, cut: false }
  const kept = all.slice(0, maxLines - 1)
  // what is left after the kept lines, cut to one line (it is longer than a line, so cutLine ends it with …)
  const restStart = kept.reduce((n, l) => t.indexOf(l, n) + l.length, 0)
  return { lines: [...kept, cutLine(t.slice(restStart), width, font)], cut: true }
}

/** Width × height of a label box for these lines. */
export function labelSize(lines: string[], font: number = EDGE_LABEL.font): { w: number; h: number } {
  const w = Math.max(0, ...lines.map((l) => measure(l, font))) + EDGE_LABEL.padX * 2
  const lh = font === EDGE_LABEL.font ? EDGE_LABEL.lineHeight : Math.round(font * 1.25)
  return { w: Math.ceil(w), h: lines.length * lh + EDGE_LABEL.padY * 2 }
}

const hit = (r: LabelBox, b: LabelBox, gap: number) => r.x < b.x + b.w + gap && r.x + r.w + gap > b.x && r.y < b.y + b.h + gap && r.y + r.h + gap > b.y

/** The boxes a label at centre (x, y) of size w×h would touch. */
export function labelHits<B extends LabelBox>(x: number, y: number, w: number, h: number, boxes: B[], gap: number = EDGE_LABEL.gap): B[] {
  const r = { x: x - w / 2, y: y - h / 2, w, h }
  return boxes.filter((b) => hit(r, b, gap))
}

/** A point `t` (0..1) of the way along a polyline. */
export function pointAlong(path: Pt[], t: number): Pt {
  const lens = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y))
  const total = lens.reduce((a, b) => a + b, 0)
  let d = total * t
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, d / lens[i]) : 0
      return { x: path[i].x + (path[i + 1].x - path[i].x) * k, y: path[i].y + (path[i + 1].y - path[i].y) * k }
    }
    d -= lens[i]
  }
  return path[0]
}

const FRACTIONS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]

/** Spots to try on the wire, best first: `at`, then along each run (horizontal runs first, in order), each with its run's direction. */
function spots(path: Pt[], at: number | undefined): Array<{ p: Pt; dir: Pt }> {
  const out: Array<{ p: Pt; dir: Pt }> = []
  const segs = path.slice(1).map((b, i) => ({ a: path[i], b, i })).filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1)
  const dirOf = (s: { a: Pt; b: Pt }) => {
    const l = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) || 1
    return { x: (s.b.x - s.a.x) / l, y: (s.b.y - s.a.y) / l }
  }
  if (at !== undefined && segs.length) {
    const p = pointAlong(path, at)
    // the run it lies on, for the nudge direction
    const seg = segs.find((s) => Math.abs((s.b.x - s.a.x) * (p.y - s.a.y) - (s.b.y - s.a.y) * (p.x - s.a.x)) < 1 && p.x >= Math.min(s.a.x, s.b.x) - 1 && p.x <= Math.max(s.a.x, s.b.x) + 1 && p.y >= Math.min(s.a.y, s.b.y) - 1 && p.y <= Math.max(s.a.y, s.b.y) + 1) ?? segs[0]
    out.push({ p, dir: dirOf(seg) })
  }
  const horizontal = (s: { a: Pt; b: Pt }) => Math.abs(s.b.y - s.a.y) < 1
  const ordered = [...segs.filter(horizontal), ...segs.filter((s) => !horizontal(s))]
  for (const s of ordered) for (const t of FRACTIONS) out.push({ p: { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }, dir: dirOf(s) })
  return out
}

export interface PlaceOptions {
  font?: number
  /** data.label.at */
  at?: number
  /** data.label.short */
  short?: string
  /** spots to try before any other (a domain-story verb beside its line) */
  prefer?: Pt[]
}

/**
 * Place a label of `text` on the wire `path` (its points, source first) so it covers none of `boxes` (every card on
 * the board, the wire's own two ends included). Undefined for an empty label.
 */
export function placeEdgeLabel(text: string, path: Pt[], boxes: LabelBox[], o: PlaceOptions = {}): PlacedLabel | undefined {
  const full = text.replace(/\s+/g, ' ').trim()
  if (!full || path.length < 2) return undefined
  const font = o.font ?? EDGE_LABEL.font
  // only the boxes near the wire matter
  const xs = path.map((p) => p.x)
  const ys = path.map((p) => p.y)
  const m = EDGE_LABEL.maxW
  const near = boxes.filter((b) => b.x < Math.max(...xs) + m && b.x + b.w > Math.min(...xs) - m && b.y < Math.max(...ys) + m && b.y + b.h > Math.min(...ys) - m)
  // what to show, best first: the whole label (one line, else two), the short text, then narrower cuts
  const variants: Array<{ mode: PlacedLabel['mode']; lines: string[] }> = []
  const seen = new Set<string>()
  const push = (mode: PlacedLabel['mode'], lines: string[]) => {
    const k = lines.join('\n')
    if (!lines.length || seen.has(k)) return
    seen.add(k)
    variants.push({ mode, lines })
  }
  const whole = labelLines(full, EDGE_LABEL.maxW, font)
  push(whole.cut ? 'cut' : 'full', whole.lines)
  if (o.short) {
    const s = labelLines(o.short, EDGE_LABEL.maxW, font)
    push(s.cut ? 'cut' : 'short', s.lines)
  }
  for (const w of [120, 88, 60]) {
    const src = o.short ?? full
    const l = labelLines(src, w, font)
    push(l.cut ? 'cut' : o.short ? 'short' : 'full', l.lines)
    push('cut', [cutLine(src, w, font)])
  }
  const tries = spots(path, o.at)
  for (const v of variants) {
    const { w, h } = labelSize(v.lines, font)
    for (const p of o.prefer ?? []) if (!labelHits(p.x, p.y, w, h, near).length) return { mode: v.mode, x: p.x, y: p.y, w, h, lines: v.lines, text: full, font }
    // on the line
    for (const s of tries) if (!labelHits(s.p.x, s.p.y, w, h, near).length) return { mode: v.mode, x: s.p.x, y: s.p.y, w, h, lines: v.lines, text: full, font }
    // nudged off the line: beside it, touching it (above / left first)
    for (const s of tries) {
      let nx = -s.dir.y
      let ny = s.dir.x
      if (ny > 0 || (ny === 0 && nx > 0)) ((nx = -nx), (ny = -ny))
      const d = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2) + 2
      for (const k of [1, -1]) {
        const x = s.p.x + nx * d * k
        const y = s.p.y + ny * d * k
        if (!labelHits(x, y, w, h, near).length) return { mode: v.mode, x, y, w, h, lines: v.lines, text: full, font }
      }
    }
  }
  // nowhere: a dot on the wire where it is free, else halfway
  const D = EDGE_LABEL.dot
  const dotAt = tries.find((s) => !labelHits(s.p.x, s.p.y, D, D, near, 1).length)?.p ?? pointAlong(path, 0.5)
  return { mode: 'dot', x: dotAt.x, y: dotAt.y, w: D, h: D, lines: [], text: full, font }
}
