// EventStorming content (docs/diagrams.md §3), as Brandolini's *Introducing EventStorming* describes it.
// The file names elements by id or by text; `normalizeEventStorming` resolves every reference to an
// element id once, so the renderer, the grammar check and the story proposer read the same model.
// Pure and builtin-free (the web imports it for the grammar panel).
import { z } from 'zod'
import { idAllocator, traceSchema, type Trace } from './ids.js'

const ref = z.string()
const refs = z.union([ref, z.array(ref)])
const trace = traceSchema
const traces = z.array(trace).optional()

export const eventStormingSchema = z.object({
  level: z.enum(['big-picture', 'process', 'software']).default('big-picture'),
  /** Swimlanes, top → bottom (p.83). Elements without a lane go to the first one. */
  lanes: z.array(z.string()).optional(),
  /** Draw the colour legend on the diagram (p.314). */
  legend: z.boolean().default(true),
  events: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string(),
        lane: z.string().optional(),
        /** The phase / chapter / bounded context it belongs to (a phase's id or text). */
        phase: ref.optional(),
        /** Boundary between phases; drawn larger (p.82, p.188). */
        pivotal: z.boolean().optional(),
        /** Time-triggered: 'End of day' (p.146, p.212). */
        time: z.string().optional(),
        recurring: z.boolean().optional(),
        /** A person whose action this is (big picture) — legacy name `actor`. */
        person: ref.optional(),
        actor: z.string().optional(),
        /** Software level: which aggregate raised it. */
        aggregate: ref.optional(),
        traces,
      }),
    )
    .min(1),
  commands: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string(),
        /** Who issues it (legacy name `actor`). */
        by: ref.optional(),
        actor: z.string().optional(),
        /** The system that handles it and emits the event (p.202). */
        system: ref.optional(),
        /** Events it can produce — several = branches, happy path first (p.209). Legacy: `event`. */
        produces: refs.optional(),
        event: ref.optional(),
        aggregate: ref.optional(),
        traces,
      }),
    )
    .default([]),
  policies: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string(),
        /** "Whenever <events>" */
        when: refs,
        /** "then <commands>" */
        then: refs,
        /** A person handles it (a manual reaction, p.224). */
        person: ref.optional(),
      }),
    )
    .default([]),
  readModels: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string(),
        /** Events that update it (p.201). */
        updatedBy: refs.optional(),
        /** People or commands it informs (p.231). Legacy: `for` (a command). */
        informs: refs.optional(),
        for: ref.optional(),
        traces,
      }),
    )
    .default([]),
  people: z.array(z.union([z.string(), z.object({ id: z.string().optional(), text: z.string() })])).default([]),
  systems: z
    .array(z.union([z.string(), z.object({ id: z.string().optional(), text: z.string(), external: z.boolean().optional(), raises: refs.optional() })]))
    .default([]),
  /** Legacy: an external system next to the event it raises or receives. */
  externals: z.array(z.object({ id: z.string().optional(), text: z.string(), event: ref })).default([]),
  aggregates: z.array(z.union([z.string(), z.object({ id: z.string().optional(), text: z.string() })])).default([]),
  hotspots: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string(),
        on: ref.optional(),
        near: ref.optional(),
        kind: z.enum(['problem', 'question', 'risk', 'disagreement', 'unexplored']).optional(),
      }),
    )
    .default([]),
  opportunities: z.array(z.object({ id: z.string().optional(), text: z.string(), on: ref.optional(), near: ref.optional() })).default([]),
  /** Value created (+, green) or destroyed (−, red), in any currency (p.108-114). */
  values: z.array(z.object({ id: z.string().optional(), text: z.string(), on: ref.optional(), sign: z.enum(['+', '-']).default('+'), currency: z.string().optional() })).default([]),
  /** Arrow votes on a problem or an opportunity (p.102). */
  votes: z.array(z.object({ id: z.string().optional(), on: ref, count: z.number().int().positive().default(1) })).default([]),
  /** Temporal milestones on top of the timeline ("6 months before", p.84). */
  milestones: z.array(z.object({ id: z.string().optional(), text: z.string(), before: ref.optional() })).default([]),
  /** Phases / chapters / candidate bounded contexts over a stretch of the timeline (p.85, p.133). */
  phases: z.array(z.object({ id: z.string().optional(), text: z.string(), from: ref.optional(), to: ref.optional() })).default([]),
  /** Definitions of domain terms, kept below the flow (p.144). */
  definitions: z.array(z.object({ id: z.string().optional(), term: z.string(), text: z.string() })).default([]),
})
export type EventStormingContent = z.input<typeof eventStormingSchema>
export type EventStormingParsed = z.output<typeof eventStormingSchema>
export type EsLevel = EventStormingParsed['level']

