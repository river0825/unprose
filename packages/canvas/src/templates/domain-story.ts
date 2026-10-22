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
// Collisions (docs/diagrams.md §6b "No collisions"): an actor that sends to itself ("cl lints the file to cl")
// gets its work object beside it, never on top of it, and no return arrow (it would run back over the activity
// arrow); no two pictograms ever share a spot (a work object that finds no free place on its way is moved to the
// nearest free place around it); an annotation is as big as its text (measured, wrapped within NOTE_MAX_W) and
// keeps off pictograms and arrows; group outlines shrink-wrap their members, a group whose members are all in
// another group is drawn nested inside it, and two groups that would still overlap are trimmed apart where
// there is room — or, when they share members, marked (`data.overlaps`) for the lint and the layout check.
// Verbs and number circles are placed on the board as a whole (wireGeometry.ts planWires), not here.
// Items: actors and work objects are `card`s with `data.ds` (the web draws them as pictograms), activity
// arrows carry `data.seq` (the web draws the number circle on the line) and the verb as their label. A
// sentence without a work object is one arrow actor → receiver; its element id rides on that arrow, and
// traces into it resolve to its actor.
import type { Item } from '../model.js'
import { normalizeDomainStory, readSentence, type DomainStoryContent, type DsModel, type DsSentence } from '../diagrams/domainStory.js'
import { measure, sizeToText } from '../textMetrics.js'
import { EDGE_LABEL } from '../edgeLabel.js'
import { PAD, arrow, make, offsetAll, type RenderOpts } from './util.js'

export { domainStorySchema, type DomainStoryContent } from '../diagrams/domainStory.js'

/** A pictogram item: icon on top, the name under it. */
export const ICON_W = 132
export const ICON_H = 100
// Spacing (docs/diagrams.md §6b "Spacing"). The `compact` pitches are the earlier fixed ones; `normal` (the default)
// and `roomy` scale them up, and on top of that every arrow gets room for its number circle and its verb, measured
// with the same text metrics the snapshot and the layout check use (textMetrics.ts), so labels and numbers do not
// crowd: a long verb widens the grid.
const BASE = { cellW: 460, cellH: 330, spread: 150, slot: 250, nudge: 70 }
export const DS_SPACING = { compact: 1, normal: 1.25, roomy: 1.55 } as const
export type DsSpacing = keyof typeof DS_SPACING
/** The verb's font on the board (edgeLabel.ts EDGE_LABEL.dsFont). */
const DS_VERB_FONT = EDGE_LABEL.dsFont
/** The number circle (22 px) sits ~24 px along the arrow: what an arrow needs before its verb starts. */
const SEQ_ROOM = 22 + 24
/** Air after the verb, per spacing. */
const VERB_AIR: Record<DsSpacing, number> = { compact: 0, normal: 24, roomy: 60 }
/** A verb wider than this is cut on the board anyway; it does not stretch the grid further. */
const VERB_CAP = 220
/** How far a floating arrow starts from the centre of a pictogram it leaves horizontally / vertically (ItemEdge floatingEnd). */
const CUT_X = ICON_W / 2 + 6
const CUT_Y = ICON_H / 2 + 6

export interface DsGeometry {
  /** actor grid pitch: room for a work object and two labelled arrows between neighbours */
  cellW: number
  cellH: number
  /** sideways gap between work objects that share the way between two actors */
  spread: number
  /** distance of a receiver-less work object from its actor */
  slot: number
  /** step when nudging a work object off another */
  nudge: number
}

/** The free length an activity arrow needs: number circle + verb + air. */
export function arrowRoom(verb: string | undefined, spacing: DsSpacing = 'normal'): number {
  return SEQ_ROOM + Math.min(VERB_CAP, verb ? measure(verb, DS_VERB_FONT) : 0) + VERB_AIR[spacing]
}

