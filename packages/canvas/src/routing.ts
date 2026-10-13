// Several agents on one board (docs/canvas.md "Several agents on one board"): who answers the board, who a
// comment is for (@mentions), what the board is about (its context note) and who holds the files behind each
// diagram. Pure and dependency-free (model.ts, and the annotation / TODO marks of annotations.ts), so the server, the
// MCP tools and the web UI share it.
//
// Names: an agent is known by its name — a token's / OAuth client's name, or UNPROSE_AGENT_NAME for a local
// agent. The default local agent (studio, or a local session without a name) is `agent`; people write it as
// `@studio`.
import { annotationOf, isAnnotationDraft, todoOf } from './annotations.js'
import { diagramFrameId, diagramOf, diagramSpecOf, type Board, type Change, type Item, type Op } from './model.js'

/** The default local agent: studio, or a local session without UNPROSE_AGENT_NAME. */
export const LOCAL_AGENT = 'agent'

/** Who answers the person's comments on a board (`meta.responder`). Absent = as before: studio and any agent. */
export interface Responder {
  mode: 'any' | 'studio' | 'agent'
  /** mode 'agent': the agent's name */
  agent?: string
  /** who set it, and when */
  by?: string
  at?: string
}

/** A short note on what the board is about (`meta.context`), shown at the top of the board and given to every agent. */
export interface BoardContext {
  text: string
  by?: string
  at?: string
}

/**
 * Who holds the files behind a diagram (`meta.diagrams[key].holder`, `meta.workflow.holder`): recorded when an agent
 * draws it from files. `agent` and `at` are stamped by the canvas from the caller's credentials; `machine` and
 * `root` are this machine's paths and are left out for viewers elsewhere.
 */
export interface FileHolder {
  agent: string
  machine?: string
  root?: string
  /** the repo's folder name (shown to everyone) */
  repo?: string
  /** `git remote get-url origin`, without credentials */
  remote?: string
  /** when it was last drawn from the files */
  at?: string
  /** the proposal thread last applied (`--applied <comment id>`) and when */
  applied?: string
  appliedAt?: string
  /** handed over: the agent that held the files before, and the handover thread (docs/canvas.md "Handing over the files") */
  from?: string
  handover?: string
}

export const CONTEXT_MAX = 4000

type Meta = Record<string, unknown> | undefined
type Data = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

export function responderOf(meta: Meta): Responder | undefined {
  const r = meta?.responder as Responder | undefined
  if (!r || typeof r !== 'object') return undefined
  if (r.mode === 'agent') return str(r.agent) ? r : undefined
  return r.mode === 'any' || r.mode === 'studio' ? r : undefined
}

/**
 * A responder an agent suggested (`meta.responderSuggestion`): agents never set "Answered by" themselves — drawing a
 * new board, or asking through canvas_context, only suggests it, and the person confirms it with one click (logged as
 * the person). Watching a board, being mentioned and holding the files are separate from answering it.
 */
export function suggestionOf(meta: Meta): Responder | undefined {
  return responderOf({ responder: meta?.responderSuggestion })
}

/** The value a person sends to /settings to accept a suggestion: an agent's name, 'studio' or 'any'. */
export function responderValue(r: Responder): string {
  return r.mode === 'agent' ? r.agent! : r.mode
}

/** The name the responder answers as: `agent` for studio, the agent's name, undefined for anyone. */
export function responderName(r: Responder | undefined): string | undefined {
  if (!r || r.mode === 'any') return undefined
  return r.mode === 'studio' ? LOCAL_AGENT : r.agent
}

/** "codex-b", "the studio", "any agent". */
export function responderLabel(r: Responder | undefined): string {
  const n = responderName(r)
  return n ? displayName(n) : 'any agent'
}

/** How a name reads to people: the default local agent is "studio". */
export function displayName(name: string): string {
  return name === LOCAL_AGENT ? 'studio' : name
}

export function contextOf(meta: Meta): BoardContext | undefined {
  const c = meta?.context as BoardContext | undefined
  return c && typeof c === 'object' && str(c.text) ? c : undefined
}

/**
 * The handle people @mention an agent by: its name as one word — lower case, spaces and other signs as `-`
 * ("agent on Acme-Robins-MacBook-Pro" → `agent-on-acme-robins-macbook-pro`). The default local agent is
 * `studio`. Names are unique by handle (the canvas refuses a second "codex b" next to "codex-b").
 */
export function handleOf(name: string): string {
  const raw = name.trim().replace(/^@+/, '')
  if (raw.toLowerCase() === LOCAL_AGENT || raw.toLowerCase() === 'studio') return 'studio'
  const h = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}_.-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
    .replace(/[-.]+$/, '')
  return h || 'agent'
}

/** Same agent? Names compare by their handle (case, spaces and signs do not matter); `studio` is the default local agent. */
export function sameAgent(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return handleOf(a) === handleOf(b)
}

/** The known agent a name or @handle means (its canonical name), or undefined. */
export function resolveAgent(raw: string | undefined, known: string[]): string | undefined {
  if (!raw || !raw.trim()) return undefined
  const want = raw.trim().replace(/^@+/, '')
  if (sameAgent(want, LOCAL_AGENT)) return LOCAL_AGENT
  return known.find((n) => n === want) ?? known.find((n) => n.toLowerCase() === want.toLowerCase()) ?? known.find((n) => sameAgent(n, want))
}

/** "codex-b" or "codex-b (agent on mbp-b)" when the handle differs from the name — how a recipient is named to people. */
export function agentLabel(name: string): string {
  const h = handleOf(name)
  const d = displayName(name)
  return h === d ? `@${h}` : `@${h} (${d})`
}

/** A responder value from what a person or agent asked for: 'any', 'studio', or an agent's name ('me' = the caller). */
export function parseResponder(raw: unknown, caller: string | undefined, by: string | undefined, at: string): Responder | null | undefined {
  if (raw === null || raw === '' || raw === 'default') return null
  if (typeof raw === 'object' && raw) {
    const r = raw as Responder
    return parseResponder(r.mode === 'agent' ? r.agent : r.mode, caller, by, at)
  }
  if (typeof raw !== 'string') return undefined
  const v = raw.trim()
  if (v === 'any') return { mode: 'any', by, at }
  if (v === 'studio' || v === LOCAL_AGENT) return { mode: 'studio', by, at }
  const name = v === 'me' ? caller : v
  if (!name) return undefined
  if (sameAgent(name, LOCAL_AGENT)) return { mode: 'studio', by, at }
  return { mode: 'agent', agent: name.slice(0, 60), by, at }
}

// ── holders ────────────────────────────────────────────────────────────────────

