// Handing a board's files over to another agent (docs/canvas.md "Several agents on one board"): the person starts
// it, per diagram; the agent holding them confirms its files are current ("ready"), the other agent accepts, and
// from then on that agent holds them (applies proposals, redraws) while the old holder proposes. The board carries
// the open handover in `meta.handover`; after it each diagram's holder records `from` and `handover`.
// Pure (no React, no fetch): what the dialog lists, what it pre-selects, which agent it suggests, and how the open
// handover reads in the panel — so the rules can be tested.
import { diagramSpecOf, type Board } from '../../../src/model'
import { displayName, holdersOf, LOCAL_AGENT, sameAgent, type FileHolder } from '../../../src/routing'
import { KIND_NAMES } from '../diagrams/frame'
import { timeAgo } from '../time'

/** One diagram's part of the handover: who holds it now (`from`) and, once it confirmed, what it confirmed. */
export interface HandoverKey {
  key: string
  from: string
  source?: string
  title?: string
  /** the old holder confirmed its files are current (`forced`: the person handed it over without that) */
  ready?: { by: string; at: string; files: Record<string, string>; forced?: true }
}

/** `meta.handover`: open from the person's Start until the new holder accepts or someone cancels it. */
export interface Handover {
  id: string
  /** the agent taking the files */
  to: string
  /** it also becomes "Answered by" */
  answeredBy: boolean
  /** the thread the handover is discussed in (its root carries `data.handover`) */
  thread: string
  by: string
  at: string
  keys: HandoverKey[]
}

/** A holder after a handover: the agent it came from and the thread (not in routing.ts's FileHolder yet). */
export type HandedHolder = FileHolder & { from?: string; handover?: string }

/** An agent as GET /settings lists it (components/BoardAgents.tsx AgentRow). */
export interface AgentLike {
  name: string
  handle?: string
  watching: boolean
  seen?: string
  holder?: boolean
}

