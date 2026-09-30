// Ports for upgrading the canvas from the canvas (docs/canvas.md "Updating"). Pure types: updater.ts decides
// what happens and when; adapters decide how (GitHub releases, child processes) — fakes in tests.

/** The newest published release. */
export interface ReleaseInfo {
  version: string
  /** Release notes (the release body), when the source has them. */
  notes?: string
  url?: string
  /** Where the answer came from: 'github', 'github (token)', 'gh', 'fake' … */
  source: string
}

export interface UpdateSource {
  /** The latest release; rejects with a readable message when it cannot be found (offline, private repo …). */
  latest(): Promise<ReleaseInfo>
}

export interface CommandSpec {
  command: string
  args: string[]
  cwd?: string
}

export interface Installer {
  /** Run one command to completion; every output line goes to `onLine`. Rejects on a non-zero exit. */
  run(cmd: CommandSpec, onLine: (line: string) => void): Promise<void>
  /** Tracked files with uncommitted changes in a git work tree (empty = clean). */
  dirtyFiles(cwd: string): Promise<string[]>
  /** Download `unprose-runtime-v<version>.tgz` (checksum-verified) and unpack it into `dir`. */
  downloadRuntime(version: string, dir: string, onLine: (line: string) => void): Promise<void>
  /** Does this file exist? (the new entry script must, before the handoff) */
  exists(path: string): boolean
}

export interface Launcher {
  /** Start the next server in the background, detached from this one; returns its pid. */
  spawnDetached(entry: string, args: string[], env: Record<string, string>, logFile: string): number
  /** The version a server on this port answers with (GET /api/version), or undefined. */
  probeVersion(port: number): Promise<string | undefined>
  /** Is this process alive? */
  alive(pid: number): boolean
  kill(pid: number): void
}
