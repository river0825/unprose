// Port: ProcessSupervisor — long-running child processes the canvas server owns, one per key
// (today: `awd studio <workflow>` for a workflow the server was configured with, docs/studio.md §8b).
// Pure types: the server decides *what* runs; an adapter decides *how* (child_process today).

export interface ProcessSpec {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  /** Append every output line here too (the in-memory log keeps only the last 50). */
  logFile?: string
}

export interface ProcessInfo {
  running: boolean
  pid?: number
  /** When the current (or last) run started, ISO. */
  since?: string
  exitedAt?: string
  exitCode?: number | null
  signal?: string | null
  /** Last output lines, oldest first (stdout and stderr interleaved, ≤ 50). */
  log: string[]
}

export interface ProcessSupervisor {
  /** Start the process for `key`; when it is already running, just report it (idempotent). */
  start(key: string, spec: ProcessSpec): ProcessInfo
  /** Stop it (SIGTERM, then SIGKILL after a grace period); resolves once it has exited. */
  stop(key: string): Promise<ProcessInfo>
  info(key: string): ProcessInfo | undefined
  /** Signal every running child now (server shutdown); does not wait. */
  stopAll(): void
}

export const LOG_LINES = 50
