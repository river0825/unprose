// Who is on the other end of an event: the block that emits what this one listens to,
// and the blocks that listen to what this one emits. Read from the board's `data.detail`.
import type { Board, Item } from '../../../src/model'
import { detailOf } from './detail'

/** `card.moved if event.data.to == 'Planning'` → { event: 'card.moved', condition: "event.data.to == 'Planning'" } */
export function parseListen(line: string): { event: string; condition?: string } {
  const m = line.match(/^(\S+)(?:\s+if\s+(.+))?$/)
  return m ? { event: m[1], condition: m[2] } : { event: line }
}

const matches = (listened: string, emitted: string) =>
  listened === emitted || (listened.startsWith('*.') && emitted.endsWith(listened.slice(1)))

const blocks = (board: Board) => Object.values(board.items).filter((it) => it.type !== 'arrow' && it.type !== 'comment' && detailOf(it))

/** Blocks that emit `event` (for `*.failed`: the synthetic "any step" node, if drawn). */
export function producersOf(board: Board, event: string, self?: string): Item[] {
  return blocks(board).filter((it) => {
    if (it.id === self) return false
    const d = detailOf(it)!
    if (event.startsWith('*.')) return (it.data?.nodeId as string | undefined) === event
    return (d.emits ?? []).includes(event)
  })
}

/** Blocks that run on `event`: their `listens`, or a human step's `resumeOn`. */
export function consumersOf(board: Board, event: string, self?: string): Array<{ item: Item; condition?: string; resume?: boolean }> {
  const out: Array<{ item: Item; condition?: string; resume?: boolean }> = []
  for (const it of blocks(board)) {
    if (it.id === self) continue
    const d = detailOf(it)!
    for (const l of d.listens ?? []) {
      const p = parseListen(l)
      if (matches(p.event, event)) out.push({ item: it, condition: p.condition })
    }
    if ('resumeOn' in d && d.resumeOn?.includes(event)) out.push({ item: it, resume: true })
  }
  return out
}

/**
 * The wire drawn for `event` between two blocks (items): by its recorded `data.event`, else —
 * on a board drawn before wires carried events — any wire between the two items.
 */
export function wireFor(board: Board, event: string, fromItem: Item | undefined, toItem: Item | undefined): Item | undefined {
  const arrows = Object.values(board.items).filter((a) => a.type === 'arrow' && a.role !== 'owns' && a.role !== 'delegates')
  const node = (it: Item | undefined) => it?.data?.nodeId as string | undefined
  const byEvent = arrows.find((a) => {
    const e = a.data?.event as { event?: string; from?: string; to?: string } | undefined
    return e?.event === event && (!fromItem || e.from === node(fromItem)) && (!toItem || e.to === node(toItem))
  })
  return byEvent ?? arrows.find((a) => (!fromItem || a.from === fromItem.id) && (!toItem || a.to === toItem.id))
}