const holderIn = (v: unknown): FileHolder | undefined => {
  const h = (v as { holder?: FileHolder } | undefined)?.holder
  return h && typeof h === 'object' && str(h.agent) ? h : undefined
}

/** Every diagram (and the workflow) with the agent holding its files. `key` is the diagram key, 'workflow' for meta.workflow. */
export function holdersOf(meta: Meta): Array<{ key: string; source?: string; holder: FileHolder }> {
  const out: Array<{ key: string; source?: string; holder: FileHolder }> = []
  const diagrams = meta?.diagrams as Record<string, { source?: unknown; holder?: unknown }> | undefined
  for (const [key, d] of Object.entries(diagrams && typeof diagrams === 'object' ? diagrams : {})) {
    const holder = holderIn(d)
    if (holder) out.push({ key, ...(str(d?.source) ? { source: d.source as string } : {}), holder })
  }
  const wf = meta?.workflow as { file?: unknown; holder?: unknown } | undefined
  const h = holderIn(wf)
  if (h) out.push({ key: 'workflow', ...(str(wf?.file) ? { source: wf!.file as string } : {}), holder: h })
  return out
}

/** The holder of a file behind the board (a file of `meta.workflow.files` or of a diagram's `files`). */
export function holderOfFile(meta: Meta, file: string | undefined): FileHolder | undefined {
  if (!file) return undefined
  const diagrams = meta?.diagrams as Record<string, { source?: unknown; files?: unknown; holder?: unknown }> | undefined
  for (const d of Object.values(diagrams && typeof diagrams === 'object' ? diagrams : {})) {
    const files = d?.files && typeof d.files === 'object' ? Object.keys(d.files as object) : []
    if (d?.source === file || files.includes(file)) {
      const h = holderIn(d)
      if (h) return h
    }
  }
  const wf = meta?.workflow as { files?: unknown; holder?: unknown } | undefined
  const wfFiles = wf?.files && typeof wf.files === 'object' ? Object.keys(wf.files as object) : []
  return wfFiles.includes(file) ? holderIn(wf) : undefined
}

/** The holder of the diagram an item is drawn in (a legacy workflow board: the workflow's holder). */
export function holderOfItem(board: Pick<Board, 'kind' | 'items' | 'meta'>, item: Item | undefined): FileHolder | undefined {
  if (!item) return undefined
  const d = diagramOf(board, item)
  if (!d) return undefined
  const diagrams = board.meta?.diagrams as Record<string, unknown> | undefined
  if (d.frameId) return holderIn(diagrams?.[d.key])
  return holderIn(diagrams?.[d.key]) ?? (d.kind === 'workflow' ? holderIn(board.meta?.workflow) : undefined)
}

/** The single agent holding every diagram's files on the board, when there is exactly one (a responder suggestion). */
export function soleHolder(meta: Meta): string | undefined {
  const names = [...new Set(holdersOf(meta).map((h) => h.holder.agent))]
  return names.length === 1 ? names[0] : undefined
}

/**
 * The holders in a meta about to be saved (a PUT after a redraw), stamped from the caller: a holder the caller
 * sent without `at` (or changed) is theirs now — `agent` = the caller, `at` = now. A holder copied unchanged from
 * what the caller read (same `agent` and `at`; a viewer elsewhere gets it without `machine` / `root`) keeps the
 * stored one. So nobody can record another agent as a holder.
 */
export function stampHolders(current: Meta, next: Record<string, unknown>, caller: string, now: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...next }
  const stamp = (cur: FileHolder | undefined, sent: unknown): FileHolder | undefined => {
    if (!sent || typeof sent !== 'object') return undefined
    const s = sent as FileHolder
    if (cur && s.at && s.at === cur.at && s.agent === cur.agent) return cur
    const h: FileHolder = { agent: caller, at: now }
    for (const k of ['machine', 'root', 'repo', 'remote'] as const) if (str(s[k])) h[k] = (s[k] as string).slice(0, 300)
    if (h.remote) h.remote = withoutCredentials(h.remote)
    if (str(s.applied)) {
      h.applied = (s.applied as string).slice(0, 80)
      h.appliedAt = cur?.applied === h.applied && cur.appliedAt ? cur.appliedAt : now
    } else if (cur && sameAgent(cur.agent, caller) && cur.applied) {
      h.applied = cur.applied
      h.appliedAt = cur.appliedAt
    }
    // a handover is remembered across the new holder's own redraws (never taken from what the caller sent), and so is
    // where it said it keeps the files when a redraw from file text (the remote design_draw) says nothing about it
    if (cur && sameAgent(cur.agent, caller)) {
      if (str(cur.from)) h.from = cur.from
      if (str(cur.handover)) h.handover = cur.handover
      if (!h.repo && !h.remote && !h.root) {
        if (str(cur.repo)) h.repo = cur.repo
        if (str(cur.remote)) h.remote = cur.remote
      }
    }
    return h
  }
  const diagrams = next.diagrams as Record<string, Data> | undefined
  if (diagrams && typeof diagrams === 'object') {
    const curD = (current?.diagrams ?? {}) as Record<string, Data>
    out.diagrams = Object.fromEntries(
      Object.entries(diagrams).map(([key, d]) => {
        if (!d || typeof d !== 'object') return [key, d]
        const { holder: sent, ...rest } = d
        const h = stamp(holderIn(curD[key]), sent)
        return [key, h ? { ...rest, holder: h } : rest]
      }),
    )
  }
  const wf = next.workflow as Data | undefined
  if (wf && typeof wf === 'object') {
    const { holder: sent, ...rest } = wf
    const h = stamp(holderIn(current?.workflow), sent)
    out.workflow = h ? { ...rest, holder: h } : rest
  }
  return out
}

/**
 * PATCH /api/boards/:id: `patch` merged into `meta` — each top-level key given replaces that key (null removes it);
 * `diagrams` merges per diagram key (an entry replaces that diagram's entry whole, null removes it). Two agents
 * drawing different diagrams of one board, in turn or at once, never overwrite each other's entries.
 */
export function mergeBoardMeta(meta: Meta, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Data = { ...(meta ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'diagrams' && v && typeof v === 'object' && !Array.isArray(v)) {
      const cur = out.diagrams && typeof out.diagrams === 'object' ? { ...(out.diagrams as Data) } : {}
      for (const [key, d] of Object.entries(v as Data)) {
        if (d === null || d === undefined) delete cur[key]
        else cur[key] = d
      }
      out.diagrams = cur
    } else if (v === null || v === undefined) delete out[k]
    else out[k] = v
  }
  return out
}

// ── who may redraw a diagram (the guard; docs/canvas.md "Handing over the files") ───────────────────────────

