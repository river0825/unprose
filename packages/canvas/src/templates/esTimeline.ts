// Where things go on an EventStorming board: left → right in time (docs/diagrams.md §3).
//
// The book's process-modelling grammar is a sentence read left to right (p.200-202):
//   read model → person → command → system → event → policy → command → …
// so every element gets a *rank* (its column) from that causal graph: the longest path from a start
// (a command nobody triggers, an event with no source). The file order of events is the timeline too,
// so a later event is never drawn left of an earlier one unless the causes say otherwise; events that
// are branches of one command share a column (p.209). Only true loops point back.
//
// Pure: element ids in, { rank, row } out. The template turns ranks and rows into pixels.
import type { EsModel } from '../diagrams/eventStorming.js'

export interface Node {
  id: string
  /** Band it lives in (a swimlane, the plain timeline, or an aggregate). */
  band: string
}

export interface Placement {
  rank: Map<string, number>
  row: Map<string, number>
}

/**
 * Rank and row for the flow nodes (commands, systems, events, policies) of a detailed board.
 * `edges` are the causal wires, in drawing order (first produced event first); `timeline` is the
 * events in file order.
 */
export function placeFlow(nodes: Node[], edges: Array<[string, string]>, timeline: string[], siblings: (a: string, b: string) => boolean): Placement {
  const isEvent = new Set(timeline)
  const ids = nodes.map((n) => n.id)
  const known = new Set(ids)
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]))
  const pred = new Map<string, string[]>(ids.map((id) => [id, []]))
  const add = (a: string, b: string) => {
    if (!known.has(a) || !known.has(b) || a === b || succ.get(a)!.includes(b)) return
    succ.get(a)!.push(b)
    pred.get(b)!.push(a)
  }
  for (const [a, b] of edges) add(a, b)

  // Loops: drop the edges that close a cycle (found depth-first from the starts, in file order).
  const starts = ids.filter((id) => pred.get(id)!.length === 0)
  const state = new Map<string, 1 | 2>() // 1 = on the stack, 2 = done
  const back = new Set<string>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const s of succ.get(id)!) {
      if (state.get(s) === 1) back.add(`${id}>${s}`)
      else if (!state.has(s)) visit(s)
    }
    state.set(id, 2)
  }
  for (const id of [...starts, ...ids]) if (!state.has(id)) visit(id)
  const forward = (a: string, b: string) => !back.has(`${a}>${b}`)

  // The timeline: each event comes after the one before it in the file, unless they are branches of
  // one command or the causes already say the opposite (no edge that would make a loop).
  const reaches = (from: string, to: string) => {
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length) {
      const x = stack.pop()!
      if (x === to) return true
      if (seen.has(x)) continue
      seen.add(x)
      for (const s of succ.get(x)!) if (forward(x, s)) stack.push(s)
    }
    return false
  }
  const events = timeline.filter((e) => known.has(e))
  for (let i = 1; i < events.length; i++) {
    const [a, b] = [events[i - 1], events[i]]
    if (siblings(a, b) || reaches(b, a)) continue
    add(a, b)
  }

  // As early as possible (longest path). Events stay there — they are the timeline; a command, system
  // or policy then slides right up to just before what it causes, so it sits next to its event instead
  // of far away on the left.
  const order = topo(ids, succ, forward)
  const rank = new Map<string, number>()
  for (const id of order) rank.set(id, Math.max(0, ...pred.get(id)!.filter((p) => forward(p, id)).map((p) => rank.get(p)! + 1)))
  for (const id of [...order].reverse()) {
    if (isEvent.has(id)) continue
    const next = succ.get(id)!.filter((s) => forward(id, s)).map((s) => rank.get(s)!)
    if (next.length) rank.set(id, Math.max(rank.get(id)!, Math.min(...next) - 1))
  }

  // Rows: follow each chain from its start; a node keeps its parent's row when that cell is free, so the
  // happy path (a command's first produced event) runs straight and branches drop below it.
  const bandOf = new Map(nodes.map((n) => [n.id, n.band]))
  const taken = new Set<string>()
  const row = new Map<string, number>()
  const place = (id: string, want: number) => {
    if (row.has(id)) return
    let r = want
    while (taken.has(`${bandOf.get(id)}|${rank.get(id)}|${r}`)) r++
    row.set(id, r)
    taken.add(`${bandOf.get(id)}|${rank.get(id)}|${r}`)
    for (const s of succ.get(id)!) if (forward(id, s)) place(s, r)
  }
  for (const id of order) if (pred.get(id)!.every((p) => !forward(p, id))) place(id, 0)
  for (const id of ids) place(id, 0)
  return { rank, row }
}

function topo(ids: string[], succ: Map<string, string[]>, forward: (a: string, b: string) => boolean): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]))
  for (const a of ids) for (const b of succ.get(a)!) if (forward(a, b)) indeg.set(b, indeg.get(b)! + 1)
  const queue = ids.filter((id) => indeg.get(id) === 0)
  const out: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    out.push(id)
    for (const s of succ.get(id)!) {
      if (!forward(id, s)) continue
      indeg.set(s, indeg.get(s)! - 1)
      if (indeg.get(s) === 0) queue.push(s)
    }
  }
  return out
}

/** Two events are branches of one command (it produces both): they share a column. */
export function branchSiblings(m: EsModel): (a: string, b: string) => boolean {
  return (a, b) => m.commands.some((k) => k.produces.includes(a) && k.produces.includes(b))
}