/** The grid for a story: its spacing's pitches, widened so the longest verb fits, then the file's explicit gaps. */
export function dsGeometry(m: Pick<DsModel, 'sentences' | 'layout'>): DsGeometry {
  const spacing: DsSpacing = m.layout?.spacing ?? 'normal'
  const f = DS_SPACING[spacing]
  // compact keeps the old fixed pitches (long verbs may crowd); normal and roomy make room for the longest verb
  const need = spacing === 'compact' ? 0 : Math.max(arrowRoom(undefined, spacing), ...m.sentences.flatMap((s) => [arrowRoom(s.verb, spacing), arrowRoom(s.toLabel, spacing)]))
  // a work object sits halfway between two actors: each half holds one arrow plus the two pictogram cuts
  const cellW = Math.round(Math.max(BASE.cellW * f, 2 * (need + 2 * CUT_X)))
  const cellH = Math.round(Math.max(BASE.cellH * f, 2 * (need + 2 * CUT_Y)))
  return {
    cellW: m.layout?.gapX ?? cellW,
    cellH: m.layout?.gapY ?? cellH,
    spread: Math.round(Math.max(BASE.spread * f, ICON_W + 18)),
    slot: Math.round(Math.max(BASE.slot * f, need + 2 * CUT_X)),
    nudge: Math.round(BASE.nudge * f),
  }
}
/** Annotations: sized from their text (textMetrics.ts), at most this wide; the height grows with the text. */
export const NOTE_MIN_W = 160
export const NOTE_MAX_W = 280
const NOTE_MIN_H = 40
/** Group outlines: padding around the members (the title sits above the outline, GROUP_TITLE_H tall). */
const GROUP_PAD_X = 28
const GROUP_PAD_TOP = 30
const GROUP_PAD_BOTTOM = 22
/** extra room around a group drawn inside another */
const GROUP_NEST = 18
export const GROUP_TITLE_H = 26

type Box = { x: number; y: number; w: number; h: number }
type Pt = { x: number; y: number }
const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const overlaps = (a: Box, b: Box, gap = 16) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
/** The actors a sentence's work object goes on to — never its own actor (a self-directed activity has none). */
export const receiversOf = (s: Pick<DsSentence, 'actor' | 'to'>): string[] => s.to.filter((r) => r !== s.actor)

/** Does the segment p→q pass through box b (grown by `pad`)? (Liang–Barsky clip.) */
export function segmentHitsBox(p: Pt, q: Pt, b: Box, pad = 0): boolean {
  const [x0, y0, x1, y1] = [b.x - pad, b.y - pad, b.x + b.w + pad, b.y + b.h + pad]
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  for (const [pp, qq] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]] as const) {
    if (pp === 0) {
      if (qq < 0) return false
      continue
    }
    const r = qq / pp
    if (pp < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return false
  }
  return true
}

/** The nearest spot around `at` where a w×h box overlaps none of `boxes`: rings of growing radius, 12 directions each. */
function nearestFree(at: Pt, w: number, h: number, boxes: Box[], step: number, start: Pt = { x: 0, y: 1 }): Box {
  const box = (p: Pt) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h })
  const a0 = Math.atan2(start.y, start.x)
  for (let ring = 1; ring <= 40; ring++) {
    for (let k = 0; k < 12; k++) {
      // alternate sides of the start direction: 0, +30°, -30°, +60° …
      const a = a0 + (Math.ceil(k / 2) * (k % 2 ? 1 : -1) * Math.PI) / 6
      const b = box({ x: at.x + Math.cos(a) * ring * step, y: at.y + Math.sin(a) * ring * step })
      if (!boxes.some((o) => overlaps(o, b))) return b
    }
  }
  return box({ x: at.x, y: at.y + 41 * step })
}

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

/**
 * Which drawing of its actors a sentence uses: copy keys. An actor's first (often only) drawing has the actor's id as
 * its key; a repeated actor's later drawings are `<id>#2`, `<id>#3` …, numbered in the order the story needs them.
 */
export interface DsCast {
  actor: string
  /** the receivers (never the actor itself) */
  to: string[]
}
/** The copy key of actor `id`'s `k`th drawing (1-based). */
const copyKey = (id: string, k: number) => (k === 1 ? id : `${id}#${k}`)
/** The actor a copy key draws, and which drawing of it it is. */
export const parseCopyKey = (key: string): { id: string; copy: number } => {
  const i = key.lastIndexOf('#')
  return i > 0 ? { id: key.slice(0, i), copy: Number(key.slice(i + 1)) } : { id: key, copy: 1 }
}
/**
 * A repeated actor is used again only when the sentence can be drawn next to that drawing: at most this many grid cells
 * away (a longer arrow runs back across the story), crossing no arrow drawn before and through no other actor.
 */
const REUSE_CELLS = 2

interface Layout {
  /** copy key → box */
  actor: Map<string, Box>
  object: Map<string, Box> // sentence id → work-object box
  /** sentence id → the drawings of its actors it uses */
  cast: Map<string, DsCast>
  /** copy keys in the order they were drawn */
  drawn: string[]
  /** crossing arrows, plus arrows through pictograms (weighted): the layout with the least is kept */
  crossings: number
}

