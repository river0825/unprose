// (state, event) → { state, commands }. Pure. No clocks, no IO, no randomness:
// the timestamp comes from the event, ids are derived from the event id.

import type { WorkflowDefinition, StepDef, AiStep, ScriptStep, HumanStep, GateStep, ResolvedAgent } from './schema.js'
import type { Event, Command } from './events.js'
import { commandId, splitEventType } from './events.js'
import { evalCondition, templateDeep, template } from './expr.js'
import { DEFAULT_MEMORY, rememberOf, stripMemoryFields, withMemoryProperties, type MemoryTrailEntry } from './memory.js'
import { listenerMatches } from './reflection.js'

export type RunStatus = 'idle' | 'running' | 'waiting' | 'done' | 'failed'

export interface ActiveStep { commandId: string; since: string; attempt: number; timerId?: string; /** ai steps: the agent doing the work */ agent?: string }
export interface WaitingStep { since: string; resumeOn: string[]; timerId?: string }
export interface PendingActivation { step: string; eventId: string; event: Event }

export interface RunState {
  key: string
  status: RunStatus
  active: Record<string, ActiveStep>
  waiting: Record<string, WaitingStep>
  /** Activations that were blocked by `concurrency`; released FIFO. */
  pending: PendingActivation[]
  vars: Record<string, unknown>
  history: Array<{ step: string; outcome: string; at: string; attempt?: number }>
  /** Retry counters per step. */
  attempts: Record<string, number>
  /** Steps whose retry is scheduled (backoff) but not yet fired. */
  retrying: Record<string, { at: string; attempt: number }>
  /** Steps that ended in a terminal `failed`. */
  failed: string[]
  /** Short-term memory: the ai trail on this key and what agents asked to `remember`. */
  memory: RunMemory
  lastEventAt?: string
}

export interface RunMemory {
  trail: MemoryTrailEntry[]
  /** agent id → merged `remember` objects. */
  short: Record<string, Record<string, unknown>>
}

export function initialState(key: string): RunState {
  return { key, status: 'idle', active: {}, waiting: {}, pending: [], vars: {}, history: [], attempts: {}, retrying: {}, failed: [], memory: { trail: [], short: {} } }
}

export interface ReduceResult { state: RunState; commands: Command[] }

export interface ReduceOptions {
  /** Values exposed as `env` in expressions. Defaults to {}. */
  env?: Record<string, string>
  /** Optional map of role → system prompt text (resolved by the caller from roles/*.md). */
  roles?: Record<string, string>
  /** Agents with their prompt text resolved (loader merges yaml + agents/*.md). Defaults to def.agents. */
  agents?: Record<string, ResolvedAgent>
}

function scopeFor(state: RunState, event: Event, opts: ReduceOptions) {
  return { event, vars: state.vars, key: state.key, env: opts.env ?? {}, now: event.ts, history: state.history }
}

function isSystemEvent(ev: Event): boolean {
  return ev.type.startsWith('timer.') || ev.type.startsWith('run.')
}

const withRetry = new WeakMap<WorkflowDefinition, WorkflowDefinition>()

