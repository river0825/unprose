// A small layered (Sugiyama-style) layout for directed graphs drawn left → right — the workflow board.
//
//   1. break cycles: a depth-first walk from the sources marks the edges that close a loop
//      (a fix round back to build, a bounce back from review) as back edges;
//   2. layer: sources in layer 0, every other node one past its furthest forward predecessor —
//      back edges are ignored, so a loop no longer pushes its nodes to the far right;
//   3. order each layer to cut crossings: barycenter sweeps over the layers, with a placeholder
//      ("dummy") in every layer a long edge passes, so long edges get a free lane;
//   4. place vertically: each node moves towards the median of its neighbours, a long edge's
//      placeholders stay on its source's row, and nothing overlaps.
//
// Deterministic (no randomness, ties keep declaration order) so a redraw lands in the same place.

export interface LayeredNode {
  id: string
  /** Pinned to layer 0 (a trigger). */
  source?: boolean
  h: number
}
export interface LayeredEdge {
  from: string
  to: string
}
export interface LayeredResult {
  layer: Map<string, number>
  /** Top of each node, from 0 down. */
  y: Map<string, number>
  /** Per input edge: true when it closes a loop (drawn back, not forward). */
  back: boolean[]
}

interface Slot {
  id: string
  h: number
  dummy: boolean
}

