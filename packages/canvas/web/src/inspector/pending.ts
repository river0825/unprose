// A flow wire on a workflow board is one event subscription (docs/studio.md §7). Editing it
// does not change the file: the wire records what the person meant in `data.pending`, and
// the AI reviews that before touching workflow.yaml. Pure: these build ops and words.
import type { Board, Item, Op } from '../../../src/model'
import { diagramOf } from '../diagrams/frame'

export interface WireEnds { from: string; to: string; event?: string; condition?: string }
export interface WireEvent { event: string; condition?: string; resume?: boolean; from: string; to: string }
export interface Pending {
  kind: 'rewire' | 'add' | 'remove' | 'relabel'
  /** node ids; absent for add */
  before?: WireEnds & { event: string }
  /** absent for remove */
  after?: WireEnds
  by: 'user'
  at: string
}

export const nodeIdOf = (it: Item | undefined): string | undefined => (typeof it?.data?.nodeId === 'string' ? (it.data.nodeId as string) : undefined)
export const eventOf = (it: Item | undefined): WireEvent | undefined => {
  const e = it?.data?.event as WireEvent | undefined
  return e && typeof e.event === 'string' ? e : undefined
}
export const pendingOf = (it: Item | undefined): Pending | undefined => {
  const p = it?.data?.pending as Pending | undefined
  return p && typeof p.kind === 'string' ? p : undefined
}

/** A wire whose edits become proposals: a flow wire between two workflow steps (docs/studio.md §7, docs/diagrams.md §1). */
export function isFlowWire(board: Board, it: Item | undefined): boolean {
  if (it?.type !== 'arrow') return false
  // the wire's diagram is its source's: a workflow frame on any board, or a legacy workflow board
  if (diagramOf(board, it.from ? board.items[it.from] : it)?.kind !== 'workflow') return false
  if (it.role === 'owns' || it.role === 'delegates' || it.role === 'trace') return false
  return it.role === 'flow' || Boolean(eventOf(it)) || Boolean(pendingOf(it))
}

/** The board item that draws workflow node `id` (a step, trigger or `*.failed` node). */
export function itemOfNode(board: Board, id: string): Item | undefined {
  return Object.values(board.items).find((it) => it.type !== 'arrow' && it.type !== 'comment' && nodeIdOf(it) === id)
}

/** `card-info.done if event.data.ok` → { event, condition } */
export function parseLabel(label: string): { event?: string; condition?: string } {
  const m = label.trim().match(/^(\S+)(?:\s+if\s+(.+))?$/)
  return m ? { event: m[1], condition: m[2]?.trim() } : {}
}
export const labelFor = (e: { event?: string; condition?: string }) => [e.event, e.condition ? `if ${e.condition}` : ''].filter(Boolean).join(' ')

/** What the wire says in the file today: its drawn event, or what it said before the pending edit. */
function original(board: Board, it: Item): (WireEnds & { event: string }) | undefined {
  const p = pendingOf(it)
  if (p?.before) return p.before
  if (p?.kind === 'add') return undefined
  const e = eventOf(it)
  const from = e?.from ?? nodeIdOf(board.items[it.from ?? ''])
  const to = e?.to ?? nodeIdOf(board.items[it.to ?? ''])
  const event = e?.event ?? parseLabel(it.label ?? it.text ?? '').event
  if (!from || !to || !event) return undefined
  return { from, to, event, ...(e?.condition ? { condition: e.condition } : {}) }
}

const same = (a: WireEnds | undefined, b: WireEnds | undefined) =>
  Boolean(a && b) && a!.from === b!.from && a!.to === b!.to && (a!.event ?? '') === (b!.event ?? '') && (a!.condition ?? '') === (b!.condition ?? '')

/** `data` without `pending`, with `pending` set when there is one. */
function withPending(it: Item, pending: Pending | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { pending: _old, ...rest } = { ...(it.data ?? {}), ...extra }
  return pending ? { ...rest, pending } : rest
}

/** The ends move on the board; the wire remembers where it was. Back to the original → no longer pending. */
export function rewireOp(board: Board, it: Item, fromItem: string, toItem: string, extra: Record<string, unknown>, now: string): Op | undefined {
  const from = nodeIdOf(board.items[fromItem])
  const to = nodeIdOf(board.items[toItem])
  if (!from || !to) return undefined
  const before = original(board, it)
  const cur = pendingOf(it)
  const after: WireEnds = { from, to, event: cur?.after?.event ?? before?.event, condition: cur?.after?.condition ?? before?.condition }
  const kind: Pending['kind'] = before ? (cur?.kind === 'relabel' && before.from === from && before.to === to ? 'relabel' : 'rewire') : 'add'
  const pending = before && same(before, after) ? undefined : { kind, ...(before ? { before } : {}), after, by: 'user' as const, at: now }
  return { kind: 'update', id: it.id, patch: { from: fromItem, to: toItem, data: withPending(it, pending, extra) } }
}

