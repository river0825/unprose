// The engine is the only place that has side effects: it feeds every event
// through the reducer and fulfils the commands. State is rebuilt from the log
// on start, so the process can die at any point and pick up where it was.

import { reduce, initialState, type WorkflowDefinition, type Event, type Command, type RunState, type ResolvedAgent } from '@awd/core'
import type { EventStore } from '../ports/eventStore.js'
import type { WorkerRuntime } from '../ports/workerRuntime.js'
import type { ScriptRunner } from '../ports/scriptRunner.js'
import type { Clock, ClockHandle } from '../ports/clock.js'
import type { MemoryStore } from '../ports/memory.js'
import { callAi } from './executors/ai.js'
import { MEMORY_LEARNED, syncMemory } from './memory.js'
import { REFLECTION_NOTED } from './reflection.js'
import { reflectNotesOf } from '@awd/core'
import { Timer } from './timer.js'
import { keyFor } from './keys.js'

export interface EngineOptions {
  def: WorkflowDefinition
  store: EventStore
  worker: WorkerRuntime
  /** Runs `script` steps (the process adapter, or a fake in tests). */
  scriptRunner: ScriptRunner
  /** Wall clock by default; a FakeClock in tests. */
  clock?: Clock
  /** Long-term agent memory (a projection of `memory.learned` events). Optional: without it agents only get short-term memory. */
  memory?: MemoryStore
  roles?: Record<string, string>
  /** Agents with prompts resolved (loader). Defaults to def.agents. */
  agents?: Record<string, ResolvedAgent>
  env?: Record<string, string>
  /** cwd for script steps (the workflow's directory). */
  cwd?: string
  log?: (line: string) => void
  timerIntervalMs?: number
}

export class Engine {
  readonly states = new Map<string, RunState>()
  readonly timer: Timer
  private unsub?: () => void
  private queue: Event[] = []
  private draining = false
  private answered = new Set<string>()
  private inflight = new Map<string, Promise<void>>()
  private pollHandle?: ClockHandle
  private started = false
  private clock: Clock

  constructor(private opts: EngineOptions) {
    this.clock = opts.clock ?? wallClock
    this.timer = new Timer(opts.store, opts.timerIntervalMs, this.clock)
  }

  get def() { return this.opts.def }
  get store() { return this.opts.store }

  /** Replay the log, re-issue unanswered commands, then go live. */
  async start(): Promise<void> {
    const events = this.store.all()
    for (const e of events) if (e.causationId) this.answered.add(e.causationId)
    this.timer.load(events)
    if (this.opts.memory) await syncMemory(events, this.opts.memory)

    const pendingCommands: Command[] = []
    for (const ev of events) {
      if (isSystem(ev)) continue
      const cmds = this.applyEvent(ev)
      for (const c of cmds) if (!this.isAnswered(c)) pendingCommands.push(c)
    }
    this.started = true
    this.unsub = this.store.subscribe((ev) => this.enqueue(ev))
    this.timer.start()
    // A store other processes can append to (`awd emit`) asks to be re-read.
    const refresh = this.store.refresh?.bind(this.store)
    if (refresh) this.pollHandle = this.clock.setInterval(() => refresh(), 500)
    this.log(`replayed ${events.length} events, ${this.states.size} runs, ${pendingCommands.length} unanswered commands`)
    for (const c of pendingCommands) this.dispatch(c)
    this.timer.tick()
  }

  stop() {
    this.unsub?.()
    this.timer.stop()
    this.pollHandle?.clear()
    this.pollHandle = undefined
  }

