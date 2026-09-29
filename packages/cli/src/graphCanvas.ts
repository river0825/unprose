// `awd graph wf.yaml --canvas [url]` (and `awd studio`) — draw the workflow on
// the canvas server as a `workflow` board. Item ids are deterministic, so running
// it again after editing the yaml updates the same board in place instead of
// drawing a second copy. Every block carries its full detail (docs/studio.md §1).

import fs from 'node:fs'
import path from 'node:path'
import { toGraph, type WorkflowDefinition } from '@awd/core'
import { loadWorkflow, blockDetails, workflowFiles } from '@awd/runtime'

export interface PushGraphOptions {
  /** Canvas server (default AWD_CANVAS_URL or http://localhost:4400). */
  canvas?: string
  /** Where the run overlay should look for live state (default AWD_RUNTIME_URL or http://localhost:4311). */
  runtime?: string
  /** The workflow file — needed for block details (agent files, scripts, line numbers). */
  file?: string
}

export async function pushGraphToCanvas(def: WorkflowDefinition, opts: PushGraphOptions = {}): Promise<{ base: string; boardId: string; seq: number }> {
  const base = (opts.canvas || process.env.AWD_CANVAS_URL || 'http://localhost:4400').replace(/\/$/, '')
  const { graph, files } = withDetails(toGraph(def), opts.file)
  const title = `${def.name} — workflow.yaml`
  const api = async <T,>(method: string, p: string, body?: unknown): Promise<T> => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`)
    return res.json() as Promise<T>
  }
  const { boards } = await api<{ boards: Array<{ id: string; title: string; kind: string }> }>('GET', '/api/boards')
  let board = boards.find((b) => b.kind === 'workflow' && b.title === title)
  if (!board) board = (await api<{ board: { id: string; title: string; kind: string } }>('POST', '/api/boards', { title, kind: 'workflow' })).board
  const { items: drawn } = await api<{ items: BoardItem[] }>('POST', `/api/boards/${board.id}/template`, { kind: 'workflow', content: graph })
  const { board: current } = await api<{ board: { items: Record<string, BoardItem>; meta?: { workflow?: { statusUrl?: string } } & Record<string, unknown> } }>('GET', `/api/boards/${board.id}`)
  const { changes } = await api<{ changes: UserChange[] }>('GET', `/api/boards/${board.id}/changes?since=0&author=user`)
  const ops = planRedraw(current.items, drawn, placedByUser(changes))
  const { seq } = await api<{ seq: number }>('POST', `/api/boards/${board.id}/ops`, { author: 'agent', ops, note: `awd graph: ${def.name}` })
  // A redraw without --runtime keeps the runtime the board already points at (studio redraws without one).
  const statusUrl = (opts.runtime || process.env.AWD_RUNTIME_URL || current.meta?.workflow?.statusUrl || 'http://localhost:4311').replace(/\/$/, '')
  // PUT replaces meta whole: keep the other keys, replace only `workflow`.
  const meta = { ...current.meta, workflow: { statusUrl, name: def.name, file: opts.file ? path.resolve(opts.file) : undefined, ...files } }
  await api('PUT', `/api/boards/${board.id}`, { meta })
  return { base, boardId: board.id, seq }
}

/**
 * The graph with `detail` on every node and agent, plus the text of the files
 * behind it (docs/studio.md §5) — only when we know the file to read around.
 */
export function withDetails(graph: ReturnType<typeof toGraph>, file?: string) {
  if (!file) return { graph, files: undefined }
  const wf = loadWorkflow(file)
  const opts = { root: repoRoot(wf.dir), readFile: (p: string) => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : undefined) }
  const d = blockDetails(wf, opts)
  return {
    graph: {
      ...graph,
      nodes: graph.nodes.map((n) => (d.nodes[n.id] ? { ...n, detail: d.nodes[n.id] } : n)),
      agents: graph.agents.map((a) => (d.agents[a.id] ? { ...a, detail: d.agents[a.id] } : a)),
    },
    files: workflowFiles(wf, d, opts),
  }
}

/** The git top level above `dir`, else `dir` itself. */
export function repoRoot(dir: string): string {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    if (path.dirname(d) === d) return dir
  }
}

type TemplateOp = { kind: string; id?: string; patch?: Record<string, unknown>; item?: BoardItem }
type BoardItem = { id: string; type: string; from?: string; to?: string; data?: Record<string, unknown>; [k: string]: unknown }
const GEOMETRY = ['x', 'y', 'w', 'h', 'parent', 'order', 'fontSize']

type UserChange = { ops: TemplateOp[] }

/** Items the person has ever moved or resized — from the change log, since every update rewrites `updatedBy`. */
export function placedByUser(changes: UserChange[]): Set<string> {
  const ids = new Set<string>()
  for (const ch of changes) for (const op of ch.ops) if (op.kind === 'update' && op.id && op.patch && GEOMETRY.some((k) => k in op.patch!)) ids.add(op.id)
  return ids
}

/**
 * A redraw refreshes what a block says, never where the person put it: an update for an
 * item the user has placed keeps its geometry (the file changed, not the layout).
 */
export function keepUserLayout(ops: TemplateOp[], placed: Set<string>): TemplateOp[] {
  return ops.map((op) => {
    if (op.kind !== 'update' || !op.id || !placed.has(op.id) || !op.patch) return op
    const patch = Object.fromEntries(Object.entries(op.patch).filter(([k]) => !GEOMETRY.includes(k) && k !== 'updatedBy' && k !== 'createdBy'))
    return { ...op, patch }
  })
}

// ── Complete redraw with pending wire edits (docs/studio.md §7) ──────────────

/** Items the workflow template owns: its scope prefix. Comments and hand-drawn items never start with it. */
const SCOPE = 'wf.'

export interface RedrawScope {
  /** Id prefix of the items this drawing owns: `wf.` for a workflow board, `<key>.` for a diagram frame. */
  prefix: string
  /** Ids the drawing owns without the prefix (e.g. the diagram frame itself) — never removed as stale. */
  keep?: Set<string>
}

interface WireEnd { from: string; to: string; event?: string; condition?: string }
interface Pending { kind: 'rewire' | 'add' | 'remove' | 'relabel'; before?: WireEnd; after?: WireEnd; /** a proposed element: the trace that explains it */ trace?: { from: string; rel: string } }

const pendingOf = (it: BoardItem | undefined): Pending | undefined => {
  const p = it?.data?.pending as Pending | undefined
  return p && typeof p.kind === 'string' ? p : undefined
}
/** `plan` and `wf.node.plan` name the same block. */
const node = (id: string) => id.replace(/^wf\.node\./, '')
const wireOf = (it: BoardItem) => it.data?.event as WireEnd | undefined
const sameWire = (drawn: BoardItem, want: WireEnd) => {
  const w = wireOf(drawn)
  return !!w && node(w.from) === node(want.from) && node(w.to) === node(want.to) && (want.event === undefined || w.event === want.event)
}

/** `data` keys that say how an item is shown or read, not what it means — a redraw keeps them. */
const PRESENTATION = ['seenBy', 'agentState', 'fromSide', 'toSide', 'bend']
function withPresentation(drawn: BoardItem, was: BoardItem): BoardItem {
  const kept = Object.fromEntries(PRESENTATION.filter((k) => was.data && k in was.data).map((k) => [k, was.data![k]]))
  return Object.keys(kept).length ? { ...drawn, data: { ...drawn.data, ...kept } } : drawn
}

/** Has the drawing (the files) caught up with what the person proposed? */
export function isResolved(p: Pending, drawn: BoardItem[]): boolean {
  // A proposed element (a story from EventStorming, §4) is explained once an element with the same trace is drawn.
  if (p.trace) return drawn.some((d) => ((d.data?.traces as Array<{ from: string; rel: string }> | undefined) ?? []).some((t) => t.from === p.trace!.from && t.rel === p.trace!.rel))
  const wires = drawn.filter((d) => d.type === 'arrow' && wireOf(d))
  if (p.kind === 'remove') return !!p.before && !wires.some((w) => sameWire(w, p.before!))
  return !!p.after && wires.some((w) => sameWire(w, p.after!))
}

/**
 * The ops that make the board match the drawing: add/update every drawn item (keeping the
 * geometry of items the person placed), remove template items the drawing no longer has, and
 * leave a wire the person edited exactly as they left it until the files explain it.
 */
export function planRedraw(board: Record<string, BoardItem>, drawn: BoardItem[], placed: Set<string>, scope: RedrawScope = { prefix: SCOPE }): TemplateOp[] {
  const drawnIds = new Set(drawn.map((d) => d.id))
  const held = new Set<string>() // pending, not yet resolved: untouchable
  const ops: TemplateOp[] = []
  // A proposal belongs to this drawing when the item (or both ends of a wire the person drew) is in its scope;
  // another frame's proposals are not ours to settle.
  const owned = (it: BoardItem) =>
    it.id.startsWith(scope.prefix) || (it.type === 'arrow' && !!it.from && !!it.to && [it.from, it.to].every((e) => e.startsWith(scope.prefix) || scope.keep?.has(e)))
  for (const it of Object.values(board)) {
    const p = pendingOf(it)
    if (!p || !owned(it)) continue
    if (!isResolved(p, drawn)) held.add(it.id)
    else if (!drawnIds.has(it.id)) ops.push({ kind: 'remove', id: it.id }) // resolved: the drawn wire replaces it
  }
  const updates: TemplateOp[] = []
  for (const d of drawn) {
    if (held.has(d.id)) continue
    const was = board[d.id]
    updates.push(was ? { kind: 'update', id: d.id, patch: withPresentation(d, was) } : { kind: 'add', item: d })
  }
  for (const it of Object.values(board)) {
    if (held.has(it.id) || drawnIds.has(it.id) || pendingOf(it) || scope.keep?.has(it.id)) continue
    if (it.id.startsWith(scope.prefix) && it.type !== 'comment') ops.push({ kind: 'remove', id: it.id })
  }
  return [...keepUserLayout(updates, placed), ...ops]
}
