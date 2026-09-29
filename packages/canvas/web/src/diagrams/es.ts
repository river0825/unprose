// EventStorming as the book describes it (Brandolini, *Introducing EventStorming*; printed page numbers),
// read off the board: what each sticky means, who it should sit next to, and what breaks the grammar.
// A web-side reading of the drawn items; `awd design lint` checks the file (docs/diagrams.md §3).
import type { Board, Item } from '../../../src/model'
import { membersOf } from './frame'
import { isTraceWire } from './traces'

export interface RoleInfo { name: string; colour: string; meaning: string; page: string }

/** Both the template's older role names (actor, external) and the book's (person, system). */
export const ES_ROLES: Record<string, RoleInfo> = {
  event: { name: 'Domain event', colour: 'orange', meaning: 'Something relevant that happened, in the past tense.', page: 'p.202' },
  pivotal: { name: 'Pivotal event', colour: 'orange (larger)', meaning: 'An event that marks a phase change in the story; used to sort the timeline.', page: 'p.82' },
  command: { name: 'Command', colour: 'blue', meaning: 'A decision or action a person (or system) takes; it leads through a system to events.', page: 'p.202' },
  policy: { name: 'Policy', colour: 'lilac', meaning: '"Whenever <event>, then <command>" — the reaction between an event and the next command.', page: 'p.202' },
  'read-model': { name: 'Read model', colour: 'green', meaning: 'The information a person needs to decide; events update it.', page: 'p.200-202' },
  actor: { name: 'Person', colour: 'small pale yellow', meaning: 'Who takes the decision or is involved.', page: 'p.88' },
  person: { name: 'Person', colour: 'small pale yellow', meaning: 'Who takes the decision or is involved.', page: 'p.88' },
  external: { name: 'System', colour: 'pink (large)', meaning: 'Whatever we can put the blame on: an external system, a tool, an organisation.', page: 'p.90' },
  system: { name: 'System', colour: 'pink (large)', meaning: 'Whatever we can put the blame on: an external system, a tool, an organisation.', page: 'p.90' },
  hotspot: { name: 'Hotspot', colour: 'purple', meaning: 'A problem, question or conflict to come back to. Open hotspots = not done yet.', page: 'p.87, p.199' },
  opportunity: { name: 'Opportunity', colour: 'green', meaning: 'An idea for improvement found while exploring.', page: 'p.101' },
  value: { name: 'Value', colour: 'green (+) / red (−)', meaning: 'Value created or destroyed at this point.', page: 'p.108' },
  vote: { name: 'Arrow vote', colour: 'blue', meaning: 'A vote for the problem the group wants to solve first.', page: 'p.104' },
  milestone: { name: 'Time milestone', colour: 'marker line', meaning: 'A point in time used to structure the timeline.', page: 'p.85' },
  phase: { name: 'Phase / chapter', colour: 'label', meaning: 'A chapter of the story; a clue for bounded contexts.', page: 'p.133' },
  definition: { name: 'Definition', colour: 'white', meaning: 'What a term means here — captured as the words come up.', page: 'p.144' },
  aggregate: { name: 'Aggregate', colour: 'large pale yellow', meaning: 'Software level: the thing that takes the command and raises the events.', page: 'p.277' },
}

const roleKey = (it: Item) => (it.role === 'actor' ? 'person' : it.role === 'external' ? 'system' : it.role ?? '')

/** Grammar links between members: drawn flow arrows plus the template's data references. */
function links(board: Board, members: Item[]): Array<[string, string]> {
  const ids = new Set(members.map((m) => m.id))
  const out: Array<[string, string]> = []
  for (const a of Object.values(board.items)) {
    if (a.type !== 'arrow' || isTraceWire(a) || !a.from || !a.to) continue
    if (ids.has(a.from) && ids.has(a.to)) out.push([a.from, a.to])
  }
  for (const m of members) {
    const d = m.data ?? {}
    const ref = (v: unknown) => (typeof v === 'string' && ids.has(v) ? v : undefined)
    const r = roleKey(m)
    if (r === 'command' && ref(d.event)) out.push([m.id, ref(d.event)!])
    if (r === 'policy') {
      if (ref(d.when)) out.push([ref(d.when)!, m.id])
      if (ref(d.then)) out.push([m.id, ref(d.then)!])
    }
    if (r === 'read-model' && ref(d.for)) out.push([m.id, ref(d.for)!])
    if (r === 'system' && ref(d.event)) out.push([m.id, ref(d.event)!])
    if (r === 'person' && ref(d.for)) out.push([m.id, ref(d.for)!])
  }
  return out
}

export interface Neighbours { before: Item[]; after: Item[] }

