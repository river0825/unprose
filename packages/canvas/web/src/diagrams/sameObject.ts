// One work object, drawn several times. Domain Storytelling gives every activity its own work object, so the
// thing a story is about appears once per sentence that touches it (docs/diagrams.md §6b). The name says they
// are the same; the board says it too: selecting or pointing at one lights up the others. An actor a story lets
// repeat (`layout.actors: repeat`) is drawn again where the story comes back to it: its drawings light up the same way. Pure.
import type { Board, Item } from '../../../src/model'

const isObject = (it: Item | undefined): it is Item => !!it && it.data?.ds === 'object'
const isActor = (it: Item | undefined): boolean => !!it && it.data?.ds === 'actor' && typeof it.data.element === 'string'
/** What makes two pictograms the same work object: the declared work object, else the same name — inside one story. */
const keyOf = (it: Item) => `${it.parent ?? ''}|${typeof it.data?.workObject === 'string' ? `id:${it.data.workObject}` : `text:${(it.text ?? '').trim().toLowerCase()}`}`
/** What makes two pictograms the same actor: the actor they draw (`data.element`), inside one story. */
const actorKeyOf = (it: Item) => `${it.parent ?? ''}|actor:${String(it.data?.element)}`

/** The other pictograms of the same work object in the same story, in the order of their sentences. */
export function sameWorkObject(board: Board, it: Item | undefined): Item[] {
  if (isActor(it)) return sameActor(board, it)
  if (!isObject(it)) return []
  const key = keyOf(it)
  return Object.values(board.items)
    .filter((o) => o.id !== it.id && isObject(o) && keyOf(o) === key)
    .sort((a, b) => Number(a.data?.seq ?? 0) - Number(b.data?.seq ?? 0) || (a.id < b.id ? -1 : 1))
}

/** The other drawings of the same actor in the same story (a repeated actor): its first drawing first, then by id. */
export function sameActor(board: Board, it: Item | undefined): Item[] {
  if (!it || !isActor(it)) return []
  const key = actorKeyOf(it)
  return Object.values(board.items)
    .filter((o) => o.id !== it.id && isActor(o) && actorKeyOf(o) === key)
    .sort((a, b) => Number(!!a.data?.occurrence) - Number(!!b.data?.occurrence) || drawingNo(a) - drawingNo(b) || (a.id < b.id ? -1 : 1))
}

/** Which drawing of its actor an item is: 1 for the first, n for `<…>.actor.<id>.<n>`. */
export function drawingNo(it: Item): number {
  if (!it.data?.occurrence) return 1
  const n = Number(it.id.slice(it.id.lastIndexOf('.') + 1))
  return Number.isFinite(n) && n > 1 ? n : 2
}

/** The sentences an actor drawing takes part in (the activities from or to it), in number order. */
export function sentencesAt(board: Board, actor: Item): string[] {
  const out = new Map<number, string>()
  for (const a of Object.values(board.items)) {
    if (a.type !== 'arrow' || (a.from !== actor.id && a.to !== actor.id) || typeof a.data?.sentence !== 'string') continue
    const seq = typeof a.data.seq === 'number' ? a.data.seq : Number(board.items[a.from ?? '']?.data?.seq ?? 0)
    if (!out.has(seq)) out.set(seq, a.data.sentence)
  }
  return [...out.entries()].sort((x, y) => x[0] - y[0]).map(([, s]) => s)
}