  /** Wait until nothing is executing (tests). */
  async idle(): Promise<void> {
    while (this.inflight.size || this.queue.length || this.draining) {
      await Promise.all([...this.inflight.values()])
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  private log(line: string) { this.opts.log?.(line) }

  private isAnswered(c: Command): boolean {
    if (c.kind === 'wait_human' || c.kind === 'cancel_schedule') return true
    if (c.kind === 'schedule') return this.answered.has(c.id) || this.timer.list().some((t) => t.id === c.id) || this.store.all().some((e) => e.type === 'timer.cancel' && (e.data as { id: string }).id === c.id)
    return this.answered.has(c.id)
  }

  private enqueue(ev: Event) {
    this.queue.push(ev)
    if (!this.draining) this.drain()
  }

  private drain() {
    this.draining = true
    try {
      while (this.queue.length) {
        const ev = this.queue.shift()!
        if (ev.causationId) this.answered.add(ev.causationId)
        if (isSystem(ev)) continue
        for (const c of this.applyEvent(ev)) this.dispatch(c)
      }
    } finally {
      this.draining = false
    }
  }

  /** Pure part: reduce one event into its run's state. */
  private applyEvent(ev: Event): Command[] {
    const key = ev.key || safeKey(this.def, ev, this.opts.env)
    const prev = this.states.get(key) ?? initialState(key)
    const { state, commands } = reduce(this.def, prev, { ...ev, key }, { env: this.opts.env, roles: this.opts.roles, agents: this.opts.agents })
    this.states.set(key, state)
    return commands
  }

  private dispatch(c: Command) {
    if (this.answered.has(c.id) && c.kind !== 'cancel_schedule') return
    const p = this.execute(c).catch((e) => this.log(`command ${c.id} crashed: ${(e as Error).stack ?? e}`)).finally(() => this.inflight.delete(c.id))
    this.inflight.set(c.id, p)
  }

  private async execute(c: Command): Promise<void> {
    switch (c.kind) {
      case 'emit': {
        this.store.append({ ...c.event, causationId: c.event.causationId ?? c.id })
        return
      }
      case 'schedule': {
        this.timer.set({ id: c.id, key: c.key, at: c.at, event: c.event })
        return
      }
      case 'cancel_schedule': {
        this.timer.cancel(c.scheduleId, keyOfCommand(c, this))
        return
      }
      case 'wait_human': {
        this.log(`[${c.key}] ${c.step}: waiting for ${c.resumeOn.join('|')}`)
        return
      }
      case 'run_script': {
        this.log(`[${c.key}] ${c.step}: $ ${c.cmd}`)
        const r = await this.opts.scriptRunner(c, { cwd: this.opts.cwd, env: this.opts.env })
        this.log(`[${c.key}] ${c.step} → ${r.outcome} (${r.durationMs}ms)`)
        this.store.append({ type: `${c.step}.${r.outcome}`, key: c.key, data: r.data, causationId: c.id, meta: { step: c.step, attempt: c.attempt, code: r.code, durationMs: r.durationMs, stderr: r.stderr.slice(-500) || undefined } })
        for (const n of reflectNotesOf({ reflect: r.reflect })) this.store.append({ type: REFLECTION_NOTED, key: c.key, data: { source: 'script', key: c.key, step: c.step, note: n.note, kind: n.kind, tags: n.tags ?? [] }, causationId: c.id, meta: { step: c.step } })
        return
      }
      case 'call_ai': {
        const via = (this.opts.worker as { for?: (r?: string) => WorkerRuntime }).for?.(c.runner)?.name ?? this.opts.worker.name
        this.log(`[${c.key}] ${c.step}: @${c.agent ?? c.role ?? 'model'} model=${c.model ?? '-'} via ${via}`)
        const r = await callAi(c, this.opts.worker, { memory: this.opts.memory })
        this.log(`[${c.key}] ${c.step} → ${r.outcome}${r.error ? ' (' + r.error.slice(0, 120) + ')' : ''}${r.learned ? ` · learned ${r.learned.length}` : ''}`)
        // The outcome first (it is what marks the command answered), then what the agent learned.
        this.store.append({ type: `${c.step}.${r.outcome}`, key: c.key, data: r.data, causationId: c.id, meta: { step: c.step, attempt: c.attempt, usage: r.usage, worker: this.opts.worker.name, error: r.error, ...(r.recalled ? { recalled: r.recalled.map((e) => e.note) } : {}) } })
        for (const note of r.learned ?? []) {
          const ev = this.store.append({ type: MEMORY_LEARNED, key: c.key, data: { agent: c.agent ?? c.role ?? c.step, key: c.key, step: c.step, note: note.note, tags: note.tags ?? [] }, causationId: c.id, meta: { step: c.step } })
          if (this.opts.memory) await this.opts.memory.record({ id: ev.id, agent: c.agent ?? c.role ?? c.step, key: c.key, step: c.step, note: note.note, tags: note.tags ?? [], at: ev.ts })
        }
        for (const n of r.reflected ?? []) this.store.append({ type: REFLECTION_NOTED, key: c.key, data: { source: 'ai', agent: c.agent ?? c.role ?? c.step, key: c.key, step: c.step, note: n.note, kind: n.kind, tags: n.tags ?? [] }, causationId: c.id, meta: { step: c.step } })
        return
      }
    }
  }
}

function isSystem(ev: Event): boolean {
  return ev.type.startsWith('timer.') || ev.type === MEMORY_LEARNED || ev.type === REFLECTION_NOTED
}

/** The real clock — the only place the application touches `setInterval`. */
export const wallClock: Clock = {
  now: () => Date.now(),
  setInterval(fn, ms) {
    const h = setInterval(fn, ms)
    h.unref?.()
    return { clear: () => clearInterval(h) }
  },
  setTimeout(fn, ms) {
    const h = setTimeout(fn, ms)
    h.unref?.()
    return { clear: () => clearTimeout(h) }
  },
}

function safeKey(def: WorkflowDefinition, ev: Event, env?: Record<string, string>): string {
  try { return keyFor(def, ev, env) } catch { return ev.id }
}

function keyOfCommand(c: Extract<Command, { kind: 'cancel_schedule' }>, engine: Engine): string {
  return engine.timer.list().find((t) => t.id === c.scheduleId)?.key ?? ''
}

/** Rebuild every run's state from a list of events (no side effects). */
export function projectStates(def: WorkflowDefinition, events: Event[], opts: { env?: Record<string, string>; roles?: Record<string, string>; agents?: Record<string, ResolvedAgent> } = {}): Map<string, RunState> {
  const states = new Map<string, RunState>()
  for (const ev of events) {
    if (isSystem(ev)) continue
    const key = ev.key || safeKey(def, ev, opts.env)
    const prev = states.get(key) ?? initialState(key)
    states.set(key, reduce(def, prev, { ...ev, key }, opts).state)
  }
  return states
}
