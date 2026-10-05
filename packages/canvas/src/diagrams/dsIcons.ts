// Icons a domain story brings along (docs/diagrams.md §6b "Icons of your own"): `icons: { <name>: '<svg …>' }`
// in the file, used as an actor's or a work object's `kind`. Egon.io has the same idea — "upload your own icons
// and then select them as actors or work objects", "square SVG images" (egon.io/howto) — and keeps them in the
// story's icon set, so they travel with an export.
//
// An icon is text written by an agent, possibly a remote one, and it is drawn in the person's browser: it is never
// passed through. Only plain shapes with plain geometry are read out of it, and the page, the snapshot and the
// Egon export draw from that list. Pure and builtin-free (the web imports it).

export interface DsShape {
  tag: string
  attrs: Record<string, string>
}
export interface DsGlyph {
  /** The icon's own viewBox; shapes are scaled into the 24 × 24 box the built-in icons use. */
  viewBox: [number, number, number, number]
  shapes: DsShape[]
}

/** Longest icon text read, and most shapes drawn — a pictogram, not an illustration. */
export const DS_ICON_MAX_CHARS = 4000
export const DS_ICON_MAX_SHAPES = 40

const NUM = /^-?(\d+\.?\d*|\.\d+)$/
const PATH = /^[\sMmLlHhVvCcSsQqTtAaZz\d.,+\-eE]+$/
const POINTS = /^[\s\d.,+\-eE]+$/
const SHAPES: Record<string, Record<string, RegExp>> = {
  path: { d: PATH },
  circle: { cx: NUM, cy: NUM, r: NUM },
  ellipse: { cx: NUM, cy: NUM, rx: NUM, ry: NUM },
  rect: { x: NUM, y: NUM, width: NUM, height: NUM, rx: NUM, ry: NUM },
  line: { x1: NUM, y1: NUM, x2: NUM, y2: NUM },
  polyline: { points: POINTS },
  polygon: { points: POINTS },
}
const REQUIRED: Record<string, string[]> = { path: ['d'], circle: ['r'], ellipse: ['rx', 'ry'], rect: ['width', 'height'], line: ['x2'], polyline: ['points'], polygon: ['points'] }

const attrsOf = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = (m[2] ?? m[3] ?? '').trim()
  return out
}

/** The drawable shapes of an icon, or undefined when it has none (not a string, too long, nothing we draw). */
export function parseDsIcon(svg: unknown): DsGlyph | undefined {
  if (typeof svg !== 'string' || !svg.trim() || svg.length > DS_ICON_MAX_CHARS) return undefined
  const box = /<svg\b[^>]*>/i.exec(svg)?.[0]
  const vb = box ? (attrsOf(box).viewBox ?? '').split(/[\s,]+/).map(Number) : []
  const viewBox: DsGlyph['viewBox'] = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0 ? [vb[0], vb[1], vb[2], vb[3]] : [0, 0, 24, 24]
  const shapes: DsShape[] = []
  for (const m of svg.matchAll(/<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase()
    const given = attrsOf(m[2])
    const attrs: Record<string, string> = {}
    for (const [name, ok] of Object.entries(SHAPES[tag])) if (given[name] !== undefined && ok.test(given[name])) attrs[name] = given[name]
    if (!REQUIRED[tag].every((name) => attrs[name] !== undefined)) continue
    shapes.push({ tag, attrs })
    if (shapes.length >= DS_ICON_MAX_SHAPES) break
  }
  return shapes.length ? { viewBox, shapes } : undefined
}

/** The transform that fits the icon's viewBox into 24 × 24, centred; undefined when it already is 0 0 24 24. */
export function dsGlyphTransform(g: DsGlyph): string | undefined {
  const [x, y, w, h] = g.viewBox
  if (x === 0 && y === 0 && w === 24 && h === 24) return undefined
  const s = 24 / Math.max(w, h)
  const r = (v: number) => Math.round(v * 1000) / 1000
  return `translate(${r((24 - w * s) / 2)} ${r((24 - h * s) / 2)}) scale(${r(s)}) translate(${r(-x)} ${r(-y)})`
}

/** The icon as SVG markup for a 24 × 24 box (the caller sets stroke and colour, as for the built-in icons). */
export function dsGlyphMarkup(g: DsGlyph): string {
  const body = g.shapes.map((s) => `<${s.tag}${Object.entries(s.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}/>`).join('')
  const t = dsGlyphTransform(g)
  return t ? `<g transform="${t}">${body}</g>` : body
}
