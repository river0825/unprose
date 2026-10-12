// User journey — stages as columns, one row per facet, emotion drawn as a
// curve of small stickies (row height maps -2..2).
import { z } from 'zod'
import type { Item } from '../model.js'
import { annotationsSchema, idAllocator, slugify } from '../diagrams/ids.js'
import { GAP, LANE_HEADER, PAD, STICKY_H, STICKY_W, arrow, make, offsetAll, stableId, type RenderOpts } from './util.js'

export const userJourneySchema = z.object({
  persona: z.string(),
  stages: z
    .array(
      z.object({
        text: z.string(),
        actions: z.array(z.string()).default([]),
        touchpoints: z.array(z.string()).default([]),
        emotion: z.number().int().min(-2).max(2).default(0),
        pains: z.array(z.string()).default([]),
        opportunities: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  /** What a stage or a sticky is for (docs/diagrams.md "Annotations"): numbered cards below the journey. */
  annotations: annotationsSchema.optional(),
})
export type UserJourneyContent = z.input<typeof userJourneySchema>

const COL = STICKY_W + GAP
const ROW_H = 90
const EMOTION_H = 5 * 40 + GAP

export function renderUserJourney(raw: UserJourneyContent, opts: RenderOpts = {}): Item[] {
  const c = userJourneySchema.parse(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'uj'
  const id = (role: string, name: string) => stableId(scope, role, name)
  const items: Item[] = []
  const labelW = 130
  const x0 = PAD + labelW + GAP
  // what an annotation names (`data.element`): a stage by the slug of its text, a sticky as `<stage>/<slug of its text>`
  const alloc = idAllocator()
  const stageEl = c.stages.map((s) => alloc(undefined, s.text, 'stage'))

  items.push(make({ id: id('persona', c.persona), type: 'text', x: PAD, y: PAD, w: labelW + c.stages.length * COL, h: 40, text: `Persona: ${c.persona}`, role: 'persona', color: 'white' }, now))

  const facets: { key: 'actions' | 'touchpoints' | 'pains' | 'opportunities'; label: string; color: 'white' | 'blue' | 'red' | 'green' }[] = [
    { key: 'actions', label: 'Actions', color: 'white' },
    { key: 'touchpoints', label: 'Touchpoints', color: 'blue' },
    { key: 'pains', label: 'Pain points', color: 'red' },
    { key: 'opportunities', label: 'Opportunities', color: 'green' },
  ]

  const maxRows = (key: (typeof facets)[number]['key']) => Math.max(1, ...c.stages.map((s) => s[key].length))
  let y = PAD + 40 + GAP

  // Stage header row
  c.stages.forEach((s, i) => {
    items.push(make({ id: id('stage', s.text), type: 'sticky', x: x0 + i * COL, y, w: STICKY_W, h: 70, text: s.text, color: 'yellow', role: 'stage', order: i, data: { element: stageEl[i] } }, now))
  })
  y += 70 + GAP

  // Facet rows (actions & touchpoints first, then emotion curve, then pains & opportunities)
  const drawFacet = (f: (typeof facets)[number]) => {
    const rows = maxRows(f.key)
    const rowId = id('row', f.label)
    items.push(make({ id: rowId, type: 'text', x: PAD, y, w: labelW, h: 40, text: f.label, role: 'row-label', color: 'grey' }, now))
    c.stages.forEach((s, i) => {
      s[f.key].forEach((t, k) => {
        items.push(
          make(
            { id: id(f.key.replace(/s$/, ''), `${s.text}/${t}`), type: 'sticky', x: x0 + i * COL, y: y + k * ROW_H, w: STICKY_W, h: ROW_H - GAP / 2, text: t, color: f.color, role: f.key.replace(/s$/, ''), data: { stage: s.text, element: alloc(`${stageEl[i]}/${slugify(t) || f.key.replace(/s$/, '')}`, t) } },
            now,
          ),
        )
      })
    })
    y += rows * ROW_H + GAP / 2
  }
  drawFacet(facets[0])
  drawFacet(facets[1])

  // Emotion curve: +2 at top, -2 at bottom; one small sticky per stage, connected by arrows.
  const laneId = id('row', 'Emotion')
  items.push(make({ id: laneId, type: 'lane', x: PAD, y: y - LANE_HEADER / 2, w: labelW + c.stages.length * COL + GAP, h: EMOTION_H + LANE_HEADER, text: 'Emotion', role: 'emotion-lane', color: 'grey' }, now))
  const faces = ['😫', '🙁', '😐', '🙂', '😄']
  let prev: string | undefined
  c.stages.forEach((s, i) => {
    const level = s.emotion // -2..2
    const ey = y + (2 - level) * 40
    const e = make(
      { id: id('emotion', s.text), type: 'sticky', x: x0 + i * COL + STICKY_W / 2 - 30, y: ey, w: 60, h: 40, text: faces[level + 2], color: level > 0 ? 'green' : level < 0 ? 'red' : 'yellow', role: 'emotion', parent: laneId, data: { stage: s.text, emotion: level, element: alloc(`${stageEl[i]}/emotion`, 'emotion') } },
      now,
    )
    items.push(e)
    if (prev) items.push(arrow(scope, prev, e.id, now, undefined, 'emotion-curve'))
    prev = e.id
  })
  y += EMOTION_H + LANE_HEADER

  drawFacet(facets[2])
  drawFacet(facets[3])

  return offsetAll(items, opts.at)
}
