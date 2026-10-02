// Replaying a domain story (docs/diagrams.md §6b "Replay"), the pure half: which items of a domain-story
// frame are told, current or not yet told at step k. Egon.io (github.com/WPS/egon.io, tools/replay) works
// the same way: one step per sequence number — activities that share a number (parallel activities) are one
// step — each step shows its actors, activity arrows and work objects, everything told earlier stays, and
// everything later is hidden. Pure: a board and a frame in, the steps out; the web only applies them.
//
// What appears when:
// - an activity arrow (role `activity`, `data.seq`) and the pictograms at its ends: at the step of its number;
// - the onward arrow (`activity-to`) and the receiving actor: with its work object;
// - an annotation and its dashed link: with what it explains (Egon shows an actor's annotation with the actor);
// - a group outline: when its first member appears (Egon hides groups unless "show groups" is on, and then
//   shows them all from the start — the first-member rule is ours, so an outline never surrounds nothing);
// - a comment about a story item: with that item;
// - an actor in no sentence: not during the replay (Egon hides it too); the legend, the scope line and
//   anything else in the frame that is not part of the story: always.
import type { Board, Item } from '../../../src/model'

export type ReplayStatus = 'current' | 'told' | 'untold'

export interface ReplayStep {
  /** the sequence number this step tells */
  seq: number
  /** the sentences of the step, read out ("③ Clerk enters policy into Policy system"), one per sentence */
  sentences: string[]
  /** items that are current at this step: its arrows, work objects and the actors that take part */
  current: string[]
  /** the current step's pictograms (no arrows) — what the view follows */
  focus: string[]
}

export interface ReplayModel {
  frameId: string
  steps: ReplayStep[]
  /** story item id → the step (1-based) it first appears at; Infinity = not shown during the replay */
  appear: Map<string, number>
}

const isDs = (it: Item | undefined) => Boolean(it?.data?.ds) && !String(it?.data?.ds).startsWith('legend-')

function inside(board: Board, it: Item, frameId: string): boolean {
  let p = it.parent
  const seen = new Set<string>()
  while (p && !seen.has(p)) {
    if (p === frameId) return true
    seen.add(p)
    p = board.items[p]?.parent
  }
  return false
}

/** True when the frame holds a domain story that can be replayed (at least one numbered activity). */
export function canReplay(board: Board, frameId: string): boolean {
  return buildReplay(board, frameId).steps.length > 0
}

/** The steps of the domain story in frame `frameId`. */
export function buildReplay(board: Board, frameId: string): ReplayModel {
  const byId = board.items
  const all = Object.values(byId)
  const members = all.filter((it) => it.type !== 'arrow' && it.type !== 'comment' && inside(board, it, frameId))
  const memberIds = new Set(members.map((m) => m.id))
  const arrows = all.filter((it) => it.type === 'arrow' && it.from && it.to && memberIds.has(it.from) && memberIds.has(it.to))
  const activities = arrows.filter((a) => a.role === 'activity' && typeof a.data?.seq === 'number' && isDs(a))
  const seqs = [...new Set(activities.map((a) => a.data!.seq as number))].sort((a, b) => a - b)
  const stepOf = new Map(seqs.map((s, i) => [s, i + 1]))

  const appear = new Map<string, number>()
  const current = seqs.map(() => new Set<string>())
  const sentences = seqs.map(() => [] as string[])
  const show = (id: string | undefined, step: number) => {
    if (!id) return
    appear.set(id, Math.min(appear.get(id) ?? Infinity, step))
  }
  const mark = (id: string | undefined, step: number) => {
    if (!id || !Number.isFinite(step)) return
    show(id, step)
    current[step - 1].add(id)
  }

  // every story item starts as not shown; the rules below bring it in
  for (const it of [...members, ...arrows]) if (isDs(it)) appear.set(it.id, Infinity)

  for (const a of activities) {
    const step = stepOf.get(a.data!.seq as number)!
    mark(a.id, step)
    mark(a.from, step)
    mark(a.to, step)
    const said = typeof a.data?.sentence === 'string' ? a.data.sentence : undefined
    if (said && !sentences[step - 1].includes(said)) sentences[step - 1].push(said)
  }
  // a work object with a number but no arrow into it (should not happen) still appears at its number
  for (const o of members) if (o.data?.ds === 'object' && typeof o.data.seq === 'number' && stepOf.has(o.data.seq) && appear.get(o.id) === Infinity) mark(o.id, stepOf.get(o.data.seq)!)
  for (const t of arrows) {
    if (t.role !== 'activity-to' || !isDs(t)) continue
    const step = appear.get(t.from!) ?? Infinity
    mark(t.id, step)
    mark(t.to, step)
  }

  // annotations: with what they explain (their dashed link points from the note to it)
  for (const l of arrows) {
    if (l.role !== 'annotation-link') continue
    const step = appear.get(l.to!) ?? Infinity
    show(l.from, step)
    show(l.id, step)
  }
  // groups: when their first member appears
  for (const g of members) {
    if (g.data?.ds !== 'group') continue
    const wanted = Array.isArray(g.data.members) ? (g.data.members as unknown[]).map(String) : []
    const hits = [...members, ...arrows].filter((it) => it.id !== g.id && wanted.some((m) => it.data?.element === m || it.data?.workObject === m))
    appear.set(g.id, Math.min(Infinity, ...hits.map((h) => appear.get(h.id) ?? Infinity)))
  }
  // comments about a story item: with the item (a reply follows its thread's first comment)
  const rootTarget = (c: Item): string | undefined => {
    let cur: Item | undefined = c
    const seen = new Set<string>()
    while (cur?.type === 'comment' && !seen.has(cur.id)) {
      seen.add(cur.id)
      const next: Item | undefined = cur.target ? byId[cur.target] : undefined
      if (next?.type !== 'comment') return cur.target
      cur = next
    }
    return undefined
  }
  for (const c of all) {
    if (c.type !== 'comment') continue
    const t = rootTarget(c)
    if (t && appear.has(t)) appear.set(c.id, appear.get(t)!)
  }

  const steps: ReplayStep[] = seqs.map((seq, i) => ({
    seq,
    sentences: sentences[i],
    current: [...current[i]],
    focus: [...current[i]].filter((id) => byId[id]?.type !== 'arrow'),
  }))
  return { frameId, steps, appear }
}

/** The status of an item at step `k` (1-based); undefined for an item the replay leaves alone. */
export function statusAt(model: ReplayModel, k: number, id: string): ReplayStatus | undefined {
  const at = model.appear.get(id)
  if (at === undefined) return undefined
  if (at > k) return 'untold'
  return model.steps[k - 1]?.current.includes(id) ? 'current' : 'told'
}

/** Every story item's status at step `k` — what the board applies. */
export function statusesAt(model: ReplayModel, k: number): Map<string, ReplayStatus> {
  const out = new Map<string, ReplayStatus>()
  const cur = new Set(model.steps[k - 1]?.current ?? [])
  for (const [id, at] of model.appear) out.set(id, at > k ? 'untold' : cur.has(id) ? 'current' : 'told')
  return out
}

/** Keep a step inside 1…N (a redraw can shorten the story while it plays). */
export function clampStep(model: ReplayModel, k: number): number {
  return Math.max(1, Math.min(model.steps.length, Math.round(k) || 1))
}
