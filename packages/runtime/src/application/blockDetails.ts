// Block details — what each block on the workflow board *is*, in full: an
// agent's persona, the prompt an ai step really sends, when a gate lets a run
// through, the script a step runs. Pure: file contents come in through
// `readFile`; the CLI hands it the fs one. See docs/studio.md §1.

import path from 'node:path'
import { formatDuration, type ResolvedAgent, type StepDef, type TriggerDef, type WorkflowDefinition } from '@awd/core'
import { splitFrontmatter } from './agents.js'
import { renderPrompt } from './prompting.js'
import type { WorkerRequest } from '../ports/workerRuntime.js'

/** What blockDetails needs from a loaded workflow (the LoadedWorkflow shape, minus the store bits). */
export interface WorkflowSource {
  def: WorkflowDefinition
  /** Absolute path of workflow.yaml. */
  file: string
  /** Directory of workflow.yaml. */
  dir: string
  roles: Record<string, string>
  agents: Record<string, ResolvedAgent>
}

export interface DetailOptions {
  /** Absolute path → text, or undefined when there is no such file. */
  readFile: (abs: string) => string | undefined
  /** Paths in the details are relative to this (the repo root). Default: the workflow dir. */
  root?: string
}

export type BlockDetail = Record<string, unknown> & {
  kind: string
  source: { workflow: string; line?: number }
  /** 1-based line range of this block in the workflow file (absent for agents that live only in their own file). */
  yaml?: { start: number; end: number }
  listens: string[]
  emits: string[]
}

export interface BlockDetails {
  /** By graph node id (triggers, steps). */
  nodes: Record<string, BlockDetail>
  /** By agent id. */
  agents: Record<string, BlockDetail>
}

const MAX_SOURCE = 20_000
const MAX_FILE = 100_000

export function blockDetails(wf: WorkflowSource, opts: DetailOptions): BlockDetails {
  const root = opts.root ?? wf.dir
  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/')
  const exists = (abs: string) => opts.readFile(abs) !== undefined
  const ranges = keyRanges(opts.readFile(wf.file) ?? '')
  const source = (section: string, id: string) => ({ workflow: rel(wf.file), line: ranges[section]?.[id]?.start })
  const yaml = (section: string, id: string) => (ranges[section]?.[id] ? { yaml: ranges[section][id] } : {})
  const def = wf.def

  const nodes: Record<string, BlockDetail> = {}
  for (const t of def.triggers) {
    nodes[t.id] = { kind: 'trigger', on: t.on, emit: t.emit, config: triggerConfig(t), source: source('triggers', t.id), ...yaml('triggers', t.id), listens: [], emits: [t.emit] }
  }
  for (const s of def.steps) {
    const common = { source: source('steps', s.id), ...yaml('steps', s.id), listens: s.on.map((l) => (l.if ? `${l.event} if ${l.if}` : l.event)), emits: [...s.outcomes, 'failed', 'timeout'].map((o) => `${s.id}.${o}`) }
    nodes[s.id] = { ...stepDetail(s, wf, rel, exists, opts.readFile, root), ...common }
  }

  const agents: Record<string, BlockDetail> = {}
  const stepsOf = (id: string, byRole = false) => def.steps.filter((s) => s.kind === 'ai' && (byRole ? !s.ai.agent && s.ai.role === id : s.ai.agent === id)).map((s) => s.id)
  for (const a of Object.values(wf.agents)) {
    const md = path.join(wf.dir, 'agents', `${a.id}.md`)
    const file = a.file ? path.resolve(wf.dir, a.file) : exists(md) ? md : undefined
    const text = file ? opts.readFile(file) : undefined
    const { system, id: _id, ...frontmatter } = a
    agents[a.id] = {
      kind: 'agent',
      file: file ? rel(file) : undefined,
      persona: text !== undefined ? splitFrontmatter(text).body.trim() : system?.trim(),
      frontmatter,
      steps: stepsOf(a.id),
      source: source('agents', a.id),
      ...yaml('agents', a.id),
      listens: [],
      emits: [],
    }
  }
  // legacy `role:` steps show up as agents too (matches toGraph)
  for (const s of def.steps) {
    if (s.kind !== 'ai' || s.ai.agent || !s.ai.role || agents[s.ai.role]) continue
    const role = s.ai.role
    agents[role] = { kind: 'agent', file: roleFile(wf, role, rel, exists), persona: wf.roles[role]?.trim(), frontmatter: {}, steps: stepsOf(role, true), source: { workflow: rel(wf.file) }, listens: [], emits: [] }
  }
  return { nodes, agents }
}

