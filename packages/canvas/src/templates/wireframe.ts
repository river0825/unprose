// Wireframe — low-fi screens on a 12-column grid. Element coordinates are in
// grid units (x: 0..11 columns, y: rows of 40px); the screen is the parent.
import { z } from 'zod'
import type { Item } from '../model.js'
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
              /** Free-form notes for the human (rendered as a comment bubble). */
              note: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
})
export type WireframeContent = z.input<typeof wireframeSchema>

const ROW = 40
const SCREEN_GAP = 80

export function renderWireframe(raw: WireframeContent, opts: RenderOpts = {}): Item[] {
  const c = wireframeSchema.parse(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'wf'
  const id = (role: string, name: string) => stableId(scope, role, name)
  const items: Item[] = []
  let sx = PAD

  c.screens.forEach((s, si) => {
    const width = s.w ?? 960
    const gridPad = 16
    const colW = (width - gridPad * 2) / 12
    const rows = s.h ?? Math.max(8, ...s.elements.map((e) => e.y + (e.h ?? 1))) + 1
    const height = rows * ROW + gridPad * 2 + 32
    const screenId = id('screen', s.name)
    items.push(make({ id: screenId, type: 'wireframe', x: sx, y: PAD, w: width, h: height, text: s.name, role: 'screen', color: 'white', order: si }, now))
    s.elements.forEach((e, ei) => {
      const ex = sx + gridPad + e.x * colW
      const ey = PAD + 32 + gridPad + e.y * ROW
      const ew = e.w * colW - 8
      const eh = (e.h ?? 1) * ROW - 8
      const elId = id(e.role, `${s.name}/${e.text ?? ''}#${ei}`)
      items.push(make({ id: elId, type: 'wireframe', x: ex, y: ey, w: ew, h: eh, text: e.text, role: e.role, color: 'grey', parent: screenId, order: ei }, now))
      if (e.note) {
        items.push(make({ id: id('comment', `${s.name}/${e.text ?? ''}#${ei}`), type: 'comment', x: ex + ew - 20, y: ey - 20, w: 200, h: 60, text: e.note, role: 'note', color: 'yellow', target: elId }, now))
      }
    })
    sx += width + SCREEN_GAP
  })

  return offsetAll(items, opts.at)
}

export { GAP as _wireframeGap }
