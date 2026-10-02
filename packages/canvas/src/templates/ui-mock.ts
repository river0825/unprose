// UI mock (docs/diagrams.md §6c) — real-looking screens side by side, one board item per element.
// The web draws each item from `data.ui` with its design system; no HTML from the file is ever rendered.
// Ids: a screen is `<key>.screen.<screen id>`, an element `<key>.ui.<screen id>.<element id>`; both carry
// `data.element` ('<screen>' / '<screen>/<element>') for traces and flows.
import type { Item } from '../model.js'
import { attachUiFindings, layoutScreen, normalizeUiMock, walkUi, isDrawnContainer, type UiBox, type UiEl, type UiMockContent } from '../diagrams/uiMock.js'
import { PAD, arrow, make, offsetAll, type RenderOpts } from './util.js'

export { uiMockSchema, type UiMockContent } from '../diagrams/uiMock.js'

/** Space above a screen for its name (drawn above the device, as Figma does). */
export const SCREEN_LABEL = 28
const SCREEN_GAP = 140

export function renderUiMock(raw: UiMockContent, opts: RenderOpts = {}): Item[] {
  const m = normalizeUiMock(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'ui'
  const screenId = (s: string) => `${scope}.screen.${s}`
  const elId = (ref: string) => `${scope}.ui.${ref.replace('/', '.')}`
  const items: Item[] = []
  const byRef = new Map<string, string>()
  let sx = PAD

  m.screens.forEach((s, si) => {
    const lay = layoutScreen(s)
    const sy = PAD + SCREEN_LABEL
    const sid = screenId(s.id)
    byRef.set(s.id, sid)
    const look = { theme: s.theme.theme, accent: s.theme.accent, radius: s.theme.radius, font: s.theme.font }
    items.push(
      make(
        {
          id: sid, type: 'ui', role: 'screen', x: sx, y: sy, w: lay.w, h: lay.h, text: s.name, order: si,
          data: { element: s.id, ui: { type: 'screen', device: s.device, path: s.path, textKey: 'name', container: true, ...look }, ...(s.traces.length ? { traces: s.traces } : {}) },
        },
        now,
      ),
    )
    if (s.note) items.push(make({ id: `${scope}.note.${s.id}`, type: 'comment', x: sx + lay.w - 40, y: sy - 50, w: 220, h: 64, text: s.note, role: 'note', color: 'yellow', target: sid }, now))
    lay.boxes.forEach((b, bi) => items.push(...elementItems(b, bi, sx, sy, sid, look)))
    sx += lay.w + SCREEN_GAP
  })

  function elementItems(b: UiBox, order: number, sx: number, sy: number, sid: string, look: Record<string, unknown>): Item[] {
    const e = b.el
    const id = elId(e.ref)
    byRef.set(e.ref, id)
    const out: Item[] = [
      make(
        {
          id, type: 'ui', role: e.type, x: sx + b.x, y: sy + b.y, w: b.w, h: b.h, text: e.text, order,
          parent: b.parent ? elId(b.parent) : sid,
          data: { element: e.ref, ui: uiData(e, look), ...(e.traces.length ? { traces: e.traces } : {}) },
        },
        now,
      ),
    ]
    if (e.note) out.push(make({ id: `${scope}.note.${e.ref.replace('/', '.')}`, type: 'comment', x: sx + b.x + b.w + 12, y: sy + b.y - 12, w: 220, h: 64, text: e.note, role: 'note', color: 'yellow', target: id }, now))
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
