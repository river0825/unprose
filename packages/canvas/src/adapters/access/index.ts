// AccessStore adapters (docs/canvas.md "Remote agents"): a JSON file (0600) under the server's data dir, or memory.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AccessData, AccessStore } from '../../ports/accessStore.js'

const empty = (): AccessData => ({ agents: [], clients: [] })

export class MemoryAccessStore implements AccessStore {
  readonly where = 'memory'
  private data: AccessData
  constructor(initial?: AccessData) {
    this.data = structuredClone(initial ?? empty())
  }
  read(): AccessData {
    return structuredClone(this.data)
  }
  write(data: AccessData): void {
    this.data = structuredClone(data)
  }
}

/**
 * `agents.json`: written atomically (tmp + rename) with mode 0600 in a 0700 directory. Never inside a board
 * directory or a project — the boards are committed, the secrets' hashes are not.
 */
export class FileAccessStore implements AccessStore {
  constructor(readonly where: string) {}
  read(): AccessData {
    try {
      const j = JSON.parse(fs.readFileSync(this.where, 'utf8')) as Partial<AccessData>
      return { agents: Array.isArray(j.agents) ? j.agents : [], clients: Array.isArray(j.clients) ? j.clients : [] }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      throw new Error(`cannot read ${this.where}: ${(e as Error).message}`)
    }
  }
  write(data: AccessData): void {
    fs.mkdirSync(path.dirname(this.where), { recursive: true, mode: 0o700 })
    const tmp = `${this.where}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, this.where)
    try {
      fs.chmodSync(this.where, 0o600)
    } catch {
      // not every file system has modes
    }
  }
}

/** `$UNPROSE_AGENTS_FILE`, else `$XDG_DATA_HOME/awd/agents.json`, else `~/.awd/agents.json`. */
export function defaultAgentsFile(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  if (env.UNPROSE_AGENTS_FILE) return path.resolve(env.UNPROSE_AGENTS_FILE)
  if (env.XDG_DATA_HOME) return path.join(env.XDG_DATA_HOME, 'awd', 'agents.json')
  return path.join(home, '.awd', 'agents.json')
}