export function reduce(rawDef: WorkflowDefinition, prev: RunState, event: Event, opts: ReduceOptions = {}): ReduceResult {
  let def = withRetry.get(rawDef)
  if (!def) { def = retryListeners(rawDef); withRetry.set(rawDef, def) }
  // Structural clone so callers can keep the previous state (replay/golden tests compare snapshots).
  const state: RunState = JSON.parse(JSON.stringify(prev))
  if (!state.memory) state.memory = { trail: [], short: {} }
  state.lastEventAt = event.ts
  const commands: Command[] = []
  const scope = scopeFor(state, event, opts)

  // 1. Is this event an outcome of one of our steps? Record it and free the slot.
  const split = splitEventType(event.type)
  const ownStep = split ? def.steps.find((s) => s.id === split.step) : undefined
  if (ownStep && split) {
    completeStep(def, state, ownStep, split.outcome, event, commands)
  }

  // 2. Human steps waiting on this event type?
  for (const [stepId, w] of Object.entries(state.waiting)) {
    if (!w.resumeOn.includes(event.type)) continue
    const step = def.steps.find((s) => s.id === stepId) as HumanStep | undefined
    if (!step) continue
    const chosen = step.human.outcomes.find((o) => evalCondition(o.if, scope))
    if (!chosen) continue
    delete state.waiting[stepId]
    if (w.timerId) commands.push({ kind: 'cancel_schedule', id: commandId(event.id, stepId, 'cancel'), scheduleId: w.timerId })
    commands.push({
      kind: 'emit', id: commandId(event.id, stepId, 'resume'),
      event: { type: `${stepId}.${chosen.outcome}`, key: state.key, data: event.data, causationId: commandId(event.id, stepId, 'resume'), meta: { step: stepId, resumedBy: event.id } },
    })
  }

  // 3. Which steps listen to this event? (`*.failed` / `*.timeout` listen to every other step.)
  if (!isSystemEvent(event)) {
    const stepIds = def.steps.map((s) => s.id)
    for (const step of def.steps) {
      const listener = step.on.find((l) => listenerMatches(l.event, event.type, step.id, stepIds) && evalCondition(l.if, scope))
      if (!listener) continue
      activate(def, state, step, event, commands, opts)
    }
  }

  // 4. Release pending activations if there is room.
  drainPending(def, state, commands, opts)

  state.status = deriveStatus(state)
  return { state, commands }
}

function slotsInUse(state: RunState): number {
  return Object.keys(state.active).length
}

