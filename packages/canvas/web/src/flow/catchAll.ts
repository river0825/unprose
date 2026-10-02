// Catch-all listeners as badges, and which wires a viewer chose to see (docs/canvas.md → "Wires").
// Pure (no React), so the rules can be tested on their own.
import type { Edge } from '@xyflow/react'
import type { Board, Item } from '../../../src/model'

/**
 * Why a workflow wire is a catch-all: it stands for a subscription that listens to (or fans out across)
 * many blocks, so as a line it runs across the whole graph without saying much about the flow.
 * - `wildcard`: its event pattern contains `*` (`*.failed`, `build.*`);
 * - `resume`: a human step's `resume_on` — the trigger wakes a waiting step, it does not start one;
 * - `clock`: its source is a cron trigger (`on: cron`, e.g. `tick`) — a sweep on a timer, not a next step;
 * - `fan-out`: one block sends the same event to FAN or more different blocks;
 * - `fan-in`: one block listens to FAN or more different blocks (a hub such as `park` on every failure).
 * The two hub rules count only the wires the first three left, so a trigger's resume fan-out does not
 * turn its real start wire into a catch-all.
 */
export type CatchAllReason = 'wildcard' | 'resume' | 'clock' | 'fan-out' | 'fan-in'

/** How many different blocks make a fan-out / fan-in a hub. */
export const FAN = 4

type WireEvent = { event: string; condition?: string; resume?: boolean }

/** The `on:` subscription a workflow wire stands for (data.event), if it is one. */
export function eventOf(it: Item | undefined): WireEvent | undefined {
  if (!it || it.type !== 'arrow' || it.role === 'trace' || it.role === 'owns' || it.role === 'delegates') return undefined
  const e = it.data?.event as Partial<WireEvent> | undefined
  return e && typeof e.event === 'string' ? (e as WireEvent) : undefined
}

/** Every catch-all wire on the board, with why. Only workflow wires (arrows carrying `data.event`) can be one. */
export function catchAllWires(board: Board): Map<string, CatchAllReason> {
  const wires = Object.values(board.items).filter((it) => it.from && it.to && board.items[it.from] && board.items[it.to] && eventOf(it))
  const out = new Map<string, CatchAllReason>()
  // first the kinds a wire is by itself
  for (const w of wires) {
    const e = eventOf(w)!
    const src = board.items[w.from!]
    const cfg = src.data?.config as { on?: unknown } | undefined
    const reason: CatchAllReason | undefined = e.event.includes('*') ? 'wildcard' : e.resume ? 'resume' : src.data?.kind === 'trigger' && cfg?.on === 'cron' ? 'clock' : undefined
    if (reason) out.set(w.id, reason)
  }
  // then hubs, counted over the wires that are left (a trigger's resumes do not make its real start wire a fan-out)
  const rest = wires.filter((w) => !out.has(w.id))
  const fanOut = new Map<string, Set<string>>() // source|event → targets
  const fanIn = new Map<string, Set<string>>() // target → sources
  for (const w of rest) {
    const k = `${w.from}|${eventOf(w)!.event}`
    if (!fanOut.has(k)) fanOut.set(k, new Set())
    fanOut.get(k)!.add(w.to!)
    if (!fanIn.has(w.to!)) fanIn.set(w.to!, new Set())
    fanIn.get(w.to!)!.add(w.from!)
  }
  for (const w of rest) {
    if (fanOut.get(`${w.from}|${eventOf(w)!.event}`)!.size >= FAN) out.set(w.id, 'fan-out')
    else if (fanIn.get(w.to!)!.size >= FAN) out.set(w.id, 'fan-in')
  }
  return out
}

/** A badge on a block standing for collapsed wires: `in` on the listener, `out` on the block that emits. */
export interface WireBadge {
  key: string
  end: 'in' | 'out'
  text: string
  title: string
  wires: string[]
  /** every wire it stands for is drawn again (the badge was clicked) */
  open: boolean
}

const nameOf = (it: Item | undefined) => String(it?.data?.nodeId ?? it?.text?.split('\n')[0] ?? it?.id ?? '?')
const WHY: Record<CatchAllReason, string> = {
  wildcard: 'a wildcard listener',
  resume: 'resumes a waiting human step',
  clock: 'on a timer',
  'fan-out': `one event to ${FAN}+ blocks`,
  'fan-in': `listens to ${FAN}+ blocks`,
}

