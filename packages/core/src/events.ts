// Events are the only truth; commands are requests the runtime fulfils.

import type { CommandMemory } from './memory.js'

export interface Event {
  id: string
  type: string
  /** Aggregate id (run key). Engine fills this from the workflow `key` template. */
  key: string
  data?: unknown
  ts: string
  /** The command id that produced this event, if any. */
  causationId?: string
  /** Free metadata: trigger id, step id, attempt, usage, error… */
  meta?: Record<string, unknown>
}

export type Command =
  | { kind: 'run_script'; id: string; step: string; key: string; cmd: string; cwd?: string; env: Record<string, string>; stdin: unknown; timeout?: number; attempt: number }
  | {
      kind: 'call_ai'; id: string; step: string; key: string; attempt: number
      /** Resolved agent id (from `agents:`), if the step named one. */
      agent?: string
      role?: string
      model?: string
      system?: string
      tools?: string[]
      effort?: string
      maxTurns?: number
      /** Which WorkerRuntime should run it; undefined = the engine's default. */
      runner?: string
      /** Runner-specific config copied from the agent (cli / herdr). */
      runnerConfig?: Record<string, unknown>
      input: unknown
      outputSchema: Record<string, unknown>
      timeout?: number
      /** Short-term memory from state + whether/how much long-term memory the runtime should recall. */
      memory?: CommandMemory
    }
  | { kind: 'wait_human'; id: string; step: string; key: string; resumeOn: string[]; timeout?: number }
  | { kind: 'emit'; id: string; event: Omit<Event, 'id' | 'ts'> & Partial<Pick<Event, 'id' | 'ts'>> }
  | { kind: 'schedule'; id: string; key: string; at: number; event: Omit<Event, 'id' | 'ts' | 'key'> }
  | { kind: 'cancel_schedule'; id: string; scheduleId: string }

export type CommandKind = Command['kind']

/** Stable id for a command derived from (cause, step, suffix) so replay is deterministic. */
export function commandId(causeEventId: string, step: string, suffix = ''): string {
  return `${causeEventId}:${step}${suffix ? ':' + suffix : ''}`
}

/** Split `qualify.pick` into { step: 'qualify', outcome: 'pick' }. */
export function splitEventType(type: string): { step: string; outcome: string } | undefined {
  const i = type.lastIndexOf('.')
  if (i <= 0) return undefined
  return { step: type.slice(0, i), outcome: type.slice(i + 1) }
}