/**
 * What an agent hears when it would redraw (change, or drop) a diagram whose files another agent holds. The only way
 * the files change hands is a handover the person starts.
 */
export function heldElsewhereText(key: string, source: string | undefined, holder: string): string {
  return `the files of "${key}"${source ? ` (${source})` : ''} are held by ${displayName(holder)}: you cannot redraw them. Propose instead (canvas_files → canvas_propose_edit), or ask the person to hand them over to you (board panel → Hand over files).`
}

/** Before a redraw of diagram `key`: the refusal when another agent holds its files; undefined when `caller` may draw it (it holds them, or nobody does yet). */
export function diagramRefusal(meta: Meta, key: string, caller: string): string | undefined {
  const d = (meta?.diagrams as Record<string, Data> | undefined)?.[key]
  const h = holderIn(d)
  return h && !sameAgent(h.agent, caller) ? heldElsewhereText(key, str(d?.source), h.agent) : undefined
}

/** Before a redraw of the workflow (`meta.workflow`): the refusal when another agent holds its files. */
export function workflowRefusal(meta: Meta, caller: string): string | undefined {
  const wf = meta?.workflow as Data | undefined
  const h = holderIn(wf)
  return h && !sameAgent(h.agent, caller) ? heldElsewhereText('workflow', str(wf?.file), h.agent) : undefined
}

/** JSON with sorted keys: two metas that say the same thing compare equal, whatever order their keys came in. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x as Data).sort().map((k) => [k, (x as Data)[k]])) : x)) ?? ''

/**
 * A PUT replaces the meta whole: a diagram (or the workflow) whose files another agent holds, left out of what the
 * caller sent, is kept instead of dropped — an older client redrawing its own diagram cannot drop another's.
 */
export function keepHeldEntries(current: Meta, sent: Record<string, unknown>, caller: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...sent }
  const curD = (current?.diagrams ?? {}) as Record<string, Data>
  const held = Object.entries(curD).filter(([, d]) => {
    const h = holderIn(d)
    return h && !sameAgent(h.agent, caller)
  })
  if (held.length) {
    const sentD = sent.diagrams && typeof sent.diagrams === 'object' && !Array.isArray(sent.diagrams) ? { ...(sent.diagrams as Data) } : {}
    for (const [key, d] of held) if (!(key in sentD)) sentD[key] = d
    out.diagrams = sentD
  }
  const wh = holderIn(current?.workflow)
  if (wh && !sameAgent(wh.agent, caller) && !('workflow' in sent)) out.workflow = current!.workflow
  return out
}

/**
 * The guard on PUT / PATCH of a board's meta (after the holders are stamped): a caller may not take over, change or
 * drop a diagram — or the workflow — whose files another agent holds. A diagram nobody holds yet is free for the first
 * drawer; the holder redraws its own as often as it likes. Returns the refusal, or undefined.
 */
export function heldRefusal(current: Meta, next: Record<string, unknown>, caller: string): string | undefined {
  const curD = (current?.diagrams ?? {}) as Record<string, Data>
  const nextD = (next.diagrams && typeof next.diagrams === 'object' ? next.diagrams : {}) as Record<string, unknown>
  for (const [key, d] of Object.entries(curD)) {
    const h = holderIn(d)
    if (!h || sameAgent(h.agent, caller)) continue
    if (stable(d) !== stable(nextD[key])) return heldElsewhereText(key, str(d?.source), h.agent)
  }
  const wf = current?.workflow as Data | undefined
  const wh = holderIn(wf)
  if (wh && !sameAgent(wh.agent, caller) && stable(wf) !== stable(next.workflow)) return heldElsewhereText('workflow', str(wf?.file), wh.agent)
  return undefined
}

/** The project roots a board's diagrams were drawn from (their holders' `root`), for "which project is this board in". */
export function diagramRoots(meta: Meta): string[] {
  return [...new Set(holdersOf(meta).map((h) => h.holder.root).filter((r): r is string => typeof r === 'string' && r.length > 0))]
}

/** `https://user:token@host/x.git` → `https://host/x.git`. */
export function withoutCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1')
}

/** The meta a viewer elsewhere sees: holders without this machine's name and paths. */
export function redactHolders<T extends Meta>(meta: T): T {
  if (!meta) return meta
  const strip = (v: unknown) => {
    const h = holderIn(v)
    if (!h) return v
    const { machine: _m, root: _r, ...rest } = h
    return { ...(v as Data), holder: rest }
  }
  const out: Data = { ...meta }
  const diagrams = meta.diagrams as Record<string, unknown> | undefined
  if (diagrams && typeof diagrams === 'object') out.diagrams = Object.fromEntries(Object.entries(diagrams).map(([k, d]) => [k, strip(d)]))
  if (meta.workflow) out.workflow = strip(meta.workflow)
  return out as T
}

/** After an agent was renamed: the responder and the holders that named it name it anew. Undefined when nothing changed. */
export function renameInMeta(meta: Meta, from: string, to: string): Record<string, unknown> | undefined {
  if (!meta) return undefined
  let changed = false
  const out: Data = { ...meta }
  const r = responderOf(meta)
  if (r?.mode === 'agent' && sameAgent(r.agent, from)) {
    out.responder = { ...r, agent: to }
    changed = true
  }
  const s = suggestionOf(meta)
  if (s?.mode === 'agent' && sameAgent(s.agent, from)) {
    out.responderSuggestion = { ...s, agent: to }
    changed = true
  }
  const fix = (v: unknown) => {
    const h = holderIn(v)
    if (!h || (!sameAgent(h.agent, from) && !sameAgent(h.from, from))) return v
    changed = true
    return { ...(v as Data), holder: { ...h, ...(sameAgent(h.agent, from) ? { agent: to } : {}), ...(sameAgent(h.from, from) ? { from: to } : {}) } }
  }
  const diagrams = meta.diagrams as Record<string, unknown> | undefined
  if (diagrams && typeof diagrams === 'object') out.diagrams = Object.fromEntries(Object.entries(diagrams).map(([k, d]) => [k, fix(d)]))
  if (meta.workflow) out.workflow = fix(meta.workflow)
  const ho = handoverOf(meta)
  if (ho && (sameAgent(ho.to, from) || sameAgent(ho.by, from) || ho.keys.some((k) => sameAgent(k.from, from) || sameAgent(k.ready?.by, from)))) {
    const swap = (n: string) => (sameAgent(n, from) ? to : n)
    out.handover = { ...ho, to: swap(ho.to), by: swap(ho.by), keys: ho.keys.map((k) => ({ ...k, from: swap(k.from), ...(k.ready ? { ready: { ...k.ready, by: swap(k.ready.by) } } : {}) })) }
    changed = true
  }
  return changed ? out : undefined
}

