// Domain Storytelling (docs/diagrams.md §6b) — a pictographic story, drawn the way the method draws it.
//
// What a domain story picture looks like (domainstorytelling.org quick-start guide, Egon.io):
// - actors and work objects are pictograms with their name under the icon — no boxes;
// - "Every actor appears only once in the domain story. But for every activity, we draw a separate work
//   object." Actors sit freely on the canvas, work objects sit on the way from one actor to the next;
// - an activity is an arrow labelled with a verb; its sequence number is a small circle at the arrow's
//   origin; an onward arrow ("to", "for" …) takes the work object on to the receiving actor.
// Layout here: actors on a coarse grid, the first actor on the left, each new actor in a free cell next to
// the actor it first works with (right first, then below/above); a work object at the middle of the way
// from its actor to its receiver (spread sideways when several objects share that way); a sentence without
// a receiver puts its object in a free slot around its actor. A few placement preferences are tried and
// the one with the fewest crossing arrows is kept, so the output is deterministic. Positions are not part
// of the file, so Egon.io import/export is unaffected.
// Items: actors and work objects are `card`s with `data.ds` (the web draws them as pictograms), activity
// arrows carry `data.seq` (the web draws the number circle on the line) and the verb as their label. A
// sentence without a work object is one arrow actor → receiver; its element id rides on that arrow, and
// traces into it resolve to its actor.
import type { Item } from '../model.js'
import { normalizeDomainStory, readSentence, type DomainStoryContent, type DsModel, type DsSentence } from '../diagrams/domainStory.js'
import { PAD, arrow, make, offsetAll, type RenderOpts } from './util.js'

export { domainStorySchema, type DomainStoryContent } from '../diagrams/domainStory.js'

/** A pictogram item: icon on top, the name under it. */
export const ICON_W = 132
export const ICON_H = 100
const CELL_W = 460 // actor grid: room for a work object and two labelled arrows between neighbours
const CELL_H = 330
const SPREAD = 150 // sideways gap between work objects that share the way between two actors
const SLOT = 250 // distance of a receiver-less work object from its actor
const NOTE_W = 200
const NOTE_H = 64

type Box = { x: number; y: number; w: number; h: number }
type Pt = { x: number; y: number }
const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const overlaps = (a: Box, b: Box, gap = 16) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/** Proper crossings between segments that share no endpoint. */
export function countCrossings(segs: Array<[Pt, Pt]>): number {
  const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5
  const orient = (a: Pt, b: Pt, c: Pt) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
  let n = 0
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i]
      const [c, d] = segs[j]
      if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) n++
    }
  return n
}