// ── the normalized model ──────────────────────────────────────────────────

export type EsElementKind =
  | 'event'
  | 'command'
  | 'policy'
  | 'read-model'
  | 'person'
  | 'system'
  | 'aggregate'
  | 'hotspot'
  | 'opportunity'
  | 'value'
  | 'vote'
  | 'milestone'
  | 'phase'
  | 'definition'

export interface EsEvent { id: string; text: string; lane: number; order: number; phase?: string; pivotal: boolean; time?: string; recurring: boolean; person?: string; aggregate?: string; traces: Trace[] }
export interface EsCommand { id: string; text: string; by?: string; system?: string; produces: string[]; aggregate?: string; traces: Trace[] }
export interface EsPolicy { id: string; text: string; when: string[]; then: string[]; person?: string }
export interface EsReadModel { id: string; text: string; updatedBy: string[]; informs: string[]; traces: Trace[] }
export interface EsPerson { id: string; text: string }
export interface EsSystem { id: string; text: string; external: boolean; raises: string[] }
export interface EsAggregate { id: string; text: string }
export interface EsNote { id: string; text: string; on?: string }
export interface EsHotspot extends EsNote { kind?: string }
export interface EsValue extends EsNote { sign: '+' | '-'; currency?: string }
export interface EsVote { id: string; on?: string; count: number }
export interface EsMilestone { id: string; text: string; before?: string }
export interface EsPhase { id: string; text: string; from?: string; to?: string }
export interface EsDefinition { id: string; term: string; text: string }

