// Port: WorkerRuntime — how the application asks *a model* for an answer.
// The reducer never sees it; the ai executor does. One agent = one persona;
// `runner` says which adapter (claude-code, anthropic, cli, herdr, fake) runs it.

import type { MemoryEntry } from './memory.js'
import type { MemoryTrailEntry } from '@awd/core'

/** What the runtime recalled for this call; adapters may show it (the system prompt already carries it). */
export interface RecalledMemory {
  longTerm: MemoryEntry[]
  short?: { trail: MemoryTrailEntry[]; remembered: Record<string, unknown> }
}

export interface WorkerRequest {
  /** Agent id from `agents:` (also the fixture name for the fake worker). */
  agent?: string
  role?: string
  model?: string
  system?: string
  /** Tool allow-list (Claude Code syntax: Read, Grep, "Bash(gh *)" …); server tools by name (web_search). */
  tools?: string[]
  effort?: string
  maxTurns?: number
  /** Which WorkerRuntime the agent asked for (RunnerRegistry routes on it). */
  runner?: string
  /** Runner-specific config from the agent (cli / herdr). */
  runnerConfig?: Record<string, unknown>
  input: unknown
  outputSchema: Record<string, unknown>
  timeout?: number
  memory?: RecalledMemory
  /** For fixtures / logging / mailboxes. */
  key: string
  step: string
  commandId?: string
}

export interface WorkerUsage { inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number }

export interface WorkerResult {
  output: Record<string, unknown>
  usage?: WorkerUsage
  raw?: unknown
}

export interface WorkerRuntime {
  readonly name: string
  run(req: WorkerRequest): Promise<WorkerResult>
}

/** Builds the adapter for a runner name; the composition root supplies one. */
export type WorkerFactory = (runner: string) => WorkerRuntime