export function layered(nodes: LayeredNode[], edges: LayeredEdge[], opts: { gap?: number; laneH?: number; sweeps?: number } = {}): LayeredResult {
  const gap = opts.gap ?? 40
  const laneH = opts.laneH ?? 20
  const known = new Map(nodes.map((n) => [n.id, n]))
  const valid = edges.map((e) => known.has(e.from) && known.has(e.to))

  // 1. back edges by DFS from the sources, then from whatever is left, in declaration order
  const out = new Map<string, number[]>(nodes.map((n) => [n.id, []]))
  edges.forEach((e, i) => valid[i] && out.get(e.from)!.push(i))
  const back = edges.map((e, i) => valid[i] && e.from === e.to)
  const state = new Map<string, 0 | 1 | 2>()
  const roots = [...nodes.filter((n) => n.source), ...nodes.filter((n) => !n.source)]
  for (const r of roots) {
    if (state.get(r.id)) continue
    const stack: Array<{ id: string; next: number }> = [{ id: r.id, next: 0 }]
    state.set(r.id, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]
      const outs = out.get(top.id)!
      if (top.next >= outs.length) {
        state.set(top.id, 2)
        stack.pop()
        continue
      }
      const ei = outs[top.next++]
      const to = edges[ei].to
      const s = state.get(to) ?? 0
      if (s === 1) back[ei] = true
      else if (s === 0) {
        state.set(to, 1)
        stack.push({ id: to, next: 0 })
      }
    }
  }
  const forward = edges.map((e, i) => (valid[i] && !back[i] && e.from !== e.to ? e : undefined))

  // 2. longest path from the sources over forward edges (Kahn order)
  const preds = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  const succs = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const e of forward) if (e) (preds.get(e.to)!.push(e.from), succs.get(e.from)!.push(e.to))
  const indeg = new Map(nodes.map((n) => [n.id, preds.get(n.id)!.length]))
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  const layer = new Map<string, number>()
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]
    const ps = preds.get(id)!
    layer.set(id, known.get(id)!.source ? 0 : ps.length ? Math.max(...ps.map((p) => layer.get(p)!)) + 1 : 1)
    for (const s of succs.get(id)!) {
      indeg.set(s, indeg.get(s)! - 1)
      if (indeg.get(s) === 0) queue.push(s)
    }
  }
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, 1) // unreachable in a DAG; defensive

  // 3. layers of slots: real nodes plus a placeholder per layer a long forward edge crosses
  const depth = Math.max(0, ...layer.values())
  const layers: Slot[][] = Array.from({ length: depth + 1 }, () => [])
  const slotUp = new Map<string, string[]>() // slot → neighbours in the layer before
  const slotDown = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    if (!slotDown.has(a)) slotDown.set(a, [])
    if (!slotUp.has(b)) slotUp.set(b, [])
    slotDown.get(a)!.push(b)
    slotUp.get(b)!.push(a)
  }
  for (const n of nodes) layers[layer.get(n.id)!].push({ id: n.id, h: n.h, dummy: false })
  forward.forEach((e, i) => {
    if (!e) return
    let prev = e.from
    for (let l = layer.get(e.from)! + 1; l < layer.get(e.to)!; l++) {
      const id = `\u0000${i}:${l}`
      layers[l].push({ id, h: laneH, dummy: true })
      link(prev, id)
      prev = id
    }
    link(prev, e.to)
  })

  const pos = new Map<string, number>()
  const index = () => layers.forEach((ls) => ls.forEach((s, i) => pos.set(s.id, i)))
  index()
  const crossings = () => {
    let c = 0
    for (let l = 0; l < layers.length - 1; l++) {
      const segs: Array<[number, number]> = []
      for (const s of layers[l]) for (const d of slotDown.get(s.id) ?? []) segs.push([pos.get(s.id)!, pos.get(d)!])
      for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) c++
    }
    return c
  }
  const sortBy = (ls: Slot[], nb: Map<string, string[]>) => {
    const bary = new Map(ls.map((s) => {
      const ns = nb.get(s.id) ?? []
      return [s.id, ns.length ? ns.reduce((a, n) => a + pos.get(n)!, 0) / ns.length : pos.get(s.id)!] as const
    }))
    ls.sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || pos.get(a.id)! - pos.get(b.id)!)
    ls.forEach((s, i) => pos.set(s.id, i))
  }
  let best = layers.map((ls) => [...ls])
  let bestC = crossings()
  for (let it = 0; it < (opts.sweeps ?? 12) && bestC > 0; it++) {
    if (it % 2 === 0) for (let l = 1; l < layers.length; l++) sortBy(layers[l], slotUp)
    else for (let l = layers.length - 2; l >= 0; l--) sortBy(layers[l], slotDown)
    const c = crossings()
    if (c < bestC) ((bestC = c), (best = layers.map((ls) => [...ls])))
  }
  best.forEach((ls, l) => (layers[l] = ls))
  index()

  // 4. vertical placement: pull towards neighbours' centres, keep order, never overlap
  const y = new Map<string, number>()
  for (const ls of layers) {
    let at = 0
    for (const s of ls) ((y.set(s.id, at), (at += s.h + gap)))
  }
  const centre = (id: string, h: number) => y.get(id)! + h / 2
  const hOf = new Map(layers.flat().map((s) => [s.id, s.h]))
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  }
  const place = (ls: Slot[], nb: Map<string, string[]>) => {
    const want = ls.map((s) => {
      // a placeholder follows its edge straight on; a node follows the median of its neighbours
      const ns = nb.get(s.id) ?? []
      return ns.length ? median(ns.map((n) => centre(n, hOf.get(n)!))) - s.h / 2 : y.get(s.id)!
    })
    const ys = [...want]
    for (let i = 1; i < ls.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + ls[i - 1].h + gap)
    for (let i = ls.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - ls[i].h - gap)
    ls.forEach((s, i) => y.set(s.id, ys[i]))
  }
  for (let it = 0; it < 6; it++) {
    for (let l = 1; l < layers.length; l++) place(layers[l], slotUp)
    for (let l = layers.length - 2; l >= 0; l--) place(layers[l], slotDown)
  }
  for (let l = 1; l < layers.length; l++) place(layers[l], slotUp)

  const top = Math.min(...nodes.map((n) => y.get(n.id)!))
  const out2 = new Map<string, number>()
  for (const n of nodes) out2.set(n.id, Math.round((y.get(n.id)! - top) / 10) * 10)
  return { layer, y: out2, back }
}
