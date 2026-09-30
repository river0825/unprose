// From a domain story to story-map candidates — our rule, like the EventStorming one (docs/diagrams.md §4);
// the method's site describes no mapping:
//   a sentence whose actor is a person or a group of people → "As <actor>, I <verb> <work object> [to <receiver>]"
//   the work object reaching its receiver (or the activity being done)  → its acceptance criterion
//   the group the sentence belongs to (else the story itself)           → the backbone activity
//   the actor                                                           → the step
// Software systems acting are not users, so they propose nothing. Pure: candidates are proposals only.
import { normalizeDomainStory, type DomainStoryContent, type DsModel } from './domainStory.js'
import { normalizeUserStoryMap, type UserStoryMapContent } from './userStoryMap.js'
import type { StoryCandidate, StoryProposal } from './proposeStories.js'

export interface ProposeFromDomainStoryOptions {
  /** Diagram key of the domain story, used in trace refs: '<dsKey>/<sentence id>'. */
  dsKey: string
  /** Name of the backbone activity for sentences outside any group (default: the key). */
  storyName?: string
  existing?: UserStoryMapContent
}

export function proposeFromDomainStory(content: DomainStoryContent | DsModel, opts: ProposeFromDomainStoryOptions): StoryProposal {
  const m = 'dsModel' in content ? content : normalizeDomainStory(content)
  const existing = opts.existing ? normalizeUserStoryMap(opts.existing) : undefined
  const traced = new Set(existing?.activities.flatMap((a) => a.steps.flatMap((s) => s.stories.flatMap((st) => st.traces.map((t) => t.from)))) ?? [])
  const activityByText = new Map(existing?.activities.map((a) => [a.text, a.id]) ?? [])
  const stepByText = new Map(existing?.activities.flatMap((a) => a.steps.map((s) => [s.text, s.id] as const)) ?? [])
  const actor = (id: string) => m.actors.find((a) => a.id === id)!
  const story = { id: 'story', text: opts.storyName ?? opts.dsKey }

  const candidates: StoryCandidate[] = []
  for (const s of [...m.sentences].sort((a, b) => a.seq - b.seq)) {
    const who = actor(s.actor)
    if (who.kind === 'system') continue
    const ref = `${opts.dsKey}/${s.id}`
    if (traced.has(ref)) continue
    const receivers = s.to.map((r) => actor(r).text)
    const group = m.groups.find((g) => g.members.includes(s.id) || (s.object && g.members.includes(s.object)) || g.members.includes(s.actor)) ?? story
    candidates.push({
      id: `from-${s.id}`,
      text: `As ${who.text}, I ${s.verb}${s.objectText ? ` ${s.objectText}` : ''}${receivers.length ? ` ${s.toLabel ?? 'to'} ${receivers.join(', ')}` : ''}`,
      acceptance: [receivers.length && s.objectText ? `${s.objectText} reaches ${receivers.join(', ')}` : `Done: ${s.verb}${s.objectText ? ` ${s.objectText}` : ''}`],
      traces: [{ from: ref, rel: 'derived-from' }],
      activity: { id: activityByText.get(group.text) ?? group.id, text: group.text },
      step: { id: stepByText.get(who.text) ?? who.id, text: who.text },
      person: who.text,
      source: { kind: 'sentence', id: s.id },
    })
  }

  const activities: StoryProposal['activities'] = []
  for (const c of candidates) {
    let a = activities.find((x) => x.id === c.activity.id)
    if (!a) activities.push((a = { id: c.activity.id, text: c.activity.text, steps: [] }))
    let st = a.steps.find((x) => x.id === c.step.id)
    if (!st) a.steps.push((st = { id: c.step.id, text: c.step.text, stories: [] }))
    st.stories.push({ id: c.id, text: c.text, acceptance: c.acceptance, traces: c.traces })
  }
  return { candidates, activities }
}
