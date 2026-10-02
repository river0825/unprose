// EventStorming, drawn the way *Introducing EventStorming* describes it (docs/diagrams.md §3).
// It reads left → right in time. On a process or software board each element gets a column from the
// book's grammar — person → command → system → event → policy → command … (p.200-202), see esTimeline.ts —
// so every wire runs forward; a command's branches (several produced events) drop to rows below the happy
// path (p.209). Around each flow sticky, in its column: a milestone and the read model / person that
// lead to it above, the notes about it (hotspots, opportunities, values, votes) below.
// Big picture shows events only, one column each in timeline order, with their people above and the
// systems that raise them below. On the software level, aggregates group their commands and events in
// frames *instead of* the timeline (p.21), still left → right inside.
import type { Item } from '../model.js'
import { ES_COLORS, ES_LEGEND, normalizeEventStorming, type EsModel, type EventStormingContent } from '../diagrams/eventStorming.js'
import { slugify } from '../diagrams/ids.js'
import { branchSiblings, placeFlow, type Again, type Node } from './esTimeline.js'
import { GAP, LANE_HEADER, PAD, SMALL_H, SMALL_W, STICKY_H, STICKY_W, arrow, fit, make, offsetAll, type RenderOpts } from './util.js'

export { eventStormingSchema, type EventStormingContent } from '../diagrams/eventStorming.js'

/** Column pitch: a sticky plus room for a wire label ("whenever", "then", "informs") between columns. */
const COL = STICKY_W + 96
const PIVOTAL_W = STICKY_W + 16
const PIVOTAL_H = STICKY_H + 24
const MILESTONE_H = 50
const STACK = GAP / 2

/** Horizontal strips inside one row of the grid, top → bottom. */
type Strip = 'milestone' | 'read-model' | 'person' | 'main' | 'below' | 'note'
const STRIPS: Strip[] = ['milestone', 'read-model', 'person', 'main', 'below', 'note']
const STRIP_H: Record<Strip, number> = { milestone: MILESTONE_H, 'read-model': STICKY_H, person: SMALL_H, main: STICKY_H, below: STICKY_H, note: SMALL_H }

/** One sticky waiting for a position: its band (lane or aggregate), column, row and strip. */
interface Slot {
  band: string
  rank: number
  row: number
  strip: Strip
  id: string
  role: string
  text: string
  color: Item['color']
  w: number
  h: number
  order?: number
  data: Record<string, unknown>
}