/** The badges each block shows for its catch-all wires (block id → badges, `in` first). */
export function wireBadges(board: Board, catchAll: Map<string, CatchAllReason>, expanded: Set<string>): Map<string, WireBadge[]> {
  const ins = new Map<string, Map<string, { text: string; wires: Item[] }>>()
  const outs = new Map<string, Item[]>()
  for (const [id, reason] of catchAll) {
    const w = board.items[id]
    const e = eventOf(w)
    if (!w || !e) continue
    // a hub collects many events: one badge for all of them; otherwise one per subscription name
    const text = reason === 'fan-in' ? 'hub' : e.resume ? `resume: ${e.event}` : `on ${e.event}`
    const byText = ins.get(w.to!) ?? new Map()
    ins.set(w.to!, byText)
    const g = byText.get(text) ?? { text, wires: [] }
    g.wires.push(w)
    byText.set(text, g)
    outs.set(w.from!, [...(outs.get(w.from!) ?? []), w])
  }
  const open = (ws: Item[]) => ws.every((w) => expanded.has(w.id))
  const line = (w: Item, dir: 'from' | 'to') => {
    const e = eventOf(w)!
    const name = e.resume ? `resume: ${e.event}` : e.event
    return `${name}${e.condition ? ` if ${e.condition}` : ''} ${dir === 'from' ? '←' : '→'} ${nameOf(board.items[dir === 'from' ? w.from! : w.to!])} (${WHY[catchAll.get(w.id)!]})`
  }
  const out = new Map<string, WireBadge[]>()
  const add = (id: string, b: WireBadge) => out.set(id, [...(out.get(id) ?? []), b])
  for (const [to, byText] of ins) {
    for (const g of byText.values()) {
      const events = new Set(g.wires.map((w) => eventOf(w)!.event))
      const text = g.text === 'hub' ? `on ${events.size} event${events.size === 1 ? '' : 's'} · ${new Set(g.wires.map((w) => w.from)).size} blocks` : g.text
      add(to, { key: `in:${to}:${g.text}`, end: 'in', text, title: g.wires.map((w) => line(w, 'from')).join('\n'), wires: g.wires.map((w) => w.id), open: open(g.wires) })
    }
  }
  for (const [from, ws] of outs) {
    const events = [...new Set(ws.map((w) => eventOf(w)!.event))]
    const targets = [...new Set(ws.map((w) => w.to!))]
    const where = targets.length === 1 ? nameOf(board.items[targets[0]]) : `${targets.length} blocks`
    const what = events.length === 1 ? events[0] : `${events.length} events`
    add(from, { key: `out:${from}`, end: 'out', text: `${what} → ${where}`, title: ws.map((w) => line(w, 'to')).join('\n'), wires: ws.map((w) => w.id), open: open(ws) })
  }
  return out
}

/** Which wires are drawn: every one, only those touching the selection, or none. */
export type WireMode = 'all' | 'selected' | 'none'
export const WIRE_MODES: WireMode[] = ['all', 'selected', 'none']

/** Items whose selection does not pick wires (as for focus): containers and comments. */
const NO_PICK = new Set<Item['type']>(['frame', 'lane', 'comment'])

/**
 * Apply the viewer's wire mode: in `selected` only wires touching a selected block are drawn, in `none`
 * no wire is; a wire that is itself selected (e.g. picked in the Inspector's Wiring list) is always drawn.
 * Comment tethers are not wires and stay. Returns the same array when nothing changes.
 */
export function applyWireMode(edges: Edge[], mode: WireMode, selected: string[], board: Board): Edge[] {
  const picked = new Set(selected.filter((id) => board.items[id] && !NO_PICK.has(board.items[id].type)))
  let changed = false
  const out = edges.map((e) => {
    if (e.type !== 'item') return e
    const show = e.selected || (!e.hidden && (mode === 'all' || (mode === 'selected' && (picked.has(e.source) || picked.has(e.target)))))
    if (show === !e.hidden) return e
    changed = true
    return { ...e, hidden: !show }
  })
  return changed ? out : edges
}