// ── handing over the files (docs/canvas.md "Handing over the files") ───────────────────────────────────────
//
// The person moves the files behind some diagrams from the agent holding them (`from`) to another agent (`to`):
// the person starts it (board panel → Hand over files), each `from` agent settles its open proposals, redraws what
// changed and marks its diagrams ready, then `to` accepts and becomes their holder (and, if the person asked, the
// board's "Answered by"). At most one is open per board (`meta.handover`, a board setting); its thread's root comment
// (`handover.<id>`, `data.handover`) routes every message there to both sides.

/** One diagram (or 'workflow' = `meta.workflow`) being handed over. */
export interface HandoverKey {
  key: string
  /** the holder when the handover started */
  from: string
  /** the file the diagram is drawn from */
  source?: string
  /** the frame's title (for people) */
  title?: string
  /** `from` (or the person, `forced`) said the files on the board are the ones to take: path → sha-1 */
  ready?: { by: string; at: string; files: Record<string, string>; forced?: true }
}

/** The open handover of a board (`meta.handover`). */
export interface Handover {
  /** 'ho_<base36 random>' */
  id: string
  /** canonical name of the agent receiving the files */
  to: string
  /** on accept, "Answered by" becomes `to` */
  answeredBy: boolean
  /** id of the handover thread's root comment */
  thread: string
  /** who started it ('user' = the person) */
  by: string
  at: string
  keys: HandoverKey[]
}

/** The board's open handover, validated; undefined when there is none (or it is not well formed). */
export function handoverOf(meta: Meta): Handover | undefined {
  const h = meta?.handover as Partial<Handover> | undefined
  if (!h || typeof h !== 'object' || Array.isArray(h)) return undefined
  if (!str(h.id) || !str(h.to) || !str(h.thread) || !str(h.by) || !str(h.at) || typeof h.answeredBy !== 'boolean' || !Array.isArray(h.keys) || !h.keys.length) return undefined
  const keys: HandoverKey[] = []
  for (const raw of h.keys as unknown[]) {
    const k = raw as Partial<HandoverKey> | undefined
    if (!k || typeof k !== 'object' || !str(k.key) || !str(k.from)) return undefined
    const r = k.ready as HandoverKey['ready'] | undefined
    const files = r && typeof r === 'object' && r.files && typeof r.files === 'object' && !Array.isArray(r.files) ? Object.fromEntries(Object.entries(r.files).filter(([, v]) => typeof v === 'string')) : undefined
    const ready = r && typeof r === 'object' && str(r.by) && str(r.at) && files ? { by: r.by, at: r.at, files, ...(r.forced === true ? { forced: true as const } : {}) } : undefined
    keys.push({ key: k.key!, from: k.from!, ...(str(k.source) ? { source: k.source } : {}), ...(str(k.title) ? { title: k.title } : {}), ...(ready ? { ready } : {}) })
  }
  return { id: h.id!, to: h.to!, answeredBy: h.answeredBy, thread: h.thread!, by: h.by!, at: h.at!, keys }
}

/** The agents handing files over, each once, in the order of the keys. */
export function handoverFroms(h: Pick<Handover, 'keys'>): string[] {
  const out: string[] = []
  for (const k of h.keys) if (!out.some((o) => sameAgent(o, k.from))) out.push(k.from)
  return out
}

/** The handover a thread's root comment belongs to (`data.handover`: { id, state, to, from }). */
export function handoverThreadOf(root: Item | undefined): { id: string; state?: string; to?: string; from?: string[] } | undefined {
  const h = root?.type === 'comment' ? (root.data?.handover as { id?: unknown; state?: unknown; to?: unknown; from?: unknown } | undefined) : undefined
  if (!h || typeof h !== 'object' || !str(h.id)) return undefined
  return { id: h.id as string, ...(str(h.state) ? { state: h.state as string } : {}), ...(str(h.to) ? { to: h.to as string } : {}), ...(Array.isArray(h.from) ? { from: (h.from as unknown[]).filter((x): x is string => typeof x === 'string') } : {}) }
}

const at = (name: string) => `@${handleOf(name)}`
const named = (k: Pick<HandoverKey, 'key' | 'title'>) => `«${k.title ?? k.key}»`
const list = (names: string[]) => names.join(', ')
/** "2026-10-08 10:12 UTC" */
export const whenText = (iso: string | undefined) => (iso && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso) ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'its last draw')

/** The handover thread's first message — for the person and for both agents. */
export function handoverStartText(h: Handover): string {
  const froms = handoverFroms(h)
  const one = froms.length === 1
  const files = list(h.keys.map((k) => `${named(k)}${k.source ? ` (${k.source})` : ''}${one ? '' : ` from ${at(k.from)}`}`))
  return [
    `Handing over the files of ${files}${one ? ` from ${at(froms[0])}` : ''} to ${at(h.to)}.`,
    `${list(froms.map(at))}: settle the open proposals on them, redraw any of them whose file changed since your last draw, then canvas_handover({ ready: true }).`,
    `${at(h.to)}: when they are ready, canvas_handover({ accept: true }), keep the files in your repo (canvas_files), and redraw once from your copy. From then on proposals on them go to you.`,
  ].join('\n')
}

/**
 * The reply when keys are marked ready: by their holder ("Ready: …", with each file's short sha-1), or by the person
 * without the holder (`forced`, "Handed over without @a's confirmation: …", as of the holder's last draw).
 */
export function handoverReadyText(h: Handover, marked: HandoverKey[], o: { forced?: boolean; lastDraw?: Record<string, string | undefined> } = {}): string {
  const lines: string[] = []
  if (o.forced) {
    for (const from of handoverFroms({ keys: marked })) {
      const mine = marked.filter((k) => sameAgent(k.from, from))
      lines.push(`Handed over without ${at(from)}'s confirmation: ${list(mine.map((k) => `${named(k)} as of its last draw, ${whenText(o.lastDraw?.[k.key])}`))}`)
    }
  } else {
    const files = marked.flatMap((k) => Object.entries(k.ready?.files ?? {}).map(([p, sha]) => `${p} ${sha.slice(0, 7)}`))
    lines.push(`Ready: ${list(marked.map(named))} — the files as of my last draw (${files.length ? list(files) : 'no files on the board'})`)
  }
  if (h.keys.every((k) => k.ready)) lines.push(`Every file is ready — ${at(h.to)}: canvas_handover({ accept: true }).`)
  return lines.join('\n')
}

