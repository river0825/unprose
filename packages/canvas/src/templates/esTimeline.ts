// Where things go on an EventStorming board: left → right in time (docs/diagrams.md §3).
//
// The book's process-modelling grammar is a sentence read left to right (p.200-202):
//   read model → person → command → system → event → policy → command → …
// so every element gets a *rank* (its column) from that causal graph: the longest path from a start
// (a command nobody triggers, an event with no source). The file order of events is the timeline too,
// so a later event is never drawn left of an earlier one unless the causes say otherwise; events that
// are branches of one command share a column (p.209).
//
// Time only runs forward. A wire that would point back in time — a retry ("whenever a conflict is found,
// configure again"), a read model that makes someone repeat an earlier command — is not drawn as a loop
// back to the left: the earlier element is drawn again as a later *occurrence*, right after the element
// that leads to it, and the wire goes there (sticky notes are cheap: write it again).
//
// Pure: element ids in, { rank, row, again } out. The template turns ranks and rows into pixels.
import type { EsModel } from '../diagrams/eventStorming.js'

export interface Node {
  id: string
  /** Band it lives in (a swimlane, the plain timeline, or an aggregate). */
  band: string
}

/** A later occurrence of `of`, drawn right after `after` instead of a wire from `after` back to `of`. */
export interface Again {
  id: string
  of: string
  after: string
  band: string
}

export interface Placement {
  rank: Map<string, number>
  row: Map<string, number>
  /** The later occurrences (their ids are in rank / row too). */
  again: Again[]
  /** `${from}>${to}` of a wire that points back in time → the occurrence the wire goes to instead. */
  retarget: Map<string, string>
}

export interface FlowOptions {
  /**
   * When each node happens (events: their file order; a command just before what it produces …). A wire
   * from a later node to an earlier one points back in time and gets a later occurrence instead.
   */
  time?: Map<string, number>
  /** The id of the `n`th (0-based) later occurrence of `of`; default `<of>.again`, `<of>.again-2`, … */
  againId?: (of: string, n: number) => string
}

export const againIdOf = (of: string, n: number): string => (n ? `${of}.again-${n + 1}` : `${of}.again`)

/**
 * Rank and row for the flow nodes (commands, systems, events, policies, read models that inform a
 * command) of a detailed board. `edges` are the causal wires, in drawing order (first produced event
 * first); `timeline` is the events in file order.
 */