/** An agent that has not waited on the board for this long is away. */
export const AWAY_MS = 60_000

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** The open handover on a board, or undefined (a malformed one is ignored, like a malformed responder). */
export function handoverOf(meta: Record<string, unknown> | undefined): Handover | undefined {
  const h = meta?.handover as Record<string, unknown> | undefined
  if (!h || typeof h !== 'object') return undefined
  const id = str(h.id)
  const to = str(h.to)
  if (!id || !to || !Array.isArray(h.keys)) return undefined
  const keys: HandoverKey[] = []
  for (const raw of h.keys as unknown[]) {
    const k = raw as Record<string, unknown> | undefined
    const key = str(k?.key)
    const from = str(k?.from)
    if (!k || !key || !from) continue
    const out: HandoverKey = { key, from }
    if (str(k.source)) out.source = k.source as string
    if (str(k.title)) out.title = k.title as string
    const r = k.ready as Record<string, unknown> | undefined
    if (r && typeof r === 'object') {
      const files = r.files && typeof r.files === 'object' ? Object.fromEntries(Object.entries(r.files as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {}
      out.ready = { by: str(r.by) ?? from, at: str(r.at) ?? '', files, ...(r.forced === true ? { forced: true as const } : {}) }
    }
    keys.push(out)
  }
  if (!keys.length) return undefined
  return { id, to, answeredBy: h.answeredBy === true, thread: str(h.thread) ?? '', by: str(h.by) ?? '', at: str(h.at) ?? '', keys }
}

/** What re-reads the panel's board meta when it changes (components/SidePanel.tsx → useFreshMeta). */
export function handoverStamp(meta: Record<string, unknown> | undefined): string {
  return JSON.stringify([meta?.handover ?? null, meta?.responder ?? null])
}

/** A diagram whose files an agent holds: what the dialog lists. `key` is 'workflow' for `meta.workflow`. */
export interface HeldDiagram {
  key: string
  kind: string
  /** "Domain story", "Story map", … */
  kindName: string
  title: string
  source?: string
  holder: HandedHolder
  frameId?: string
}

const firstLine = (t: string | undefined) => (t ?? '').split('\n').map((l) => l.trim()).find(Boolean)

/** Every diagram on the board with a holder, with its frame's title and kind (in the order of `meta.diagrams`). */
export function heldDiagrams(board: Pick<Board, 'items' | 'meta' | 'title'>): HeldDiagram[] {
  const frames = new Map<string, { id: string; kind: string; text?: string }>()
  for (const it of Object.values(board.items)) {
    const spec = diagramSpecOf(it)
    if (spec && !frames.has(spec.key)) frames.set(spec.key, { id: it.id, kind: spec.kind, text: it.text })
  }
  const metaKind = (key: string) => str((board.meta?.diagrams as Record<string, { kind?: unknown }> | undefined)?.[key]?.kind)
  return holdersOf(board.meta).map(({ key, source, holder }) => {
    if (key === 'workflow') return { key, kind: 'workflow', kindName: KIND_NAMES.workflow, title: str(board.title) ?? 'Workflow', ...(source ? { source } : {}), holder }
    const f = frames.get(key)
    const kind = f?.kind ?? metaKind(key) ?? ''
    return { key, kind, kindName: KIND_NAMES[kind] ?? kind, title: firstLine(f?.text) ?? key, ...(source ? { source } : {}), holder, ...(f ? { frameId: f.id } : {}) }
  })
}

/** Is this agent waiting on the board now, or did it in the last minute? */
export function isAgentHere(a: AgentLike | undefined, now = Date.now()): boolean {
  if (!a) return false
  if (a.watching) return true
  const at = a.seen ? Date.parse(a.seen) : NaN
  return Number.isFinite(at) && now - at < AWAY_MS
}

/** "here", "away · seen 12 min ago", "away". */
export function presenceText(a: AgentLike | undefined, now = Date.now()): string {
  if (isAgentHere(a, now)) return 'here'
  const seen = a?.seen ? timeAgo(a.seen) : ''
  return seen ? `away · seen ${seen}` : 'away'
}

const holds = (d: HeldDiagram, agent: string) => sameAgent(d.holder.agent, agent)

/** The diagrams `to` would take: those it does not hold already. */
export function takeable(held: HeldDiagram[], to: string | undefined): HeldDiagram[] {
  return to ? held.filter((d) => !holds(d, to)) : []
}

/** Who the files can go to: every agent with something to take — named agents first, the local default (studio) last. */
export function targetsOf<A extends AgentLike>(held: HeldDiagram[], agents: A[]): A[] {
  const seen = new Set<string>()
  const out = agents.filter((a) => {
    const k = a.name.toLowerCase()
    if (seen.has(k) || !takeable(held, a.name).length) return false
    seen.add(k)
    return true
  })
  return [...out.filter((a) => !sameAgent(a.name, LOCAL_AGENT)), ...out.filter((a) => sameAgent(a.name, LOCAL_AGENT))]
}

/** "Hand over files…" is offered when some diagram has a holder and another agent could take it. */
export function canHandOver(held: HeldDiagram[], agents: AgentLike[]): boolean {
  return targetsOf(held, agents).length > 0
}

/**
 * The agent the dialog suggests: the board's responder when it has something to take (it is not the only holder),
 * else the first agent that holds nothing, else the first that could take something.
 */
export function defaultTarget(held: HeldDiagram[], agents: AgentLike[], responder?: string): string | undefined {
  const targets = targetsOf(held, agents)
  const r = responder ? targets.find((a) => sameAgent(a.name, responder)) : undefined
  if (r) return r.name
  return (targets.find((a) => !held.some((d) => holds(d, a.name))) ?? targets[0])?.name
}

/** The rows the person unchecked to start with: none (every diagram is selected), or all but `only` (a frame's "Hand over…"). */
export function initialUnchecked(held: HeldDiagram[], only?: string): Set<string> {
  return new Set(only ? held.filter((d) => d.key !== only).map((d) => d.key) : [])
}

/** The keys the dialog would send: every row `to` can take that the person did not uncheck. */
export function checkedKeys(held: HeldDiagram[], to: string | undefined, unchecked: ReadonlySet<string>): string[] {
  return takeable(held, to).filter((d) => !unchecked.has(d.key)).map((d) => d.key)
}

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)
const uniq = (names: string[]) => names.filter((n, i) => names.findIndex((m) => sameAgent(m, n)) === i)

/** What Start will do, in one plain sentence (plus one when the new holder also answers the board). */
export function planSentence(rows: HeldDiagram[], to: string | undefined, answeredBy: boolean): string {
  if (!to || !rows.length) return ''
  const from = uniq(rows.map((d) => d.holder.agent)).map(displayName)
  const t = displayName(to)
  const first = `${list(from)} ${from.length === 1 ? 'confirms its' : 'confirm their'} files are current, then ${t} takes them; until then nothing changes.`
  return answeredBy ? `${first} After that ${t} also answers your comments on this board.` : first
}

/** The request bodies (POST /api/boards/:id/handover, …/ready, …/cancel): always as the person. */
export const startBody = (to: string, keys: string[], answeredBy: boolean) => ({ to, keys, answeredBy, author: 'user' as const })
export const forceBody = (keys: string[]) => ({ force: true as const, keys, author: 'user' as const })
export const cancelBody = () => ({ author: 'user' as const })

export type KeyState = 'waiting' | 'ready' | 'forced'

/** How one diagram of the open handover stands. */
export interface StatusRow {
  key: string
  title: string
  kindName?: string
  from: string
  state: KeyState
  /** "waiting for agent-a to confirm", "ready", "ready (without agent-a's confirmation)" */
  text: string
  /** "agent-a confirmed 2 files 3 min ago" (a tooltip) */
  detail?: string
}

export function keyState(k: HandoverKey): KeyState {
  return !k.ready ? 'waiting' : k.ready.forced ? 'forced' : 'ready'
}

export function keyText(k: HandoverKey): string {
  const from = displayName(k.from)
  const s = keyState(k)
  return s === 'waiting' ? `waiting for ${from} to confirm` : s === 'forced' ? `ready (without ${from}'s confirmation)` : 'ready'
}

/** Per diagram of the open handover: its title (the handover's, else the frame's, else the key) and where it stands. */
export function statusRows(h: Handover, board: Pick<Board, 'items' | 'meta' | 'title'>): StatusRow[] {
  const held = new Map(heldDiagrams(board).map((d) => [d.key, d]))
  return h.keys.map((k) => {
    const d = held.get(k.key)
    const state = keyState(k)
    const n = k.ready ? Object.keys(k.ready.files).length : 0
    const detail = state === 'ready' && k.ready ? `${displayName(k.ready.by)} confirmed ${n} file${n === 1 ? '' : 's'}${k.ready.at ? ` ${timeAgo(k.ready.at)}` : ''}` : state === 'forced' && k.ready?.at ? `handed over anyway ${timeAgo(k.ready.at)}` : undefined
    return { key: k.key, title: k.title ?? d?.title ?? k.key, ...(d?.kindName ? { kindName: d.kindName } : {}), from: k.from, state, text: keyText(k), ...(detail ? { detail } : {}) }
  })
}

export const allReady = (h: Handover) => h.keys.every((k) => !!k.ready)

/** The keys still waiting for their holder's confirmation ("Hand over anyway" sends these). */
export const unreadyKeys = (h: Handover) => h.keys.filter((k) => !k.ready).map((k) => k.key)

/** The last step: "waiting for agent-b to accept" (now), or "then waiting for agent-b to accept" (after the confirmations). */
export function acceptLine(h: Handover): string {
  return `${allReady(h) ? '' : 'then '}waiting for ${displayName(h.to)} to accept`
}

/** Everyone the handover waits for: the old holders still to confirm, then the new one. */
export function involvedAgents(h: Handover): string[] {
  return uniq([...h.keys.map((k) => k.from), h.to])
}

/**
 * The question before "Hand over anyway": the new holder takes the files as the board has them, i.e. from each old
 * holder's last draw (the oldest, when it drew several of the diagrams).
 */
export function forceQuestion(h: Handover, board: Pick<Board, 'items' | 'meta' | 'title'>): string {
  const held = new Map(heldDiagrams(board).map((d) => [d.key, d]))
  const byFrom: Array<{ from: string; at?: string }> = []
  for (const k of h.keys) {
    if (k.ready) continue
    const at = held.get(k.key)?.holder.at
    const cur = byFrom.find((x) => sameAgent(x.from, k.from))
    if (!cur) byFrom.push({ from: k.from, ...(at ? { at } : {}) })
    else if (at && (!cur.at || Date.parse(at) < Date.parse(cur.at))) cur.at = at
  }
  const parts = byFrom.map((x) => `${displayName(x.from)}'s last draw${x.at && timeAgo(x.at) ? `, ${timeAgo(x.at)}` : ''}`)
  // the clauses carry commas of their own: "…last draw, 5 h ago, and agent-c's last draw"
  const joined = parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
  return `Use the files as the board has them from ${joined}?`
}

/** One line on a diagram frame's panel while it is part of the open handover. */
export function frameNotice(h: Handover | undefined, key: string): string | undefined {
  const k = h?.keys.find((x) => x.key === key)
  if (!h || !k) return undefined
  return `Handing over to ${displayName(h.to)}: ${keyText(k)}${allReady(h) ? `; waiting for ${displayName(h.to)} to accept` : ''}`
}

/** The holder line's time: "last applied 3 min ago", "handed over 3 min ago" (from another agent), "drawn 3 min ago". */
export function holderWhen(h: HandedHolder): string {
  if (h.appliedAt) return `last applied ${timeAgo(h.appliedAt)}`
  if (h.at && str(h.from)) return `handed over ${timeAgo(h.at)}`
  return h.at ? `drawn ${timeAgo(h.at)}` : ''
}

/** "agent-a", "agent-a and agent-c": who holds these diagrams now. */
export function holderNames(held: HeldDiagram[]): string {
  return list(uniq(held.map((d) => d.holder.agent)).map(displayName))
}