/** The reply when `to` accepted. */
export function handoverAcceptText(h: Handover): string {
  const keys = list(h.keys.map(named))
  return [`Accepted — ${at(h.to)} holds the files of ${keys} now; proposals on them go to ${at(h.to)}. ${list(handoverFroms(h).filter((f) => !sameAgent(f, h.to)).map(at))}: propose from now on (canvas_files → canvas_propose_edit).`, ...(h.answeredBy ? [`"Answered by" is ${at(h.to)} now, as the person asked when handing over.`] : [])].join('\n')
}

/** The reply when the handover was cancelled (by the person: `by` undefined). */
export function handoverCancelText(by: string | undefined, reason?: string): string {
  return `Cancelled by ${by ? at(by) : 'the person'}${reason?.trim() ? `: ${reason.trim()}` : ''}`
}

/** Who must do what next, one line each (canvas_context, canvas_read_board's outline, canvas_handover). */
export function handoverLines(h: Handover): string[] {
  const keys = list(h.keys.map((k) => `${named(k)}${k.source ? ` (${k.source})` : ''}${k.ready ? ` [ready${k.ready.forced ? ', handed over by the person' : ''}]` : ''}`))
  const out = [`Handover open (thread ${h.thread}, started by ${h.by === 'user' ? 'the person' : displayName(h.by)}): the files of ${keys} go from ${list(handoverFroms(h).map(displayName))} to ${displayName(h.to)}${h.answeredBy ? '; "Answered by" becomes it on accept' : ''}`]
  const waiting = handoverFroms({ keys: h.keys.filter((k) => !k.ready) })
  for (const from of waiting) {
    const mine = h.keys.filter((k) => !k.ready && sameAgent(k.from, from))
    out.push(`  waiting for ${displayName(from)}: settle the open proposals on ${list(mine.map(named))}, redraw any whose file changed, then canvas_handover({ ready: true })`)
  }
  out.push(waiting.length ? `  then ${displayName(h.to)} accepts: canvas_handover({ accept: true })` : `  every file is ready — waiting for ${displayName(h.to)} to accept: canvas_handover({ accept: true })`)
  out.push('  either side may decline it (canvas_handover({ cancel: true, reason })); only the person starts or forces a handover')
  return out
}

/** The keys of `h` not ready yet, as "«X» waits for @a" — the 409 an early accept gets. */
export function handoverWaiting(h: Handover): string {
  return list(h.keys.filter((k) => !k.ready).map((k) => `${named(k)} waits for ${at(k.from)}`))
}

/** The Decline button's answer in a proposal thread (web components/EditProposal.tsx, flow/notesView.ts). */
export const DECLINE_TEXT = 'No, leave the file as it is.'

/**
 * A finished proposal thread — the holder answered "Applied to …" (`--applied`: a reply `applied.<t>`), or the person
 * declined it: the same rule as the web's notesView.isSettled.
 */
export function isSettledThread(thread: Item[]): boolean {
  return thread.some((m, i) => i > 0 && (m.id.startsWith('applied.') || (m.text ?? '').trimStart().startsWith('Applied to ') || (m.createdBy === 'user' && (m.text ?? '').trim() === DECLINE_TEXT)))
}

/** The diagram key a proposal thread is about: the diagram whose files hold the edited file ('workflow' for meta.workflow), else the diagram its items are in. */
export function proposalKeyOf(board: Pick<Board, 'kind' | 'items' | 'meta'>, root: Item): string | undefined {
  const file = proposedFile(root)
  if (file) {
    const diagrams = board.meta?.diagrams as Record<string, { source?: unknown; files?: unknown }> | undefined
    for (const [key, d] of Object.entries(diagrams && typeof diagrams === 'object' ? diagrams : {})) {
      if (d?.source === file || (d?.files && typeof d.files === 'object' && file in (d.files as object))) return key
    }
    const wf = board.meta?.workflow as { files?: unknown } | undefined
    if (wf?.files && typeof wf.files === 'object' && file in (wf.files as object)) return 'workflow'
  }
  const ids = [...(Array.isArray(wireProposalOf(root)?.about) ? ((wireProposalOf(root)!.about as unknown[]).filter((x): x is string => typeof x === 'string')) : []), root.target].filter(Boolean) as string[]
  for (const id of ids) {
    const d = diagramOf(board, board.items[id])
    if (d) return d.frameId ? d.key : d.kind === 'workflow' ? 'workflow' : d.key
  }
  return undefined
}

/** Proposal threads still open on these diagrams (no "Applied to" / declined reply), oldest first. */
export function openProposals(board: Pick<Board, 'kind' | 'items' | 'meta'>, keys: string[]): string[] {
  const roots = Object.values(board.items).filter((i) => i.type === 'comment' && isProposal(i) && threadRoot(board, i).id === i.id)
  return roots
    .filter((r) => {
      const key = proposalKeyOf(board, r)
      return key !== undefined && keys.includes(key) && !isSettledThread(threadOf(board, r))
    })
    .sort((a, b) => String(a.data?.postedAt ?? a.updatedAt).localeCompare(String(b.data?.postedAt ?? b.updatedAt)))
    .map((r) => r.id)
}

/**
 * `data.handover` on comments is the canvas's own (the handover endpoints write it): a new comment cannot carry one,
 * and an update keeps what the stored comment has — so nobody routes a thread to both sides of a handover by hand.
 */
export function keepHandoverMarks(board: Pick<Board, 'items'>, ops: Op[]): Op[] {
  return ops.map((op): Op => {
    if (op.kind === 'add' && op.item.type === 'comment' && op.item.data && 'handover' in op.item.data) {
      const was = board.items[op.item.id]?.data?.handover
      const data = { ...op.item.data }
      if (was !== undefined) data.handover = was
      else delete data.handover
      return { ...op, item: { ...op.item, data } }
    }
    if (op.kind === 'update' && op.patch.data && typeof op.patch.data === 'object' && board.items[op.id]?.type === 'comment') {
      const was = board.items[op.id].data?.handover
      const data = { ...(op.patch.data as Data) }
      if (was !== undefined) data.handover = was
      else delete data.handover
      return { ...op, patch: { ...op.patch, data } }
    }
    return op
  })
}

/**
 * `data.todo` as the canvas keeps it (docs/canvas.md "TODOs"): who checked a TODO off and when are the caller (`who`: an
 * agent's name, or `person`) and now, whatever was sent; checking off one already done keeps who did it; reopening
 * drops them. A new comment with `data.todo` starts open unless it is written done.
 */
