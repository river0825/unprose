// Trace wires join elements of different diagrams (docs/diagrams.md §2): 來自 derived-from, 組成 groups,
// 畫面 shows. They are drawn dotted and are never flow.
import type { Board, Item } from '../../../src/model'

export type TraceRel = 'derived-from' | 'groups' | 'shows'
export const REL_NAMES: Record<TraceRel, string> = { 'derived-from': '來自', groups: '組成', shows: '畫面' }
const BY_NAME: Record<string, TraceRel> = { 來自: 'derived-from', 組成: 'groups', 畫面: 'shows' }

export const isTraceWire = (it: Item | undefined) => it?.type === 'arrow' && it.role === 'trace'

export function relOf(a: Item): TraceRel | undefined {
  const r = ((a.data?.trace as { rel?: string } | undefined)?.rel ?? (a.data?.rel as string | undefined)) ?? a.label ?? a.text
  if (r === 'derived-from' || r === 'groups' || r === 'shows') return r
  return r ? BY_NAME[r.trim()] : undefined
}

export interface TraceLink {
  wire: Item
  rel?: TraceRel
  /** The element on the other end. */
  other?: Item
  /**
   * A trace wire runs from the element that carries the trace to where it points:
   * story —來自→ command. `out`: this item carries it (this 來自 other). `in`: other carries it (other 來自 this).
   */
  dir: 'out' | 'in'
}

export function tracesOf(board: Board, it: Item): TraceLink[] {
  const out: TraceLink[] = []
  for (const a of Object.values(board.items)) {
    if (!isTraceWire(a)) continue
    if (a.from === it.id) out.push({ wire: a, rel: relOf(a), other: a.to ? board.items[a.to] : undefined, dir: 'out' })
    else if (a.to === it.id) out.push({ wire: a, rel: relOf(a), other: a.from ? board.items[a.from] : undefined, dir: 'in' })
  }
  return out
}
