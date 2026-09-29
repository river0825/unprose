// MemoryStore adapter: one NDJSON file per agent under <store-dir>/memory/.
// A projection — delete the directory and the engine rebuilds it from the
// `memory.learned` events on the next start.

import fs from 'node:fs'
import path from 'node:path'
import { rankForRecall, type MemoryEntry, type MemoryStore, type RecallQuery } from '../../ports/memory.js'

export class FileMemoryStore implements MemoryStore {
  private cache = new Map<string, MemoryEntry[]>()
  /** Forgotten ids — the log still has the event; the projection must not take it back on the next sync. */
  private forgotten: Set<string>

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    const f = this.tombstones()
    this.forgotten = new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [])
  }

  private tombstones() {
    return path.join(this.dir, '_forgotten')
  }

  private file(agent: string) {
    return path.join(this.dir, `${agent.replace(/[^A-Za-z0-9_-]/g, '_')}.ndjson`)
  }

  private load(agent: string): MemoryEntry[] {
    const hit = this.cache.get(agent)
    if (hit) return hit
    const f = this.file(agent)
    const rows = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as MemoryEntry) : []
    this.cache.set(agent, rows)
    return rows
  }

  private agents(): string[] {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.ndjson') && !f.startsWith('_')).map((f) => f.slice(0, -'.ndjson'.length))
  }

  async record(entry: MemoryEntry) {
    if (this.forgotten.has(entry.id)) return
    const rows = this.load(entry.agent)
    if (rows.some((e) => e.id === entry.id)) return
    rows.push(entry)
    fs.appendFileSync(this.file(entry.agent), JSON.stringify(entry) + '\n')
  }

  async recall(agent: string, q: RecallQuery = {}) {
    return rankForRecall(this.load(agent), q)
  }

  async list(agent?: string) {
    const ids = agent ? [agent] : this.agents()
    return ids.flatMap((a) => this.load(a)).sort((a, b) => (a.at < b.at ? -1 : 1))
  }

  async forget(agent: string, id: string) {
    const rows = this.load(agent)
    const i = rows.findIndex((e) => e.id === id)
    if (i === -1) return false
    rows.splice(i, 1)
    fs.writeFileSync(this.file(agent), rows.map((e) => JSON.stringify(e)).join('\n') + (rows.length ? '\n' : ''))
    this.forgotten.add(id)
    fs.appendFileSync(this.tombstones(), id + '\n')
    return true
  }
}