/** What an element is joined to on each side (grammar links only, not traces). */
export function neighboursOf(board: Board, frameId: string, it: Item): Neighbours {
  const members = membersOf(board, frameId)
  const ls = links(board, members)
  const get = (id: string) => board.items[id]
  return {
    before: ls.filter(([, t]) => t === it.id).map(([f]) => get(f)).filter(Boolean) as Item[],
    after: ls.filter(([f]) => f === it.id).map(([, t]) => get(t)).filter(Boolean) as Item[],
  }
}

/** The book's rule for this element's neighbours, in words. */
export function grammarRule(it: Item): string | undefined {
  switch (roleKey(it)) {
    case 'command': return 'A person issues it; a system sits between it and the event it produces (p.202).'
    case 'event': return 'Comes from a person’s action, a system, time, or another event via a policy (p.208); a policy sits between it and the next command (p.202).'
    case 'policy': return 'Sits between an event and a command: whenever <event>, then <command> (p.202).'
    case 'read-model': return 'Events update it; it informs the person who decides the next command (p.200-202).'
    case 'system': return 'Sits between a command and the event it produces (p.202).'
    case 'person': return 'Looks at read models and issues commands (p.200-202).'
    default: return undefined
  }
}

export interface Finding { elementId: string; message: string; page: string }

/** Grammar findings for the EventStorming frame, read off the drawn items. */
export function esFindings(board: Board, frameId: string, level?: string): Finding[] {
  const members = membersOf(board, frameId)
  const ls = links(board, members)
  const byId = new Map(members.map((m) => [m.id, m]))
  const role = (id: string) => { const m = byId.get(id); return m ? roleKey(m) : '' }
  const out: Finding[] = []
  const isEvent = (r: string) => r === 'event' || r === 'pivotal'
  for (const m of members) {
    const r = roleKey(m)
    const ins = ls.filter(([, t]) => t === m.id).map(([f]) => role(f))
    const outs = ls.filter(([f]) => f === m.id).map(([, t]) => role(t))
    if (r === 'command' && level !== 'big-picture' && outs.some(isEvent) && !outs.includes('system')) out.push({ elementId: m.id, message: `Command “${label(m)}” leads straight to an event — put the system that handles it in between.`, page: 'p.202' })
    if (r === 'command' && level !== 'big-picture' && !outs.length && !ins.includes('system')) out.push({ elementId: m.id, message: `Command “${label(m)}” produces no event.`, page: 'p.202' })
    if (isEvent(r) && outs.includes('command')) out.push({ elementId: m.id, message: `Event “${label(m)}” leads straight to a command — the policy in between is missing.`, page: 'p.202' })
    if (r === 'event' && level !== 'big-picture' && !ins.length && !m.data?.time) out.push({ elementId: m.id, message: `Event “${label(m)}” has no source (person, system, time or policy).`, page: 'p.208' })
    if (r === 'read-model' && !ins.length && !outs.length) out.push({ elementId: m.id, message: `Read model “${label(m)}” is not used by anyone.`, page: 'p.200' })
    if (r === 'pivotal' && level === 'process') out.push({ elementId: m.id, message: 'Pivotal events belong to the big picture; a process board follows one process.', page: 'p.82' })
    if (r === 'hotspot' && !m.data?.resolved) out.push({ elementId: m.id, message: `Open hotspot: “${label(m)}”.`, page: 'p.199' })
  }
  return out
}

const label = (m: Item) => (m.text ?? m.id).split('\n')[0].slice(0, 60)

/** Story-map element roles. */
export const USM_ROLES: Record<string, RoleInfo> = {
  activity: { name: 'Activity (backbone)', colour: 'blue', meaning: 'A big thing the user does; from EventStorming pivotal events / phases (docs/diagrams.md §4).', page: '§4' },
  step: { name: 'Step', colour: 'yellow', meaning: 'A step of the activity, left to right in the order it happens.', page: '§4' },
  story: { name: 'Story', colour: 'white', meaning: 'Something to build; acceptance = the events it produces + the read models it shows (EventStorming p.279).', page: 'p.279' },
  release: { name: 'Release', colour: 'line', meaning: 'A cut line: stories above the first line are Release 1.', page: '§5' },
}

export const DOMAIN_STORY_ROLES: Record<string, RoleInfo> = {
  actor: { name: 'Actor', colour: 'pictogram', meaning: 'A person, group or software system that takes part in the story.', page: 'domainstorytelling.org' },
  'work-object': { name: 'Work object', colour: 'pictogram', meaning: 'What the actors work with: a document, data, a thing.', page: 'domainstorytelling.org' },
  activity: { name: 'Activity', colour: 'numbered arrow', meaning: 'A verb on a numbered arrow; the numbers read as sentences.', page: 'domainstorytelling.org' },
}

export function roleInfo(kind: string, it: Item): RoleInfo | undefined {
  if (kind === 'event-storming') return ES_ROLES[it.role ?? '']
  if (kind === 'user-story-map') return USM_ROLES[it.role ?? '']
  if (kind === 'domain-story') return DOMAIN_STORY_ROLES[it.role ?? '']
  return undefined
}
