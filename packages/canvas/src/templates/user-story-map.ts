// User story map (docs/diagrams.md §5) — backbone activities → steps → stories under each step, in
// horizontal release lanes top → bottom with a cut line above each release after the first: stories above
// the first line are Release 1. Stories keep their acceptance and trace links in `data`; the server turns
// traces into dotted 'trace' wires when the target is on the board.
import type { Item } from '../model.js'
import { normalizeUserStoryMap, type UserStoryMapContent } from '../diagrams/userStoryMap.js'
import { slugify } from '../diagrams/ids.js'
import { GAP, LANE_HEADER, PAD, STICKY_H, fit, make, offsetAll, type RenderOpts } from './util.js'

export { userStoryMapSchema, type UserStoryMapContent } from '../diagrams/userStoryMap.js'

const CARD_W = 150
const CARD_H = 90
const COL = CARD_W + GAP / 2

export function renderUserStoryMap(raw: UserStoryMapContent, opts: RenderOpts = {}): Item[] {
  const m = normalizeUserStoryMap(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'usm'
  const itemId = (role: string, element: string) => `${scope}.${role}.${element}`
  const items: Item[] = []

  const rowActivity = PAD
  const rowStep = rowActivity + STICKY_H + GAP
  const rowStoriesStart = rowStep + CARD_H + GAP + LANE_HEADER

  // Column assignment: each step gets a column; activities span their steps.
  let col = 0
  const stepCols: Array<{ id: string; text: string; col: number; stories: (typeof m.activities)[number]['steps'][number]['stories'] }> = []
  m.activities.forEach((a, ai) => {
    const startCol = col
    a.steps.forEach((s) => stepCols.push({ id: s.id, text: s.text, col: col++, stories: s.stories }))
    if (a.steps.length === 0) col++
    const span = Math.max(col - startCol, 1)
    items.push(make({ id: itemId('activity', a.id), type: 'sticky', x: PAD + startCol * COL, y: rowActivity, w: span * COL - GAP / 2, h: STICKY_H, text: a.text, color: 'blue', role: 'activity', order: ai, data: { element: a.id } }, now))
  })
  stepCols.forEach((s, i) => {
    items.push(make({ id: itemId('step', s.id), type: 'sticky', x: PAD + s.col * COL, y: rowStep, w: CARD_W, h: CARD_H, text: s.text, color: 'yellow', role: 'step', order: i, data: { element: s.id } }, now))
  })

  // Release lanes: each lane's height = the most stories any step has in that release.
  const width = PAD * 2 + Math.max(col, 1) * COL
  let y = rowStoriesStart
  const lanes: Item[] = []
  const laneSlugs = new Set<string>()
  m.releases.forEach((rel, ri) => {
    let slug = slugify(rel) || 'release'
    for (let n = 2; laneSlugs.has(slug); n++) slug = `${slugify(rel) || 'release'}-${n}`
    laneSlugs.add(slug)
    const laneId = itemId('release', slug)
    const laneStories: Item[] = []
    let maxRows = 0
    stepCols.forEach((s) => {
      const inRel = s.stories.filter((st) => st.release === rel)
      maxRows = Math.max(maxRows, inRel.length)
      inRel.forEach((st, k) => {
        const data: Record<string, unknown> = { element: st.id, release: rel, step: s.id }
        if (st.acceptance.length) data.acceptance = st.acceptance
        if (st.traces.length) data.traces = st.traces
        laneStories.push(make({ id: itemId('story', st.id), type: 'card', x: PAD + s.col * COL, y: y + k * (CARD_H + GAP / 2), w: CARD_W, h: CARD_H, text: st.text, color: 'white', role: 'story', parent: laneId, order: k, data }, now))
      })
    })
    const laneH = Math.max(maxRows, 1) * (CARD_H + GAP / 2) + PAD
    const lane = make({ id: laneId, type: 'lane', x: 0, y: y - LANE_HEADER, w: width, h: laneH + LANE_HEADER, text: rel, role: 'release', color: 'grey', order: ri, data: { release: rel } }, now)
    lanes.push(fit(lane, laneStories, PAD / 2, LANE_HEADER))
    items.push(...laneStories)
    y += laneH + LANE_HEADER + GAP / 2
  })

  // The cut line above every release but the first, halfway between the lanes: what is above ships first.
  lanes.forEach((lane, i) => {
    if (i === 0) return
    const prev = lanes[i - 1]
    const y = (prev.y + prev.h + lane.y) / 2 - 2
    items.push(make({ id: `${lane.id.replace('.release.', '.release-cut.')}`, type: 'text', x: 0, y, w: width, h: 4, text: '', role: 'release-cut', color: 'grey', data: { release: lane.data?.release } }, now))
  })

  return offsetAll([...lanes, ...items], opts.at)
}