function stepDetail(s: StepDef, wf: WorkflowSource, rel: (abs: string) => string, exists: (abs: string) => boolean, readFile: DetailOptions['readFile'], root: string): Record<string, unknown> & { kind: string } {
  if (s.kind === 'script') {
    // the first word of `run` that is a file in the repo, e.g. `bash scripts/card_info.sh {{ key }}` or
    // `python3 ../scripts/state.py release {{ key }}` (a script beside the workflow's folder); quotes and
    // `--opt=<path>` are looked through
    const base = s.cwd ? path.resolve(wf.dir, s.cwd) : wf.dir
    const words = s.run.split(/\s+/).flatMap((w) => [w, w.includes('=') ? w.slice(w.indexOf('=') + 1) : '']).map((w) => w.replace(/^['"]|['";|&)]+$/g, ''))
    const inRepo = (abs: string) => abs === root || abs.startsWith(root + path.sep) || abs.startsWith(wf.dir + path.sep)
    const file = words.filter((w) => w && !w.includes('{{') && !w.startsWith('-')).map((w) => path.resolve(base, w)).find((abs) => inRepo(abs) && exists(abs))
    const text = file ? readFile(file) : undefined
    return { kind: 'script', run: s.run, file: file ? rel(file) : undefined, code: text?.slice(0, MAX_SOURCE), ...(text && text.length > MAX_SOURCE ? { truncated: true } : {}) }
  }
  if (s.kind === 'ai') {
    const agent = s.ai.agent ? wf.agents[s.ai.agent] : undefined
    // same order as the reducer: inline prompt, agent, role file
    const system = s.ai.prompt ?? agent?.system ?? (s.ai.role ? wf.roles[s.ai.role] : undefined) ?? (s.ai.agent ? wf.roles[s.ai.agent] : undefined)
    const req = { system, input: s.ai.input ?? {}, outputSchema: s.ai.output } as WorkerRequest
    const md = s.ai.agent ? path.join(wf.dir, 'agents', `${s.ai.agent}.md`) : undefined
    const file = agent?.file ? rel(path.resolve(wf.dir, agent.file)) : md && exists(md) ? rel(md) : s.ai.role ? roleFile(wf, s.ai.role, rel, exists) : undefined
    return {
      kind: 'ai', agent: s.ai.agent, role: s.ai.role, model: s.ai.model ?? agent?.model, file,
      prompt: renderPrompt(req), input: (s.ai.input ?? {}) as Record<string, unknown>, output: s.ai.output, outcomes: s.outcomes,
    }
  }
  const ends = (o: string) => !!s.terminal && (s.terminal.includes('*') || s.terminal.includes(o))
  const rules = (s.kind === 'gate' ? s.gate.outcomes : s.human.outcomes).map((r) => ({ outcome: r.outcome, when: r.if, terminal: ends(r.outcome) }))
  if (s.kind === 'gate' && s.gate.default) rules.push({ outcome: s.gate.default, when: 'otherwise', terminal: ends(s.gate.default) })
  const verb = (o: string) => (ends(o) ? `Ends the run as "${o}"` : `Goes on as "${o}"`)
  const plain = [
    ...(s.kind === 'human' ? [`Waits for ${s.human.resume_on.join(' or ')}`] : []),
    ...rules.map((r) => `${verb(r.outcome)} ${r.when === 'otherwise' ? 'otherwise' : `when ${r.when}`}`),
    ...(s.timeout ? [`${ends('timeout') ? 'Stops the run' : 'Goes on'} as "timeout" after ${formatDuration(s.timeout)}`] : []),
  ]
  return { kind: s.kind, rules, resumeOn: s.kind === 'human' ? s.human.resume_on : undefined, timeout: s.timeout ? formatDuration(s.timeout) : undefined, plain }
}

function roleFile(wf: WorkflowSource, role: string, rel: (abs: string) => string, exists: (abs: string) => boolean): string | undefined {
  const hit = ['md', 'txt'].map((ext) => path.join(wf.dir, 'roles', `${role}.${ext}`)).find(exists)
  return hit ? rel(hit) : undefined
}

function triggerConfig(t: TriggerDef): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of ['path', 'at', 'board', 'canvas', 'author', 'if', 'data'] as const) if (t[k] !== undefined) out[k] = t[k]
  if (t.every) out.every = formatDuration(t.every)
  return out
}

/** 1-based line of every second-level key, by top-level section: { steps: { plan: 42 }, agents: {...} }. */
export function keyLines(yaml: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const [section, keys] of Object.entries(keyRanges(yaml))) {
    out[section] = {}
    for (const [k, r] of Object.entries(keys)) out[section][k] = r.start
  }
  return out
}