export function renderEventStorming(raw: EventStormingContent, opts: RenderOpts = {}): Item[] {
  const m = normalizeEventStorming(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'es'
  const itemId = (role: string, element: string) => `${scope}.${role}.${element}`
  const detailed = m.level !== 'big-picture'

  // ── which elements live in an aggregate frame instead of on the timeline (software level) ──
  const aggOf = new Map<string, string>() // element id → aggregate id
  if (m.level === 'software' && m.aggregates.length) {
    for (const e of m.events) if (e.aggregate) aggOf.set(e.id, e.aggregate)
    for (const k of m.commands) {
      const a = k.aggregate ?? k.produces.map((e) => aggOf.get(e)).find(Boolean)
      if (a) {
        aggOf.set(k.id, a)
        for (const e of k.produces) if (!aggOf.has(e)) aggOf.set(e, a)
      }
    }
    for (const p of m.policies) {
      const a = p.when.map((e) => aggOf.get(e)).find(Boolean)
      if (a) aggOf.set(p.id, a)
    }
    for (const r of m.readModels) {
      const a = r.informs.map((x) => aggOf.get(x)).find(Boolean)
      if (a) aggOf.set(r.id, a)
    }
  }

  // ── bands: one per swimlane (or the plain timeline), one per aggregate ──
  const laneKeys = m.lanes.map((name, i) => `lane:${i}:${name}`)
  const timelineBand = (lane: number) => (m.lanes.length ? laneKeys[lane] : 'timeline')
  const eventById = new Map(m.events.map((e) => [e.id, e]))
  const bandOfEvent = (id: string | undefined) => {
    if (!id) return timelineBand(0)
    const a = aggOf.get(id)
    return a ? `agg:${a}` : timelineBand(eventById.get(id)?.lane ?? 0)
  }
  const personText = (id: string) => m.people.find((p) => p.id === id)?.text ?? id
  const systemText = (id: string) => m.systems.find((s) => s.id === id)?.text ?? id
  // Both are pink systems (p.88); 'external' marks one outside our boundary ("whatever we can put the blame on").
  const systemRole = (id: string) => (m.systems.find((s) => s.id === id)?.external ? 'external' : 'system')

  // ── the flow nodes and where they go: rank (column) and row per band ──
  const nodes: Node[] = []
  const edges: Array<[string, string]> = []
  const systemOcc = new Map<string, string>() // `${system}|${anchor}` → item id
  const nodeOf = new Map<string, string>() // element id → its flow node id (item id)
  const inlineRm = new Set<string>() // read models drawn as a flow step (they inform a command)
  const ev = (id: string) => itemId('event', id)
  for (const e of m.events) {
    nodes.push({ id: ev(e.id), band: bandOfEvent(e.id) })
    nodeOf.set(e.id, ev(e.id))
  }
  if (detailed) {
    for (const k of m.commands) {
      const via = m.policies.find((p) => p.then.includes(k.id))?.when[0]
      const band = aggOf.has(k.id) ? `agg:${aggOf.get(k.id)}` : bandOfEvent(k.produces[0] ?? via)
      const cmd = itemId('command', k.id)
      nodes.push({ id: cmd, band })
      nodeOf.set(k.id, cmd)
      let last = cmd
      if (k.system) {
        const sys = itemId('system', `${k.system}.${k.id}`)
        systemOcc.set(`${k.system}|${k.id}`, sys)
        nodes.push({ id: sys, band })
        edges.push([cmd, sys])
        last = sys
      }
      for (const e of k.produces) edges.push([last, ev(e)])
    }
    for (const p of m.policies) {
      const po = itemId('policy', p.id)
      nodes.push({ id: po, band: aggOf.has(p.id) ? `agg:${aggOf.get(p.id)}` : bandOfEvent(p.when[0]) })
      nodeOf.set(p.id, po)
      for (const e of p.when) edges.push([ev(e), po])
      for (const k of p.then) edges.push([po, itemId('command', k)])
    }
    // A read model that informs a command is a step of the flow (read model → person → command, p.201): it sits
    // on the row between the event that updates it and the command it informs, not in a strip of its own.
    for (const r of m.readModels) {
      const cmds = r.informs.filter((x) => m.kindOf.get(x) === 'command' && nodeOf.has(x))
      if (!cmds.length) continue
      const rm = itemId('read-model', r.id)
      const updates = r.updatedBy.filter((e) => eventById.has(e))
      const band = aggOf.has(r.id) ? `agg:${aggOf.get(r.id)}` : updates.length ? bandOfEvent(updates[updates.length - 1]) : (nodes.find((n) => n.id === nodeOf.get(cmds[0]))?.band ?? timelineBand(0))
      nodes.push({ id: rm, band })
      nodeOf.set(r.id, rm)
      inlineRm.add(r.id)
      for (const e of updates) edges.push([ev(e), rm])
      for (const k of cmds) edges.push([rm, itemId('command', k)])
    }
  }
  // Systems that raise events on their own (external systems, p.88): a flow node before the event on a
  // detailed board, a sticky under the event on the big picture.
  const raisers: Array<{ id: string; system: string; event: string }> = []
  for (const s of m.systems) {
    for (const e of s.raises) {
      if (!eventById.has(e) || systemOcc.has(`${s.id}|${e}`)) continue
      const id = itemId('system', `${s.id}.${e}`)
      systemOcc.set(`${s.id}|${e}`, id)
      raisers.push({ id, system: s.id, event: e })
      if (detailed) {
        nodes.push({ id, band: bandOfEvent(e) })
        edges.push([id, ev(e)])
      }
    }
  }
  const timeline = m.events.map((e) => ev(e.id))
  let rank: Map<string, number>
  let row: Map<string, number>
  let again: Again[] = []
  let retarget = new Map<string, string>()
  if (detailed) {
    const siblings = branchSiblings(m)
    ;({ rank, row, again, retarget } = placeFlow(nodes, edges, timeline, (a, b) => siblings(a.slice(scope.length + 7), b.slice(scope.length + 7)), { time: flowTimes(m, itemId, systemOcc, inlineRm) }))
    nodes.push(...again.map((a) => ({ id: a.id, band: a.band })))
    // Each aggregate numbers its own columns from zero.
    const minRank = new Map<string, number>()
    for (const n of nodes) if (n.band.startsWith('agg:')) minRank.set(n.band, Math.min(minRank.get(n.band) ?? Infinity, rank.get(n.id)!))
    for (const n of nodes) if (minRank.has(n.band)) rank.set(n.id, rank.get(n.id)! - minRank.get(n.band)!)
  } else {
    // Big picture: the timeline itself — one column per event, in file order.
    rank = new Map()
    row = new Map()
    const perBand = new Map<string, number>()
    for (const e of m.events) {
      const band = bandOfEvent(e.id)
      const col = band.startsWith('agg:') ? (perBand.set(band, (perBand.get(band) ?? -1) + 1), perBand.get(band)!) : m.events.filter((x) => !aggOf.has(x.id)).indexOf(e)
      rank.set(ev(e.id), col)
      row.set(ev(e.id), 0)
    }
  }
  const bandOf = new Map(nodes.map((n) => [n.id, n.band]))
  const at = (id: string) => ({ band: bandOf.get(id) ?? timelineBand(0), rank: rank.get(id) ?? 0, row: row.get(id) ?? 0 })
  /** Where an element's flow sticky is (for notes, milestones, read models, people). */
  const atElement = (element: string | undefined) => {
    const n = element ? nodeOf.get(element) : undefined
    return n && rank.has(n) ? at(n) : undefined
  }

  // ── slots ──
  const slots: Slot[] = []
  const slot = (s: Omit<Slot, 'data'> & { data?: Record<string, unknown> }) => slots.push({ ...s, data: s.data ?? {} })
  const rmWhere = new Map<string, { band: string; rank: number; row: number }>() // where each read model sits
  const personAt = new Map<string, string>() // `${band}|${rank}|${row}|${person}` → item id (one person sticky per cell)
  const personSlot = (person: string, where: { band: string; rank: number; row: number }, anchor: string) => {
    const key = `${where.band}|${where.rank}|${where.row}|${person}`
    if (personAt.has(key)) return personAt.get(key)!
    const id = itemId('person', `${person}.${anchor}`)
    personAt.set(key, id)
    slot({ ...where, strip: 'person', id, role: 'person', text: personText(person), color: ES_COLORS.person, w: SMALL_W, h: SMALL_H, data: { element: person, occurrence: true, for: anchor } })
    return id
  }

  for (const e of m.events) {
    slot({
      ...at(ev(e.id)),
      strip: 'main',
      id: ev(e.id),
      role: 'event',
      text: e.text,
      color: ES_COLORS.event,
      w: e.pivotal ? PIVOTAL_W : STICKY_W,
      h: e.pivotal ? PIVOTAL_H : STICKY_H,
      order: e.order,
      data: { element: e.id, pivotal: e.pivotal, ...(e.time ? { time: e.time } : {}), ...(e.recurring ? { recurring: true } : {}), ...(e.aggregate ? { aggregate: e.aggregate } : {}), ...(e.traces.length ? { traces: e.traces } : {}) },
    })
    const commandHasPerson = detailed && m.commands.some((k) => k.by && k.produces.includes(e.id))
    if (e.person && !commandHasPerson) personSlot(e.person, at(ev(e.id)), e.id)
  }

  if (detailed) {
    for (const k of m.commands) {
      const cmd = itemId('command', k.id)
      slot({ ...at(cmd), strip: 'main', id: cmd, role: 'command', text: k.text, color: ES_COLORS.command, w: STICKY_W, h: STICKY_H, data: { element: k.id, produces: k.produces, ...(k.aggregate ? { aggregate: k.aggregate } : {}), ...(k.traces.length ? { traces: k.traces } : {}) } })
      if (k.by) personSlot(k.by, at(cmd), k.id)
      const sys = k.system ? systemOcc.get(`${k.system}|${k.id}`) : undefined
      if (sys && k.system) slot({ ...at(sys), strip: 'main', id: sys, role: systemRole(k.system), text: systemText(k.system), color: ES_COLORS.system, w: STICKY_W, h: STICKY_H, data: { element: k.system, occurrence: true, for: k.id } })
    }
    for (const p of m.policies) {
      const po = itemId('policy', p.id)
      slot({ ...at(po), strip: 'main', id: po, role: 'policy', text: p.text, color: ES_COLORS.policy, w: STICKY_W, h: STICKY_H, data: { element: p.id, when: p.when, then: p.then, ...(p.person ? { person: personText(p.person) } : {}) } })
    }
    // A read model that informs a command is a step on the row, before that command (placed with the flow);
    // one that informs only people (or nothing) sits just after the last event that updates it, above the row,
    // so the wires into it run forward.
    for (const r of m.readModels) {
      const rm = itemId('read-model', r.id)
      const lastUpdate = r.updatedBy.map((e) => atElement(e)).filter(Boolean).sort((a, b) => b!.rank - a!.rank)[0]
      const inline = inlineRm.has(r.id) && rank.has(rm)
      const where = inline ? at(rm) : lastUpdate ? { ...lastUpdate, rank: lastUpdate.rank + 1 } : { band: timelineBand(0), rank: 0, row: 0 }
      nodeOf.set(r.id, rm)
      rmWhere.set(r.id, where)
      slot({ ...where, strip: inline ? 'main' : 'read-model', id: rm, role: 'read-model', text: r.text, color: ES_COLORS['read-model'], w: STICKY_W, h: STICKY_H, data: { element: r.id, updatedBy: r.updatedBy, informs: r.informs, ...(r.traces.length ? { traces: r.traces } : {}) } })
    }
  }
  for (const x of raisers) {
    if (detailed) slot({ ...at(x.id), strip: 'main', id: x.id, role: systemRole(x.system), text: systemText(x.system), color: ES_COLORS.system, w: STICKY_W, h: STICKY_H, data: { element: x.system, occurrence: true, for: x.event } })
    else slot({ ...at(ev(x.event)), strip: 'below', id: x.id, role: systemRole(x.system), text: systemText(x.system), color: ES_COLORS.system, w: STICKY_W, h: STICKY_H, data: { element: x.system, occurrence: true, for: x.event } })
  }
  // Later occurrences (a retry, a command repeated after a read model): the same sticky again, further right,
  // marked as a repeat of the first one (data.repeats); a command's person stands above it again.
  for (const a of again) {
    const orig = slots.find((s) => s.id === a.of)
    if (!orig) continue
    slot({ ...at(a.id), strip: orig.strip, id: a.id, role: orig.role, text: orig.text, color: orig.color, w: orig.w, h: orig.h, data: { element: orig.data.element, occurrence: true, repeats: a.of } })
    const k = orig.role === 'command' ? m.commands.find((c) => c.id === orig.data.element) : undefined
    if (k?.by) personSlot(k.by, at(a.id), a.id.slice(`${scope}.command.`.length))
  }
  // A read model informs a person: an occurrence of that person at or after the read model, else one more
  // occurrence in the read model's column — never a wire back to the left.
  if (detailed) {
    for (const r of m.readModels) {
      const where = rmWhere.get(r.id)
      if (!where) continue
      for (const x of r.informs) {
        if (m.kindOf.get(x) !== 'person') continue
        const later = [...personAt.keys()].some((key) => {
          const parts = key.split('|')
          const [band, rk, person] = [parts.slice(0, -3).join('|'), Number(parts[parts.length - 3]), parts[parts.length - 1]]
          return person === x && rk >= where.rank && (band === where.band || (!band.startsWith('agg:') && !where.band.startsWith('agg:')))
        })
        if (!later) personSlot(x, where, r.id)
      }
    }
  }
  for (const ms of m.milestones) {
    const where = atElement(ms.before) ?? { band: timelineBand(0), rank: 0, row: 0 }
    slot({ ...where, strip: 'milestone', id: itemId('milestone', ms.id), role: 'milestone', text: ms.text, color: ES_COLORS.milestone, w: SMALL_W, h: MILESTONE_H, data: { element: ms.id, before: ms.before } })
  }
  // Notes sit under whatever they are about — never on a wire; one about a note (a vote on a hotspot)
  // stacks under that note.
  const noteWhere = new Map<string, { band: string; rank: number; row: number }>()
  const note = (role: string, id: string, text: string, on: string | undefined, i: number, color: Item['color'], data: Record<string, unknown> = {}) => {
    const where = (on ? (noteWhere.get(on) ?? atElement(on)) : undefined) ?? { band: timelineBand(0), rank: i, row: 0 }
    noteWhere.set(id, where)
    slot({ ...where, strip: 'note', id: itemId(role, id), role, text, color, w: SMALL_W, h: SMALL_H, data: { element: id, on, ...data } })
  }
  m.hotspots.forEach((h, i) => note('hotspot', h.id, h.text, h.on, i, ES_COLORS.hotspot, { rotate: -8, ...(h.kind ? { kind: h.kind } : {}) }))
  m.opportunities.forEach((o, i) => note('opportunity', o.id, o.text, o.on, i, ES_COLORS.opportunity))
  m.values.forEach((v, i) => note('value', v.id, `${v.sign === '+' ? '+' : '−'} ${v.currency ? `${v.currency}: ` : ''}${v.text}`, v.on, i, v.sign === '+' ? ES_COLORS['value+'] : ES_COLORS['value-'], { sign: v.sign }))
  m.votes.forEach((v, i) => note('vote', v.id, `↑ ${v.count}`, v.on, i, ES_COLORS.vote, { count: v.count }))

  // ── pixels: strips stack inside a row, rows stack inside a band, bands stack top → bottom ──
  const items: Item[] = []
  /** Heights of each (row, strip) in a band, and the y of each within the band. */
  const layoutBand = (band: string) => {
    const inBand = slots.filter((s) => s.band === band)
    const depth = new Map<string, number>() // `${row}|${strip}` → sticky count in its fullest cell
    const unit = new Map<string, number>()
    const perCell = new Map<string, number>()
    for (const s of inBand) {
      const cell = `${s.rank}|${s.row}|${s.strip}`
      const k = (perCell.get(cell) ?? 0) + 1
      perCell.set(cell, k)
      const key = `${s.row}|${s.strip}`
      depth.set(key, Math.max(depth.get(key) ?? 0, k))
      unit.set(key, Math.max(unit.get(key) ?? STRIP_H[s.strip], s.h))
    }
    const rows = Math.max(0, ...inBand.map((s) => s.row + 1))
    const top = new Map<string, number>()
    let y = 0
    for (let r = 0; r < rows; r++) {
      for (const st of STRIPS) {
        const key = `${r}|${st}`
        top.set(key, y)
        const n = depth.get(key) ?? 0
        if (n) y += n * unit.get(key)! + (n - 1) * STACK + GAP
      }
      y += GAP // air between rows
    }
    const placed = new Map<string, number>()
    const positioned = inBand.map((s) => {
      const cell = `${s.rank}|${s.row}|${s.strip}`
      const k = placed.get(cell) ?? 0
      placed.set(cell, k + 1)
      const key = `${s.row}|${s.strip}`
      // centre narrow stickies (people, notes) in their column so they sit right above / below their sticky
      const dx = s.rank * COL + Math.max(0, (STICKY_W - s.w) / 2)
      return { s, dx, dy: top.get(key)! + k * (unit.get(key)! + STACK) }
    })
    return { positioned, height: Math.max(y - GAP * 2, STICKY_H) + PAD }
  }

  // Phases (chapters, candidate bounded contexts) run as labelled bars over the timeline (p.85, p.133).
  const eventRank = (id?: string) => (id && !aggOf.has(id) ? rank.get(ev(id)) : undefined)
  const timelineRanks = m.events.filter((e) => !aggOf.has(e.id)).map((e) => rank.get(ev(e.id))!)
  const lastRank = Math.max(0, ...timelineRanks)
  const phaseBars = m.phases.map((ph) => {
    const members = m.events.filter((e) => e.phase === ph.id).map((e) => eventRank(e.id)).filter((r): r is number => r !== undefined)
    const from = eventRank(ph.from) ?? (members.length ? Math.min(...members) : 0)
    const to = eventRank(ph.to) ?? (members.length ? Math.max(...members) : lastRank)
    return { ph, from: Math.min(from, to), to: Math.max(from, to) }
  })
  const phaseRows: Array<Array<{ from: number; to: number }>> = []
  const phaseRowOf = phaseBars.map((b) => {
    let r = phaseRows.findIndex((pr) => pr.every((o) => b.to < o.from || b.from > o.to))
    if (r < 0) r = phaseRows.push([]) - 1
    phaseRows[r].push(b)
    return r
  })
  const PHASE_H = 32
  const phasesH = phaseRows.length ? phaseRows.length * (PHASE_H + STACK) + GAP : 0
  phaseBars.forEach((b, i) => {
    items.push(make({ id: itemId('phase', b.ph.id), type: 'text', x: PAD + b.from * COL, y: PAD + phaseRowOf[i] * (PHASE_H + STACK), w: (b.to - b.from) * COL + STICKY_W, h: PHASE_H, text: b.ph.text, role: 'phase', color: ES_COLORS.phase, data: { element: b.ph.id, from: b.ph.from, to: b.ph.to, header: 'column' } }, now))
  })

  // Timeline: one band per swimlane (or one band with no lane).
  const timelineBands = m.lanes.length ? laneKeys : ['timeline']
  const laneIds = new Map<string, string>()
  const laneSlug = new Set<string>()
  m.lanes.forEach((name, i) => {
    let sl = slugify(name) || 'lane'
    for (let n = 2; laneSlug.has(sl); n++) sl = `${slugify(name) || 'lane'}-${n}`
    laneSlug.add(sl)
    laneIds.set(laneKeys[i], itemId('lane', sl))
  })
  const itemOf = new Map<string, Item>()
  const bandTop = new Map<string, number>()
  const bandH = new Map<string, number>()
  let y = PAD + phasesH
  for (const band of timelineBands) {
    const laid = layoutBand(band)
    const top = y + (m.lanes.length ? LANE_HEADER : 0)
    bandTop.set(band, top)
    bandH.set(band, laid.height)
    for (const { s, dx, dy } of laid.positioned) {
      const it = make({ id: s.id, type: 'sticky', x: PAD + dx, y: top + dy, w: s.w, h: s.h, text: s.text, color: s.color, role: s.role, parent: laneIds.get(band), order: s.order, data: s.data }, now)
      items.push(it)
      itemOf.set(s.id, it)
    }
    y = top + laid.height + (m.lanes.length ? GAP : 0)
  }
  // Pivotal events: a marker line in front of the event, across its band (the book's label tape, p.82).
  for (const e of m.events.filter((e) => e.pivotal && !aggOf.has(e.id))) {
    const band = bandOfEvent(e.id)
    const r = rank.get(ev(e.id)) ?? 0
    items.push(make({ id: itemId('pivotal', e.id), type: 'text', x: PAD + r * COL - (COL - STICKY_W) / 2 - 2, y: bandTop.get(band)! - (m.lanes.length ? LANE_HEADER / 2 : 0), w: 4, h: bandH.get(band)!, text: '', role: 'pivotal', color: 'grey', parent: laneIds.get(band), data: { for: ev(e.id), element: e.id } }, now))
  }
  const width = PAD * 2 + lastRank * COL + PIVOTAL_W
  const laneItems: Item[] = m.lanes.map((name, i) => {
    const key = laneKeys[i]
    const base = make({ id: laneIds.get(key)!, type: 'lane', x: 0, y: bandTop.get(key)! - LANE_HEADER, w: width, h: bandH.get(key)! + LANE_HEADER, text: name, role: 'lane', color: 'grey', order: i, data: { header: 'row' } }, now)
    return fit(base, items.filter((it) => it.parent === base.id), PAD, LANE_HEADER)
  })
  const laneW = Math.max(width, ...laneItems.map((l) => l.x + l.w))
  const lanes = laneItems.map((l) => ({ ...l, x: 0, w: laneW }))
  let bottom = y

  // Software level: one frame per aggregate, side by side under the timeline.
  const aggFrames: Item[] = []
  const aggBands = m.aggregates.filter((a) => [...aggOf.values()].includes(a.id)).map((a) => `agg:${a.id}`)
  if (aggBands.length) {
    let x = PAD
    const top = bottom + GAP * 2 + LANE_HEADER
    for (const band of aggBands) {
      const a = m.aggregates.find((g) => `agg:${g.id}` === band)!
      const frameId = itemId('aggregate-frame', a.id)
      const agSticky = make({ id: itemId('aggregate', a.id), type: 'sticky', x, y: top, w: STICKY_W, h: SMALL_H, text: a.text, color: ES_COLORS.aggregate, role: 'aggregate', parent: frameId, data: { element: a.id } }, now)
      const inside = [agSticky]
      for (const { s, dx, dy } of layoutBand(band).positioned) {
        const it = make({ id: s.id, type: 'sticky', x: x + dx, y: top + SMALL_H + GAP + dy, w: s.w, h: s.h, text: s.text, color: s.color, role: s.role, parent: frameId, order: s.order, data: s.data }, now)
        inside.push(it)
        itemOf.set(s.id, it)
      }
      const frame = fit(make({ id: frameId, type: 'frame', x, y: top, w: 0, h: 0, text: `«aggregate» ${a.text}`, role: 'aggregate', color: 'pale-yellow', data: { element: a.id } }, now), inside, GAP / 2, LANE_HEADER / 2)
      aggFrames.push(frame)
      items.push(...inside)
      x = frame.x + frame.w + GAP
    }
    bottom = Math.max(bottom, ...aggFrames.map((f) => f.y + f.h))
  }

  // Definitions below the flow (p.144), then the legend (p.314).
  if (m.definitions.length) {
    const dy = bottom + GAP
    m.definitions.forEach((d, i) => items.push(make({ id: itemId('definition', d.id), type: 'sticky', x: PAD + i * (STICKY_W + GAP), y: dy, w: STICKY_W, h: STICKY_H, text: `${d.term}: ${d.text}`, role: 'definition', color: ES_COLORS.definition, data: { element: d.id, term: d.term } }, now)))
    bottom = dy + STICKY_H
  }
  if (m.legend) bottom = legend(m, items, scope, bottom, now)

  // ── arrows, from the model's relations ──
  const arrows: Item[] = []
  const has = (id: string) => itemOf.has(id)
  // a wire that would point back in time goes to the later occurrence instead (esTimeline.ts)
  const to = (from: string, target: string) => retarget.get(`${from}>${target}`) ?? target
  if (detailed) {
    for (const k of m.commands) {
      const cmd = itemId('command', k.id)
      const sys = k.system ? systemOcc.get(`${k.system}|${k.id}`) : undefined
      if (sys) arrows.push(arrow(scope, cmd, to(cmd, sys), now, undefined, 'handles'))
      k.produces.forEach((e, i) => {
        const target = to(sys ?? cmd, ev(e))
        if (!has(target)) return
        arrows.push(arrow(scope, sys ?? cmd, target, now, undefined, 'produces', i ? { data: { branch: i } } : {}))
      })
    }
    for (const p of m.policies) {
      const po = itemId('policy', p.id)
      for (const e of p.when) if (has(ev(e))) arrows.push(arrow(scope, ev(e), to(ev(e), po), now, 'whenever', 'triggers'))
      for (const k of p.then) arrows.push(arrow(scope, po, to(po, itemId('command', k)), now, 'then', 'triggers'))
    }
    for (const r of m.readModels) {
      const rm = itemId('read-model', r.id)
      const rmX = itemOf.get(rm)?.x ?? 0
      for (const e of r.updatedBy) if (has(ev(e))) arrows.push(arrow(scope, ev(e), to(ev(e), rm), now, undefined, 'updates'))
      for (const x of r.informs) {
        // a person it informs: the occurrence of that person nearest after the read model (a forward wire),
        // else the nearest one before it (a short loop, not one across the whole board)
        const occurrences = [...personAt.entries()].filter(([key]) => key.endsWith(`|${x}`)).map(([, id]) => itemOf.get(id)).filter((it): it is Item => Boolean(it))
        const person = occurrences.filter((it) => it.x >= rmX).sort((a, b) => a.x - b.x)[0] ?? occurrences.sort((a, b) => b.x - a.x)[0]
        const target = m.kindOf.get(x) === 'command' ? to(rm, itemId('command', x)) : person?.id
        if (target && has(target)) arrows.push(arrow(scope, rm, target, now, 'informs', 'informs'))
      }
    }
  }
  for (const [key, id] of systemOcc) {
    const [sys, anchor] = key.split('|')
    if (m.kindOf.get(anchor) === 'event' && has(ev(anchor)) && has(id)) arrows.push(arrow(scope, id, to(id, ev(anchor)), now, undefined, 'raises', { data: { system: sys } }))
  }

  return offsetAll([...lanes, ...aggFrames, ...items, ...arrows], opts.at)
}

/**
 * When each flow node happens, for telling a wire that points back in time (esTimeline.ts): an event at its
 * place in the file; a command just before the first event it produces (or just after the policy that
 * triggers it); its system between the two; a policy just after the last event it reacts to; a read model
 * on the flow just after the last event that updates it (or just before the command it informs).
 */
function flowTimes(m: EsModel, itemId: (role: string, element: string) => string, systemOcc: Map<string, string>, inlineRm: Set<string>): Map<string, number> {
  const t = new Map<string, number>()
  const idx = new Map(m.events.map((e, i) => [e.id, i]))
  for (const e of m.events) t.set(itemId('event', e.id), idx.get(e.id)!)
  const policyT = new Map<string, number>()
  for (const p of m.policies) {
    const when = p.when.map((e) => idx.get(e)).filter((x): x is number => x !== undefined)
    if (when.length) policyT.set(p.id, Math.max(...when) + 0.25)
    if (policyT.has(p.id)) t.set(itemId('policy', p.id), policyT.get(p.id)!)
  }
  const commandT = new Map<string, number>()
  for (const k of m.commands) {
    const produced = k.produces.map((e) => idx.get(e)).filter((x): x is number => x !== undefined)
    const by = m.policies.filter((p) => p.then.includes(k.id) && policyT.has(p.id)).map((p) => policyT.get(p.id)!)
    const at = produced.length ? Math.min(...produced) - 0.5 : by.length ? Math.min(...by) + 0.1 : undefined
    if (at === undefined) continue
    commandT.set(k.id, at)
    t.set(itemId('command', k.id), at)
  }
  for (const [key, id] of systemOcc) {
    const anchor = key.slice(key.indexOf('|') + 1)
    if (commandT.has(anchor)) t.set(id, commandT.get(anchor)! + 0.2)
    else if (idx.has(anchor)) t.set(id, idx.get(anchor)! - 0.3)
  }
  for (const r of m.readModels) {
    if (!inlineRm.has(r.id)) continue
    const updates = r.updatedBy.map((e) => idx.get(e)).filter((x): x is number => x !== undefined)
    const cmds = r.informs.map((x) => commandT.get(x)).filter((x): x is number => x !== undefined)
    const at = updates.length ? Math.max(...updates) + 0.25 : cmds.length ? Math.min(...cmds) - 0.7 : undefined
    if (at !== undefined) t.set(itemId('read-model', r.id), at)
  }
  return t
}

/** A row of legend stickies for the kinds this diagram uses, each with the book's page (p.314). */
function legend(m: EsModel, items: Item[], scope: string, bottom: number, now: string): number {
  const used = new Set<keyof typeof ES_COLORS>()
  for (const it of items) {
    if (it.role === 'value') used.add(it.data?.sign === '-' ? 'value-' : 'value+')
    else if (it.role === 'external') used.add('system')
    else if (it.role && it.role in ES_COLORS) used.add(it.role as keyof typeof ES_COLORS)
  }
  if (m.aggregates.length && m.level === 'software') used.add('aggregate')
  const kinds = (Object.keys(ES_COLORS) as Array<keyof typeof ES_COLORS>).filter((k) => used.has(k))
  if (!kinds.length) return bottom
  const y = bottom + GAP
  items.push(make({ id: `${scope}.legend-title.legend`, type: 'text', x: PAD, y, w: 400, h: 28, text: 'Legend — Introducing EventStorming (p.314)', role: 'legend-title', color: 'white' }, now))
  const LEGEND_W = 150
  kinds.forEach((k, i) =>
    items.push(make({ id: `${scope}.legend.${k}`, type: 'sticky', x: PAD + i * (LEGEND_W + GAP / 2), y: y + 36, w: LEGEND_W, h: 60, text: ES_LEGEND[k], role: 'legend', color: ES_COLORS[k], data: { for: k } }, now)),
  )
  return y + 36 + 60
}
