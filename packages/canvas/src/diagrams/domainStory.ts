// Domain Storytelling (https://domainstorytelling.org/quick-start-guide), the pure half: the file schema,
// stable element ids, a normalized model and the grammar check. Pure and builtin-free (the web imports it).
//
// What the method says (quick-start guide, 2026-09-30) and what we follow:
// - "An actor can be a person, a group of people, or a software system." Actors are nouns.
// - "Actors create, work with, and exchange work objects such as documents, physical things, and digital objects."
// - "The actors' activities are shown as arrows and labeled with verbs"; a sentence reads
//   actor → activity → work object (→ to another actor). "The sentences can be brought into an order by
//   numbering them" — the number sits at the origin of the activity arrow.
// - "Every actor appears only once in the domain story. But for every activity, we draw a separate work object."
// - Textual annotations complement the sentences; "a group is represented as an outline that clusters parts
//   of a story" (repetition, optional parts, locations, organisations, subdomains).
// - Scope: granularity (coarse ↔ fine), point in time (as-is / to-be), domain purity (pure / digitalized).
// Vocabulary and values also match Egon.io, the method authors' modeler (github.com/WPS/egon.io), so stories
// can be imported and exported: its scope enums, actor icons Person / Group / System, and default work-object
// icons Document / Folder / Call / Email / Conversation / Info. Egon allows two activities to share a number
// (`multipleNumberAllowed`) — the site does not describe parallel activities, so a shared `seq` is allowed and
// reported as info.
import { z } from 'zod'
import { idAllocator, slugify, traceSchema, type Trace } from './ids.js'
import { DS_ICON_MAX_CHARS } from './dsIcons.js'
import { reviewDomainStory, type DsReviewRule } from './domainStoryReview.js'

export const DS_ACTOR_KINDS = ['person', 'group', 'system'] as const
/** Work-object kinds with a glyph: the site's three categories plus Egon.io's default icon set. Custom names are allowed. */
export const DS_OBJECT_KINDS = ['document', 'thing', 'digital', 'folder', 'call', 'email', 'conversation', 'info', 'message'] as const
export const DS_GRANULARITY = ['coarse-grained', 'medium-grained', 'fine-grained', 'cloud-level', 'kite-level', 'sea-level', 'fish-level', 'clam-level'] as const

const named = () =>
  z.union([
    z.string(),
    z.object({
      id: z.string().optional(),
      text: z.string().min(1),
      /** actor: person | group | system; work object: document | thing | digital | … (custom icon names allowed) */
      kind: z.string().optional(),
    }),
  ])

export const domainStorySchema = z.object({
  scope: z
    .object({
      granularity: z.enum(DS_GRANULARITY).optional(),
      time: z.enum(['as-is', 'to-be']).optional(),
      purity: z.enum(['pure', 'digitalized']).optional(),
    })
    .optional(),
  actors: z.array(named()).min(1),
  workObjects: z.array(named()).default([]),
  sentences: z
    .array(
      z.object({
        id: z.string().optional(),
        /** Sequence number; defaults to the next one. Two sentences may share a number (parallel activities). */
        seq: z.number().int().positive().optional(),
        /** The actor who acts (id or text). */
        actor: z.string().min(1),
        /** The activity, a verb from the domain language. */
        verb: z.string().min(1),
        /** The work object (id or text of a declared work object, or any text — each activity gets its own card). */
        object: z.string().optional(),
        /** The actor(s) the work object goes to. */
        to: z.union([z.string(), z.array(z.string())]).optional(),
        /** Label of the arrow to the receiver, e.g. "to", "with" (Egon.io labels both arrows). */
        toLabel: z.string().optional(),
        note: z.string().optional(),
        traces: z.array(traceSchema).optional(),
      }),
    )
    .min(1),
  groups: z.array(z.object({ id: z.string().optional(), text: z.string().min(1), members: z.array(z.string()).default([]) })).default([]),
  annotations: z.array(z.object({ id: z.string().optional(), on: z.string(), text: z.string().min(1) })).default([]),
  /** Icons of the story's own: a name (used as an actor's or work object's `kind`) → a 24 × 24 line-drawing SVG (dsIcons.ts). */
  icons: z.record(z.string(), z.string().max(DS_ICON_MAX_CHARS)).optional(),
  /** How far apart the board draws actors, work objects and arrows (§6b "Spacing"); not part of Egon.io's format. */
  layout: z
    .object({
      spacing: z.enum(['compact', 'normal', 'roomy']).optional(),
      /** horizontal pitch of the actor grid in px (overrides the spacing's) */
      gapX: z.number().min(240).max(2000).optional(),
      /** vertical pitch of the actor grid in px */
      gapY: z.number().min(180).max(2000).optional(),
    })
    .optional(),
})
export type DomainStoryContent = z.input<typeof domainStorySchema>