export function placeFlow(nodes: Node[], edges: Array<[string, string]>, timeline: string[], siblings: (a: string, b: string) => boolean, opts: FlowOptions = {}): Placement {
  const isEvent = new Set(timeline)
  const ids = nodes.map((n) => n.id)
  const known = new Set(ids)
  const bandOf = new Map(nodes.map((n) => [n.id, n.band]))
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]))
  const pred = new Map<string, string[]>(ids.map((id) => [id, []]))
  const add = (a: string, b: string) => {
    if (!known.has(a) || !known.has(b) || a === b || succ.get(a)!.includes(b)) return
    succ.get(a)!.push(b)
    pred.get(b)!.push(a)
  }
  for (const [a, b] of edges) add(a, b)

  // Back in time: a wire from a later node to an earlier one.
  const back = new Set<string>()
  const t = opts.time
  if (t) for (const a of ids) for (const b of succ.get(a)!) if (t.has(a) && t.has(b) && t.get(a)! > t.get(b)!) back.add(`${a}>${b}`)
  // Loops the times do not settle (nodes without a time): drop the edges that close a cycle, depth-first
  // from the earliest starts.
  const byTime = (x: string, y: string) => (t?.get(x) ?? Infinity) - (t?.get(y) ?? Infinity)
  const starts = ids.filter((id) => pred.get(id)!.every((p) => back.has(`${p}>${id}`)))
  const state = new Map<string, 1 | 2>() // 1 = on the stack, 2 = done
  const visit = (id: string) => {
    state.set(id, 1)
    for (const s of succ.get(id)!) {
      if (back.has(`${id}>${s}`)) continue
      if (state.get(s) === 1) back.add(`${id}>${s}`)
      else if (!state.has(s)) visit(s)
    }
    state.set(id, 2)
  }
  for (const id of [...[...starts].sort(byTime), ...ids]) if (!state.has(id)) visit(id)

  // Every wire back becomes a later occurrence of its target, right after its source.
  const againId = opts.againId ?? againIdOf
  const again: Again[] = []
  const retarget = new Map<string, string>()
  const count = new Map<string, number>()
  for (const a of [...ids]) {
    for (const b of [...succ.get(a)!]) {
      if (!back.has(`${a}>${b}`)) continue
      const n = count.get(b) ?? 0
      count.set(b, n + 1)
      const id = againId(b, n)
      const band = bandOf.get(a)!
      again.push({ id, of: b, after: a, band })
      retarget.set(`${a}>${b}`, id)
      ids.push(id)
      known.add(id)
      bandOf.set(id, band)
      succ.set(id, [])
      pred.set(id, [])
      add(a, id)
    }
  }
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
  const causal = new Set<string>()
  for (const [a, list] of succ) for (const b of list) causal.add(`${a}>${b}`)
  const events = timeline.filter((e) => known.has(e))
  for (let i = 1; i < events.length; i++) {
    const [a, b] = [events[i - 1], events[i]]
    if (siblings(a, b) || reaches(b, a)) continue
    add(a, b)
  }

  // As early as possible (longest path). Events stay there — they are the timeline; a command, system,
  // policy or read model then slides right up to just before what it causes, so it sits next to its event
  // instead of far away on the left.
  const order = topo(ids, succ, forward)
  const rank = new Map<string, number>()
  for (const id of order) rank.set(id, Math.max(0, ...pred.get(id)!.filter((p) => forward(p, id)).map((p) => rank.get(p)! + 1)))
  for (const id of [...order].reverse()) {
    if (isEvent.has(id)) continue
    const next = succ.get(id)!.filter((s) => forward(id, s)).map((s) => rank.get(s)!)
    if (next.length) rank.set(id, Math.max(rank.get(id)!, Math.min(...next) - 1))
  }

  // How far right a node's chain runs: the path that goes on is the happy path.
  const reach = new Map<string, number>()
  for (const id of [...order].reverse()) reach.set(id, Math.max(rank.get(id)!, ...succ.get(id)!.filter((s) => forward(id, s)).map((s) => reach.get(s) ?? rank.get(s)!)))

  // Rows: follow each chain from its start; a node keeps its parent's row when that cell is free. The
  // successor whose chain runs on furthest goes first, so the timeline and a command's first outcome stay on
  // one row, and branches — another outcome, a retry that ends in a repeated sticky, a separate flow coming
  // in — drop below it. A read model in the middle of a sequence is just another step on the row.
  // An event that follows another only in the file, while its cause is another branch of the same fork
  // (variant B after variant A, both from one event), is placed from its own branch, not on the row of the
  // event before it.
  const ancestors = new Map<string, Set<string>>()
  const ancestorsOf = (id: string): Set<string> => {
    const hit = ancestors.get(id)
    if (hit) return hit
    const out = new Set<string>()
    ancestors.set(id, out)
    for (const p of pred.get(id)!) {
      if (!causal.has(`${p}>${id}`) || !forward(p, id)) continue
      out.add(p)
      for (const x of ancestorsOf(p)) out.add(x)
    }
    return out
  }
  const branchOfFork = (a: string, s: string) => {
    if (causal.has(`${a}>${s}`)) return false
    const mine = new Set([a, ...ancestorsOf(a)])
    return pred.get(s)!.some((p) => causal.has(`${p}>${s}`) && forward(p, s) && !row.has(p) && [p, ...ancestorsOf(p)].some((x) => mine.has(x)))
  }
  const taken = new Set<string>()
  const row = new Map<string, number>()
  const place = (id: string, want: number) => {
    if (row.has(id)) return
    let r = want
    while (taken.has(`${bandOf.get(id)}|${rank.get(id)}|${r}`)) r++
    row.set(id, r)
    taken.add(`${bandOf.get(id)}|${rank.get(id)}|${r}`)
    const next = succ.get(id)!.filter((s) => forward(id, s) && !branchOfFork(id, s))
    const pos = new Map(next.map((s, i) => [s, i]))
    next.sort((x, y) => reach.get(y)! - reach.get(x)! || pos.get(x)! - pos.get(y)!)
    for (const s of next) place(s, r)
  }
  for (const id of order) if (pred.get(id)!.every((p) => !forward(p, id))) place(id, 0)
  for (const id of ids) place(id, 0)
  return { rank, row, again, retarget }
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