export function stampTodos(board: Pick<Board, 'items'>, ops: Op[], who: string, now: string): Op[] {
  const mark = (sent: unknown, was: ReturnType<typeof todoOf>): Data | undefined => {
    if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return undefined
    const t = todoOf({ type: 'comment', data: { todo: sent } })!
    const { doneBy: _b, doneAt: _a, ...rest }: Data = { ...(sent as Data), state: t.state }
    if (t.state !== 'done') return rest
    return { ...rest, ...(was?.state === 'done' && was.doneBy ? { doneBy: was.doneBy, doneAt: was.doneAt ?? now } : { doneBy: who, doneAt: now }) }
  }
  return ops.map((op): Op => {
    if (op.kind === 'add' && op.item.type === 'comment' && op.item.data && 'todo' in op.item.data) {
      const todo = mark(op.item.data.todo, todoOf(board.items[op.item.id]))
      const data = { ...op.item.data }
      if (todo) data.todo = todo
      else delete data.todo
      return { ...op, item: { ...op.item, data } }
    }
    if (op.kind === 'update' && op.patch.data && typeof op.patch.data === 'object' && 'todo' in (op.patch.data as Data) && board.items[op.id]?.type === 'comment') {
      const todo = mark((op.patch.data as Data).todo, todoOf(board.items[op.id]))
      const data = { ...(op.patch.data as Data) }
      if (todo) data.todo = todo
      else delete data.todo
      return { ...op, patch: { ...op.patch, data } }
    }
    return op
  })
}

// ── mentions and who a comment is for ─────────────────────────────────────────

/**
 * The agent a text mentions: `@<name>` with a known name (the longest that fits, case-insensitive, ending at a
 * word boundary). `@studio` is the default local agent. The first mention counts.
 */
export function mentionIn(text: string | undefined, known: string[]): string | undefined {
  if (!text || !text.includes('@')) return undefined
  // every agent answers to its name and to its handle (@agent-on-mbp-b for "agent on mbp-b")
  const tokens: Array<{ token: string; name: string }> = []
  for (const n of new Set([...known, 'studio'])) {
    if (!n || n.length > 60) continue
    const name = sameAgent(n, LOCAL_AGENT) ? LOCAL_AGENT : n
    for (const t of new Set([n, handleOf(n)])) tokens.push({ token: t.toLowerCase(), name })
  }
  tokens.sort((a, b) => b.token.length - a.token.length)
  const re = /(^|[^\p{L}\p{N}_.@-])@/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const at = m.index + m[0].length
    const rest = text.slice(at).toLowerCase()
    for (const { token, name } of tokens) {
      if (!rest.startsWith(token)) continue
      const next = rest.charAt(token.length)
      if (next && /[\p{L}\p{N}_-]/u.test(next)) continue
      return name
    }
  }
  return undefined
}

/** The first comment of a thread: follow `target` while it points at another comment. */
export function threadRoot(board: Pick<Board, 'items'>, it: Item): Item {
  let cur = it
  const seen = new Set<string>()
  while (!seen.has(cur.id)) {
    seen.add(cur.id)
    const next = cur.target ? board.items[cur.target] : undefined
    if (next?.type !== 'comment') return cur
    cur = next
  }
  return it
}

const editOf = (it: Item) => (it.data?.discuss as { edit?: { file?: unknown; by?: unknown } } | undefined)?.edit
const wireProposalOf = (it: Item) => (it.data?.discuss as { proposal?: unknown; about?: unknown } | undefined)
/** The file a proposal changes: its edit's, else the file a draft annotation goes into (a draft sent without the edit). */
function proposedFile(root: Item): string | undefined {
  const edit = editOf(root)
  if (edit && typeof edit.file === 'string') return edit.file
  return isAnnotationDraft(root) ? annotationOf(root)?.file : undefined
}

/**
 * The holder a proposal thread goes to: the file's holder (an edit, or the file a draft annotation names), or the holder
 * of the wire / items it is about.
 */
function proposalHolder(board: Pick<Board, 'kind' | 'items' | 'meta'>, root: Item): FileHolder | undefined {
  const file = proposedFile(root)
  const byFile = file ? holderOfFile(board.meta, file) : undefined
  if (byFile) return byFile
  if (editOf(root)) return holderOfItem(board, board.items[root.target ?? ''])
  const d = wireProposalOf(root)
  if (d?.proposal || isAnnotationDraft(root)) {
    const ids = [...(Array.isArray(d?.about) ? (d.about as unknown[]).filter((x): x is string => typeof x === 'string') : []), root.target].filter(Boolean) as string[]
    for (const id of ids) {
      const h = holderOfItem(board, board.items[id])
      if (h) return h
    }
  }
  return undefined
}

/** The agent a proposal thread goes to (the holder of the files), when the board names one. */
export const proposalHolderOf = (board: Pick<Board, 'kind' | 'items' | 'meta'>, root: Item): string | undefined => proposalHolder(board, root)?.agent

/** A proposal thread's root: an edit to a file, a wire change, or the person's draft annotation (with or without its edit). */
export const isProposal = (it: Item) => Boolean(editOf(it) || wireProposalOf(it)?.proposal || isAnnotationDraft(it))
/** The agent that wrote a comment ('agent' for the default local one); undefined for the person. */
export const agentOf = (it: Item): string | undefined => (it.createdBy === 'agent' ? (str(it.data?.by) ?? LOCAL_AGENT) : undefined)

/** Why a comment goes where it goes ('todo': a TODO itself, which wakes nobody — docs/canvas.md "TODOs"). */
export type Route = 'mention' | 'proposal' | 'responder' | 'paused' | 'handover' | 'todo'

/** Consecutive agent messages in one thread, without a person's message, before agents pause there (the loop guard). */
export const DEFAULT_AGENT_TURNS = 6

/** A thread's comments in the order they were posted (`data.postedAt`, stamped by the canvas; else updatedAt). */
export function threadOf(board: Pick<Board, 'items'>, root: Item): Item[] {
  const when = (i: Item) => String(i.data?.postedAt ?? i.updatedAt ?? '')
  return Object.values(board.items)
    .filter((i) => i.type === 'comment' && (i.id === root.id || threadRoot(board, i).id === root.id))
    .sort((a, b) => (a.id === root.id ? -1 : b.id === root.id ? 1 : when(a).localeCompare(when(b))))
}

/** How many agent messages end the thread (no person's message after them). */
export function trailingAgentTurns(thread: Item[]): number {
  let n = 0
  for (let i = thread.length - 1; i >= 0 && thread[i].createdBy === 'agent'; i--) n++
  return n
}

/** The thread is paused for agents: its last message says so (the loop guard tripped; a person's reply resumes it). */
export function isPaused(board: Pick<Board, 'items'>, root: Item): boolean {
  const t = threadOf(board, root)
  return Boolean(t[t.length - 1]?.data?.paused)
}