export interface DsActor { id: string; text: string; kind: string }
export interface DsWorkObject { id: string; text: string; kind: string }
export interface DsSentence {
  id: string
  seq: number
  actor: string
  verb: string
  /** declared work object id, when the sentence names one */
  object?: string
  /** what the work-object card says (declared text, or the sentence's own text) */
  objectText?: string
  objectKind: string
  to: string[]
  toLabel?: string
  note?: string
  traces: Trace[]
}
export interface DsModel {
  scope: { granularity?: string; time?: string; purity?: string }
  actors: DsActor[]
  workObjects: DsWorkObject[]
  sentences: DsSentence[]
  groups: Array<{ id: string; text: string; members: string[] }>
  annotations: Array<{ id: string; on: string; text: string }>
  /** The story's own icons by kind name (absent: only the built-in ones). */
  icons?: Record<string, string>
  /** Drawing spacing from the file's `layout` (absent: the default, `normal`). */
  layout?: { spacing?: 'compact' | 'normal' | 'roomy'; gapX?: number; gapY?: number }
  /** References that matched nothing (unknown actors are still drawn, as persons). */
  unresolved: Array<{ element: string; field: string; ref: string }>
  /** Marks a normalized model (vs raw content). */
  dsModel: true
}

/** Parse + resolve references to ids. Unknown actors are added as persons so the story still draws. */
export function normalizeDomainStory(raw: DomainStoryContent): DsModel {
  const c = domainStorySchema.parse(raw)
  const alloc = idAllocator()
  const asNamed = (v: string | { id?: string; text: string; kind?: string }) => (typeof v === 'string' ? { text: v } : v)
  const actors: DsActor[] = c.actors.map(asNamed).map((a) => ({ id: alloc(a.id, a.text, 'actor'), text: a.text, kind: a.kind ?? 'person' }))
  const workObjects: DsWorkObject[] = c.workObjects.map(asNamed).map((o) => ({ id: alloc(o.id, o.text, 'object'), text: o.text, kind: o.kind ?? 'document' }))
  const unresolved: DsModel['unresolved'] = []
  const find = <T extends { id: string; text: string }>(list: T[], ref: string) => list.find((x) => x.id === ref) ?? list.find((x) => x.text === ref) ?? list.find((x) => x.id === slugify(ref))
  const actorRef = (ref: string, element: string, field: string): string => {
    const hit = find(actors, ref)
    if (hit) return hit.id
    unresolved.push({ element, field, ref })
    const added = { id: alloc(undefined, ref, 'actor'), text: ref, kind: 'person' }
    actors.push(added)
    return added.id
  }

  let next = 1
  const sentences: DsSentence[] = c.sentences.map((s) => {
    const seq = s.seq ?? next
    next = Math.max(next, seq + 1)
    const id = alloc(s.id, `${seq}-${s.verb}`, 'sentence')
    const declared = s.object ? find(workObjects, s.object) : undefined
    const to = s.to === undefined ? [] : Array.isArray(s.to) ? s.to : [s.to]
    return {
      id,
      seq,
      actor: actorRef(s.actor, id, 'actor'),
      verb: s.verb,
      ...(declared ? { object: declared.id } : {}),
      ...(s.object ? { objectText: declared?.text ?? s.object } : {}),
      objectKind: declared?.kind ?? 'document',
      to: to.map((r) => actorRef(r, id, 'to')),
      ...(s.toLabel ? { toLabel: s.toLabel } : {}),
      ...(s.note ? { note: s.note } : {}),
      traces: s.traces ?? [],
    }
  })

  const elementRef = (ref: string, element: string, field: string): string | undefined => {
    const hit = find(actors, ref)?.id ?? find(workObjects, ref)?.id ?? sentences.find((s) => s.id === ref)?.id
    if (!hit) unresolved.push({ element, field, ref })
    return hit
  }
  const groups = c.groups.map((g) => {
    const id = alloc(g.id, g.text, 'group')
    return { id, text: g.text, members: g.members.map((m) => elementRef(m, id, 'members')).filter((x): x is string => !!x) }
  })
  const annotations = c.annotations.flatMap((a, i) => {
    const id = alloc(a.id, `note-${i + 1}`, 'note')
    const on = elementRef(a.on, id, 'on')
    return on ? [{ id, on, text: a.text }] : []
  })
  return { scope: c.scope ?? {}, actors, workObjects, sentences, groups, annotations, ...(c.icons ? { icons: c.icons } : {}), ...(c.layout ? { layout: c.layout } : {}), unresolved, dsModel: true }
}