function activate(def: WorkflowDefinition, state: RunState, step: StepDef, event: Event, commands: Command[], opts: ReduceOptions, fromPending = false) {
  if (step.kind === 'gate') {
    // Gates are decisions, not work: they never take a slot.
    const scope = scopeFor(state, event, opts)
    const g = (step as GateStep).gate
    const chosen = g.outcomes.find((o) => evalCondition(o.if, scope))?.outcome ?? g.default
    const cid = commandId(event.id, step.id)
    if (!chosen) {
      commands.push({ kind: 'emit', id: cid, event: { type: `${step.id}.failed`, key: state.key, data: { error: 'no gate outcome matched and no default' }, causationId: cid, meta: { step: step.id } } })
      return
    }
    commands.push({ kind: 'emit', id: cid, event: { type: `${step.id}.${chosen}`, key: state.key, data: event.data, causationId: cid, meta: { step: step.id, gate: true } } })
    return
  }

  if (step.id in state.active || step.id in state.waiting) {
    // Same step already in flight for this key: one worker per card. Queue it.
    if (!fromPending) state.pending.push({ step: step.id, eventId: event.id, event })
    return
  }
  if (step.kind !== 'human' && def.concurrency > 0 && slotsInUse(state) >= def.concurrency) {
    if (!fromPending) state.pending.push({ step: step.id, eventId: event.id, event })
    return
  }

  const attempt = (state.attempts[step.id] ?? 0) + 1
  const cid = commandId(event.id, step.id, attempt > 1 ? `a${attempt}` : '')
  const scope = scopeFor(state, event, opts)

  if (step.kind === 'human') {
    const h = step as HumanStep
    const timerId = step.timeout ? commandId(event.id, step.id, 'timeout') : undefined
    state.waiting[step.id] = { since: event.ts, resumeOn: h.human.resume_on, timerId }
    commands.push({ kind: 'wait_human', id: cid, step: step.id, key: state.key, resumeOn: h.human.resume_on, timeout: step.timeout })
    if (step.timeout && timerId) commands.push({ kind: 'schedule', id: timerId, key: state.key, at: Date.parse(event.ts) + step.timeout, event: { type: `${step.id}.timeout`, data: { since: event.ts }, meta: { step: step.id } } })
    return
  }

  const timerId = step.timeout ? commandId(event.id, step.id, `timeout${attempt > 1 ? attempt : ''}`) : undefined
  const agentId = step.kind === 'ai' ? (step as AiStep).ai.agent : undefined
  state.active[step.id] = { commandId: cid, since: event.ts, attempt, timerId, ...(agentId ? { agent: agentId } : {}) }
  state.attempts[step.id] = attempt

  if (step.kind === 'script') {
    const s = step as ScriptStep
    commands.push({
      kind: 'run_script', id: cid, step: step.id, key: state.key, attempt,
      cmd: String(template(s.run, scope)),
      cwd: s.cwd,
      env: templateDeep(s.env ?? {}, scope) as Record<string, string>,
      stdin: { event, vars: state.vars, key: state.key, step: step.id, attempt },
      timeout: step.timeout,
    })
  } else if (step.kind === 'ai') {
    const a = step as AiStep
    // Who does the work: the agent (preferred), else the legacy role prompt.
    const agent = a.ai.agent ? (opts.agents ?? def.agents)?.[a.ai.agent] : undefined
    const system = a.ai.prompt ?? agent?.system ?? (a.ai.role ? opts.roles?.[a.ai.role] : undefined) ?? (a.ai.agent ? opts.roles?.[a.ai.agent] : undefined)
    // Runner-specific config rides on the command, templated with the step scope so a
    // builder can run inside `{{ vars.worktree.path }}`.
    const rawRunnerConfig =
      agent?.runner === 'cli' ? agent.cli
      : agent?.runner === 'herdr' ? agent.herdr
      : (agent?.runner === 'claude-code' || agent?.runner === undefined) ? agent?.claudeCode
      : undefined
    const runnerConfig = rawRunnerConfig ? templateDeep(rawRunnerConfig, scope) : undefined
    const mem = agent?.memory ?? DEFAULT_MEMORY
    const memory = {
      ...(mem.shortTerm ? { short: { trail: state.memory.trail, remembered: state.memory.short[a.ai.agent ?? a.ai.role ?? step.id] ?? {} } } : {}),
      ...(mem.longTerm && mem.recall > 0 ? { longTerm: { recall: mem.recall } } : {}),
    }
    commands.push({
      kind: 'call_ai', id: cid, step: step.id, key: state.key, attempt,
      agent: a.ai.agent, role: a.ai.role, model: a.ai.model ?? agent?.model,
      system: system === undefined ? undefined : String(template(system, scope)),
      tools: agent?.tools, effort: agent?.effort, maxTurns: agent?.maxTurns,
      runner: agent?.runner, runnerConfig: runnerConfig as Record<string, unknown> | undefined,
      input: templateDeep(a.ai.input ?? { event: event.data, vars: state.vars }, scope),
      // `remember` / `learn` are always allowed, whatever the step's own schema says.
      outputSchema: withMemoryProperties(a.ai.output),
      timeout: step.timeout,
      ...(Object.keys(memory).length ? { memory } : {}),
    })
  }
  if (step.timeout && timerId) {
    commands.push({ kind: 'schedule', id: timerId, key: state.key, at: Date.parse(event.ts) + step.timeout, event: { type: `${step.id}.timeout`, data: { attempt }, meta: { step: step.id, attempt } } })
  }
}