function layoutWith(m: DsModel, sentences: DsSentence[], order: string[], pref: Offset[], g: DsGeometry): Layout {
  const cell = new Map<string, [number, number]>()
  const taken = new Set<string>()
  const put = (id: string, c: number, r: number) => {
    cell.set(id, [c, r])
    taken.add(`${c},${r}`)
  }
  const near = (id: string, partner: string) => {
    const [pc, pr] = cell.get(partner)!
    for (const [dc, dr] of pref) if (!taken.has(`${pc + dc},${pr + dr}`)) return put(id, pc + dc, pr + dr)
    let c = pc + 1
    while (taken.has(`${c},${pr}`)) c++
    put(id, c, pr)
  }
  const cast = new Map<string, DsCast>()
  if (m.actors.some((a) => a.repeat)) placeWithCopies(m, sentences, order, g, cell, put, near, cast)
  else {
    // every actor drawn once (the book's rule)
    put(order[0], 0, 0)
    for (const s of sentences) {
      const members = [s.actor, ...receiversOf(s)]
      for (const id of members) {
        if (cell.has(id)) continue
        const partner = members.find((p) => cell.has(p)) ?? [...cell.keys()][cell.size - 1]
        near(id, partner)
      }
      cast.set(s.id, { actor: s.actor, to: receiversOf(s) })
    }
    for (const id of order) if (!cell.has(id)) near(id, [...cell.keys()][cell.size - 1])
  }

  const actor = new Map<string, Box>()
  for (const [id, [c, r]] of cell) actor.set(id, { x: c * g.cellW, y: r * g.cellH, w: ICON_W, h: ICON_H })

  // Work objects: on the way from the actor to the receiver(s), spread sideways when the way is shared.
  const boxes: Box[] = [...actor.values()]
  const free = (b: Box) => !boxes.some((o) => overlaps(o, b))
  const wayCount = new Map<string, number>()
  const wayKey = (s: DsSentence) => [cast.get(s.id)!.actor, ...[...cast.get(s.id)!.to].sort()].join('>')
  const wayIndex = new Map<string, number>()
  for (const s of sentences) if (s.objectText && receiversOf(s).length) wayCount.set(wayKey(s), (wayCount.get(wayKey(s)) ?? 0) + 1)
  const object = new Map<string, Box>()
  for (const s of sentences) {
    if (!s.objectText) continue
    const a = centre(actor.get(cast.get(s.id)!.actor)!)
    let at: Pt
    let perp: Pt
    const recv = cast.get(s.id)!.to
    if (recv.length) {
      const rs = recv.map((r) => centre(actor.get(r)!))
      const t = { x: rs.reduce((v, p) => v + p.x, 0) / rs.length, y: rs.reduce((v, p) => v + p.y, 0) / rs.length }
      const len = Math.hypot(t.x - a.x, t.y - a.y)
      // receivers all on the actor's spot cannot happen (distinct actors take distinct cells); guard anyway
      perp = len ? { x: -(t.y - a.y) / len, y: (t.x - a.x) / len } : { x: 0, y: 1 }
      const n = wayCount.get(wayKey(s)) ?? 1
      const k = wayIndex.get(wayKey(s)) ?? 0
      wayIndex.set(wayKey(s), k + 1)
      const shift = (k - (n - 1) / 2) * g.spread
      at = { x: (a.x + t.x) / 2 + perp.x * shift, y: (a.y + t.y) / 2 + perp.y * shift }
    } else {
      // no receiver (or only itself): the first free slot around the actor, never the actor's own spot
      perp = { x: 0, y: 1 }
      at = { x: a.x + g.slot, y: a.y }
      // a free slot whose arrow from the actor passes no other pictogram; else the first free one
      const own = actor.get(cast.get(s.id)!.actor)!
      const slots = SLOTS.map(([dx, dy]) => ({ x: a.x + dx * g.slot, y: a.y + dy * g.slot * 0.75 })).filter((c) => free({ x: c.x - ICON_W / 2, y: c.y - ICON_H / 2, w: ICON_W, h: ICON_H }))
      at = slots.find((c) => !boxes.some((o) => o !== own && segmentHitsBox(a, c, o, -10))) ?? slots[0] ?? at
    }
    // nudge sideways until it overlaps nothing
    let box = { x: at.x - ICON_W / 2, y: at.y - ICON_H / 2, w: ICON_W, h: ICON_H }
    for (let step = 1; !free(box) && step <= 12; step++) {
      const d = Math.ceil(step / 2) * g.nudge * (step % 2 ? 1 : -1)
      box = { x: at.x + perp.x * d - ICON_W / 2, y: at.y + perp.y * d - ICON_H / 2, w: ICON_W, h: ICON_H }
    }
    // still on something: the nearest free place around it (two pictograms never share a spot)
    if (!free(box)) box = nearestFree(at, ICON_W, ICON_H, boxes, g.nudge, perp)
    boxes.push(box)
    object.set(s.id, box)
  }

  const segs: Array<[Pt, Pt]> = []
  for (const s of sentences) {
    const c = cast.get(s.id)!
    const a = centre(actor.get(c.actor)!)
    const o = object.get(s.id)
    if (o) {
      segs.push([a, centre(o)])
      for (const r of c.to) segs.push([centre(o), centre(actor.get(r)!)])
    } else for (const r of c.to) segs.push([a, centre(actor.get(r)!)])
  }
  // arrows running through a pictogram that is not one of their ends weigh as much as two crossings
  const all = [...actor.values(), ...object.values()]
  let through = 0
  for (const [p, q] of segs) for (const b of all) if (!samePt(centre(b), p) && !samePt(centre(b), q) && segmentHitsBox(p, q, b, -10)) through++
  return { actor, object, cast, drawn: [...cell.keys()], crossings: countCrossings(segs) + 2 * through }
}
const samePt = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5