/** "② Customer sends application form to Clerk" — a sentence read out, as the method intends. */
export function readSentence(m: DsModel, s: DsSentence): string {
  const name = (id: string) => m.actors.find((a) => a.id === id)?.text ?? id
  const to = s.to.length ? ` ${s.toLabel ?? 'to'} ${s.to.map(name).join(', ')}` : ''
  return `${circled(s.seq)} ${name(s.actor)} ${s.verb}${s.objectText ? ` ${s.objectText}` : ''}${to}`
}

/** ① … ⑳, then (21), (22) … */
export function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`
}

const QUICK_START = 'domainstorytelling.org/quick-start-guide'

export type DsRule = 'unresolved-reference' | 'sentence-without-object' | 'sequence-gap' | 'sequence-shared' | 'work-object-unused' | 'actor-unused' | 'actor-kind-custom' | 'self-receiver' | 'groups-overlap' | 'note-long'

/** A note longer than this (in display width: a CJK character counts as two) crowds the story (§6b "No collisions"). */
export const NOTE_RECOMMENDED = 120
/** Display width of a text: wide (CJK, full-width) characters count as two. */
export function displayWidth(text: string): number {
  let n = 0
  for (const ch of text) n += /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(ch) ? 2 : 1
  return n
}
export interface DsFinding {
  rule: DsRule | DsReviewRule
  severity: 'warning' | 'info'
  element?: string
  message: string
  /** Where the rule comes from (the site's quick-start guide, or Egon.io). */
  page: string
}

/** The pictographic language's rules as checks. Pure: content (or a normalized model) in, findings out. */
export function checkDomainStory(content: DomainStoryContent | DsModel): DsFinding[] {
  const m = 'dsModel' in content ? content : normalizeDomainStory(content)
  const out: DsFinding[] = []
  for (const u of m.unresolved) out.push({ rule: 'unresolved-reference', severity: 'warning', element: u.element, message: `${u.field} "${u.ref}" matches no ${u.field === 'actor' || u.field === 'to' ? 'actor (drawn as a person)' : 'element'}`, page: QUICK_START })
  const actorName = (id: string) => m.actors.find((a) => a.id === id)?.text ?? id
  for (const s of m.sentences) {
    if (s.to.includes(s.actor)) {
      const others = s.to.filter((r) => r !== s.actor)
      out.push({
        rule: 'self-receiver',
        severity: 'warning',
        element: s.id,
        message: `${circled(s.seq)} "${actorName(s.actor)} ${s.verb}" goes to ${actorName(s.actor)} itself: ${s.objectText ? 'the board draws its work object beside the actor and leaves out the arrow back' : 'with no work object and no other receiver, nothing can be drawn for it'} — omit the redundant \`to: ${s.actor}\` (an internal step: actor → activity → work object)${others.length ? '' : ', or name the actor who really receives it'}`,
        page: QUICK_START,
      })
    }
    if (!s.objectText) out.push({ rule: 'sentence-without-object', severity: 'info', element: s.id, message: `${circled(s.seq)} "${s.verb}": no work object — a sentence is actor → activity → work object`, page: QUICK_START })
  }
  const seqs = [...new Set(m.sentences.map((s) => s.seq))].sort((a, b) => a - b)
  seqs.forEach((n, i) => {
    const expected = i === 0 ? 1 : seqs[i - 1] + 1
    if (n !== expected) out.push({ rule: 'sequence-gap', severity: 'info', message: `sequence jumps from ${i === 0 ? 'the start' : seqs[i - 1]} to ${n}`, page: QUICK_START })
  })
  for (const n of seqs) {
    const same = m.sentences.filter((s) => s.seq === n)
    if (same.length > 1) out.push({ rule: 'sequence-shared', severity: 'info', element: same[1].id, message: `${circled(n)} is used by ${same.length} sentences — read as parallel activities (Egon.io allows a shared number; the site does not describe it)`, page: 'egon.io' })
  }
  // groups sharing members (neither inside the other) cannot get separate outlines
  const name = (id: string) => m.actors.find((a) => a.id === id)?.text ?? m.workObjects.find((o) => o.id === id)?.text ?? m.sentences.find((x) => x.id === id)?.objectText ?? id
  for (let i = 0; i < m.groups.length; i++)
    for (let j = i + 1; j < m.groups.length; j++) {
      const [a, b] = [m.groups[i], m.groups[j]]
      const sa = new Set(a.members)
      const sb = new Set(b.members)
      const shared = [...sa].filter((x) => sb.has(x))
      if (!shared.length || [...sa].every((x) => sb.has(x)) || [...sb].every((x) => sa.has(x))) continue
      out.push({
        rule: 'groups-overlap',
        severity: 'warning',
        element: b.id,
        message: `groups "${a.text}" and "${b.text}" share ${shared.map((x) => `"${name(x)}"`).join(', ')}, so their outlines overlap — keep each shared element in one group, or make one group a sub-group (all of its members in the other; it is then drawn inside it)`,
        page: QUICK_START,
      })
    }
  for (const n of m.annotations) {
    const w = displayWidth(n.text)
    if (w > NOTE_RECOMMENDED) out.push({ rule: 'note-long', severity: 'warning', element: n.id, message: `note on "${name(n.on)}" is long (${w} > ${NOTE_RECOMMENDED}; a CJK character counts as 2): its box grows to fit, but a long note crowds the story — keep the gist on the board and move the detail into a sentence's \`note\` or the file`, page: QUICK_START })
  }
  for (const o of m.workObjects) {
    if (!m.sentences.some((s) => s.object === o.id)) out.push({ rule: 'work-object-unused', severity: 'warning', element: o.id, message: `"${o.text}" is in no sentence`, page: QUICK_START })
  }
  for (const a of m.actors) {
    if (!m.sentences.some((s) => s.actor === a.id || s.to.includes(a.id))) out.push({ rule: 'actor-unused', severity: 'warning', element: a.id, message: `"${a.text}" neither acts nor receives anything`, page: QUICK_START })
    if (!(DS_ACTOR_KINDS as readonly string[]).includes(a.kind)) out.push({ rule: 'actor-kind-custom', severity: 'info', element: a.id, message: `"${a.text}": kind "${a.kind}" is a custom icon — the method names person, group of people and software system`, page: QUICK_START })
  }
  out.push(...reviewDomainStory(m))
  return out
}