function completeStep(def: WorkflowDefinition, state: RunState, step: StepDef, outcome: string, event: Event, commands: Command[]) {
  const active = state.active[step.id]
  if (active?.timerId) commands.push({ kind: 'cancel_schedule', id: commandId(event.id, step.id, 'cancel'), scheduleId: active.timerId })
  delete state.active[step.id]

  if (step.kind === 'human') {
    const w = state.waiting[step.id]
    if (outcome === 'timeout' && !w) return // stale timer
    delete state.waiting[step.id]
    if (outcome === 'timeout') { state.history.push({ step: step.id, outcome, at: event.ts }); return }
  } else if (outcome === 'timeout' && !active) return // stale timer for a step that already finished
  if (outcome === 'failed' || outcome === 'timeout') {
    const attempt = active?.attempt ?? state.attempts[step.id] ?? 1
    const retry = step.retry
    state.history.push({ step: step.id, outcome, at: event.ts, attempt })
    if (retry && attempt <= retry.max) {
      // Re-run: schedule a synthetic `<step>.retry` event that re-activates the step.
      const rid = commandId(event.id, step.id, 'retry')
      const retryEvent = { type: `${step.id}.retry`, data: (event.meta?.cause as unknown) ?? event.data, meta: { step: step.id, attempt: attempt + 1, from: outcome } }
      if (retry.backoff > 0) {
        state.retrying[step.id] = { at: new Date(Date.parse(event.ts) + retry.backoff).toISOString(), attempt: attempt + 1 }
        commands.push({ kind: 'schedule', id: rid, key: state.key, at: Date.parse(event.ts) + retry.backoff, event: retryEvent })
      } else commands.push({ kind: 'emit', id: rid, event: { ...retryEvent, key: state.key, causationId: rid } })
      return
    }
    state.attempts[step.id] = 0
    if (!state.failed.includes(step.id)) state.failed.push(step.id)
    return
  }
  if (outcome === 'retry') {
    // Consumed in `activate` via the implicit `<step>.retry` listener.
    delete state.retrying[step.id]
    return
  }
  state.attempts[step.id] = 0
  state.history.push({ step: step.id, outcome, at: event.ts, attempt: active?.attempt })
  if (step.kind === 'ai') {
    // Short-term memory: what happened on this key, and what the agent asked to keep.
    const agentId = active?.agent ?? (step as AiStep).ai.agent ?? (step as AiStep).ai.role ?? step.id
    const summary = (event.data as { summary?: unknown } | undefined)?.summary
    state.memory.trail.push({ step: step.id, agent: agentId, outcome, at: event.ts, ...(typeof summary === 'string' ? { summary } : {}) })
    const remembered = rememberOf(event.data)
    if (remembered) state.memory.short[agentId] = { ...(state.memory.short[agentId] ?? {}), ...remembered }
  }
  if (event.data !== undefined) state.vars[step.id] = step.kind === 'ai' ? stripMemoryFields(event.data) : event.data
}

function drainPending(def: WorkflowDefinition, state: RunState, commands: Command[], opts: ReduceOptions) {
  let progressed = true
  while (progressed && state.pending.length) {
    progressed = false
    for (let i = 0; i < state.pending.length; i++) {
      const p = state.pending[i]
      const step = def.steps.find((s) => s.id === p.step)
      if (!step) { state.pending.splice(i, 1); progressed = true; break }
      const busy = step.id in state.active || step.id in state.waiting
      const full = step.kind !== 'human' && def.concurrency > 0 && slotsInUse(state) >= def.concurrency
      if (busy || full) continue
      state.pending.splice(i, 1)
      activate(def, state, step, p.event, commands, opts, true)
      progressed = true
      break
    }
  }
}

function deriveStatus(state: RunState): RunStatus {
  if (Object.keys(state.active).length || state.pending.length || Object.keys(state.retrying ?? {}).length) return 'running'
  if (Object.keys(state.waiting).length) return 'waiting'
  if (state.failed.length) return 'failed'
  if (state.history.length) return 'done'
  return 'idle'
}

/**
 * The reducer listens for `<step>.retry` implicitly: treat it as if the
 * step's original listener fired again. Called by reduce() through this
 * helper so the retry path stays in one place.
 */
export function retryListeners(def: WorkflowDefinition): WorkflowDefinition {
  return {
    ...def,
    steps: def.steps.map((s) => (s.kind === 'gate' || s.kind === 'human' ? s : s.on.some((l) => l.event === `${s.id}.retry`) ? s : { ...s, on: [...s.on, { event: `${s.id}.retry` }] })),
  }
}

/** Fold a list of events into a state, returning every command along the way. */
export function replay(def: WorkflowDefinition, key: string, events: Event[], opts: ReduceOptions = {}): { state: RunState; steps: Array<{ event: Event; commands: Command[] }> } {
  let state = initialState(key)
  const steps: Array<{ event: Event; commands: Command[] }> = []
  for (const ev of events) {
    const r = reduce(def, state, ev, opts)
    state = r.state
    steps.push({ event: ev, commands: r.commands })
  }
  return { state, steps }
}