type Offset = readonly [number, number]
/** Where to put a new actor relative to the actor it first works with — a few preference orders to try. */
const PREFERENCES: Offset[][] = [
  [[1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [-1, 0], [2, 0], [0, 2], [2, 1], [2, -1]],
  [[1, 0], [0, -1], [0, 1], [1, -1], [1, 1], [-1, -1], [-1, 1], [-1, 0], [2, 0], [0, -2], [2, -1], [2, 1]],
  [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [1, -1], [-1, 0], [-1, -1], [0, 2], [2, 0], [1, 2], [2, 1]],
  [[1, 1], [1, -1], [1, 0], [0, 1], [0, -1], [-1, 1], [-1, -1], [-1, 0], [2, 0], [2, 1], [2, -1], [0, 2]],
]
const SLOTS: Offset[] = [[1, 0], [1, 0.8], [1, -0.8], [0, 1], [0, -1], [-1, 0.8], [-1, -0.8], [-1, 0], [1.6, 0], [0, 1.7], [0, -1.7]]

interface Layout {
  actor: Map<string, Box>
  object: Map<string, Box> // sentence id → work-object box
  crossings: number
}

function layoutWith(m: DsModel, sentences: DsSentence[], order: string[], pref: Offset[]): Layout {
  const cell = new Map<string, [number, number]>()
  const taken = new Set<string>()
  const put = (id: string, c: number, r: number) => {
    cell.set(id, [c, r])
    taken.add(`${c},${r}`)
  }
  put(order[0], 0, 0)
  const near = (id: string, partner: string) => {
    const [pc, pr] = cell.get(partner)!
    for (const [dc, dr] of pref) if (!taken.has(`${pc + dc},${pr + dr}`)) return put(id, pc + dc, pr + dr)
    let c = pc + 1
    while (taken.has(`${c},${pr}`)) c++
    put(id, c, pr)
  }
  for (const s of sentences) {
    const cast = [s.actor, ...s.to]
    for (const id of cast) {
      if (cell.has(id)) continue
      const partner = cast.find((p) => cell.has(p)) ?? [...cell.keys()][cell.size - 1]
      near(id, partner)
    }
  }
  for (const id of order) if (!cell.has(id)) near(id, [...cell.keys()][cell.size - 1])

  const actor = new Map<string, Box>()
  for (const [id, [c, r]] of cell) actor.set(id, { x: c * CELL_W, y: r * CELL_H, w: ICON_W, h: ICON_H })

  // Work objects: on the way from the actor to the receiver(s), spread sideways when the way is shared.
  const boxes: Box[] = [...actor.values()]
  const free = (b: Box) => !boxes.some((o) => overlaps(o, b))
  const wayCount = new Map<string, number>()
  const wayKey = (s: DsSentence) => [s.actor, ...[...s.to].sort()].join('>')
  const wayIndex = new Map<string, number>()
  for (const s of sentences) if (s.objectText && s.to.length) wayCount.set(wayKey(s), (wayCount.get(wayKey(s)) ?? 0) + 1)
  const object = new Map<string, Box>()
  for (const s of sentences) {
    if (!s.objectText) continue
    const a = centre(actor.get(s.actor)!)
    let at: Pt
    let perp: Pt
    if (s.to.length) {
      const rs = s.to.map((r) => centre(actor.get(r)!))
      const t = { x: rs.reduce((v, p) => v + p.x, 0) / rs.length, y: rs.reduce((v, p) => v + p.y, 0) / rs.length }
      const len = Math.hypot(t.x - a.x, t.y - a.y) || 1
      perp = { x: -(t.y - a.y) / len, y: (t.x - a.x) / len }
      const n = wayCount.get(wayKey(s)) ?? 1
      const k = wayIndex.get(wayKey(s)) ?? 0
      wayIndex.set(wayKey(s), k + 1)
      const shift = (k - (n - 1) / 2) * SPREAD
      at = { x: (a.x + t.x) / 2 + perp.x * shift, y: (a.y + t.y) / 2 + perp.y * shift }
    } else {
      // no receiver: the first free slot around the actor
      perp = { x: 0, y: 1 }
      at = { x: a.x + SLOT, y: a.y }
      for (const [dx, dy] of SLOTS) {
        const cand = { x: a.x + dx * SLOT, y: a.y + dy * SLOT * 0.75 }
        if (free({ x: cand.x - ICON_W / 2, y: cand.y - ICON_H / 2, w: ICON_W, h: ICON_H })) {
          at = cand
          break
        }
      }
    }
    // nudge sideways until it overlaps nothing
    let box = { x: at.x - ICON_W / 2, y: at.y - ICON_H / 2, w: ICON_W, h: ICON_H }
    for (let step = 1; !free(box) && step <= 12; step++) {
      const d = Math.ceil(step / 2) * 70 * (step % 2 ? 1 : -1)
      box = { x: at.x + perp.x * d - ICON_W / 2, y: at.y + perp.y * d - ICON_H / 2, w: ICON_W, h: ICON_H }
    }
    boxes.push(box)
    object.set(s.id, box)
  }

  const segs: Array<[Pt, Pt]> = []
  for (const s of sentences) {
    const a = centre(actor.get(s.actor)!)
    const o = object.get(s.id)
    if (o) {
      segs.push([a, centre(o)])
      for (const r of s.to) segs.push([centre(o), centre(actor.get(r)!)])
    } else for (const r of s.to) segs.push([a, centre(actor.get(r)!)])
  }
  return { actor, object, crossings: countCrossings(segs) }
}

/** The side of `from` that faces `to`, and the side of `to` that faces back. */
function facing(from: Box, to: Box): { fromSide: string; toSide: string } {
  const a = centre(from)
  const b = centre(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy) * 0.9) return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' }
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' }
}

