// UI mock (docs/diagrams.md §6c) — real-looking screens side by side, one board item per element.
// The web draws each item from `data.ui` with its design system; no HTML from the file is ever rendered.
// Ids: a screen is `<key>.screen.<screen id>`, an element `<key>.ui.<screen id>.<element id>`; both carry
// `data.element` ('<screen>' / '<screen>/<element>') for traces and flows.
// Notes are design annotations — what an item is for, why it is there — drawn as callouts: a numbered pin on the
// element, list entry or table row (the web draws it from `data.ui.callout`, `items[i].callout`, `rowCallouts`) and a
// card with the same number in the gutter, a column right of the screen (UI_GUTTER), never on the product. The
// screen's own note goes first, unnumbered; the callouts follow in reading order, 1…n per screen.
// The file's top-level `annotations:` (docs/diagrams.md "Annotations") read like notes: `on: '<screen>/<element>'` is
// numbered with that element's callouts (an element with several gets `data.ui.callouts`, every number, beside
// `callout`, the first); `on: '<screen>'` is a callout on the screen itself.
import type { Item } from '../model.js'
import { attachUiFindings, layoutScreen, normalizeUiMock, walkUi, isDrawnContainer, uiCalloutSize, uiGutterOf, UI_GUTTER, type UiBox, type UiEl, type UiItem, type UiMockContent } from '../diagrams/uiMock.js'
import { annotationIds, annotationsIn, readingOrder, resolveOn } from './annotations.js'
import { PAD, arrow, make, offsetAll, type RenderOpts } from './util.js'

export { uiMockSchema, type UiMockContent } from '../diagrams/uiMock.js'
export { readingOrder } from './annotations.js'

/** Space above a screen for its name (drawn above the device, as Figma does). */
export const SCREEN_LABEL = 28
/** Between a screen's gutter and the next screen. */
const SCREEN_GAP = 120

/** What a callout is about: the screen or an element (a file annotation, the element's own note), or one entry / row of it (the item drawn for the element). */
type CalloutOn = { item: Item; kind: 'element' | 'screen' } | { item: Item; kind: 'item' | 'row'; index: number }

/**
 * A note to draw in the gutter: its id and text, what it is about (`target`, and `on` for a callout), where that is
 * (its top-left in board coordinates), its place in the file (`seq`) for ties, and `ref` as the file names it.
 */
interface GutterNote { id: string; text: string; target: string; anchorX: number; anchorY: number; seq: number; ref: string; on?: CalloutOn; data?: Record<string, unknown> }