export interface EsModel {
  level: EsLevel
  lanes: string[]
  legend: boolean
  events: EsEvent[]
  commands: EsCommand[]
  policies: EsPolicy[]
  readModels: EsReadModel[]
  people: EsPerson[]
  systems: EsSystem[]
  aggregates: EsAggregate[]
  hotspots: EsHotspot[]
  opportunities: EsNote[]
  values: EsValue[]
  votes: EsVote[]
  milestones: EsMilestone[]
  phases: EsPhase[]
  definitions: EsDefinition[]
  /** element id → its kind, for every element in the diagram. */
  kindOf: Map<string, EsElementKind>
  /** References that matched nothing (field + what was written). The grammar check reports them. */
  unresolved: Array<{ element: string; field: string; ref: string }>
}

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/** Resolve every reference in the content to element ids. Pure; the same content always gives the same ids. */
export function normalizeEventStorming(raw: EventStormingContent): EsModel {
  const c = eventStormingSchema.parse(raw)
  const alloc = idAllocator()
  const kindOf = new Map<string, EsElementKind>()
  const byText = new Map<EsElementKind, Map<string, string>>()
  const unresolved: EsModel['unresolved'] = []
  const declare = (kind: EsElementKind, explicit: string | undefined, text: string) => {
    const id = alloc(explicit, text, kind)
    kindOf.set(id, kind)
    if (!byText.has(kind)) byText.set(kind, new Map())
    const m = byText.get(kind)!
    if (!m.has(text)) m.set(text, id)
    return id
  }
  /** A reference: an element id of an allowed kind, else the text of one. */
  const resolve = (r: string, kinds: EsElementKind[], element: string, field: string): string | undefined => {
    if (kindOf.has(r) && kinds.includes(kindOf.get(r)!)) return r
    for (const k of kinds) {
      const hit = byText.get(k)?.get(r)
      if (hit) return hit
    }
    unresolved.push({ element, field, ref: r })
    return undefined
  }
  const resolveAll = (v: string | string[] | undefined, kinds: EsElementKind[], element: string, field: string) =>
    list(v).flatMap((r) => resolve(r, kinds, element, field) ?? [])

  const laneNames = c.lanes ?? []
  const laneOf = (name?: string) => (name && laneNames.includes(name) ? laneNames.indexOf(name) : 0)

  // Declare every element first (so references can point forward), then resolve.
  const people: EsPerson[] = c.people.map((p) => (typeof p === 'string' ? { text: p } : p)).map((p) => ({ id: declare('person', p.id, p.text), text: p.text }))
  const personRef = (name: string | undefined, element: string, field: string): string | undefined => {
    if (!name) return undefined
    const known = kindOf.get(name) === 'person' ? name : byText.get('person')?.get(name)
    if (known) return known
    // A person written only on an event/command is still a person: declare it on first use.
    const id = declare('person', undefined, name)
    people.push({ id, text: name })
    void element
    void field
    return id
  }
  const systemsRaw = c.systems.map((s) => (typeof s === 'string' ? { text: s } : s))
  const systems: EsSystem[] = systemsRaw.map((s) => ({ id: declare('system', s.id, s.text), text: s.text, external: 'external' in s ? !!s.external : false, raises: [] }))
  const legacyExternals = c.externals.map((x) => {
    const known = byText.get('system')?.get(x.text)
    const id = known ?? declare('system', x.id, x.text)
    if (!known) systems.push({ id, text: x.text, external: true, raises: [] })
    return { id, event: x.event }
  })
  const aggregates: EsAggregate[] = c.aggregates.map((a) => (typeof a === 'string' ? { text: a } : a)).map((a) => ({ id: declare('aggregate', a.id, a.text), text: a.text }))
  const eventIds = c.events.map((e) => declare('event', e.id, e.text))
  const commandIds = c.commands.map((k) => declare('command', k.id, k.text))
  const policyIds = c.policies.map((p) => declare('policy', p.id, p.text))
  const readModelIds = c.readModels.map((r) => declare('read-model', r.id, r.text))

  const events: EsEvent[] = c.events.map((e, i) => {
    const id = eventIds[i]
    return {
      id,
      text: e.text,
      lane: laneOf(e.lane),
      order: i,
      pivotal: !!e.pivotal,
      time: e.time,
      recurring: !!e.recurring,
      person: personRef(e.person ?? e.actor, id, 'person'),
      aggregate: e.aggregate ? resolve(e.aggregate, ['aggregate'], id, 'aggregate') : undefined,
      traces: e.traces ?? [],
    }
  })
  const commands: EsCommand[] = c.commands.map((k, i) => {
    const id = commandIds[i]
    return {
      id,
      text: k.text,
      by: personRef(k.by ?? k.actor, id, 'by'),
      system: k.system ? resolve(k.system, ['system'], id, 'system') : undefined,
      produces: resolveAll(k.produces ?? k.event, ['event'], id, 'produces'),
      aggregate: k.aggregate ? resolve(k.aggregate, ['aggregate'], id, 'aggregate') : undefined,
      traces: k.traces ?? [],
    }
  })
  const policies: EsPolicy[] = c.policies.map((p, i) => ({
    id: policyIds[i],
    text: p.text,
    when: resolveAll(p.when, ['event'], policyIds[i], 'when'),
    then: resolveAll(p.then, ['command'], policyIds[i], 'then'),
    person: personRef(p.person, policyIds[i], 'person'),
  }))
  const readModels: EsReadModel[] = c.readModels.map((r, i) => ({
    id: readModelIds[i],
    text: r.text,
    updatedBy: resolveAll(r.updatedBy, ['event'], readModelIds[i], 'updatedBy'),
    informs: resolveAll(r.informs ?? r.for, ['person', 'command'], readModelIds[i], 'informs'),
    traces: r.traces ?? [],
  }))
  systemsRaw.forEach((s, i) => {
    if ('raises' in s) systems[i].raises = resolveAll(s.raises, ['event'], systems[i].id, 'raises')
  })
  for (const x of legacyExternals) {
    const ev = resolve(x.event, ['event'], x.id, 'event')
    const sys = systems.find((s) => s.id === x.id)!
    if (ev && !sys.raises.includes(ev)) sys.raises.push(ev)
  }

  const anyElement: EsElementKind[] = ['event', 'command', 'policy', 'read-model', 'person', 'system', 'aggregate', 'hotspot', 'opportunity']
  const note = (kind: EsElementKind, n: { id?: string; text: string; on?: string; near?: string }): EsNote => {
    const id = declare(kind, n.id, n.text)
    const target = n.on ?? n.near
    return { id, text: n.text, on: target ? resolve(target, anyElement, id, 'on') : undefined }
  }
  const hotspots: EsHotspot[] = c.hotspots.map((h) => ({ ...note('hotspot', h), kind: h.kind }))
  const opportunities: EsNote[] = c.opportunities.map((o) => note('opportunity', o))
  const values: EsValue[] = c.values.map((v) => ({ ...note('value', v), sign: v.sign, currency: v.currency }))
  const votes: EsVote[] = c.votes.map((v, i) => {
    const id = declare('vote', v.id, `vote-${i + 1}`)
    return { id, on: resolve(v.on, ['hotspot', 'opportunity', 'event'], id, 'on'), count: v.count }
  })
  const milestones: EsMilestone[] = c.milestones.map((m) => {
    const id = declare('milestone', m.id, m.text)
    return { id, text: m.text, before: m.before ? resolve(m.before, ['event'], id, 'before') : undefined }
  })
  const phases: EsPhase[] = c.phases.map((p) => {
    const id = declare('phase', p.id, p.text)
    return { id, text: p.text, from: p.from ? resolve(p.from, ['event'], id, 'from') : undefined, to: p.to ? resolve(p.to, ['event'], id, 'to') : undefined }
  })
  // Events may name their phase; a phase without from/to then spans its first to its last event.
  c.events.forEach((e, i) => {
    if (e.phase) events[i].phase = resolve(e.phase, ['phase'], events[i].id, 'phase')
  })
  for (const ph of phases) {
    const members = events.filter((e) => e.phase === ph.id)
    if (!ph.from && members.length) ph.from = members[0].id
    if (!ph.to && members.length) ph.to = members[members.length - 1].id
  }
  const definitions: EsDefinition[] = c.definitions.map((d) => ({ id: declare('definition', d.id, d.term), term: d.term, text: d.text }))

  return {
    level: c.level,
    lanes: laneNames,
    legend: c.legend,
    events,
    commands,
    policies,
    readModels,
    people,
    systems,
    aggregates,
    hotspots,
    opportunities,
    values,
    votes,
    milestones,
    phases,
    definitions,
    kindOf,
    unresolved,
  }
}

