// `awd graph wf.yaml --canvas [url]` (and `awd studio`) — draw the workflow on
// the canvas server as a `workflow` board. Item ids are deterministic, so running
// it again after editing the yaml updates the same board in place instead of
// drawing a second copy. Every block carries its full detail (docs/studio.md §1).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { boardByTitle, canvasApi, canvasBase, holderInfo, registerProject } from './projects.js'
import { afterApplied, type AppliedResult } from './applied.js'
import { toGraph, type WorkflowDefinition } from '@awd/core'
import { loadWorkflow, blockDetails, workflowFiles } from '@awd/runtime'
import { explainRedraw, planLines, redrawInputs, type LoggedChange, type RedrawPlan } from '@awd/canvas/diagrams'

export interface PushGraphOptions {
  /** Canvas server (default AWD_CANVAS_URL or http://localhost:4400). */
  canvas?: string
  /** Where the run overlay should look for live state (default AWD_RUNTIME_URL or http://localhost:4311). */
  runtime?: string
  /** The workflow file — needed for block details (agent files, scripts, line numbers). */
  file?: string
  /** The proposal thread this redraw applies: answers "Applied …" there; commits if UNPROSE_APPLY_COMMIT=1. */
  applied?: string
}

export async function pushGraphToCanvas(def: WorkflowDefinition, opts: PushGraphOptions = {}): Promise<{ base: string; boardId: string; seq: number; applied?: AppliedResult }> {
  const base = canvasBase(opts.canvas)
  const { graph, files } = withDetails(toGraph(def), opts.file)
  const title = `${def.name} — workflow.yaml`
  const api = canvasApi(base)
  // the board lives in the workflow's project (its repo), found there by title or created there
  const project = opts.file ? await registerProject(api, repoRoot(path.dirname(path.resolve(opts.file)))) : undefined
  const board = await boardByTitle(api, title, 'workflow', project, (b) => b.kind === 'workflow', true)
  const { items: drawn } = await api<{ items: BoardItem[] }>('POST', `/api/boards/${board.id}/template`, { kind: 'workflow', content: graph })
  const { board: current } = await api<{ board: { items: Record<string, BoardItem>; meta?: { workflow?: { statusUrl?: string } } & Record<string, unknown> } }>('GET', `/api/boards/${board.id}`)
  // the whole log: what the person moved, and who added each item (docs/diagrams.md "What a redraw keeps")
  const { changes } = await api<{ changes: LoggedChange[] }>('GET', `/api/boards/${board.id}/changes?since=0`)
  const { ops } = explainRedraw(current.items, drawn, redrawInputs(changes))
  const { seq } = await api<{ seq: number }>('POST', `/api/boards/${board.id}/ops`, { author: 'agent', ops, note: `awd graph: ${def.name}` })
  // A redraw without --runtime keeps the runtime the board already points at (studio redraws without one).
  const statusUrl = (opts.runtime || process.env.AWD_RUNTIME_URL || current.meta?.workflow?.statusUrl || 'http://localhost:4311').replace(/\/$/, '')
  // PATCH merges: only `workflow` changes (whatever other machines wrote into the meta meanwhile stays).
  // the holder: this agent has the workflow's files (docs/canvas.md "Several agents on one board")
  const root = opts.file ? repoRoot(path.dirname(path.resolve(opts.file))) : undefined
  const holder = root ? { ...holderInfo(root), ...(opts.applied ? { applied: opts.applied } : {}) } : undefined
  await api('PATCH', `/api/boards/${board.id}`, { meta: { workflow: { statusUrl, name: def.name, file: opts.file ? path.resolve(opts.file) : undefined, ...files, ...(holder ? { holder } : {}) } } })
  const applied = opts.applied && root && opts.file ? await afterApplied(api, { base, boardId: board.id, thread: opts.applied, root, fallbackFile: path.relative(root, path.resolve(opts.file)) }) : undefined
  return { base, boardId: board.id, seq, ...(applied ? { applied } : {}) }
}