/** Where entry `i` of an element is drawn, below the element's top (the list / sidebar geometry of measure()). */
function entryTop(e: UiEl, i: number): number {
  const title = e.text ? 1 : 0
  switch (e.type) {
    case 'list':
      return title * 30 + i * (e.props.items!.some((x) => x.meta) ? 60 : 44)
    case 'sidebar':
      return 16 + title * 48 + i * 36
    case 'tabs':
    case 'navbar':
    case 'breadcrumb':
      return 0 // side by side on one line: read in the file's order
    case 'select':
      return title * 26 // the options' pins sit in the field
    default:
      return title * 30 + i * 36
  }
}

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
  const screens: Array<{ screen: Item; drawn: Item[]; notes: GutterNote[]; screenNote?: { id: string; text: string; target: string } }> = []

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
    const notes: GutterNote[] = []
    const drawn = lay.boxes.flatMap((b, bi) => elementItems(b, bi, sx, sy, sid, look, notes))
    items.push(screen, ...drawn)
    screens.push({ screen, drawn, notes, ...(s.note ? { screenNote: { id: noteId(s.id), text: s.note, target: sid } } : {}) })
    sx += lay.w + UI_GUTTER.gap + UI_GUTTER.w + SCREEN_GAP
  })

  // the file's annotations join the callouts of the screen they are about, after its own notes for the same spot
  const list = annotationsIn(raw)
  const annotationId = annotationIds(list, scope)
  const everything = screens.flatMap((x) => [x.screen, ...x.drawn])
  list.forEach((a, i) => {
    const t = resolveOn(everything, a.on, scope)
    const home = t && screens.find((x) => x.screen === t || x.drawn.includes(t))
    if (!t || !home) return // awd design lint names it
    // one about the whole screen reads before what is at its top; one about an element after the element's own notes
    const screen = t === home.screen
    home.notes.push({ id: annotationId[i], text: a.text, ref: a.on, target: t.id, anchorX: t.x, anchorY: t.y, seq: (screen ? -10_000 : 10_000) + i, on: { item: t, kind: screen ? 'screen' : 'element' } })
  })
  for (const x of screens) items.push(...gutterItems(uiGutterOf(x.screen), x.screenNote, numberCallouts(x.notes)))

  function elementItems(b: UiBox, order: number, sx: number, sy: number, sid: string, look: Record<string, unknown>, notes: GutterNote[]): Item[] {
    const e = b.el
    const id = elId(e.ref)
    byRef.set(e.ref, id)
    const [left, top] = [sx + b.x, sy + b.y]
    const item = make(
      {
        id, type: 'ui', role: e.type, x: left, y: top, w: b.w, h: b.h, text: e.text, order,
        parent: b.parent ? elId(b.parent) : sid,
        data: { element: e.ref, ui: uiData(e, look), ...(e.traces.length ? { traces: e.traces } : {}) },
      },
      now,
    )
    const note = (n: Omit<GutterNote, 'target' | 'anchorX' | 'seq' | 'ref'>) => notes.push({ ...n, ref: e.ref, target: id, anchorX: left, seq: notes.length })
    if (e.note) note({ id: noteId(e.ref), text: e.note, anchorY: top, on: { item, kind: 'element' } })
    // an entry's or a row's note is anchored where that entry is drawn (the list / table geometry of measure())
    e.props.items?.forEach((it, i) => {
      if (it.note) note({ id: `${noteId(e.ref)}.item-${i}`, text: it.note, anchorY: top + entryTop(e, i), on: { item, kind: 'item', index: i }, data: { item: i } })
    })
    for (const [k, text] of Object.entries(e.props.rowNotes ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
      const i = Number(k)
      note({ id: `${noteId(e.ref)}.row-${i}`, text, anchorY: top + (e.text ? 34 : 0) + 42 + i * 46, on: { item, kind: 'row', index: i }, data: { row: i } })
    }
    return [item]
  }

  /**
   * Number a screen's callouts 1…n in reading order and tell each item drawn for an element its numbers: `callout`
   * (and the note, for the pin's tooltip) for its own note — the first one, with `callouts` listing every number when
   * the file says more than one thing about it — `items[i].callout`, `rowCallouts[<row>]`.
   */
  function numberCallouts(notes: GutterNote[]): Array<GutterNote & { callout: number }> {
    return readingOrder(notes).map((n, i) => {
      const callout = i + 1
      const on = n.on!
      const ui = { ...(on.item.data!.ui as Record<string, unknown>) }
      if (on.kind === 'element' || on.kind === 'screen') {
        if (typeof ui.callout === 'number') ui.callouts = [...(Array.isArray(ui.callouts) ? (ui.callouts as number[]) : [ui.callout]), callout]
        else Object.assign(ui, { callout, note: n.text })
      } else if (on.kind === 'item') ui.items = (ui.items as UiItem[]).map((it, j) => (j === on.index ? { ...it, callout } : it))
      else if (on.kind === 'row') ui.rowCallouts = { ...(ui.rowCallouts as Record<string, number> | undefined), [String(on.index)]: callout }
      on.item.data = { ...on.item.data, ui }
      return { ...n, callout }
    })
  }

  /**
   * A screen's gutter: its own note first (a thread, unnumbered), then the callout cards in their order, each at the
   * height of what it is about when that is free, else right below the one before — never on each other.
   */
  function gutterItems(gutter: { x: number; y: number; w: number; h: number }, screenNote: { id: string; text: string; target: string } | undefined, callouts: Array<GutterNote & { callout: number }>): Item[] {
    const out: Item[] = []
    let bottom = -Infinity
    let gap: number = UI_GUTTER.noteGap
    if (screenNote) {
      out.push(make({ ...screenNote, type: 'comment', x: gutter.x, y: gutter.y, w: UI_GUTTER.noteW, h: UI_GUTTER.noteH, role: 'note', color: 'yellow' }, now))
      bottom = gutter.y + UI_GUTTER.noteH
    }
    for (const n of callouts) {
      const size = uiCalloutSize(n.text)
      const y = Math.max(n.anchorY, gutter.y, bottom + gap)
      out.push(make({ id: n.id, type: 'comment', x: gutter.x, y, w: size.w, h: size.h, text: n.text, role: 'note', color: 'yellow', target: n.target, data: { ...n.data, callout: n.callout, annotation: { on: n.ref, ...(opts.source ? { file: opts.source } : {}) } } }, now))
      bottom = y + size.h
      gap = UI_GUTTER.calloutGap
    }
    return out
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