/** Does segment p→q properly cross any of `lines` (sharing an end does not count)? */
function crossesAny(p: Pt, q: Pt, lines: Array<[Pt, Pt]>): boolean {
  for (const l of lines) if (countCrossings([[p, q], l]) > 0) return true
  return false
}

/**
 * Actors placed when some may repeat (`layout.actors: repeat`, or an actor's `repeat: true`). Sentence by sentence:
 * the sentence is drawn where the story is — next to the drawing of one of its actors nearest to the previous
 * sentence's (a repeated actor whose only drawings are far from there is drawn again next to the previous sentence).
 * Each other actor of the sentence uses its nearest drawing when that one is at most REUSE_CELLS cells away and the
 * arrow to it crosses nothing drawn before and runs through no other actor; else a repeated actor is drawn again next
 * to the sentence (an actor that does not repeat always uses its one drawing). Deterministic.
 */
function placeWithCopies(
  m: DsModel,
  sentences: DsSentence[],
  order: string[],
  g: DsGeometry,
  cell: Map<string, [number, number]>,
  put: (id: string, c: number, r: number) => void,
  near: (id: string, partner: string) => void,
  cast: Map<string, DsCast>,
): void {
  const repeats = new Set(m.actors.filter((a) => a.repeat).map((a) => a.id))
  const copies = new Map<string, string[]>()
  let last: string | undefined
  const draw = (id: string, partner: string | undefined): string => {
    const list = copies.get(id) ?? []
    const key = copyKey(id, list.length + 1)
    list.push(key)
    copies.set(id, list)
    if (partner) near(key, partner)
    else if (last) near(key, last)
    else put(key, 0, 0)
    last = key
    return key
  }
  const dist = (a: string, b: string) => {
    const [ac, ar] = cell.get(a)!
    const [bc, br] = cell.get(b)!
    return Math.max(Math.abs(ac - bc), Math.abs(ar - br))
  }
  const at = (key: string): Pt => {
    const [c, r] = cell.get(key)!
    return { x: c * g.cellW + ICON_W / 2, y: r * g.cellH + ICON_H / 2 }
  }
  const lines: Array<[Pt, Pt]> = []
  const clean = (a: string, b: string) => {
    const [p, q] = [at(a), at(b)]
    if (crossesAny(p, q, lines)) return false
    for (const k of cell.keys()) {
      if (k === a || k === b) continue
      const c = at(k)
      if (segmentHitsBox(p, q, { x: c.x - ICON_W / 2, y: c.y - ICON_H / 2, w: ICON_W, h: ICON_H }, -10)) return false
    }
    return true
  }
  // the drawing of `id` nearest to `to` (the first drawn on a tie)
  const nearest = (id: string, to: string[]) => {
    let best: string | undefined
    let d = Infinity
    for (const k of copies.get(id) ?? []) {
      const e = to.length ? Math.min(...to.map((t) => dist(k, t))) : 0
      if (e < d) ((best = k), (d = e))
    }
    return best === undefined ? undefined : { key: best, d }
  }
  let previous: string[] = []
  for (const s of sentences) {
    const members = [s.actor, ...receiversOf(s)]
    const chosen = new Map<string, string>()
    // where to draw the sentence: the member drawn nearest to the previous sentence
    let anchor: { id: string; key: string; d: number } | undefined
    for (const id of members) {
      const hit = nearest(id, previous)
      if (hit && (!anchor || hit.d < anchor.d)) anchor = { id, ...hit }
    }
    if (!anchor) anchor = { id: s.actor, key: draw(s.actor, undefined), d: 0 }
    else if (anchor.d > REUSE_CELLS && repeats.has(anchor.id) && previous.length) anchor = { id: anchor.id, key: draw(anchor.id, previous[previous.length - 1]), d: 0 }
    chosen.set(anchor.id, anchor.key)
    for (const id of members) {
      if (chosen.has(id)) continue
      const hit = nearest(id, [anchor.key])
      const reuse = hit && (!repeats.has(id) || (hit.d <= REUSE_CELLS && clean(anchor.key, hit.key)))
      chosen.set(id, reuse ? hit.key : draw(id, anchor.key))
    }
    const c: DsCast = { actor: chosen.get(s.actor)!, to: receiversOf(s).map((r) => chosen.get(r)!) }
    for (const r of c.to) lines.push([at(c.actor), at(r)])
    cast.set(s.id, c)
    previous = [c.actor, ...c.to]
  }
  for (const id of order) if (!copies.has(id)) draw(id, undefined)
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

/** The layout the board draws: each placement preference tried, the fewest crossings kept (the first on a tie). */
function bestLayout(m: DsModel): { sentences: DsSentence[]; order: string[]; best: Layout } {
  const sentences = [...m.sentences].sort((a, b) => a.seq - b.seq)
  // Actors in order of first appearance (actor, then receivers, sentence by sentence).
  const order: string[] = []
  const seen = (id: string) => void (order.includes(id) || order.push(id))
  for (const s of sentences) {
    seen(s.actor)
    s.to.forEach(seen)
  }
  for (const a of m.actors) seen(a.id)
  const g = dsGeometry(m)
  let best = layoutWith(m, sentences, order, PREFERENCES[0], g)
  for (const pref of PREFERENCES.slice(1)) {
    const l = layoutWith(m, sentences, order, pref, g)
    if (l.crossings < best.crossings) best = l
  }
  return { sentences, order, best }
}

/**
 * How the board casts a story: every drawing of an actor (copy keys, see DsCast — one per actor unless actors repeat), in
 * the order they are drawn, and which drawings each sentence uses. For Egon.io export and anything else that must draw
 * the actors the way the board does.
 */
export function dsCasting(raw: DomainStoryContent | DsModel): { drawn: string[]; cast: Map<string, DsCast> } {
  const m = 'dsModel' in raw ? raw : normalizeDomainStory(raw)
  const { order, best } = bestLayout(m)
  return { drawn: m.actors.some((a) => a.repeat) ? best.drawn : order, cast: best.cast }
}

export function renderDomainStory(raw: DomainStoryContent, opts: RenderOpts = {}): Item[] {
  const m = normalizeDomainStory(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'ds'
  const itemId = (role: string, element: string) => `${scope}.${role}.${element}`
  const { sentences, order, best } = bestLayout(m)

  const items: Item[] = []
  // an icon the file brings travels on the item, so the page and the snapshot draw it without the file
  const ownIcon = (kind: string) => (m.icons?.[kind] ? { icon: m.icons[kind] } : {})
  const actorItem = new Map<string, Item>()
  // Traces of sentences without a work object ride on their actor (an arrow cannot be a trace's end).
  const actorTraces = new Map<string, DsSentence['traces']>()
  for (const s of sentences) {
    const key = best.cast.get(s.id)!.actor
    if (!s.objectText && s.traces.length) actorTraces.set(key, [...(actorTraces.get(key) ?? []), ...s.traces])
  }
  // every actor once: in order of first appearance; repeated actors: every drawing, in the order the story needed them
  const drawings = m.actors.some((a) => a.repeat) ? best.drawn : order
  drawings.forEach((key, i) => {
    const { id, copy } = parseCopyKey(key)
    const a = m.actors.find((x) => x.id === id)!
    const b = best.actor.get(key)!
    const traces = actorTraces.get(key)
    // a later drawing of the actor: `<scope>.actor.<id>.<n>`, marked as an occurrence (as EventStorming marks a person drawn again)
    const it = make({ id: copy > 1 ? `${itemId('actor', a.id)}.${copy}` : itemId('actor', a.id), type: 'card', ...b, text: a.text, role: 'actor', order: i, data: { element: a.id, kind: a.kind, ...ownIcon(a.kind), ds: 'actor', ...(copy > 1 ? { occurrence: true } : {}), ...(traces ? { traces } : {}) } }, now)
    actorItem.set(key, it)
    items.push(it)
  })

  const objectItem = new Map<string, Item>()
  for (const s of sentences) {
    const read = readSentence(m, s)
    const base = { seq: s.seq, sentence: read, ds: true }
    const c = best.cast.get(s.id)!
    const from = actorItem.get(c.actor)!
    const box = best.object.get(s.id)
    const self = s.to.includes(s.actor)
    if (box && s.objectText) {
      const o = make({ id: itemId('object', s.id), type: 'card', ...box, text: s.objectText, role: 'work-object', order: s.seq, data: { element: s.id, seq: s.seq, sentence: read, kind: s.objectKind, ...ownIcon(s.objectKind), ds: 'object', ...(s.object ? { workObject: s.object } : {}), ...(s.traces.length ? { traces: s.traces } : {}), ...(s.note ? { note: s.note } : {}), ...(self ? { self: true } : {}) } }, now)
      objectItem.set(s.id, o)
      items.push(o)
      items.push(arrow(scope, from.id, o.id, now, s.verb, 'activity', { key: s.id, data: { ...base, ...facing(from, o) } }))
      // to itself: no return arrow (it would run back over the activity arrow) — the object beside the actor says it
      receiversOf(s).forEach((r, k) => {
        const to = actorItem.get(c.to[k])!
        items.push(arrow(scope, o.id, to.id, now, s.toLabel, 'activity-to', { key: `${s.id}:to:${r}`, data: { sentence: read, ds: true, ...facing(o, to) } }))
      })
    } else {
      // no work object: one numbered arrow from actor to actor (the sentence's element id rides on it); an actor
      // acting on itself without a work object has nothing to point at (the lint says so)
      for (const [k, r] of receiversOf(s).entries()) {
        const to = actorItem.get(c.to[k])!
        items.push(arrow(scope, from.id, to.id, now, s.verb, 'activity', { key: `${s.id}${k ? `:${r}` : ''}`, data: { ...base, element: s.id, ...facing(from, to) } }))
      }
    }
  }

  // Annotations: a note beside what it explains, joined by a dashed line (as Egon.io does). Its box is sized from its
  // text (wrapped within NOTE_MAX_W, as tall as the lines need), and it keeps off pictograms, other notes and, where it
  // can, the arrows.
  const placed: Box[] = [...actorItem.values(), ...objectItem.values()]
  const segs: Array<[Pt, Pt]> = items.filter((i) => i.type === 'arrow').flatMap((a) => {
    const f = [...actorItem.values(), ...objectItem.values()].find((x) => x.id === a.from)
    const t = [...actorItem.values(), ...objectItem.values()].find((x) => x.id === a.to)
    return f && t ? [[centre(f), centre(t)] as [Pt, Pt]] : []
  })
  for (const n of m.annotations) {
    const target = actorItem.get(n.on) ?? objectItem.get(n.on) ?? [...objectItem.values()].find((o) => o.data?.workObject === n.on)
    const base = target ?? { x: 0, y: 0, w: 0, h: 0 }
    const { w: nw, h: nh } = sizeToText({ type: 'text', role: 'annotation' }, n.text, { minW: NOTE_MIN_W, maxW: NOTE_MAX_W, minH: NOTE_MIN_H })
    // spots around the target, nearer first; the one crossing the fewest arrows wins, then the nearest
    const candidates: Pt[] = []
    for (const d of [60, 150, 260, 380])
      candidates.push(
        { x: base.x + base.w + d, y: base.y - 10 },
        { x: base.x + base.w + d, y: base.y + base.h - nh + 10 },
        { x: base.x - nw - d, y: base.y - 10 },
        { x: base.x - nw - d, y: base.y + base.h - nh + 10 },
        { x: base.x + base.w / 2 - nw / 2, y: base.y + base.h + d - 20 },
        { x: base.x + base.w / 2 - nw / 2, y: base.y - nh - d + 20 },
        { x: base.x + base.w + d * 0.7, y: base.y - nh - d * 0.5 },
        { x: base.x + base.w + d * 0.7, y: base.y + base.h + d * 0.5 },
        { x: base.x - nw - d * 0.7, y: base.y - nh - d * 0.5 },
        { x: base.x - nw - d * 0.7, y: base.y + base.h + d * 0.5 },
      )
    const clear = (p: Pt) => !placed.some((o) => overlaps(o, { ...p, w: nw, h: nh }))
    const cuts = (p: Pt) => segs.filter(([a, b]) => segmentHitsBox(a, b, { ...p, w: nw, h: nh }, 4)).length
    const tc = centre(base)
    const score = (p: Pt) => cuts(p) * 400 + Math.hypot(p.x + nw / 2 - tc.x, p.y + nh / 2 - tc.y)
    let at = candidates.filter(clear).sort((p, q) => score(p) - score(q))[0] ?? candidates[0]
    for (let k = 0; !clear(at) && k < 60; k++) at = { x: at.x, y: at.y + 40 }
    const note = make({ id: itemId('note', n.id), type: 'text', x: at.x, y: at.y, w: nw, h: nh, text: n.text, role: 'annotation', data: { element: n.id, on: n.on, ds: 'annotation' } }, now)
    placed.push(note)
    items.push(note)
    if (target) items.push(arrow(scope, note.id, target.id, now, undefined, 'annotation-link', { data: { ds: true, ...facing(note, target) } }))
  }

  // Groups: a rounded outline around the members (drawn first, so it sits behind them), kept apart (groupOutlines).
  const outlines: Item[] = []
  // an actor in a group: the drawings of it that the group's sentences use (its first drawing when they use none)
  const drawingsIn = (id: string, members: string[]): Item[] => {
    const used = new Set<string>()
    for (const s of sentences) {
      if (!members.includes(s.id) && !(s.object && members.includes(s.object))) continue
      const c = best.cast.get(s.id)!
      for (const k of [c.actor, ...c.to]) if (parseCopyKey(k).id === id) used.add(k)
    }
    return used.size > 1 || (used.size === 1 && !used.has(id)) ? [...used].map((k) => actorItem.get(k)!).filter(Boolean) : [actorItem.get(id)!]
  }
  const memberItems = (members: string[]) => members.flatMap((id) => (actorItem.has(id) ? drawingsIn(id, members) : [objectItem.get(id) ?? [...objectItem.values()].find((o) => o.data?.workObject === id)])).filter((b): b is Item => !!b)
  const shaped = groupOutlines(m.groups.map((g) => ({ id: g.id, members: [...new Set(memberItems(g.members).map((i) => i.id))], boxes: memberItems(g.members) })))
  for (const g of m.groups) {
    const o = shaped.get(g.id)
    if (!o) continue
    const extra = { ...(o.nestedIn ? { nestedIn: o.nestedIn } : {}), ...(o.overlaps.length ? { overlaps: o.overlaps } : {}) }
    // a colour only when the file gives one: else the board keeps what the person chose (Change colour)
    outlines.push(make({ id: itemId('group', g.id), type: 'frame', ...o.box, text: g.text, ...(g.color ? { color: g.color } : {}), role: 'group', data: { element: g.id, members: g.members, ds: 'group', ...extra } }, now))
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

export interface GroupInput {
  id: string
  /** the member pictograms' item ids */
  members: string[]
  boxes: Box[]
}
export interface GroupOutline {
  box: Box
  /** the group this one is drawn inside (all its members are that group's members too) */
  nestedIn?: string
  /** groups whose outlines still overlap this one (they share members, or interleave) */
  overlaps: string[]
}

const union = (bs: Box[]): Box => {
  const x0 = Math.min(...bs.map((b) => b.x))
  const y0 = Math.min(...bs.map((b) => b.y))
  return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 }
}
/** The outline with its title band above it — what must not touch another group's. */
export const withTitle = (b: Box): Box => ({ x: b.x, y: b.y - GROUP_TITLE_H, w: b.w, h: b.h + GROUP_TITLE_H })
const intersects = (a: Box, b: Box, tol = 0) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tol && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tol

/**
 * Group outlines that do not intersect: each shrink-wraps its members with padding; a group whose members all belong to
 * another group is drawn inside it (the outer one grows around it); two groups that still overlap are trimmed apart
 * where their members leave room between them; what cannot be separated (shared members, interleaved members) is
 * reported in `overlaps`.
 */
export function groupOutlines(groups: GroupInput[]): Map<string, GroupOutline> {
  const out = new Map<string, GroupOutline & { core: Box; set: Set<string> }>()
  const live = groups.filter((g) => g.boxes.length)
  const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x))
  // smaller groups first, so an outer group can grow around the inner ones
  const order = [...live].sort((a, b) => a.members.length - b.members.length)
  for (const g of order) {
    const set = new Set(g.members)
    const raw = union(g.boxes)
    const inner = [...out.entries()].filter(([, o]) => !o.nestedIn && subset(o.set, set))
    const core = union([raw, ...inner.map(([, o]) => ({ x: o.box.x - GROUP_NEST, y: o.box.y - GROUP_NEST - GROUP_TITLE_H, w: o.box.w + 2 * GROUP_NEST, h: o.box.h + 2 * GROUP_NEST + GROUP_TITLE_H }))])
    for (const [id, o] of inner) o.nestedIn = g.id === id ? undefined : g.id
    const box = { x: core.x - GROUP_PAD_X, y: core.y - GROUP_PAD_TOP, w: core.w + 2 * GROUP_PAD_X, h: core.h + GROUP_PAD_TOP + GROUP_PAD_BOTTOM }
    out.set(g.id, { box, core, set, overlaps: [] })
  }
  // trim pairs that overlap (neither inside the other) where their members leave room
  const ids = live.map((g) => g.id)
  const related = (a: string, b: string) => {
    const up = (x: string, y: string) => {
      for (let cur = out.get(x)?.nestedIn, k = 0; cur && k < 50; cur = out.get(cur)?.nestedIn, k++) if (cur === y) return true
      return false
    }
    return up(a, b) || up(b, a)
  }
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const A = out.get(ids[i])!
        const B = out.get(ids[j])!
        if (related(ids[i], ids[j]) || !intersects(withTitle(A.box), withTitle(B.box))) continue
        if ([...A.set].some((x) => B.set.has(x))) continue // shared members: cannot be separated
        // the room between the two cores, per axis (negative: they overlap on that axis)
        const gx = Math.max(B.core.x - (A.core.x + A.core.w), A.core.x - (B.core.x + B.core.w))
        const gy = Math.max(B.core.y - GROUP_TITLE_H - (A.core.y + A.core.h), A.core.y - GROUP_TITLE_H - (B.core.y + B.core.h))
        if (gx <= 8 && gy <= 8) continue
        if (gx >= gy) {
          const [L, R] = A.core.x < B.core.x ? [A, B] : [B, A]
          const mid = (L.core.x + L.core.w + R.core.x) / 2
          const right = Math.max(L.core.x + L.core.w + 4, Math.min(L.box.x + L.box.w, mid - 4))
          L.box = { ...L.box, w: right - L.box.x }
          const left = Math.min(R.core.x - 4, Math.max(R.box.x, mid + 4))
          R.box = { ...R.box, x: left, w: R.box.x + R.box.w - left }
        } else {
          const [T, U] = A.core.y < B.core.y ? [A, B] : [B, A]
          // the lower one's title sits above its outline: split the room between the upper bottom and that title
          const mid = (T.core.y + T.core.h + U.core.y - GROUP_TITLE_H) / 2
          const bottom = Math.max(T.core.y + T.core.h + 4, Math.min(T.box.y + T.box.h, mid - 4))
          T.box = { ...T.box, h: bottom - T.box.y }
          const top = Math.min(U.core.y - 4, Math.max(U.box.y, mid + 4 + GROUP_TITLE_H))
          U.box = { ...U.box, y: top, h: U.box.y + U.box.h - top }
        }
      }
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const A = out.get(ids[i])!
      const B = out.get(ids[j])!
      if (related(ids[i], ids[j]) || !intersects(withTitle(A.box), withTitle(B.box), 2)) continue
      A.overlaps.push(ids[j])
      B.overlaps.push(ids[i])
    }
  return new Map([...out].map(([id, o]) => [id, { box: o.box, ...(o.nestedIn ? { nestedIn: o.nestedIn } : {}), overlaps: o.overlaps }]))
}

/** The sentence a domain-story item stands for, read out (for panels and briefs). */
export function sentenceOf(item: Item): string | undefined {
  const s = item.data?.sentence
  return typeof s === 'string' ? s : undefined
}

export type { DsSentence }
