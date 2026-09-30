// From an EventStorming diagram to story-map candidates (docs/diagrams.md §4). The book gives no mapping —
// only that a story's acceptance can be the events it produces and the read models it shows (p.279) — so
// this is our rule, to try and adjust:
//   person + command            → a story candidate "As <person>, I <command>"
//   events it produces + read models that inform it → its acceptance criteria
//   pivotal events / phases     → backbone activities, in timeline order; the commands inside → steps
// Big-picture diagrams have no commands: a person's action (an event with a person) becomes the candidate.
// Pure: the candidates are proposals; nothing is written until the person accepts them.
import type { Trace } from './ids.js'
import { normalizeEventStorming, type EsModel, type EventStormingContent } from './eventStorming.js'
import { normalizeUserStoryMap, type UserStoryMapContent } from './userStoryMap.js'

export interface StoryCandidate {
  /** Proposed story id: 'from-<element id>'. */
  id: string
  text: string
  acceptance: string[]
  traces: Trace[]
  /** Backbone activity and step it would go under (ids reuse the existing map's when the text matches). */
  activity: { id: string; text: string }
  step: { id: string; text: string }
  person?: string
  /** The element it comes from: an EventStorming command / event, or a Domain Storytelling sentence. */
  source: { kind: 'command' | 'event' | 'sentence'; id: string }
}

export interface StoryProposal {
  candidates: StoryCandidate[]
  /** The same candidates shaped as story-map content (only new stories), ready to draw as pending items. */
  activities: Array<{ id: string; text: string; steps: Array<{ id: string; text: string; stories: Array<{ id: string; text: string; acceptance: string[]; traces: Trace[] }> }> }>
}

export interface ProposeOptions {
  /** Diagram key of the EventStorming frame, used in trace refs: '<esKey>/<element id>'. */
  esKey: string
  /** The story map as it is now: stories already tracing to an element are not proposed again. */
  existing?: UserStoryMapContent
}

/** Segments of the timeline: phases when the diagram has them, else cut after each pivotal event. */
function segments(m: EsModel): Array<{ id: string; text: string; events: string[] }> {
  const order = m.events.map((e) => e.id)
  const at = (id?: string) => (id ? order.indexOf(id) : -1)
  const phased = m.phases.filter((p) => p.from || p.to)
  if (phased.length) {
    return phased.map((p) => {
      const from = Math.max(at(p.from), 0)
      const to = p.to ? at(p.to) : order.length - 1
      return { id: p.id, text: p.text, events: order.slice(from, to + 1) }
    })
  }
  const out: Array<{ id: string; text: string; events: string[] }> = []
  let current: string[] = []
  for (const e of m.events) {
    current.push(e.id)
    if (e.pivotal) {
      out.push({ id: e.id, text: e.text, events: current })
      current = []
    }
  }
  if (current.length) {
    const last = m.events.find((e) => e.id === current[current.length - 1])!
    out.push({ id: last.id, text: out.length ? `After: ${out[out.length - 1].text}` : 'Flow', events: current })
  }
  return out
}

export function proposeStories(content: EventStormingContent | EsModel, opts: ProposeOptions): StoryProposal {
  const m = 'kindOf' in content ? content : normalizeEventStorming(content)
  const existing = opts.existing ? normalizeUserStoryMap(opts.existing) : undefined
  const traced = new Set(existing?.activities.flatMap((a) => a.steps.flatMap((s) => s.stories.flatMap((st) => st.traces.map((t) => t.from)))) ?? [])
  const activityByText = new Map(existing?.activities.map((a) => [a.text, a.id]) ?? [])
  const stepByText = new Map(existing?.activities.flatMap((a) => a.steps.map((s) => [s.text, s.id] as const)) ?? [])
  const person = (id?: string) => (id ? m.people.find((p) => p.id === id)?.text : undefined)
  const eventText = (id: string) => m.events.find((e) => e.id === id)?.text ?? id
  const ref = (id: string) => `${opts.esKey}/${id}`

  const segs = segments(m)
  const segOf = (eventId: string | undefined) => segs.find((s) => eventId && s.events.includes(eventId)) ?? segs[segs.length - 1]
  const candidates: StoryCandidate[] = []

  if (m.commands.length) {
    // Commands in timeline order of the first event they produce.
    const pos = (k: (typeof m.commands)[number]) => Math.min(...k.produces.map((e) => m.events.findIndex((x) => x.id === e)).filter((i) => i >= 0), Number.MAX_SAFE_INTEGER)
    const commands = [...m.commands].sort((a, b) => pos(a) - pos(b))
    for (const k of commands) {
      if (traced.has(ref(k.id))) continue
      const seg = segOf(k.produces[0])
      const who = person(k.by) ?? person(m.policies.find((p) => p.then.includes(k.id))?.person)
      const shown = m.readModels.filter((r) => r.informs.includes(k.id) || (k.by !== undefined && r.informs.includes(k.by)))
      candidates.push({
        id: `from-${k.id}`,
        text: who ? `As ${who}, I ${lowerFirst(k.text)}` : k.text,
        acceptance: [...k.produces.map((e) => `Event: ${eventText(e)}`), ...shown.map((r) => `Shows: ${r.text}`)],
        traces: [{ from: ref(k.id), rel: 'derived-from' }],
        activity: { id: activityByText.get(seg.text) ?? seg.id, text: seg.text },
        step: { id: stepByText.get(k.text) ?? k.id, text: k.text },
        person: who,
        source: { kind: 'command', id: k.id },
      })
    }
  } else {
    // Big picture: a person's action is the closest thing to a user action (p.280: story maps start from them).
    for (const e of m.events.filter((e) => e.person)) {
      if (traced.has(ref(e.id))) continue
      const seg = segOf(e.id)
      const who = person(e.person)!
      candidates.push({
        id: `from-${e.id}`,
        text: `As ${who}: ${e.text}`,
        acceptance: [`Event: ${e.text}`],
        traces: [{ from: ref(e.id), rel: 'derived-from' }],
        activity: { id: activityByText.get(seg.text) ?? seg.id, text: seg.text },
        step: { id: stepByText.get(e.text) ?? e.id, text: e.text },
        person: who,
        source: { kind: 'event', id: e.id },
      })
    }
  }

  // Shape as story-map content, keeping backbone and step order.
  const activities: StoryProposal['activities'] = []
  for (const cnd of candidates) {
    let a = activities.find((x) => x.id === cnd.activity.id)
    if (!a) activities.push((a = { id: cnd.activity.id, text: cnd.activity.text, steps: [] }))
    let s = a.steps.find((x) => x.id === cnd.step.id)
    if (!s) a.steps.push((s = { id: cnd.step.id, text: cnd.step.text, stories: [] }))
    s.stories.push({ id: cnd.id, text: cnd.text, acceptance: cnd.acceptance, traces: cnd.traces })
  }
  return { candidates, activities }
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
