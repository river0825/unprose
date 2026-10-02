// `awd graph wf.yaml --canvas [url]` (and `awd studio`) — draw the workflow on
// the canvas server as a `workflow` board. Item ids are deterministic, so running
// it again after editing the yaml updates the same board in place instead of
// drawing a second copy. Every block carries its full detail (docs/studio.md §1).

import fs from 'node:fs'
import path from 'node:path'
import { boardByTitle, canvasHeaders, registerProject } from './projects.js'
import { toGraph, type WorkflowDefinition } from '@awd/core'
import { loadWorkflow, blockDetails, workflowFiles } from '@awd/runtime'
import { planRedraw, placedByUser } from '@awd/canvas/diagrams'

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
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...canvasHeaders() }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`)
    return res.json() as Promise<T>
  }
  // the board lives in the workflow's project (its repo), found there by title or created there
  const project = opts.file ? await registerProject(api, repoRoot(path.dirname(path.resolve(opts.file)))) : undefined
  const board = await boardByTitle(api, title, 'workflow', project, (b) => b.kind === 'workflow')
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

// The redraw rules are pure and live in @awd/canvas (the server's remote design tools use them too).
export { keepUserLayout, isResolved, planRedraw, placedByUser, type RedrawScope } from '@awd/canvas/diagrams'
type BoardItem = { id: string; type: string; from?: string; to?: string; data?: Record<string, unknown>; [k: string]: unknown }
type UserChange = { ops: Array<{ kind: string; id?: string; patch?: Record<string, unknown> }> }