/** `awd graph --canvas --dry-run`: what the redraw would do to the workflow board — nothing written, no board created. */
export async function previewGraph(def: WorkflowDefinition, opts: PushGraphOptions & { limit?: number } = {}): Promise<{ base: string; boardId?: string; plan?: RedrawPlan; lines: string[] }> {
  const base = canvasBase(opts.canvas)
  const { graph } = withDetails(toGraph(def), opts.file)
  const title = `${def.name} — workflow.yaml`
  const api = canvasApi(base)
  const { boards } = await api<{ boards: Array<{ id: string; title: string; kind: string }> }>('GET', '/api/boards')
  const hit = boards.find((b) => b.title === title && b.kind === 'workflow')
  if (!hit) return { base, lines: [`Redraw preview — ${def.name} (dry run: nothing written)`, `  no board "${title}" yet: a real draw creates it and adds every block`] }
  const { items: drawn } = await api<{ items: BoardItem[] }>('POST', `/api/boards/${hit.id}/template`, { kind: 'workflow', content: graph })
  const { board: current } = await api<{ board: { items: Record<string, BoardItem> } }>('GET', `/api/boards/${hit.id}`)
  const { changes } = await api<{ changes: LoggedChange[] }>('GET', `/api/boards/${hit.id}/changes?since=0`)
  const { plan } = explainRedraw(current.items, drawn, redrawInputs(changes))
  return { base, boardId: hit.id, plan, lines: planLines(plan, { title: `Redraw preview — workflow ${def.name} on "${title}" (${base}/b/${hit.id})`, limit: opts.limit }) }
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

/** Files that make a folder a project root when there is no git repo (docs/canvas.md "Projects"). */
const PROJECT_MARKERS = ['package.json', 'AGENTS.md', 'CLAUDE.md', 'pyproject.toml', 'go.mod', 'Cargo.toml']
/** Folders that hold diagram files — never a project on their own (a `design/` without a repo is not "project design"). */
const DESIGN_DIRS = new Set(['design', 'designs', 'diagrams'])

/**
 * The project a file in `dir` belongs to (the project it is registered as, and what its paths are relative to):
 *   1. the nearest folder above with `.git` or `.unprose` (a repo, or a project the canvas already stores boards in);
 *   2. else the nearest with a project file (package.json, AGENTS.md, CLAUDE.md, pyproject.toml, go.mod, Cargo.toml),
 *      below the home folder;
 *   3. else the working directory, when `dir` is inside it (and it is not the home folder or `/`);
 *   4. else the folder above a `design/` (`designs/`, `diagrams/`) folder; else `dir`.
 */
export function repoRoot(dir: string, cwd = process.cwd(), home = os.homedir()): string {
  const abs = path.resolve(dir)
  const up = (stop: (d: string) => boolean): string | undefined => {
    for (let d = abs; ; d = path.dirname(d)) {
      if (stop(d)) return d
      if (path.dirname(d) === d) return undefined
    }
  }
  const has = (d: string, f: string) => fs.existsSync(path.join(d, f))
  const repo = up((d) => has(d, '.git') || has(d, path.join('.unprose', 'boards')))
  if (repo) return repo
  const homeDir = path.resolve(home)
  const marked = up((d) => d !== homeDir && path.dirname(d) !== d && d.startsWith(homeDir === '/' ? '/' : homeDir + path.sep) && PROJECT_MARKERS.some((f) => has(d, f)))
  if (marked) return marked
  const wd = path.resolve(cwd)
  if (wd !== homeDir && path.dirname(wd) !== wd && (abs === wd || abs.startsWith(wd + path.sep)) && !DESIGN_DIRS.has(path.basename(wd))) return wd
  if (DESIGN_DIRS.has(path.basename(abs))) {
    const parent = path.dirname(abs)
    if (parent !== homeDir && path.dirname(parent) !== parent) return parent
  }
  return abs
}

// The redraw rules are pure and live in @awd/canvas (the server's remote design tools use them too).
export { keepUserLayout, isResolved, planRedraw, placedByUser, type RedrawScope } from '@awd/canvas/diagrams'
type BoardItem = { id: string; type: string; from?: string; to?: string; data?: Record<string, unknown>; [k: string]: unknown }
