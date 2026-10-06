// The method, at the point where an agent acts on a diagram file. Tool descriptions, lint and draw results, the
// help text and AGENTS.md all take these lines from here, so an agent that never opens docs/ still meets them
// where it chooses a diagram, writes a story and reads a lint result (docs/domain-story-review.md tells why).
// Pure and builtin-free.
import { normalizeDomainStory, readSentence, type DomainStoryContent } from './domainStory.js'

/** Which diagram holds which shape of content — read before choosing a kind. */
export const WHICH_DIAGRAM = `Which diagram for which content:
- what happens over time, how the system reacts, what does NOT happen and why → EventStorming (events, policies, hotspots)
- one concrete case of who does what with what, and hands it to whom → domain story (one scenario, no conditions, no "not")
- a rule, an invariant, a comparison ("only once per contact", "A vs B") → a definition / policy / hotspot sticky, or a note — not a story
- scope and order of delivery → story map; the work → kanban; one page → wireframe / UI mock; a persona's feelings → journey`

/** What a domain story is, in the words an agent needs while writing one (the book's rules; docs/domain-story-review.md has the pages). */
export const DOMAIN_STORY_METHOD = `A domain story tells ONE concrete case as sentences the person would say aloud: actor — verb — work object — to actor. State its scope (coarse-, medium- or fine-grained; as-is or to-be; pure or digitalized) and keep every sentence at that level. Actors are the people, groups and systems that act, named by role, each once; the same thing keeps the same name every time it comes back (its state may change). It has no "if", no "or", no "does not": what does not happen is a note on the sentence that would have happened ("variation: already sent → ③ does not happen"), the case the story tells is a note on the whole story ("assumption: Casey matches for the first time"), and the rule itself lives in an EventStorming policy or a story map's acceptance — never a story of its own. Do not guess who acts or what they want — ask; then tell the story back sentence by sentence before you call it done.`

/** Collisions are a layout problem. */
export const LAYOUT_NEVER_THE_STORY = 'When pictograms or labels collide, change the layout (layout.spacing, groups, a split into scenarios) — never the story: an actor or a sentence is not dropped to make the picture fit.'

/**
 * The story read back, for the end of a lint or draw result: an agent that reads its own sentences aloud
 * notices what the grammar check cannot — a story of things that do not happen, a guessed actor, three names
 * for one thing. Empty for anything but a domain story.
 */
export function tellBack(content: DomainStoryContent): string[] {
  let m
  try {
    m = normalizeDomainStory(content)
  } catch {
    return []
  }
  const lines = [...m.sentences].sort((a, b) => a.seq - b.seq).map((s) => `  ${readSentence(m, s)}`)
  return [
    'The grammar and the drawing are checked; whether this is the right diagram and a true story is not. Tell it back — did the person say this, or did you guess?',
    ...lines,
  ]
}
