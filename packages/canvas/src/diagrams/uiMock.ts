// UI mock content (docs/diagrams.md §6c): real-looking screens the agent writes as a constrained component
// tree — no HTML, no scripts — drawn by the canvas with a small design system. Every element has a stable
// id (explicit, else the slug of its text) so the person can select it, comment on it and chat about it,
// and its place in the file (`path`) so a text edit on the board becomes a proposal with a diff.
// Pure and builtin-free: the CLI, the server and the web share it.
import { z } from 'zod'
import { slugify, traceSchema, type Trace } from './ids.js'
import { unknownFields } from './unknownFields.js'

/** Layout containers: never drawn themselves, they place their children. */
export const UI_LAYOUT = ['stack', 'row', 'grid'] as const
/** Containers drawn as an element (a box the person can select) that also hold children. */
export const UI_BOXES = ['card', 'section', 'navbar'] as const
/** Elements: one board item each. */
export const UI_LEAVES = [
  'heading', 'text', 'link', 'button', 'input', 'textarea', 'select', 'search', 'checkbox', 'radio', 'toggle',
  'badge', 'avatar', 'icon', 'divider', 'image', 'table', 'list', 'stat', 'alert', 'progress', 'tabs',
  'breadcrumb', 'pagination', 'spacer', 'empty', 'chart', 'sidebar',
] as const
export const UI_TYPES = [...UI_LAYOUT, ...UI_BOXES, ...UI_LEAVES] as const
export type UiType = (typeof UI_TYPES)[number]

/** Named glyphs the renderer draws (simple line icons of our own). */
export const UI_ICONS = [
  'plus', 'search', 'settings', 'user', 'users', 'bell', 'home', 'chevron-right', 'chevron-down', 'check', 'x', 'more',
  'folder', 'file', 'star', 'trash', 'edit', 'arrow-left', 'arrow-right', 'menu', 'filter', 'calendar', 'mail', 'lock',
  'board', 'chart', 'link', 'download', 'upload', 'eye', 'heart', 'comment',
] as const

export const UI_DEVICES = { desktop: { w: 1280, h: 800 }, laptop: { w: 1024, h: 680 }, tablet: { w: 768, h: 1024 }, phone: { w: 390, h: 844 } } as const
export type UiDevice = keyof typeof UI_DEVICES

const tone = z.enum(['neutral', 'info', 'success', 'warning', 'danger'])
const size = z.enum(['sm', 'md', 'lg'])
const listItem = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    text: z.string(),
    meta: z.string().optional(),
    icon: z.string().optional(),
    badge: z.string().optional(),
    active: z.boolean().optional(),
    /** A design note about this entry (a comment in the gutter beside the screen), never product text. */
    note: z.string().optional(),
  }),
])
export type UiListItemInput = z.input<typeof listItem>
const cell = z.union([z.string(), z.number()])
/** A table row: its cells, or `{ cells, note }` when the row carries a design note. */
const tableRow = z.union([z.array(cell), z.object({ cells: z.array(cell), note: z.string().optional() })])
export type UiRowInput = z.input<typeof tableRow>
export type UiCell = string | number

/**
 * The gutter: a column right of every screen where its notes and comment threads live, so nothing sits on the
 * product (docs/diagrams.md §6c). `place.ts` puts later comments there too, and the frame fits around it.
 */
export const UI_GUTTER = { gap: 24, w: 260, noteW: 240, noteH: 64, noteGap: 12 } as const
/** The gutter column of a drawn screen (a `ui` item with role `screen`), from its geometry. */
export function uiGutterOf(screen: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: screen.x + screen.w + UI_GUTTER.gap, y: screen.y, w: UI_GUTTER.w, h: screen.h }
}
export const isUiScreen = (it: { type: string; role?: unknown } | undefined): boolean => !!it && it.type === 'ui' && it.role === 'screen'

export interface UiNodeInput {
  type: UiType
  id?: string
  text?: string
  label?: string
  children?: UiNodeInput[]
  gap?: number
  pad?: number
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between'
  cols?: number
  span?: number
  w?: number
  h?: number
  bg?: 'surface' | 'muted' | 'accent' | 'none'
  variant?: string
  level?: number
  tone?: z.input<typeof tone>
  size?: z.input<typeof size>
  icon?: string
  items?: UiListItemInput[]
  active?: string | number
  columns?: string[]
  rows?: UiRowInput[]
  value?: string | number
  placeholder?: string
  hint?: string
  checked?: boolean
  ratio?: string
  delta?: string
  note?: string
  sample?: boolean
  goto?: string
  traces?: Trace[]
}