/**
 * Who a comment is for (the agents it wakes) and why; `to` undefined = anyone (as before):
 *   0. loop guard: an agent's message past `maxTurns` agent messages in a row in its thread wakes nobody (`paused`);
 *      a TODO (the root of its thread, `data.todo`) wakes nobody either (`todo`) — the answer, a reply, goes on below;
 *   ½. a handover thread (its root carries `data.handover`) goes to both sides: every agent handing files over and the
 *      agent receiving them — before any @mention (its first message mentions them all);
 *   1. an @mention — in the comment, else the latest one in its thread — makes it a conversation between the agent
 *      mentioned and whoever mentioned it: each message goes to the other side (an agent asking another agent gets the
 *      answer back; the person asking an agent gets nobody else woken);
 *   2. a proposal thread (an edit to a file, a wire change, the person's draft annotation) goes to the holder of the files
 *      and back to the proposer;
 *   3. otherwise the board's responder (and the agent that started the thread); no responder → anyone.
 * The comment's own author is never among its recipients.
 */
export function routeOf(board: Pick<Board, 'kind' | 'items' | 'meta'>, comment: Item, maxTurns = DEFAULT_AGENT_TURNS): { to?: string[]; route?: Route } {
  const root = threadRoot(board, comment)
  const thread = threadOf(board, root)
  const author = agentOf(comment)
  const out: string[] = []
  const add = (n: string | undefined) => {
    if (n && !sameAgent(n, author) && !out.some((o) => sameAgent(o, n))) out.push(n)
  }
  if (author) {
    const upTo = thread.slice(0, thread.findIndex((i) => i.id === comment.id) + 1 || thread.length)
    if (trailingAgentTurns(upTo) > maxTurns) return { to: [], route: 'paused' }
  }
  // a note to confirm something with someone else, not a question to an agent: written (or edited) it wakes nobody
  if (comment.id === root.id && todoOf(root)) return { to: [], route: 'todo' }
  const ho = handoverThreadOf(root)
  if (ho) {
    // the parties are on the root (they stay after the handover is done); else the open handover of this thread
    const open = handoverOf(board.meta)
    const parties = ho.to ? { to: ho.to, from: ho.from ?? [] } : open && open.thread === root.id ? { to: open.to, from: handoverFroms(open) } : undefined
    if (parties) {
      for (const f of parties.from) add(f)
      add(parties.to)
      return { to: out, route: 'handover' }
    }
  }
  const asked = str(comment.data?.mention)
    ? comment
    : thread.filter((i) => str(i.data?.mention)).sort((a, b) => String(b.data?.mentionAt ?? '').localeCompare(String(a.data?.mentionAt ?? '')))[0]
  const proposal = isProposal(root)
  const holder = proposal ? proposalHolder(board, root) : undefined
  const proposer = proposal ? agentOf(root) : undefined
  if (asked) {
    add(str(asked.data?.mention))
    add(agentOf(asked))
    add(holder?.agent)
    add(proposer)
    return { to: out, route: 'mention' }
  }
  if (holder) {
    add(holder.agent)
    add(proposer)
    return { to: out, route: 'proposal' }
  }
  const r = responderName(responderOf(board.meta))
  if (!r) return {}
  add(r)
  add(agentOf(root))
  return { to: out, route: 'responder' }
}

/** Who a comment is for (see routeOf); undefined = anyone. */
export function recipientsOf(board: Pick<Board, 'kind' | 'items' | 'meta'>, comment: Item, maxTurns = DEFAULT_AGENT_TURNS): string[] | undefined {
  return routeOf(board, comment, maxTurns).to
}

const ROUTING_KEYS = ['to', 'route', 'mention', 'mentionAt', 'paused', 'postedAt'] as const

/**
 * Stamp who each comment in these ops is for, from the board as it will be: `data.postedAt` on a new comment,
 * `data.mention` (+ `mentionAt`) when its text mentions an agent (or `data.ask` names one — canvas_ask), `data.to` /
 * `data.route` from routeOf, and `data.paused` when the loop guard tripped. Whatever a caller sent for these keys is
 * replaced — nobody routes a comment by writing `to` themselves. An update that does not change a comment's text keeps
 * what the comment already says (so read receipts stay bookkeeping).
 */
export function stampRouting(board: Board, ops: Op[], known: string[], now: string, apply: (b: Board, ops: Op[]) => Board, maxTurns = DEFAULT_AGENT_TURNS): Op[] {
  const touched = new Set<string>()
  const pre = ops.map((op): Op => {
    if (op.kind === 'add' && op.item.type === 'comment') {
      touched.add(op.item.id)
      const was = board.items[op.item.id]?.data
      const data = withMention(clean(op.item.data), op.item.text, known, was, now, op.item.data?.ask)
      data.postedAt = typeof was?.postedAt === 'string' ? was.postedAt : now
      return { ...op, item: { ...op.item, data } }
    }
    if (op.kind === 'update') {
      const cur = board.items[op.id]
      if (cur?.type !== 'comment') return op
      const textChanged = op.patch.text !== undefined && op.patch.text !== cur.text
      if (!textChanged && !op.patch.data) return op
      const base: Data = { ...(cur.data ?? {}), ...((op.patch.data as Data | undefined) ?? {}) }
      // `null` removes a key (a redraw taking the number off a note someone answered)
      for (const [k, v] of Object.entries(base)) if (v === null) delete base[k]
      // the stored routing keys stay unless the text changes
      for (const k of ROUTING_KEYS) {
        if (cur.data?.[k] !== undefined) base[k] = cur.data[k]
        else delete base[k]
      }
      if (!textChanged) return { ...op, patch: { ...op.patch, data: base } }
      touched.add(op.id)
      return { ...op, patch: { ...op.patch, data: withMention(base, op.patch.text, known, cur.data, now, cur.data?.ask) } }
    }
    return op
  })
  if (!touched.size) return pre
  const next = apply(board, pre)
  return pre.map((op): Op => {
    const id = op.kind === 'add' ? op.item.id : op.kind === 'update' ? op.id : undefined
    if (!id || !touched.has(id)) return op
    const it = next.items[id]
    if (!it) return op
    const r = routeOf(next, it, maxTurns)
    const set = (data: Data): Data => {
      const d = { ...data }
      delete d.to
      delete d.route
      delete d.paused
      if (r.to) d.to = r.to
      if (r.route) d.route = r.route
      if (r.route === 'paused') d.paused = true
      return d
    }
    if (op.kind === 'add') return { ...op, item: { ...op.item, data: set(op.item.data ?? {}) } }
    if (op.kind === 'update') return { ...op, patch: { ...op.patch, data: set((op.patch.data as Data | undefined) ?? { ...(board.items[id]?.data ?? {}) }) } }
    return op
  })
}

const clean = (data: Data | undefined): Data => {
  const d = { ...(data ?? {}) }
  for (const k of ROUTING_KEYS) delete d[k]
  return d
}

