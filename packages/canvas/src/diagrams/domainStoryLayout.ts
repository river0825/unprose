// What a domain story's drawing tells that its grammar cannot (docs/diagrams.md §6b "No collisions"): the layout is
// deterministic, so the lint can draw the story and look. Group outlines that overlap although the groups share no
// member (they interleave — sentences grouped by number around one hub actor), a line that runs through a pictogram,
// and `layout.actors: repeat` that drew no actor again. Pure: content in, findings out (the same checks as the
// board's layout check — layoutCheck.ts — on a fresh drawing).
import type { Board, Item } from '../model.js'
import { checkLayout } from '../layoutCheck.js'
import { renderDomainStory } from '../templates/domain-story.js'
import { normalizeDomainStory, type DomainStoryContent, type DsFinding } from './domainStory.js'

const PAGE = 'docs/diagrams.md §6b'

export function domainStoryLayoutFindings(content: DomainStoryContent, key = 'ds'): DsFinding[] {
  const m = normalizeDomainStory(content)
  let items: Item[]
  try {
    items = renderDomainStory(content, { scope: key, now: '1970-01-01T00:00:00.000Z' })
  } catch {
    return [] // it does not draw: the schema findings say why
  }
  const out: DsFinding[] = []
  const element = (id: string) => (id.startsWith(`${key}.`) ? id.slice(key.length + 1).replace(/^(group|note|object|actor)\./, '') : id)
  const board: Board = { id: 'lint', title: '', kind: 'freeform', seq: 0, createdAt: '', updatedAt: '', items: Object.fromEntries(items.map((i) => [i.id, i])) }
  const shared = (a: string, b: string) => {
    const ga = m.groups.find((g) => g.id === a)
    const gb = m.groups.find((g) => g.id === b)
    return !!ga && !!gb && ga.members.some((x) => gb.members.includes(x))
  }
  for (const f of checkLayout(board, { limit: 200 }).findings) {
    if (f.kind === 'group') {
      const [a, b] = [element(f.others?.[0] ?? ''), element(f.id)]
      if (shared(a, b)) continue // groups-overlap says it, with the shared members
      out.push({ rule: 'group-outlines-overlap', severity: 'warning', element: b, message: `${f.message}, although the two groups share no member: their members interleave on the board (often sentences grouped by number around one actor they all pass through) — group what sits together (an actor with its work objects), give the story more room (\`layout: { spacing: roomy }\`), split it into two stories, or drop the groups`, page: PAGE })
    } else if (f.kind === 'wire-through') {
      out.push({ rule: 'line-through', severity: 'warning', element: element(f.id), message: `${f.message} — on the board: ${f.suggestion}`, page: PAGE })
    }
  }
  // actors may repeat, and none was drawn again
  const asked = m.layout?.actors === 'repeat' ? '`layout.actors: repeat`' : m.actors.some((a) => a.repeat) ? '`repeat: true`' : undefined
  if (asked && !items.some((i) => i.data?.occurrence))
    out.push({
      rule: 'repeat-no-effect',
      severity: 'info',
      message: `${asked} draws no actor again in this story: every sentence is drawn within two grid cells of the drawings its actors already have (an actor is drawn again only where the story comes back to it from further away) — to draw one again anyway, put \`drawAgain: <actor>\` on the sentence that should get the copy`,
      page: PAGE,
    })
  return out
}
