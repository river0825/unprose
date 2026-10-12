// Wireframe — low-fi screens on a 12-column grid. Element coordinates are in
// grid units (x: 0..11 columns, y: rows of 40px); the screen is the parent.
// Annotations (docs/diagrams.md "Annotations") — an element's `note:` and the file's `annotations:` — are numbered
// cards in a gutter right of their screen (UI_GUTTER, as a UI mock's), 1…n through the frame: screen by screen, top to
// bottom. A screen without one has no gutter.
import { z } from 'zod'
import type { Item } from '../model.js'
import { annotationsSchema, idAllocator, slugify } from '../diagrams/ids.js'
import { UI_GUTTER } from '../diagrams/uiMock.js'
import { annotationIds, annotationsIn, cardsInColumn, readingOrder, resolveOn, type AnnotationNote } from './annotations.js'
import { GAP, PAD, make, offsetAll, stableId, type RenderOpts } from './util.js'

const elementRoles = ['box', 'button', 'input', 'heading', 'paragraph', 'image', 'nav', 'list', 'table', 'label'] as const

export const wireframeSchema = z.object({
  screens: z
    .array(
      z.object({
        name: z.string(),
        /** Screen width in px (default 960) and height in rows (default: fits content). */
        w: z.number().optional(),
        h: z.number().optional(),
        elements: z
          .array(
            z.object({
              role: z.enum(elementRoles),
              text: z.string().optional(),
              /** Grid column 0..11 */
              x: z.number().min(0).max(11),
              /** Row (40px units) */
              y: z.number().min(0),
              /** Column span 1..12 */
              w: z.number().min(1).max(12),
              /** Row span */
              h: z.number().min(1).default(1),
              /** What this element is for (an annotation): a numbered card right of the screen, the same number on the element. */
              note: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
  /** What a screen or an element is for (docs/diagrams.md "Annotations"), `on` a screen or `<screen>/<element>`. */
  annotations: annotationsSchema.optional(),
})
export type WireframeContent = z.input<typeof wireframeSchema>

const ROW = 40
const SCREEN_GAP = 80

export function renderWireframe(raw: WireframeContent, opts: RenderOpts = {}): Item[] {
  const c = wireframeSchema.parse(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'wf'
  const id = (role: string, name: string) => stableId(scope, role, name)
  // what an annotation names (`data.element`): a screen by the slug of its name, an element as `<screen>/<slug of its text, else its role>`
  const alloc = idAllocator()
  const screens: Array<{ screen: Item; items: Item[]; notes: AnnotationNote[] }> = []
  let sx = PAD

  c.screens.forEach((s, si) => {
    const width = s.w ?? 960
    const gridPad = 16
    const colW = (width - gridPad * 2) / 12
    const rows = s.h ?? Math.max(8, ...s.elements.map((e) => e.y + (e.h ?? 1))) + 1
    const height = rows * ROW + gridPad * 2 + 32
    const screenId = id('screen', s.name)
    const screenEl = alloc(undefined, s.name, 'screen')
    const screen = make({ id: screenId, type: 'wireframe', x: sx, y: PAD, w: width, h: height, text: s.name, role: 'screen', color: 'white', order: si, data: { element: screenEl } }, now)
    const laid = { screen, items: [] as Item[], notes: [] as AnnotationNote[] }
    s.elements.forEach((e, ei) => {
      const ex = sx + gridPad + e.x * colW
      const ey = PAD + 32 + gridPad + e.y * ROW
      const ew = e.w * colW - 8
      const eh = (e.h ?? 1) * ROW - 8
      const elId = id(e.role, `${s.name}/${e.text ?? ''}#${ei}`)
      const element = alloc(`${screenEl}/${slugify(e.text ?? '') || e.role}`, e.role)
      laid.items.push(make({ id: elId, type: 'wireframe', x: ex, y: ey, w: ew, h: eh, text: e.text, role: e.role, color: 'grey', parent: screenId, order: ei, data: { element } }, now))
      if (e.note) laid.notes.push({ id: id('comment', `${s.name}/${e.text ?? ''}#${ei}`), text: e.note, on: element, target: elId, anchorX: ex, anchorY: ey, seq: ei })
    })
    screens.push(laid)
    sx += width + SCREEN_GAP
  })

  // the file's annotations, on the screen of what they are about (after that screen's own notes for the same spot)
  const drawn = screens.flatMap((l) => [l.screen, ...l.items])
  const list = annotationsIn(raw)
  const ids = annotationIds(list, scope)
  list.forEach((a, i) => {
    const t = resolveOn(drawn, a.on, scope)
    const home = t && screens.find((l) => l.screen.id === t.id || l.items.includes(t))
    if (t && home) home.notes.push({ id: ids[i], text: a.text, on: a.on, target: t.id, anchorX: t.x, anchorY: t.y, seq: 10_000 + i })
  })

  // a screen with notes gets a gutter: the screens after it move right to make room
  const items: Item[] = []
  let shift = 0
  let n = 0
  for (const l of screens) {
    const moved = (it: Item) => (shift ? { ...it, x: it.x + shift } : it)
    const screen = moved(l.screen)
    items.push(screen, ...l.items.map(moved))
    if (!l.notes.length) continue
    const numbered = readingOrder(l.notes.map((x) => ({ ...x, anchorX: x.anchorX + shift }))).map((x) => ({ ...x, callout: ++n }))
    items.push(...cardsInColumn(numbered, { x: screen.x + screen.w + UI_GUTTER.gap, y: screen.y }, now, { file: opts.source, gap: 0 }))
    shift += UI_GUTTER.gap + UI_GUTTER.w
  }

  return offsetAll(items, opts.at)
}

export { GAP as _wireframeGap }