export const uiNodeSchema: z.ZodType<UiNodeInput> = z.lazy(() =>
  z.object({
    type: z.enum(UI_TYPES),
    /** Stable element id, unique in its screen; default: the slug of its text, else its type. */
    id: z.string().optional(),
    /** The element's words: a button's label, a heading, a card's title, a form field's label. */
    text: z.string().optional(),
    /** Form fields: the label (same as `text`). */
    label: z.string().optional(),
    children: z.array(uiNodeSchema).optional(),
    gap: z.number().min(0).optional(),
    pad: z.number().min(0).optional(),
    align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
    justify: z.enum(['start', 'center', 'end', 'between']).optional(),
    /** grid: columns (default 3). */
    cols: z.number().int().min(1).max(12).optional(),
    /** In a row: columns of 12 this element takes. */
    span: z.number().int().min(1).max(12).optional(),
    /** Fixed width / height in px. */
    w: z.number().min(1).optional(),
    h: z.number().min(1).optional(),
    bg: z.enum(['surface', 'muted', 'accent', 'none']).optional(),
    /** button: primary | secondary | ghost | danger; text: body | muted | small | code; card: flat | elevated; list: plain; chart: bar | line. */
    variant: z.string().optional(),
    /** heading: 1..4 */
    level: z.number().int().min(1).max(4).optional(),
    tone: tone.optional(),
    size: size.optional(),
    icon: z.string().optional(),
    /** navbar links, sidebar, tabs, list rows, breadcrumb, select options. */
    items: z.array(listItem).optional(),
    /** The selected entry of items: its text or index. */
    active: z.union([z.string(), z.number()]).optional(),
    columns: z.array(z.string()).optional(),
    /** table: `[cells]` per row, or `{ cells, note }` for a row with a design note; chart: `[[numbers]]`. */
    rows: z.array(tableRow).optional(),
    value: z.union([z.string(), z.number()]).optional(),
    placeholder: z.string().optional(),
    hint: z.string().optional(),
    checked: z.boolean().optional(),
    /** image: '16:9' (default), '4:3', '1:1' … */
    ratio: z.string().optional(),
    /** stat: '+12%' / '-3' — the change, coloured by its sign. */
    delta: z.string().optional(),
    /** An open question about this element (a comment in the gutter beside the screen, never on it). */
    note: z.string().optional(),
    /** This content is sample data: the board shows it as a hatched stripe on the frame, not as a badge inside the product. */
    sample: z.boolean().optional(),
    /** Tapping this element goes to that screen: a flow arrow. */
    goto: z.string().optional(),
    traces: z.array(traceSchema).optional(),
  }),
)

export const uiMockSchema = z.object({
  /** Default device for every screen. */
  device: z.enum(Object.keys(UI_DEVICES) as [UiDevice, ...UiDevice[]]).optional(),
  /** The mock's own theme (independent of the canvas theme). */
  theme: z.enum(['light', 'dark']).optional(),
  tokens: z
    .object({
      /** Accent colour (#rgb / #rrggbb). */
      accent: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i).optional(),
      /** Corner radius in px (default 8). */
      radius: z.number().min(0).max(32).optional(),
      font: z.enum(['sans', 'serif', 'mono', 'rounded']).optional(),
    })
    .optional(),
  screens: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        device: z.enum(Object.keys(UI_DEVICES) as [UiDevice, ...UiDevice[]]).optional(),
        /** Width / minimum height in px (default: the device's). */
        w: z.number().min(200).max(4000).optional(),
        h: z.number().min(200).max(8000).optional(),
        theme: z.enum(['light', 'dark']).optional(),
        /** Padding and gap of the screen's body (default 0: put content in a section). */
        pad: z.number().min(0).optional(),
        gap: z.number().min(0).optional(),
        note: z.string().optional(),
        /** The whole screen shows sample data (see the element's `sample`). */
        sample: z.boolean().optional(),
        traces: z.array(traceSchema).optional(),
        body: z.array(uiNodeSchema).default([]),
      }),
    )
    .min(1),
  /** Arrows between screens: from a screen or '<screen>/<element>' to a screen. */
  flows: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })).default([]),
})
export type UiMockContent = z.input<typeof uiMockSchema>

// ── the normalised model ─────────────────────────────────────────────────────

export type UiPath = Array<string | number>

export interface UiItem { id: string; text: string; meta?: string; icon?: string; badge?: string; active?: boolean; note?: string }