function withMention(data: Data, text: string | undefined, known: string[], was: Data | undefined, now: string, ask: unknown): Data {
  const d = { ...data }
  const m = mentionIn(text, known) ?? (str(ask) ? (resolveAgent(ask as string, known) ?? (ask as string).replace(/^@+/, '').slice(0, 60)) : undefined)
  if (m) {
    d.mention = m
    d.mentionAt = was && sameAgent(str(was.mention), m) && str(was.mentionAt) ? was.mentionAt : now
  } else {
    delete d.mention
    delete d.mentionAt
  }
  delete d.to
  return d
}

/**
 * An agent's message that asks `me` something: a comment by another agent routed to `me` by a mention or a proposal.
 * It wakes `me` like the person's comment would, even while `me` waits for the person only.
 */
export function asksMe(board: Board, change: Change, me: string): boolean {
  return change.author === 'agent' && mentionsMe(board, change, me)
}

/**
 * A change that addresses `me` personally — a comment routed to `me` by an @mention (or a reply in a thread
 * where `me` was mentioned / did the asking), by a proposal to files `me` holds, or in a handover `me` is part of —
 * by anyone but `me`.
 * Being the board's responder ("Answered by") does not count: `canvas_wait({ untilMention: true })` wakes only on this.
 */
export function mentionsMe(board: Board, change: Change, me: string): boolean {
  if (change.author === 'agent' && sameAgent(change.by ?? LOCAL_AGENT, me)) return false
  return change.ops.some((op) => {
    const id = op.kind === 'add' ? op.item.id : op.id
    const it = board.items[id] ?? (op.kind === 'add' ? op.item : undefined)
    if (it?.type !== 'comment') return false
    const route = it.data?.route
    const to = it.data?.to
    return (route === 'mention' || route === 'proposal' || route === 'handover') && Array.isArray(to) && to.some((n) => typeof n === 'string' && sameAgent(n, me))
  })
}

const hasPendingNow = (op: Op, before: Item | null | undefined): boolean => {
  if (op.kind === 'add') return Boolean(op.item.data?.pending)
  if (op.kind !== 'update' || !op.patch.data) return false
  const p = (op.patch.data as Data).pending
  return p !== undefined && JSON.stringify(p) !== JSON.stringify(before?.data?.pending)
}

/**
 * Is this change for `me` (an agent's name, `agent` for the default local one)? Comments go to their stamped
 * `data.to` (absent = anyone); a proposal made on an item (a dragged wire, a UI mock edit: `data.pending`) goes to
 * the holder of its diagram; everything else — and the "Hand to agent" button — to the board's responder.
 */
export function addressedTo(board: Board, change: Change, me: string): boolean {
  const responder = responderName(responderOf(board.meta))
  const toResponder = () => !responder || sameAgent(responder, me)
  if (change.ops.length === 0) return toResponder()
  for (const op of change.ops) {
    const id = op.kind === 'add' ? op.item.id : op.id
    const item = board.items[id] ?? (op.kind === 'add' ? op.item : undefined) ?? change.before[id] ?? undefined
    if (item?.type === 'comment') {
      const to = item.data?.to
      if (!Array.isArray(to) || to.some((n) => typeof n === 'string' && sameAgent(n, me))) return true
      continue
    }
    if (item && hasPendingNow(op, change.before[id])) {
      const h = holderOfItem(board, item)
      if (h) {
        if (sameAgent(h.agent, me)) return true
        continue
      }
    }
    if (toResponder()) return true
  }
  return false
}

/**
 * The diagrams the board still registers (`meta.diagrams`) whose frame is gone from it — removed over `/ops` or on the
 * page. The entry keeps its holder and file snapshot (the Files tab, canvas_files, the redraw guard) until the holder
 * redraws the frame from the file or drops the entry (PATCH /api/boards/:id `{ meta: { diagrams: { <key>: null } } }`).
 */
export function framelessDiagrams(board: Pick<Board, 'meta' | 'items'>): Array<{ key: string; source?: string; holder?: FileHolder }> {
  const diagrams = board.meta?.diagrams as Record<string, { source?: unknown; holder?: unknown }> | undefined
  if (!diagrams || typeof diagrams !== 'object') return []
  const framed = new Set(Object.values(board.items).map((it) => diagramSpecOf(it)?.key).filter((k): k is string => !!k))
  return Object.entries(diagrams)
    .filter(([key]) => !framed.has(key) && !board.items[diagramFrameId(key)])
    .map(([key, d]) => {
      const holder = holderIn(d)
      return { key, ...(str(d?.source) ? { source: d.source as string } : {}), ...(holder ? { holder } : {}) }
    })
}

/** One line per frameless diagram, for agents: what is left of it and the two ways out. */
export function framelessLines(board: Pick<Board, 'id' | 'meta' | 'items'>): string[] {
  return framelessDiagrams(board).map(({ key, source, holder }) =>
    `Diagram ${key}${source ? ` (${source})` : ''} is still registered, but its frame is gone from the board${holder ? ` — files held by ${displayName(holder.agent)}` : ''}: ${holder ? 'its holder redraws it from the file, or drops the entry' : 'redraw it from the file, or drop the entry'} — PATCH /api/boards/${board.id} {"meta":{"diagrams":{"${key}":null}}}${holder ? ' (only the holder may)' : ''}`,
  )
}

/** One line per board setting, for agents: the context, who answers, who holds which files (no paths). */
export function settingsLines(meta: Meta): string[] {
  const out: string[] = []
  const c = contextOf(meta)
  if (c) out.push(`Board context${c.by ? ` (from ${displayName(c.by)})` : ''}:`, ...c.text.split('\n').map((l) => `  ${l}`))
  const r = responderOf(meta)
  if (r && r.mode !== 'any') out.push(`Answered by: ${responderLabel(r)} — the person's comments here go to it; an @mention sends a thread to another agent`)
  const s = suggestionOf(meta)
  if (!r && s) out.push(`Answered by: not set — ${s.by ? displayName(s.by) : 'an agent'} suggested ${responderLabel(s)}; only the person can confirm it`)
  for (const { key, source, holder } of holdersOf(meta)) {
    out.push(`Files of ${key}${source ? ` (${source})` : ''}: held by ${displayName(holder.agent)}${holder.repo ? ` in ${holder.repo}` : ''}${holder.remote ? ` · ${holder.remote}` : ''}${holder.from ? ` (handed over from ${displayName(holder.from)})` : ''} — proposals on it go to that agent; only it redraws it`)
  }
  const h = handoverOf(meta)
  if (h) out.push(...handoverLines(h))
  return out
}