export function renderDomainStory(raw: DomainStoryContent, opts: RenderOpts = {}): Item[] {
  const m = normalizeDomainStory(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'ds'
  const itemId = (role: string, element: string) => `${scope}.${role}.${element}`
  const sentences = [...m.sentences].sort((a, b) => a.seq - b.seq)

  // Actors in order of first appearance (actor, then receivers, sentence by sentence).
  const order: string[] = []
  const seen = (id: string) => void (order.includes(id) || order.push(id))
  for (const s of sentences) {
    seen(s.actor)
    s.to.forEach(seen)
  }
  for (const a of m.actors) seen(a.id)

  // Try each placement preference; keep the fewest crossings (the first on a tie).
  let best = layoutWith(m, sentences, order, PREFERENCES[0])
  for (const pref of PREFERENCES.slice(1)) {
    const l = layoutWith(m, sentences, order, pref)
    if (l.crossings < best.crossings) best = l
  }

  const items: Item[] = []
  const actorItem = new Map<string, Item>()
  // Traces of sentences without a work object ride on their actor (an arrow cannot be a trace's end).
  const actorTraces = new Map<string, DsSentence['traces']>()
  for (const s of sentences) if (!s.objectText && s.traces.length) actorTraces.set(s.actor, [...(actorTraces.get(s.actor) ?? []), ...s.traces])
  order.forEach((id, i) => {
    const a = m.actors.find((x) => x.id === id)!
    const b = best.actor.get(id)!
    const traces = actorTraces.get(id)
    const it = make({ id: itemId('actor', a.id), type: 'card', ...b, text: a.text, role: 'actor', order: i, data: { element: a.id, kind: a.kind, ds: 'actor', ...(traces ? { traces } : {}) } }, now)
    actorItem.set(id, it)
    items.push(it)
  })

  const objectItem = new Map<string, Item>()
  for (const s of sentences) {
    const read = readSentence(m, s)
    const base = { seq: s.seq, sentence: read, ds: true }
    const from = actorItem.get(s.actor)!
    const box = best.object.get(s.id)
    if (box && s.objectText) {
      const o = make({ id: itemId('object', s.id), type: 'card', ...box, text: s.objectText, role: 'work-object', order: s.seq, data: { element: s.id, seq: s.seq, sentence: read, kind: s.objectKind, ds: 'object', ...(s.object ? { workObject: s.object } : {}), ...(s.traces.length ? { traces: s.traces } : {}), ...(s.note ? { note: s.note } : {}) } }, now)
      objectItem.set(s.id, o)
      items.push(o)
      items.push(arrow(scope, from.id, o.id, now, s.verb, 'activity', { key: s.id, data: { ...base, ...facing(from, o) } }))
      for (const r of s.to) {
        const to = actorItem.get(r)!
        items.push(arrow(scope, o.id, to.id, now, s.toLabel, 'activity-to', { key: `${s.id}:to:${r}`, data: { sentence: read, ds: true, ...facing(o, to) } }))
      }
    } else {
      // no work object: one numbered arrow from actor to actor (the sentence's element id rides on it)
      for (const [k, r] of s.to.entries()) {
        const to = actorItem.get(r)!
        items.push(arrow(scope, from.id, to.id, now, s.verb, 'activity', { key: `${s.id}${k ? `:${r}` : ''}`, data: { ...base, element: s.id, ...facing(from, to) } }))
      }
    }
  }

  // Annotations: a short text note beside what it explains, joined by a dashed line (as Egon.io does).
  const placed: Box[] = [...actorItem.values(), ...objectItem.values()]
  for (const n of m.annotations) {
    const target = actorItem.get(n.on) ?? objectItem.get(n.on) ?? [...objectItem.values()].find((o) => o.data?.workObject === n.on)
    const base = target ?? { x: 0, y: 0, w: 0, h: 0 }
    const candidates: Pt[] = [
      { x: base.x + base.w + 60, y: base.y - 10 },
      { x: base.x + base.w + 60, y: base.y + base.h - 20 },
      { x: base.x - NOTE_W - 60, y: base.y - 10 },
      { x: base.x, y: base.y + base.h + 40 },
      { x: base.x, y: base.y - NOTE_H - 40 },
    ]
    let at = candidates.find((p) => !placed.some((o) => overlaps(o, { ...p, w: NOTE_W, h: NOTE_H }))) ?? candidates[0]
    for (let k = 0; placed.some((o) => overlaps(o, { ...at, w: NOTE_W, h: NOTE_H })) && k < 12; k++) at = { x: at.x, y: at.y + NOTE_H + 20 }
    const note = make({ id: itemId('note', n.id), type: 'text', x: at.x, y: at.y, w: NOTE_W, h: NOTE_H, text: n.text, role: 'annotation', data: { element: n.id, on: n.on, ds: 'annotation' } }, now)
    placed.push(note)
    items.push(note)
    if (target) items.push(arrow(scope, note.id, target.id, now, undefined, 'annotation-link', { data: { ds: true, ...facing(note, target) } }))
  }

  // Groups: a rounded outline around the members (drawn first, so it sits behind them).
  const outlines: Item[] = []
  for (const g of m.groups) {
    const members = g.members.map((id) => actorItem.get(id) ?? objectItem.get(id) ?? [...objectItem.values()].find((o) => o.data?.workObject === id)).filter((b): b is Item => !!b)
    if (!members.length) continue
    const x0 = Math.min(...members.map((b) => b.x)) - 36
    const y0 = Math.min(...members.map((b) => b.y)) - 48
    const x1 = Math.max(...members.map((b) => b.x + b.w)) + 36
    const y1 = Math.max(...members.map((b) => b.y + b.h)) + 30
    outlines.push(make({ id: itemId('group', g.id), type: 'frame', x: x0, y: y0, w: x1 - x0, h: y1 - y0, text: g.text, color: 'grey', role: 'group', data: { element: g.id, members: g.members, ds: 'group' } }, now))
  }

  // Move everything so the story starts at PAD, then the legend under it.
  const all = [...outlines, ...items.filter((i) => i.type !== 'arrow')]
  const minX = Math.min(...all.map((i) => i.x))
  const minY = Math.min(...all.map((i) => i.y))
  const shifted = [...outlines, ...items].map((i) => (i.type === 'arrow' ? i : { ...i, x: i.x - minX + PAD, y: i.y - minY + PAD }))
  const bottom = Math.max(...shifted.filter((i) => i.type !== 'arrow').map((i) => i.y + i.h))

  const legendY = bottom + 90
  const legend: Item[] = [make({ id: itemId('legend-title', 'legend'), type: 'text', x: PAD, y: legendY, w: 560, h: 24, text: 'Legend — Domain Storytelling (domainstorytelling.org)', role: 'legend-title' }, now)]
  const entries: Array<[string, string, string]> = [
    ['actor', 'person', 'person'],
    ['actor', 'group', 'group'],
    ['actor', 'system', 'system'],
    ['object', 'document', 'work object'],
    ['activity', 'activity', 'activity: ① = order, then the verb'],
  ]
  entries.forEach(([what, kind, text], i) => {
    const w = what === 'activity' ? 260 : 110
    const x = PAD + i * 130 + (what === 'activity' ? 10 : 0)
    legend.push(make({ id: itemId('legend', `l${i}`), type: 'card', x, y: legendY + 36, w, h: 88, text, role: 'legend', data: { ds: `legend-${what}`, kind } }, now))
  })
  const facets = [m.scope.granularity, m.scope.time, m.scope.purity].filter(Boolean)
  if (facets.length) legend.push(make({ id: itemId('scope', 'scope'), type: 'text', x: PAD + 4 * 130 + 290, y: legendY + 50, w: 520, h: 64, text: `Scope: ${facets.join(' · ')}`, role: 'scope', data: { scope: m.scope } }, now))

  return offsetAll([...shifted, ...legend], opts.at)
}

/** The sentence a domain-story item stands for, read out (for panels and briefs). */
export function sentenceOf(item: Item): string | undefined {
  const s = item.data?.sentence
  return typeof s === 'string' ? s : undefined
}

export type { DsSentence }