export interface UiEl {
  /** id within the screen */
  id: string
  /** '<screen>/<id>' — what traces, flows and the board's `data.element` use */
  ref: string
  type: UiType
  text?: string
  /** which key holds the text in the file ('text' or 'label'), for proposals */
  textKey: 'text' | 'label'
  /** where the element sits in the file: ['screens', 0, 'body', 2, 'children', 1] */
  path: UiPath
  children: UiEl[]
  /**
   * What the board's `data.ui` carries: the props as written, with `items[i].note`, table `rows` always as
   * cell arrays and their notes in `rowNotes` (keyed by the row index as a string, present only when there is
   * one), and `sample: true` only when set.
   */
  props: Omit<UiNodeInput, 'type' | 'id' | 'text' | 'label' | 'children' | 'note' | 'goto' | 'traces' | 'items' | 'rows' | 'sample'> & { items?: UiItem[]; rows?: UiCell[][]; rowNotes?: Record<string, string>; sample?: true }
  note?: string
  goto?: string
  traces: Trace[]
}

export interface UiTheme { theme: 'light' | 'dark'; accent: string; radius: number; font: 'sans' | 'serif' | 'mono' | 'rounded' }

export interface UiScreen {
  id: string
  name: string
  device: UiDevice
  w: number
  minH: number
  pad: number
  gap: number
  theme: UiTheme
  note?: string
  sample?: true
  traces: Trace[]
  path: UiPath
  body: UiEl[]
}

export interface UiModel { screens: UiScreen[]; flows: Array<{ from: string; to: string; label?: string }> }

export const DEFAULT_ACCENT = '#4f46e5'

function itemsOf(items: UiListItemInput[] | undefined, active: string | number | undefined): UiItem[] | undefined {
  if (!items) return undefined
  return items.map((it, i) => {
    const o = typeof it === 'string' ? { text: it } : it
    const isActive = o.active ?? (active !== undefined && (active === i || active === o.text || active === o.id))
    return { id: o.id ?? (slugify(o.text) || `item-${i + 1}`), text: o.text, ...(o.meta ? { meta: o.meta } : {}), ...(o.icon ? { icon: o.icon } : {}), ...(o.badge ? { badge: o.badge } : {}), ...(isActive ? { active: true } : {}), ...(o.note ? { note: o.note } : {}) }
  })
}

/** Table rows as the board draws them (cell arrays, whichever way the file wrote them) and the notes some carry. */
function rowsOf(rows: UiRowInput[] | undefined): { rows?: UiCell[][]; rowNotes?: Record<string, string> } {
  if (!rows) return {}
  const notes: Record<string, string> = {}
  const cells = rows.map((r, i) => {
    if (Array.isArray(r)) return r
    if (r.note) notes[String(i)] = r.note
    return r.cells
  })
  return { rows: cells, ...(Object.keys(notes).length ? { rowNotes: notes } : {}) }
}

