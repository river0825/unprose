// Workflow definition: the normalized, in-memory shape of workflow.yaml.
// parseWorkflow() is the only way to get one; it accepts the loose YAML
// shape and fills every default so the rest of the code never checks for
// "string or array" or "30m vs number".

import YAML from 'yaml'
import { parseMemoryConfig, type AgentMemoryConfig } from './memory.js'

export type StepKind = 'script' | 'ai' | 'gate' | 'human'
export type TriggerKind = 'webhook' | 'cron' | 'cli' | 'manual' | 'board'

export interface Listener {
  /** Event type, e.g. `card.moved` or `qualify.pick`. */
  event: string
  /** Optional expression over { event, vars, key, env, now }. */
  if?: string
}

export interface RetryPolicy {
  max: number
  /** Milliseconds between attempts. */
  backoff: number
}

export interface TriggerDef {
  id: string
  on: TriggerKind
  /** Event type this trigger emits (defaults to the trigger id). */
  emit: string
  path?: string
  /** cron: interval in ms. */
  every?: number
  /** cron: daily time "HH:MM" (local). */
  at?: string
  /** Template object evaluated over { body, query, headers, env, now } (webhook) or { card, from, to, author, seq, env, now } (board). */
  data?: unknown
  if?: string
  // --- board trigger (a kanban board on the canvas is the event source) ---
  /** Board id, or `title:<board title>`. */
  board?: string
  /** Key of the kanban diagram frame on that board (docs/diagrams.md §7). Optional when the board holds one kanban. */
  frame?: string
  /** Canvas server URL (default AWD_CANVAS_URL or http://localhost:4400). */
  canvas?: string
  /** Whose card moves count: `user` (default), `agent`, or `all`. */
  author?: 'user' | 'agent' | 'all'
}

interface StepBase {
  id: string
  on: Listener[]
  outcomes: string[]
  timeout?: number
  retry?: RetryPolicy
  /** Outcomes nobody needs to consume. */
  terminal?: string[]
  description?: string
}

export interface ScriptStep extends StepBase {
  kind: 'script'
  run: string
  cwd?: string
  env?: Record<string, string>
}

export interface AiStep extends StepBase {
  kind: 'ai'
  ai: {
    /** Which of `agents:` does this step (preferred). */
    agent?: string
    /** Legacy: roles/<role>.md is the system prompt. */
    role?: string
    prompt?: string
    /** Overrides the agent's model for this step. */
    model?: string
    input?: unknown
    /** JSON schema; must contain an `outcome` enum. */
    output: Record<string, unknown>
  }
}

export type AgentRunner = 'claude-code' | 'anthropic' | 'fake' | 'cli' | 'herdr'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * An agent is a *who*: a persona with a model, a prompt and the tools it may
 * touch. Steps are the *what*. CrewAI's Agent/Task split, kept as data.
 */
export interface AgentDef {
  id: string
  description?: string
  /** Inline system prompt (templated with the step scope). */
  system?: string
  /** Path to a prompt file, relative to the workflow. */
  file?: string
  model?: string
  tools?: string[]
  effort?: Effort
  maxTurns?: number
  /** Agents this one may hand work to (documentation + lint). */
  delegates?: string[]
  /** Which WorkerRuntime executes this agent. Default: the `--worker` flag. */
  runner?: AgentRunner
  /** runner: cli — a headless CLI agent that prints its answer. */
  cli?: { command?: string; preset?: 'codex' | 'opencode'; cwd?: string; timeoutMs?: number; stdin?: boolean }
  /** runner: herdr — an interactive agent in a herdr pane, driven by prompts. */
  herdr?: { kind: string; name?: string; cwd?: string; timeoutMs?: number }
  /** runner: claude-code — where and how the `claude` CLI runs (cwd is templated, e.g. "{{ vars.worktree.path }}"). */
  claudeCode?: { permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'; cwd?: string; addDirs?: string[] }
  /** Short-term (this run) and long-term (this project) memory; default both on. */
  memory?: AgentMemoryConfig
}

/** An agent after the loader merged yaml + agents/<id>.md and read the prompt file. */
export interface ResolvedAgent extends AgentDef {
  /** The system prompt text (from `system`, `file`, the agents/*.md body, or roles/<id>.md). */
  system?: string
}

export interface GateStep extends StepBase {
  kind: 'gate'
  gate: {
    /** outcome → expression, evaluated in order. */
    outcomes: Array<{ outcome: string; if: string }>
    default?: string
  }
}

export interface HumanStep extends StepBase {
  kind: 'human'
  human: {
    resume_on: string[]
    outcomes: Array<{ outcome: string; if: string }>
  }
}

export type StepDef = ScriptStep | AiStep | GateStep | HumanStep

export interface WorkflowDefinition {
  name: string
  key?: string
  concurrency: number
  triggers: TriggerDef[]
  steps: StepDef[]
  /** `agents:` block, as written (files are merged in by the loader). */
  agents: Record<string, AgentDef>
  /** Anything else on the document, kept for tooling. */
  extra: Record<string, unknown>
}

const DURATION_RE = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?\s*$/i
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }

/** "30m" → 1_800_000. Numbers are taken as milliseconds. */
export function parseDuration(v: unknown, where = 'duration'): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') throw new Error(`${where}: expected a duration like "30m", got ${JSON.stringify(v)}`)
  const m = DURATION_RE.exec(v)
  if (!m) throw new Error(`${where}: bad duration "${v}" (use ms|s|m|h|d|w)`)
  return Number(m[1]) * UNIT_MS[(m[2] ?? 'ms').toLowerCase()]
}

export function formatDuration(ms: number): string {
  for (const [u, n] of [['w', UNIT_MS.w], ['d', UNIT_MS.d], ['h', UNIT_MS.h], ['m', UNIT_MS.m], ['s', UNIT_MS.s]] as const) {
    if (ms >= n && ms % n === 0) return `${ms / n}${u}`
  }
  return `${ms}ms`
}

function asRecord(v: unknown, where: string): Record<string, unknown> {
  if (v === null || v === undefined) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${where}: expected a mapping`)
  return v as Record<string, unknown>
}

function parseListeners(raw: unknown, where: string): Listener[] {
  if (raw === undefined || raw === null) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map((item, i) => {
    if (typeof item === 'string') return { event: item }
    const r = asRecord(item, `${where}.on[${i}]`)
    if (typeof r.event !== 'string') throw new Error(`${where}.on[${i}]: needs an "event"`)
    return { event: r.event, if: typeof r.if === 'string' ? r.if : undefined }
  })
}

/** `{ a: "expr", b: "expr" }` or `[{ outcome, if }]` → ordered list. */
function parseConditionalOutcomes(raw: unknown, where: string): Array<{ outcome: string; if: string }> {
  if (raw === undefined || raw === null) return []
  if (Array.isArray(raw)) {
    return raw.map((r, i) => {
      const o = asRecord(r, `${where}[${i}]`)
      return { outcome: String(o.outcome), if: String(o.if ?? 'true') }
    })
  }
  const r = asRecord(raw, where)
  return Object.entries(r).map(([outcome, cond]) => ({ outcome, if: cond === true || cond === null ? 'true' : String(cond) }))
}

function parseRetry(raw: unknown, where: string): RetryPolicy | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number') return { max: raw, backoff: 0 }
  const r = asRecord(raw, where)
  return { max: Number(r.max ?? 1), backoff: r.backoff === undefined ? 0 : parseDuration(r.backoff, `${where}.backoff`) }
}

function parseStep(id: string, raw: unknown): StepDef {
  const r = asRecord(raw, `steps.${id}`)
  const where = `steps.${id}`
  const on = parseListeners(r.on, where)
  // A top-level `if` is sugar for the same condition on every listener.
  if (typeof r.if === 'string') for (const l of on) l.if = l.if ? `(${l.if}) && (${r.if})` : r.if

  const base = {
    id,
    on,
    timeout: r.timeout === undefined ? undefined : parseDuration(r.timeout, `${where}.timeout`),
    retry: parseRetry(r.retry, `${where}.retry`),
    terminal: r.terminal === true ? ['*'] : Array.isArray(r.terminal) ? r.terminal.map(String) : typeof r.terminal === 'string' ? [r.terminal] : undefined,
    description: typeof r.description === 'string' ? r.description : undefined,
  }
  const declared = Array.isArray(r.outcomes) ? r.outcomes.map(String) : typeof r.outcomes === 'string' ? [r.outcomes] : undefined

  if (typeof r.run === 'string') {
    return { ...base, kind: 'script', run: r.run, cwd: typeof r.cwd === 'string' ? r.cwd : undefined,
      env: r.env ? Object.fromEntries(Object.entries(asRecord(r.env, `${where}.env`)).map(([k, v]) => [k, String(v)])) : undefined,
      outcomes: declared ?? ['done'] }
  }
  if (r.ai !== undefined) {
    const ai = asRecord(r.ai, `${where}.ai`)
    const output = asRecord(ai.output, `${where}.ai.output`)
    const enumOutcomes = outcomeEnum(output)
    return { ...base, kind: 'ai', outcomes: declared ?? enumOutcomes ?? ['done'],
      ai: { agent: typeof ai.agent === 'string' ? ai.agent : undefined, role: typeof ai.role === 'string' ? ai.role : undefined,
        prompt: typeof ai.prompt === 'string' ? ai.prompt : undefined,
        model: typeof ai.model === 'string' ? ai.model : undefined, input: ai.input, output } }
  }
  if (r.gate !== undefined) {
    const g = asRecord(r.gate, `${where}.gate`)
    const outcomes = parseConditionalOutcomes(g.outcomes ?? g, `${where}.gate.outcomes`).filter((o) => o.outcome !== 'default')
    const def = typeof g.default === 'string' ? g.default : undefined
    const names = outcomes.map((o) => o.outcome)
    if (def && !names.includes(def)) names.push(def)
    return { ...base, kind: 'gate', outcomes: declared ?? names, gate: { outcomes, default: def } }
  }
  if (r.human !== undefined) {
    const h = asRecord(r.human, `${where}.human`)
    const resume = h.resume_on === undefined ? [] : Array.isArray(h.resume_on) ? h.resume_on.map(String) : [String(h.resume_on)]
    const outcomes = parseConditionalOutcomes(h.outcomes, `${where}.human.outcomes`)
    return { ...base, kind: 'human', outcomes: declared ?? outcomes.map((o) => o.outcome), human: { resume_on: resume, outcomes } }
  }
  throw new Error(`${where}: a step needs one of run:, ai:, gate:, human:`)
}

/** Pull the `outcome` enum out of an AI output schema, if declared. */
export function outcomeEnum(schema: Record<string, unknown>): string[] | undefined {
  const props = schema.properties as Record<string, unknown> | undefined
  const o = props?.outcome as Record<string, unknown> | undefined
  if (o && Array.isArray(o.enum)) return o.enum.map(String)
  return undefined
}

function parseTrigger(id: string, raw: unknown): TriggerDef {
  const r = asRecord(raw, `triggers.${id}`)
  const on = String(r.on ?? 'manual') as TriggerKind
  return {
    id, on,
    emit: typeof r.emit === 'string' ? r.emit : id,
    path: typeof r.path === 'string' ? r.path : on === 'webhook' ? `/hooks/${id}` : undefined,
    every: r.every === undefined ? undefined : parseDuration(r.every, `triggers.${id}.every`),
    at: typeof r.at === 'string' ? r.at : undefined,
    data: r.data,
    if: typeof r.if === 'string' ? r.if : undefined,
    board: typeof r.board === 'string' ? r.board : undefined,
    frame: typeof r.frame === 'string' ? r.frame : undefined,
    canvas: typeof r.canvas === 'string' ? r.canvas : undefined,
    author: r.author === 'agent' || r.author === 'all' ? r.author : r.author === undefined ? undefined : 'user',
  }
}

const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : undefined)

/** Parse one agent from the yaml block or a frontmatter object. Unknown keys are dropped. */
export function parseAgent(id: string, raw: unknown): AgentDef {
  const r = asRecord(raw, `agents.${id}`)
  const a: AgentDef = { id }
  if (typeof r.description === 'string') a.description = r.description
  if (typeof r.system === 'string') a.system = r.system
  if (typeof r.file === 'string') a.file = r.file
  if (typeof r.model === 'string') a.model = r.model
  if (r.tools !== undefined) a.tools = Array.isArray(r.tools) ? (r.tools as unknown[]).map((t) => (typeof t === 'string' ? t : JSON.stringify(t))) : strList(r.tools)
  if (typeof r.effort === 'string') a.effort = r.effort as Effort
  if (r.maxTurns !== undefined) a.maxTurns = Number(r.maxTurns)
  if (r.delegates !== undefined) a.delegates = strList(r.delegates)
  if (typeof r.runner === 'string') a.runner = r.runner as AgentRunner
  if (r.cli !== undefined) {
    const c = asRecord(r.cli, `agents.${id}.cli`)
    a.cli = { command: typeof c.command === 'string' ? c.command : undefined, preset: typeof c.preset === 'string' ? (c.preset as 'codex' | 'opencode') : undefined,
      cwd: typeof c.cwd === 'string' ? c.cwd : undefined, timeoutMs: c.timeoutMs === undefined ? undefined : parseDuration(c.timeoutMs, `agents.${id}.cli.timeoutMs`),
      stdin: typeof c.stdin === 'boolean' ? c.stdin : undefined }
  }
  if (r.herdr !== undefined) {
    const h = asRecord(r.herdr, `agents.${id}.herdr`)
    a.herdr = { kind: String(h.kind ?? ''), name: typeof h.name === 'string' ? h.name : undefined, cwd: typeof h.cwd === 'string' ? h.cwd : undefined,
      timeoutMs: h.timeoutMs === undefined ? undefined : parseDuration(h.timeoutMs, `agents.${id}.herdr.timeoutMs`) }
  }
  if (r.memory !== undefined) a.memory = parseMemoryConfig(r.memory, `agents.${id}.memory`)
  if (r.claudeCode !== undefined) {
    const c = asRecord(r.claudeCode, `agents.${id}.claudeCode`)
    a.claudeCode = {
      permissionMode: typeof c.permissionMode === 'string' ? (c.permissionMode as NonNullable<AgentDef['claudeCode']>['permissionMode']) : undefined,
      cwd: typeof c.cwd === 'string' ? c.cwd : undefined,
      addDirs: Array.isArray(c.addDirs) ? c.addDirs.map(String) : undefined,
    }
  }
  return a
}

export function parseWorkflow(source: string | object): WorkflowDefinition {
  const doc = typeof source === 'string' ? YAML.parse(source) : source
  const r = asRecord(doc, 'workflow')
  if (typeof r.name !== 'string' || !r.name) throw new Error('workflow: "name" is required')
  const triggers = Object.entries(asRecord(r.triggers, 'triggers')).map(([id, t]) => parseTrigger(id, t))
  const steps = Object.entries(asRecord(r.steps, 'steps')).map(([id, s]) => parseStep(id, s))
  const agents = Object.fromEntries(Object.entries(asRecord(r.agents, 'agents')).map(([id, a]) => [id, parseAgent(id, a)]))
  const { name, key, concurrency, triggers: _t, steps: _s, agents: _a, ...extra } = r
  return {
    name,
    key: typeof key === 'string' ? key : undefined,
    concurrency: concurrency === undefined || concurrency === null ? 1 : Number(concurrency),
    triggers, steps, agents, extra,
  }
}

/** Known model aliases; anything else must look like a real model id. */
export const MODEL_ALIAS_NAMES = ['opus', 'sonnet', 'haiku', 'fable']

export function findStep(def: WorkflowDefinition, id: string): StepDef | undefined {
  return def.steps.find((s) => s.id === id)
}
