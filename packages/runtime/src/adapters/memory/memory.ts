// MemoryStore adapter: in RAM (tests, golden runs, --store memory).

import { rankForRecall, type MemoryEntry, type MemoryStore, type RecallQuery } from '../../ports/memory.js'

export class MemoryMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>()
  private forgotten = new Set<string>()

  async record(entry: MemoryEntry) {
    if (this.forgotten.has(entry.id)) return
    if (!this.entries.has(entry.id)) this.entries.set(entry.id, entry)
  }
  async recall(agent: string, q: RecallQuery = {}) {
    return rankForRecall([...this.entries.values()].filter((e) => e.agent === agent), q)
  }
  async list(agent?: string) {
    return [...this.entries.values()].filter((e) => !agent || e.agent === agent).sort((a, b) => (a.at < b.at ? -1 : 1))
  }
  async forget(agent: string, id: string) {
    const e = this.entries.get(id)
    if (!e || e.agent !== agent) return false
    this.entries.delete(id)
    this.forgotten.add(id)
    return true
  }
}