/**
 * 1-based line range of every second-level key, by top-level section. A block ends
 * before the next sibling key (or the next section), minus trailing blank and
 * comment lines — a `# ── Build ──` banner belongs to what follows it.
 */
export function keyRanges(yaml: string): Record<string, Record<string, { start: number; end: number }>> {
  const out: Record<string, Record<string, { start: number; end: number }>> = {}
  const lines = yaml.split('\n')
  let section: string | undefined
  let indent: number | undefined
  let open: { start: number; end: number } | undefined
  const close = (next: number) => {
    if (!open) return
    let end = next - 1 // the line before `next` (both 1-based)
    while (end > open.start && /^\s*(#.*)?$/.test(lines[end - 1])) end--
    open.end = end
    open = undefined
  }
  lines.forEach((line, i) => {
    const top = /^([A-Za-z_][\w-]*):/.exec(line)
    if (top) { close(i + 1); section = top[1]; indent = undefined; out[section] = {}; return }
    const m = /^( +)(["']?)([^"'\s#:][^"':]*)\2:(\s|$)/.exec(line)
    if (!section || !m) return
    indent ??= m[1].length
    if (m[1].length !== indent) return
    close(i + 1)
    open = out[section][m[3]] = { start: i + 1, end: i + 1 }
  })
  close(lines.length + 1)
  return out
}

/**
 * The text of every file behind the workflow, repo-relative: the workflow yaml,
 * agent files, role/prompt files, script files (whatever the details point at).
 * Each is cut at 100 000 chars and listed in `truncated`. docs/studio.md §5.
 */
export function workflowFiles(wf: WorkflowSource, details: BlockDetails, opts: DetailOptions): { files: Record<string, string>; truncated: string[] } {
  const root = opts.root ?? wf.dir
  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/')
  const paths = new Set<string>([rel(wf.file)])
  for (const d of [...Object.values(details.nodes), ...Object.values(details.agents)]) if (typeof d.file === 'string') paths.add(d.file)
  const files: Record<string, string> = {}
  const truncated: string[] = []
  for (const p of [...paths].sort()) {
    const text = opts.readFile(path.resolve(root, p))
    if (text === undefined) continue
    files[p] = text.slice(0, MAX_FILE)
    if (text.length > MAX_FILE) truncated.push(p)
  }
  return { files, truncated }
}