/** The book's colour for each element kind (p.ii-iii, p.314; hotspot is purple, never red — p.307). */
export const ES_COLORS = {
  event: 'orange',
  command: 'blue',
  policy: 'lilac',
  'read-model': 'green',
  person: 'yellow',
  system: 'pink',
  aggregate: 'pale-yellow',
  hotspot: 'purple',
  opportunity: 'green',
  'value+': 'green',
  'value-': 'red',
  vote: 'blue',
  milestone: 'blue',
  phase: 'grey',
  definition: 'white',
} as const

/** Legend wording per kind, with the page it comes from. */
export const ES_LEGEND: Record<keyof typeof ES_COLORS, string> = {
  event: 'Domain event — orange, past tense (p.75)',
  command: 'Command — blue (p.216)',
  policy: 'Policy — lilac: whenever … then … (p.222)',
  'read-model': 'Read model — green (p.231)',
  person: 'Person — small yellow (p.88)',
  system: 'System — pink (p.88, p.218)',
  aggregate: 'Aggregate — pale yellow (p.260)',
  hotspot: 'Hotspot — purple (p.86)',
  opportunity: 'Opportunity — green (p.100)',
  'value+': 'Value created — green (p.108)',
  'value-': 'Value destroyed — red (p.108)',
  vote: 'Arrow vote — blue (p.102)',
  milestone: 'Milestone — blue (p.84)',
  phase: 'Phase / bounded context (p.85, p.133)',
  definition: 'Definition (p.144)',
}
