// UI mock (docs/diagrams.md §6c) — real-looking screens side by side, one board item per element.
// The web draws each item from `data.ui` with its design system; no HTML from the file is ever rendered.
// Ids: a screen is `<key>.screen.<screen id>`, an element `<key>.ui.<screen id>.<element id>`; both carry
// `data.element` ('<screen>' / '<screen>/<element>') for traces and flows.
// Notes never sit on the product: every screen has a gutter column to its right (UI_GUTTER) where the screen's
// note goes first and the element, item and row notes stack below it in the order of what they are about.
import type { Item } from '../model.js'
import { attachUiFindings, layoutScreen, normalizeUiMock, walkUi, isDrawnContainer, uiGutterOf, UI_GUTTER, type UiBox, type UiEl, type UiMockContent } from '../diagrams/uiMock.js'
import { PAD, arrow, make, offsetAll, type RenderOpts } from './util.js'

export { uiMockSchema, type UiMockContent } from '../diagrams/uiMock.js'

/** Space above a screen for its name (drawn above the device, as Figma does). */
export const SCREEN_LABEL = 28
/** Between a screen's gutter and the next screen. */
const SCREEN_GAP = 120

/** A note to draw in the gutter: what it is about, where that is (its top, in board coordinates), and its id. */
interface GutterNote { id: string; text: string; target: string; anchorY: number; data?: Record<string, unknown> }

export function renderUiMock(raw: UiMockContent, opts: RenderOpts = {}): Item[] {
  const m = normalizeUiMock(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'ui'
  const screenId = (s: string) => `${scope}.screen.${s}`
  const elId = (ref: string) => `${scope}.ui.${ref.replace('/', '.')}`
  const noteId = (ref: string) => `${scope}.note.${ref.replace('/', '.')}`
  const items: Item[] = []
  const byRef = new Map<string, string>()
  let sx = PAD

  m.screens.forEach((s, si) => {
    const lay = layoutScreen(s)
    const sy = PAD + SCREEN_LABEL
    const sid = screenId(s.id)
    byRef.set(s.id, sid)
    const look = { theme: s.theme.theme, accent: s.theme.accent, radius: s.theme.radius, font: s.theme.font }
    const screen = make(
      {
        id: sid, type: 'ui', role: 'screen', x: sx, y: sy, w: lay.w, h: lay.h, text: s.name, order: si,
        data: { element: s.id, ui: { type: 'screen', device: s.device, path: s.path, textKey: 'name', container: true, ...look, ...(s.sample ? { sample: true } : {}) }, ...(s.traces.length ? { traces: s.traces } : {}) },
      },
      now,
    )
    items.push(screen)
    const notes: GutterNote[] = []
    if (s.note) notes.push({ id: noteId(s.id), text: s.note, target: sid, anchorY: sy })
    lay.boxes.forEach((b, bi) => items.push(...elementItems(b, bi, sx, sy, sid, look, notes)))
    items.push(...gutterItems(uiGutterOf(screen), notes))
    sx += lay.w + UI_GUTTER.gap + UI_GUTTER.w + SCREEN_GAP
  })

  function elementItems(b: UiBox, order: number, sx: number, sy: number, sid: string, look: Record<string, unknown>, notes: GutterNote[]): Item[] {
    const e = b.el
    const id = elId(e.ref)
    byRef.set(e.ref, id)
    const top = sy + b.y
    const out: Item[] = [
      make(
        {
          id, type: 'ui', role: e.type, x: sx + b.x, y: top, w: b.w, h: b.h, text: e.text, order,
          parent: b.parent ? elId(b.parent) : sid,
          data: { element: e.ref, ui: uiData(e, look), ...(e.traces.length ? { traces: e.traces } : {}) },
        },
        now,
      ),
    ]
    if (e.note) notes.push({ id: noteId(e.ref), text: e.note, target: id, anchorY: top })
    // an item's or a row's note is anchored where that entry is drawn (the list / table geometry of measure())
    const title = e.text ? 1 : 0
    e.props.items?.forEach((it, i) => {
      if (!it.note) return
      const rowH = e.type === 'list' ? (e.props.items!.some((x) => x.meta) ? 60 : 44) : 36
      notes.push({ id: `${noteId(e.ref)}.item-${i}`, text: it.note, target: id, anchorY: top + title * 30 + i * rowH, data: { item: i } })
    })
    for (const [k, note] of Object.entries(e.props.rowNotes ?? {})) {
      const i = Number(k)
      notes.push({ id: `${noteId(e.ref)}.row-${i}`, text: note, target: id, anchorY: top + title * 34 + 42 + i * 46, data: { row: i } })
    }
    return out
  }

  /** The notes of one screen, stacked in its gutter: by the top of what they are about, never on each other. */
  function gutterItems(gutter: { x: number; y: number; w: number; h: number }, notes: GutterNote[]): Item[] {
    const order = [...notes].sort((a, b) => a.anchorY - b.anchorY || a.id.localeCompare(b.id))
    let bottom = -Infinity
    return order.map((n) => {
      const y = Math.max(n.anchorY, gutter.y, bottom + UI_GUTTER.noteGap)
      bottom = y + UI_GUTTER.noteH
      return make({ id: n.id, type: 'comment', x: gutter.x, y, w: UI_GUTTER.noteW, h: UI_GUTTER.noteH, text: n.text, role: 'note', color: 'yellow', target: n.target, ...(n.data ? { data: n.data } : {}) }, now)
    })
  }

  // flows: element `goto` and the file's `flows`, drawn as arrows to the target screen
  const flows = [
    ...m.screens.flatMap((s) => walkUi(s.body).filter((e) => e.goto).map((e) => ({ from: e.ref, to: e.goto!, label: undefined as string | undefined }))),
    ...m.flows,
  ]
  const seen = new Set<string>()
  for (const f of flows) {
    const from = byRef.get(f.from)
    const to = byRef.get(f.to)
    if (!from || !to || seen.has(`${from}>${to}`)) continue
    seen.add(`${from}>${to}`)
    items.push(arrow(scope, from, to, now, f.label, 'navigate', { data: { flow: { from: f.from, to: f.to } } }))
  }
  // `awd design lint`'s findings on the elements they are about (the CLI redoes this with the file as written,
  // which also knows the fields the schema dropped)
  return attachUiFindings(offsetAll(items, opts.at), raw)
}

/** What the web needs to draw an element: its props, the screen's look, and where it sits in the file. */
function uiData(e: UiEl, look: Record<string, unknown>): Record<string, unknown> {
  const { span: _s, gap: _g, cols: _c, justify: _j, align: _a, ...props } = e.props
  return {
    type: e.type,
    ...props,
    path: e.path,
    textKey: e.textKey,
    ...(isDrawnContainer(e.type) ? { container: true } : {}),
    ...(e.goto ? { goto: e.goto } : {}),
    ...look,
  }
}
