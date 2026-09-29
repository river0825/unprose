// Runs an `ai` step through a WorkerRuntime and validates the answer against
// the step's output schema. A schema violation is a `failed` outcome (and so
// retryable), never a crash.

import { Ajv } from 'ajv'
import type { Command } from '@awd/core'
import { learnNotesOf, reflectNotesOf, type LearnNote, type ReflectNote } from '@awd/core'
import type { WorkerRuntime, WorkerUsage, RecalledMemory } from '../../ports/workerRuntime.js'
import type { MemoryStore, MemoryEntry } from '../../ports/memory.js'
import { renderMemory } from '../memory.js'

export type CallAiCommand = Extract<Command, { kind: 'call_ai' }>

export interface AiResult {
  outcome: string
  data?: unknown
  usage?: WorkerUsage
  error?: string
  /** `learn` notes the agent asked to keep — the engine turns them into `memory.learned` events. */
  learned?: LearnNote[]
  /** Long-term notes that were put in front of the model (for the outcome event's meta). */
  recalled?: MemoryEntry[]
  /** `reflect` signals for the people — the engine records them as `reflection.noted` events. */
  reflected?: ReflectNote[]
}

export interface AiDeps { memory?: MemoryStore }

const ajv = new Ajv({ allErrors: true, strict: false })
const validators = new Map<string, ReturnType<Ajv['compile']>>()

export function validateOutput(schema: Record<string, unknown>, output: unknown): string | undefined {
  const k = JSON.stringify(schema)
  let v = validators.get(k)
  if (!v) { v = ajv.compile(schema); validators.set(k, v) }
  if (v(output)) return undefined
  return ajv.errorsText(v.errors, { separator: '; ' })
}

export async function callAi(cmd: CallAiCommand, worker: WorkerRuntime, deps: AiDeps = {}): Promise<AiResult> {
  // Long-term memory is IO, so it is fetched here, not in the reducer.
  const agentId = cmd.agent ?? cmd.role
  const recalled = cmd.memory?.longTerm && deps.memory && agentId ? await deps.memory.recall(agentId, { key: cmd.key, limit: cmd.memory.longTerm.recall }) : []
  const memory: RecalledMemory | undefined = cmd.memory ? { longTerm: recalled, short: cmd.memory.short } : undefined
  const memoryText = renderMemory(memory)
  const system = [cmd.system, memoryText].filter((s) => s && s.trim()).join('\n\n') || undefined
  let result
  try {
    result = await worker.run({
      agent: cmd.agent, role: cmd.role, model: cmd.model, system, memory,
      tools: cmd.tools, effort: cmd.effort, maxTurns: cmd.maxTurns, runner: cmd.runner, runnerConfig: cmd.runnerConfig,
      input: cmd.input, outputSchema: cmd.outputSchema, timeout: cmd.timeout, key: cmd.key, step: cmd.step, commandId: cmd.id,
    })
  } catch (e) {
    const msg = (e as Error).message
    const reason = /^agent_blocked/.test(msg) ? 'agent_blocked' : /^agent_busy/.test(msg) ? 'agent_busy' : undefined
    return { outcome: /timed out/i.test(msg) ? 'timeout' : 'failed', data: { error: msg, ...(reason ? { reason } : {}) }, error: msg }
  }
  const problem = validateOutput(cmd.outputSchema, result.output)
  if (problem) return { outcome: 'failed', data: { error: `output does not match schema: ${problem}`, output: result.output }, usage: result.usage, error: problem }
  const { outcome, ...data } = result.output as { outcome?: string } & Record<string, unknown>
  const learned = learnNotesOf(result.output)
  const reflected = reflectNotesOf(result.output)
  return { outcome: typeof outcome === 'string' ? outcome : 'done', data: Object.keys(data).length ? data : undefined, usage: result.usage, learned: learned.length ? learned : undefined, recalled: recalled.length ? recalled : undefined, reflected: reflected.length ? reflected : undefined }
}
