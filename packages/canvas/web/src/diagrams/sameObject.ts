// One work object, drawn several times. Domain Storytelling gives every activity its own work object, so the
// thing a story is about appears once per sentence that touches it (docs/diagrams.md §6b). The name says they
// are the same; the board says it too: selecting or pointing at one lights up the others. Pure.
import type { Board, Item } from '../../../src/model'

const isObject = (it: Item | undefined): it is Item => !!it && it.data?.ds === 'object'
/** What makes two pictograms the same work object: the declared work object, else the same name — inside one story. */
const keyOf = (it: Item) => `${it.parent ?? ''}|${typeof it.data?.workObject === 'string' ? `id:${it.data.workObject}` : `text:${(it.text ?? '').trim().toLowerCase()}`}`

/** The other pictograms of the same work object in the same story, in the order of their sentences. */
export function sameWorkObject(board: Board, it: Item | undefined): Item[] {
  if (!isObject(it)) return []
  const key = keyOf(it)
  return Object.values(board.items)
    .filter((o) => o.id !== it.id && isObject(o) && keyOf(o) === key)
    .sort((a, b) => Number(a.data?.seq ?? 0) - Number(b.data?.seq ?? 0) || (a.id < b.id ? -1 : 1))
}