/** A wire drawn between two steps: it runs on which event? The panel asks (`after.event` starts empty). */
export function addWire(board: Board, fromItem: string, toItem: string, now: string): { data: Record<string, unknown>; role: string } | undefined {
  const from = nodeIdOf(board.items[fromItem])
  const to = nodeIdOf(board.items[toItem])
  if (!from || !to) return undefined
  return { role: 'flow', data: { pending: { kind: 'add', after: { from, to }, by: 'user', at: now } satisfies Pending } }
}

/** Delete does not remove a flow wire: it proposes the removal. A proposed new wire just goes away. */
export function removeOps(board: Board, it: Item, now: string): Op[] {
  const before = original(board, it)
  if (!before) return [{ kind: 'remove', id: it.id }]
  const pending: Pending = { kind: 'remove', before, by: 'user', at: now }
  const back = restoreEnds(board, before)
  return [{ kind: 'update', id: it.id, patch: { ...back, label: labelFor(before), data: withPending(it, pending) } }]
}

/** Editing the label proposes a new event / condition. */
export function relabelOp(board: Board, it: Item, label: string, now: string): Op {
  const before = original(board, it)
  const cur = pendingOf(it)
  const parsed = parseLabel(label)
  const from = cur?.after?.from ?? before?.from ?? nodeIdOf(board.items[it.from ?? ''])!
  const to = cur?.after?.to ?? before?.to ?? nodeIdOf(board.items[it.to ?? ''])!
  const after: WireEnds = { from, to, event: parsed.event, condition: parsed.condition }
  const kind: Pending['kind'] = !before ? 'add' : before.from === from && before.to === to ? 'relabel' : 'rewire'
  const pending = before && same(before, after) ? undefined : { kind, ...(before ? { before } : {}), after, by: 'user' as const, at: now }
  return { kind: 'update', id: it.id, patch: { label, data: withPending(it, pending) } }
}

/** For a proposed new wire: the event the person picked. */
export function pickEventOp(board: Board, it: Item, event: string, now: string): Op | undefined {
  const cur = pendingOf(it)
  if (!cur?.after) return undefined
  return relabelOp(board, it, labelFor({ event, condition: cur.after.condition }), now)
}

function restoreEnds(board: Board, ends: WireEnds): { from?: string; to?: string } {
  const from = itemOfNode(board, ends.from)?.id
  const to = itemOfNode(board, ends.to)?.id
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) }
}

/** Undo the proposal: back to what the file says (a proposed new wire is removed). */
export function undoOps(board: Board, it: Item): Op[] {
  const p = pendingOf(it)
  if (!p) return []
  if (!p.before) return [{ kind: 'remove', id: it.id }]
  return [{ kind: 'update', id: it.id, patch: { ...restoreEnds(board, p.before), label: labelFor(p.before), data: withPending(it, undefined) } }]
}

const q = (s: string | undefined) => (s ? `\`${s}\`` : 'an event not chosen yet')
const cond = (c: string | undefined) => (c ? ` if ${c}` : '')

/** The proposal in words: "plan would run on card-info.done from review instead of card-info". */
export function describePending(p: Pending): string {
  const b = p.before
  const a = p.after
  if (p.kind === 'remove' && b) return `${b.to} would no longer run on ${q(b.event)} from ${b.from}${cond(b.condition)}.`
  if (p.kind === 'add' && a) return `${a.to} would also run on ${q(a.event)} from ${a.from}${cond(a.condition)}.`
  if (!b || !a) return 'Changed on the board.'
  const now = `on ${q(a.event)} from ${a.from}${cond(a.condition)}`
  if (a.to !== b.to) return `${a.to} would run ${now}, instead of ${b.to}.`
  const was: string[] = []
  if (a.from !== b.from) was.push(b.from)
  if ((a.event ?? '') !== b.event) was.push(`on ${q(b.event)}`)
  if ((a.condition ?? '') !== (b.condition ?? '')) was.push(b.condition ? `if ${b.condition}` : 'without a condition')
  return `${a.to} would run ${now}${was.length ? ` instead of ${was.join(', ')}` : ''}.`
}

/** The yaml intent, for the brief and the panel. */
export function yamlIntent(p: Pending): string {
  const b = p.before
  const a = p.after
  const on = (e: WireEnds | undefined) => (e ? `${e.event ?? '<event not chosen>'}${e.condition ? ` (if: ${e.condition})` : ''}` : '')
  if (p.kind === 'remove' && b) return `remove \`${on(b)}\` from \`${b.to}.on\``
  if (p.kind === 'add' && a) return `add \`${on(a)}\` to \`${a.to}.on\``
  if (b && a && a.to !== b.to) return `move \`${on(b)}\` from \`${b.to}.on\` to \`${a.to}.on\`${on(a) !== on(b) ? ` as \`${on(a)}\`` : ''}`
  if (b && a) return `change \`${a.to}.on\` from \`${on(b)}\` to \`${on(a)}\``
  return ''
}
