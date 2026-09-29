// Port: ScriptRunner — runs a `script` step's command and reports its
// outcome. The process adapter spawns a shell; a fake can answer from a table.

import type { Command } from '@awd/core'

export type RunScriptCommand = Extract<Command, { kind: 'run_script' }>

export interface ScriptResult {
  outcome: string
  data?: unknown
  stdout: string
  stderr: string
  code: number | null
  durationMs: number
  /** A script's `reflect: [...]` next to its outcome — signals for the people, recorded as reflection.noted. */
  reflect?: unknown
}

export type ScriptRunner = (cmd: RunScriptCommand, opts: { cwd?: string; env?: Record<string, string> }) => Promise<ScriptResult>
