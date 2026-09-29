// Server-rendered SVG thumbnail of a board — the "wall of boards" preview.
// No text: lanes/frames as hairline rects, stickies as filled squares in the
// sticky palette, arrows as thin lines, comments as tiny yellow squares.
// Colours are CSS variables inside the SVG so it follows the viewer's theme.
import type { Board, ColorToken, Item } from './model.js'

export interface ThumbOptions {
  w?: number
  h?: number
  /** Padding inside the viewBox, in output pixels. */
  pad?: number
}

const LIGHT: Record<ColorToken, string> = {
  orange: '#ffb648',
  blue: '#7dbdff',
  yellow: '#ffe14a',
  'pale-yellow': '#fff3b0',
  lilac: '#d4b4ff',
  green: '#9fe39a',
  pink: '#ffb0cf',
  red: '#ff7a7a',
  purple: '#b78af0',
  grey: '#dedcd6',
  white: '#ffffff',
}
const DARK: Record<ColorToken, string> = {
  orange: '#d9922e',
  blue: '#4f8fd8',
  yellow: '#d6ba22',
  'pale-yellow': '#c9bd76',
  lilac: '#a07bd9',
  green: '#66b664',
  pink: '#d67aa2',
  red: '#d85a5a',
  purple: '#8f63cc',
  grey: '#6c6b67',
  white: '#d9d7d0',
}

const CONTAINERS = new Set(['lane', 'frame'])

function tokenOf(item: Item): ColorToken {
  if (item.color && item.color in LIGHT) return item.color
  if (item.type === 'comment') return 'yellow'
  if (item.type === 'wireframe') return 'grey'
  return 'white'
}

function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')
}

export function renderThumb(board: Board, opts: ThumbOptions = {}): string {
  const w = opts.w ?? 280
  const h = opts.h ?? 160
  const pad = opts.pad ?? 8
  // Sort by id so the output is stable regardless of insertion order.
  const items = Object.values(board.items).sort((a, b) => a.id.localeCompare(b.id))
  const boxed = items.filter((i) => i.type !== 'arrow')

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const i of boxed) {
    minX = Math.min(minX, i.x); minY = Math.min(minY, i.y)
    maxX = Math.max(maxX, i.x + i.w); maxY = Math.max(maxY, i.y + i.h)
  }
  const empty = boxed.length === 0
  if (empty) { minX = 0; minY = 0; maxX = w; maxY = h }
  const bw = Math.max(1, maxX - minX)
  const bh = Math.max(1, maxY - minY)
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)
  const ox = pad + ((w - pad * 2) - bw * scale) / 2 - minX * scale
  const oy = pad + ((h - pad * 2) - bh * scale) / 2 - minY * scale
  const X = (x: number) => n(ox + x * scale)
  const Y = (y: number) => n(oy + y * scale)
  const S = (v: number) => n(Math.max(v * scale, 1))

  const parts: string[] = []
  // Containers first so stickies draw on top.
  for (const i of boxed.filter((i) => CONTAINERS.has(i.type))) {
    parts.push(`<rect class="c" x="${X(i.x)}" y="${Y(i.y)}" width="${S(i.w)}" height="${S(i.h)}"/>`)
  }
  for (const i of items.filter((i) => i.type === 'arrow')) {
    const a = i.from ? board.items[i.from] : undefined
    const b = i.to ? board.items[i.to] : undefined
    if (!a || !b) continue
    parts.push(`<line class="a" x1="${X(a.x + a.w / 2)}" y1="${Y(a.y + a.h / 2)}" x2="${X(b.x + b.w / 2)}" y2="${Y(b.y + b.h / 2)}"/>`)
  }
  for (const i of boxed.filter((i) => !CONTAINERS.has(i.type))) {
    if (i.type === 'comment') {
      const s = Math.max(3, 8 * scale)
      parts.push(`<rect class="k" x="${X(i.x)}" y="${Y(i.y)}" width="${n(s)}" height="${n(s)}"/>`)
      continue
    }
    if (i.type === 'text' && !i.color) {
      parts.push(`<rect class="t" x="${X(i.x)}" y="${Y(i.y)}" width="${S(i.w)}" height="${S(Math.min(i.h, 6 / scale))}"/>`)
      continue
    }
    const tok = tokenOf(i)
    const rot = i.role === 'hotspot' ? ` transform="rotate(-3 ${X(i.x + i.w / 2)} ${Y(i.y + i.h / 2)})"` : ''
    parts.push(`<rect class="s" fill="var(--${tok})" x="${X(i.x)}" y="${Y(i.y)}" width="${S(i.w)}" height="${S(i.h)}"${rot}/>`)
  }

  const vars = (p: Record<ColorToken, string>) => (Object.keys(p) as ColorToken[]).map((k) => `--${k}:${p[k]}`).join(';')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeAttr(board.title)} thumbnail">
<style>
:root{${vars(LIGHT)};--paper:#fbfbf9;--rule:#cfd3d6;--rule-2:#aeb4b9;--ink-3:#6b727a}
@media (prefers-color-scheme:dark){:root{${vars(DARK)};--paper:#1b2027;--rule:#2e353d;--rule-2:#414a54;--ink-3:#8a9099}}
.bg{fill:var(--paper)}
.c{fill:none;stroke:var(--rule);stroke-width:1;vector-effect:non-scaling-stroke}
.a{stroke:var(--rule-2);stroke-width:1;vector-effect:non-scaling-stroke}
.s{stroke:none}
.k{fill:var(--yellow)}
.t{fill:var(--ink-3);opacity:.5}
</style>
<rect class="bg" width="${w}" height="${h}"/>
${parts.join('\n')}
</svg>`
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