/** Ids for every screen and element (element ids unique per screen), defaults filled in. */
export function normalizeUiMock(raw: UiMockContent): UiModel {
  const c = uiMockSchema.parse(raw)
  const usedScreens = new Set<string>()
  const screens = c.screens.map((s, si): UiScreen => {
    let sid = (s.id && s.id.trim()) || slugify(s.name) || `screen-${si + 1}`
    for (let n = 2; usedScreens.has(sid); n++) sid = `${(s.id && s.id.trim()) || slugify(s.name) || 'screen'}-${n}`
    usedScreens.add(sid)
    const device = s.device ?? c.device ?? 'desktop'
    const theme: UiTheme = { theme: s.theme ?? c.theme ?? 'light', accent: c.tokens?.accent ?? DEFAULT_ACCENT, radius: c.tokens?.radius ?? 8, font: c.tokens?.font ?? 'sans' }
    const used = new Set<string>()
    const alloc = (explicit: string | undefined, text: string | undefined, type: string) => {
      const base = (explicit && explicit.trim()) || slugify(text ?? '') || type
      let id = base
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`
      used.add(id)
      return id
    }
    const el = (n: UiNodeInput, path: UiPath): UiEl => {
      const { type, id: _id, text, label, children, note, goto, traces, items, rows, sample, ...props } = n
      const words = text ?? label
      const id = alloc(n.id, words, type)
      return {
        id,
        ref: `${sid}/${id}`,
        type,
        ...(words !== undefined ? { text: words } : {}),
        textKey: text === undefined && label !== undefined ? 'label' : 'text',
        path,
        children: (children ?? []).map((ch, i) => el(ch, [...path, 'children', i])),
        props: { ...props, ...(items ? { items: itemsOf(items, n.active) } : {}), ...rowsOf(rows), ...(sample ? { sample: true as const } : {}) },
        ...(note ? { note } : {}),
        ...(goto ? { goto } : {}),
        traces: traces ?? [],
      }
    }
    return {
      id: sid,
      name: s.name,
      device,
      w: s.w ?? UI_DEVICES[device].w,
      minH: s.h ?? UI_DEVICES[device].h,
      pad: s.pad ?? 0,
      gap: s.gap ?? 0,
      theme,
      ...(s.note ? { note: s.note } : {}),
      ...(s.sample ? { sample: true as const } : {}),
      traces: s.traces ?? [],
      path: ['screens', si],
      body: s.body.map((n, i) => el(n, ['screens', si, 'body', i])),
    }
  })
  return { screens, flows: c.flows }
}

/** Every element of a screen, depth first. */
export function walkUi(els: UiEl[]): UiEl[] {
  return els.flatMap((e) => [e, ...walkUi(e.children)])
}

// ── layout ──────────────────────────────────────────────────────────────────

/** A placed element, relative to its screen's top-left corner. */
export interface UiBox { el: UiEl; x: number; y: number; w: number; h: number; /** ref of the drawn element that holds it, undefined = the screen */ parent?: string }

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
/** Estimated width of a line of text in px (the canvas measures nothing; a little generous). */
export function textWidth(s: string, px = 14, bold = false): number {
  let w = 0
  for (const ch of s) w += WIDE.test(ch) ? px : ch === ' ' ? px * 0.3 : /[A-Z0-9]/.test(ch) ? px * 0.64 : /[il.,:;'|!]/.test(ch) ? px * 0.3 : px * 0.54
  return Math.ceil(w * (bold ? 1.07 : 1))
}
function lineCount(s: string | undefined, px: number, maxW: number, bold = false): number {
  if (!s) return 1
  return s.split('\n').reduce((n, seg) => n + Math.max(1, Math.ceil(textWidth(seg, px, bold) / Math.max(40, maxW))), 0)
}

export const HEADING = { 1: { px: 28, lh: 36 }, 2: { px: 22, lh: 30 }, 3: { px: 18, lh: 26 }, 4: { px: 15, lh: 22 } } as const
const BUTTON = { sm: { h: 32, pad: 12 }, md: { h: 36, pad: 16 }, lg: { h: 44, pad: 20 } } as const
const FIELD = { sm: 32, md: 38, lg: 44 } as const

const HUG = new Set<UiType>(['button', 'link', 'badge', 'avatar', 'icon', 'checkbox', 'radio', 'toggle', 'pagination'])
const STRETCH = new Set<UiType>(['stack', 'grid', 'card', 'section', 'sidebar'])
export const isDrawnContainer = (t: UiType) => (UI_BOXES as readonly string[]).includes(t)
const isLayout = (t: UiType) => (UI_LAYOUT as readonly string[]).includes(t)

function padOf(el: UiEl): number {
  if (el.props.pad !== undefined) return el.props.pad
  return el.type === 'card' ? 16 : el.type === 'section' ? 24 : el.type === 'navbar' ? 16 : 0
}
function gapOf(el: UiEl): number {
  if (el.props.gap !== undefined) return el.props.gap
  return el.type === 'grid' ? 16 : el.type === 'navbar' ? 8 : 12
}
/** A card's title strip. */
const titleH = (el: UiEl) => (el.type === 'card' && el.text ? 26 : 0)

/** Natural size of an element given the width it may use. */
export function measure(el: UiEl, avail: number): { w: number; h: number } {
  const p = el.props
  const fixedW = p.w !== undefined ? Math.min(p.w, avail) : undefined
  const sz = p.size ?? 'md'
  const t = el.text ?? ''
  const leaf = (w: number, h: number) => ({ w: fixedW ?? w, h: p.h ?? h })
  switch (el.type) {
    case 'stack':
    case 'card':
    case 'section': {
      const pad = padOf(el)
      const gap = gapOf(el)
      const w = fixedW ?? avail
      const inner = w - pad * 2
      const hs = el.children.map((c) => measure(c, inner).h)
      const head = titleH(el)
      const h = pad * 2 + head + (head && hs.length ? gap : 0) + hs.reduce((a, b) => a + b, 0) + gap * Math.max(0, hs.length - 1)
      return { w, h: Math.max(p.h ?? 0, h) }
    }
    case 'row': {
      const w = fixedW ?? avail
      const pad = padOf(el)
      const widths = rowWidths(el, w - pad * 2)
      const h = pad * 2 + Math.max(0, ...el.children.map((c, i) => measure(c, widths[i]).h))
      return { w, h: Math.max(p.h ?? 0, h) }
    }
    case 'grid': {
      const w = fixedW ?? avail
      const { rows } = gridCells(el, w)
      return { w, h: Math.max(p.h ?? 0, rows.reduce((a, r) => a + r.h, 0) + gapOf(el) * Math.max(0, rows.length - 1) + padOf(el) * 2) }
    }
    case 'navbar':
      return { w: fixedW ?? avail, h: p.h ?? 56 }
    case 'sidebar':
      return leaf(240, 16 + (t ? 48 : 0) + (p.items?.length ?? 0) * 36 + 16)
    case 'heading': {
      const hd = HEADING[(p.level ?? 2) as 1 | 2 | 3 | 4]
      return leaf(avail, lineCount(t, hd.px, fixedW ?? avail, true) * hd.lh)
    }
    case 'text': {
      const small = p.variant === 'small' || p.variant === 'caption'
      const px = small ? 12 : p.variant === 'code' ? 13 : 14
      const lh = small ? 18 : 21
      return leaf(avail, lineCount(t, px, fixedW ?? avail) * lh + (p.variant === 'code' ? 16 : 0))
    }
    case 'link':
      return leaf(textWidth(t, 14) + (p.icon ? 22 : 0) + 2, 21)
    case 'button': {
      const b = BUTTON[sz]
      const w = t ? textWidth(t, sz === 'sm' ? 13 : 14, true) + b.pad * 2 + (p.icon ? 22 : 0) : b.h
      return leaf(w, b.h)
    }
    case 'input':
    case 'select':
    case 'search':
    case 'textarea': {
      const field = el.type === 'textarea' ? (p.h ?? 96) : FIELD[sz]
      return { w: fixedW ?? avail, h: (t && el.type !== 'search' ? 26 : 0) + field + (p.hint ? 22 : 0) }
    }
    case 'checkbox':
    case 'radio':
      return leaf(26 + textWidth(t, 14), 22)
    case 'toggle':
      return leaf(48 + textWidth(t, 14), 24)
    case 'badge':
      return leaf(textWidth(t, 12, true) + 20, 22)
    case 'avatar': {
      const d = sz === 'sm' ? 24 : sz === 'lg' ? 48 : 32
      return leaf(d, d)
    }
    case 'icon': {
      const d = sz === 'sm' ? 16 : sz === 'lg' ? 28 : 20
      return leaf(d, d)
    }
    case 'divider':
      return leaf(avail, 1)
    case 'image': {
      const [a, b] = (p.ratio ?? '16:9').split(':').map(Number)
      const w = fixedW ?? avail
      return { w, h: p.h ?? Math.round((w * (b > 0 ? b : 9)) / (a > 0 ? a : 16)) }
    }
    case 'table':
      return leaf(avail, (t ? 34 : 0) + 42 + (p.rows?.length ?? 0) * 46)
    case 'list': {
      const rowH = (p.items ?? []).some((i) => i.meta) ? 60 : 44
      return leaf(avail, (t ? 30 : 0) + (p.items?.length ?? 0) * rowH)
    }
    case 'stat':
      return leaf(avail, 100)
    case 'alert':
      return leaf(avail, Math.max(46, 24 + lineCount(t, 14, (fixedW ?? avail) - 56) * 21))
    case 'progress':
      return leaf(avail, t ? 34 : 8)
    case 'tabs':
      return leaf(avail, 42)
    case 'breadcrumb':
      return leaf(avail, 21)
    case 'pagination':
      return leaf(7 * 36, 32)
    case 'spacer':
      return leaf(0, 16)
    case 'empty':
      return leaf(avail, 220)
    case 'chart':
      return leaf(avail, 220)
  }
}

/** Widths of a row's children: fixed `w`, then `span` of 12, then hugging elements, the rest share what is left. */
function rowWidths(el: UiEl, inner: number): number[] {
  const gap = gapOf(el)
  const n = el.children.length
  const colW = (inner - gap * 11) / 12
  const widths: Array<number | undefined> = el.children.map((c) => {
    if (c.props.w !== undefined) return Math.min(c.props.w, inner)
    if (c.props.span !== undefined) return colW * c.props.span + gap * (c.props.span - 1)
    if (HUG.has(c.type) || c.type === 'sidebar') return Math.min(measure(c, inner).w, inner)
    return undefined
  })
  const growers = widths.filter((w) => w === undefined).length
  const used = widths.reduce<number>((a, w) => a + (w ?? 0), 0) + gap * Math.max(0, n - 1)
  const share = growers ? Math.max(24, (inner - used) / growers) : 0
  return widths.map((w) => Math.round(w ?? share))
}

function gridCells(el: UiEl, w: number): { cellW: number; rows: Array<{ items: UiEl[]; h: number }> } {
  const cols = el.props.cols ?? 3
  const gap = gapOf(el)
  const inner = w - padOf(el) * 2
  const cellW = (inner - gap * (cols - 1)) / cols
  const rows: Array<{ items: UiEl[]; h: number }> = []
  for (let i = 0; i < el.children.length; i += cols) {
    const items = el.children.slice(i, i + cols)
    rows.push({ items, h: Math.max(0, ...items.map((c) => measure(c, cellW).h)) })
  }
  return { cellW, rows }
}

/** Place an element at (x, y) with the given box and recurse; drawn elements are pushed to `out`. */
function place(el: UiEl, x: number, y: number, w: number, h: number, parent: string | undefined, out: UiBox[]): void {
  const drawn = !isLayout(el.type)
  if (drawn) out.push({ el, x, y, w, h, ...(parent ? { parent } : {}) })
  const holder = drawn ? el.ref : parent
  const pad = padOf(el)
  const gap = gapOf(el)
  const align = el.props.align
  switch (el.type) {
    case 'stack':
    case 'card':
    case 'section': {
      const inner = w - pad * 2
      let cy = y + pad + titleH(el) + (titleH(el) && el.children.length ? gap : 0)
      for (const c of el.children) {
        const m = measure(c, inner)
        const cw = HUG.has(c.type) || c.props.w !== undefined ? m.w : inner
        const cx = align === 'center' ? x + pad + (inner - cw) / 2 : align === 'end' ? x + pad + inner - cw : x + pad
        place(c, cx, cy, cw, m.h, holder, out)
        cy += m.h + gap
      }
      return
    }
    case 'row': {
      const inner = w - pad * 2
      const widths = rowWidths(el, inner)
      const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1)
      const free = Math.max(0, inner - total)
      const j = el.props.justify ?? 'start'
      const extraGap = j === 'between' && widths.length > 1 ? free / (widths.length - 1) : 0
      let cx = x + pad + (j === 'center' ? free / 2 : j === 'end' ? free : 0)
      const rowH = h - pad * 2
      el.children.forEach((c, i) => {
        const m = measure(c, widths[i])
        const stretch = align === 'stretch' || (align === undefined && STRETCH.has(c.type))
        const ch = stretch ? Math.max(m.h, rowH) : m.h
        const cy = stretch || align === 'start' ? y + pad : align === 'end' ? y + pad + rowH - ch : y + pad + (rowH - ch) / 2
        place(c, cx, cy, widths[i], ch, holder, out)
        cx += widths[i] + gap + extraGap
      })
      return
    }
    case 'grid': {
      const { cellW, rows } = gridCells(el, w)
      let cy = y + pad
      for (const r of rows) {
        r.items.forEach((c, i) => place(c, x + pad + i * (cellW + gap), cy, cellW, align === 'start' ? measure(c, cellW).h : r.h, holder, out))
        cy += r.h + gap
      }
      return
    }
    case 'navbar': {
      // brand and links are drawn by the navbar itself on the left; its children sit at the right end, centred
      let cx = x + w - pad
      for (const c of [...el.children].reverse()) {
        const m = measure(c, w / 2)
        cx -= m.w
        place(c, cx, y + (h - m.h) / 2, m.w, m.h, holder, out)
        cx -= gap
      }
      return
    }
    default:
      return
  }
}

/** Lay a screen out: its size and every drawn element, relative to the screen's top-left corner. */
export function layoutScreen(s: UiScreen): { w: number; h: number; boxes: UiBox[] } {
  const out: UiBox[] = []
  const inner = s.w - s.pad * 2
  let y = s.pad
  for (const el of s.body) {
    const m = measure(el, inner)
    const w = HUG.has(el.type) || el.props.w !== undefined ? m.w : inner
    place(el, s.pad, y, w, m.h, undefined, out)
    y += m.h + s.gap
  }
  const content = y - (s.body.length ? s.gap : 0) + s.pad
  return { w: s.w, h: Math.max(s.minH, Math.ceil(content)), boxes: out.map((b) => ({ ...b, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })) }
}

// ── checks (awd design lint, the frame panel) ─────────────────────────────────

export interface UiFinding { severity: 'warning' | 'info'; message: string; element?: string }

/**
 * Words that mark a design note, not product text (rule `ui-text-reads-like-a-note`): the Latin ones as whole
 * words, case-insensitively ("Open" the button label is a hit, `reopen` is not); the Chinese ones anywhere.
 */
export const NOTE_WORDS = ['OPEN', 'TBD', 'TODO', 'FIXME', 'sample', 'proposal', 'proposed', 'placeholder', 'lorem'] as const
export const NOTE_WORDS_CJK = ['待定', '待確認', '待決定', '示例', '範例', '假資料', '提案'] as const
const NOTE_WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${NOTE_WORDS.join('|')})(?![\\p{L}\\p{N}_])`, 'iu')
export const NOTE_RULE = 'ui-text-reads-like-a-note'
export const NOTE_RULE_MESSAGE = 'reads like a design note, not product text: move it to `note` (on the element, the item or the row), and keep the product words here'

/** The note word a product text contains, if any. */
export function noteWordIn(text: string): string | undefined {
  const latin = NOTE_WORD_RE.exec(text)
  if (latin) return latin[0]
  return NOTE_WORDS_CJK.find((w) => text.includes(w))
}

/** Every product-facing text of an element, with where it sits (`text`, `items[2].meta`, `rows[1][0]`, `columns[0]`). */
function productTexts(e: UiEl): Array<{ at: string; text: string }> {
  const out: Array<{ at: string; text: string }> = []
  const p = e.props
  if (e.text) out.push({ at: e.textKey, text: e.text })
  if (p.placeholder) out.push({ at: 'placeholder', text: p.placeholder })
  if (p.hint) out.push({ at: 'hint', text: p.hint })
  if (typeof p.value === 'string' && p.value) out.push({ at: 'value', text: p.value })
  p.items?.forEach((it, i) => {
    out.push({ at: `items[${i}].text`, text: it.text })
    if (it.meta) out.push({ at: `items[${i}].meta`, text: it.meta })
  })
  p.columns?.forEach((c, i) => out.push({ at: `columns[${i}]`, text: c }))
  if (e.type === 'table') p.rows?.forEach((r, i) => r.forEach((c, j) => typeof c === 'string' && out.push({ at: `rows[${i}][${j}]`, text: c })))
  return out
}

/** What would draw oddly or point nowhere: unknown screens in flows, ragged tables, unknown icons, note words in product text. */
export function checkUiMock(raw: UiMockContent): UiFinding[] {
  const m = normalizeUiMock(raw)
  const out: UiFinding[] = []
  const screens = new Set(m.screens.map((s) => s.id))
  const refs = new Set(m.screens.flatMap((s) => walkUi(s.body).map((e) => e.ref)))
  const icons = new Set<string>(UI_ICONS)
  for (const s of m.screens) {
    const explicit = new Map<string, number>()
    for (const e of walkUi(s.body)) {
      const given = e.path.reduce<unknown>((node, k) => (node as Record<string | number, unknown>)?.[k], raw as unknown) as { id?: string } | undefined
      if (given?.id) explicit.set(given.id, (explicit.get(given.id) ?? 0) + 1)
      if (e.goto && !screens.has(e.goto)) out.push({ severity: 'warning', element: e.ref, message: `goto: no screen "${e.goto}" (screens: ${[...screens].join(', ')})` })
      const cols = e.props.columns?.length
      if (e.type === 'table' && cols) e.props.rows?.forEach((r, i) => r.length !== cols && out.push({ severity: 'warning', element: e.ref, message: `table row ${i + 1} has ${r.length} cells for ${cols} columns` }))
      for (const ic of [e.props.icon, ...(e.props.items ?? []).map((i) => i.icon)]) if (ic && !icons.has(ic)) out.push({ severity: 'info', element: e.ref, message: `icon "${ic}" is not one the canvas draws (${UI_ICONS.join(', ')})` })
      if (e.type === 'button' && !e.text && !e.props.icon) out.push({ severity: 'warning', element: e.ref, message: 'a button with neither text nor icon' })
      if (e.children.length && !isLayout(e.type) && !isDrawnContainer(e.type)) out.push({ severity: 'warning', element: e.ref, message: `${e.type} does not hold children (only stack, row, grid, card, section, navbar do) — they are not drawn` })
      if (e.props.active !== undefined && e.props.items && !e.props.items.some((i) => i.active)) out.push({ severity: 'info', element: e.ref, message: `active "${e.props.active}" is none of its items` })
      for (const t of productTexts(e)) {
        const word = noteWordIn(t.text)
        if (word) out.push({ severity: 'warning', element: e.ref, message: `${NOTE_RULE}: ${t.at} "${shortText(t.text)}" (${word}) ${NOTE_RULE_MESSAGE}` })
      }
    }
    for (const [id, n] of explicit) if (n > 1) out.push({ severity: 'warning', element: `${s.id}/${id}`, message: `id "${id}" is used ${n} times in screen ${s.id}; the others become ${id}-2 …` })
  }
  for (const f of m.flows) {
    if (!screens.has(f.to)) out.push({ severity: 'warning', message: `flow to "${f.to}": no such screen` })
    if (!screens.has(f.from) && !refs.has(f.from)) out.push({ severity: 'warning', message: `flow from "${f.from}": no such screen or <screen>/<element>` })
  }
  return out
}

const shortText = (s: string, n = 48) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** A place in the file as `awd design lint` writes it: `screens[0].body[2].children[1]`. */
export const uiPathText = (p: UiPath) => p.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '')

/**
 * Everything `awd design lint` says about a UI mock file that draws: fields the schema does not know (they
 * would be dropped silently), then `checkUiMock`. Each finding names the element (`<screen>/<element>`, or
 * the screen) it is about when there is one, so the board can put it on that element.
 */
export function lintUiMock(raw: UiMockContent): UiFinding[] {
  const m = normalizeUiMock(raw)
  const where = new Map<string, string>()
  for (const s of m.screens) {
    where.set(uiPathText(s.path), s.id)
    for (const e of walkUi(s.body)) where.set(uiPathText(e.path), e.ref)
  }
  const owner = (path: string) => {
    for (let p = path; p; p = p.replace(/(\.[^.[\]]+|\[\d+\])$/, '')) {
      const hit = where.get(p)
      if (hit) return hit
      if (!/(\.[^.[\]]+|\[\d+\])$/.test(p)) break
    }
    return undefined
  }
  const unknown: UiFinding[] = unknownFields(uiMockSchema, raw).map((u) => {
    const element = owner(u.path)
    return { severity: 'warning', message: `unknown field \`${u.field}\` at ${u.path} — it is not part of ui-mock and will be ignored`, ...(element ? { element } : {}) }
  })
  return [...unknown, ...checkUiMock(raw)]
}

/** Where a screen (`<screen>`) or element (`<screen>/<element>`) sits in the file, by the ids the board uses. */
export function locateUi(m: UiModel, ref: string): UiPath | undefined {
  const s = m.screens.find((x) => x.id === ref.split('/')[0])
  if (!s) return undefined
  if (!ref.includes('/')) return s.path
  return walkUi(s.body).find((e) => e.ref === ref)?.path
}

/** A drawn item, as far as findings care: the CLI's and the canvas's item types both fit. */
interface DrawnItem { id: string; type: string; data?: Record<string, unknown> }

/**
 * The drawn items with `lintUiMock`'s findings on the element each is about (`data.ui.findings`): a layout
 * node (stack, row, grid — not drawn) passes its findings to the element or screen that holds it, and a
 * finding about no element (a flow) goes to the first screen. Earlier findings are replaced. The board marks
 * those elements and lists the findings on the frame without parsing anything.
 */
export function attachUiFindings<T extends DrawnItem>(items: T[], raw: UiMockContent): T[] {
  const m = normalizeUiMock(raw)
  const shownAt = new Map<string, string>()
  const hold = (els: UiEl[], holder: string) =>
    els.forEach((e) => {
      const at = isLayout(e.type) ? holder : e.ref
      shownAt.set(e.ref, at)
      hold(e.children, at)
    })
  for (const s of m.screens) {
    shownAt.set(s.id, s.id)
    hold(s.body, s.id)
  }
  const found = new Map<string, Array<Pick<UiFinding, 'severity' | 'message'>>>()
  for (const f of lintUiMock(raw)) {
    const at = (f.element && shownAt.get(f.element)) || (m.screens[0]?.id ?? '')
    found.set(at, [...(found.get(at) ?? []), { severity: f.severity, message: f.message }])
  }
  return items.map((it) => {
    const ui = it.data?.ui as Record<string, unknown> | undefined
    if (it.type !== 'ui' || !ui || typeof it.data?.element !== 'string') return it
    const { findings: _old, ...rest } = ui
    const mine = found.get(it.data.element)
    if (!mine && !_old) return it
    return { ...it, data: { ...it.data, ui: mine ? { ...rest, findings: mine } : rest } }
  })
}
