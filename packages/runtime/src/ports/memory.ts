// Port: MemoryStore — an agent's long-term memory for this project. Every
// entry is first a `memory.learned` event in the EventStore (the truth); the
// store is a projection that answers "what did this agent learn before?"
// quickly enough to put in a prompt. Rebuildable from the log at any time.

export interface MemoryEntry {
  /** The `memory.learned` event id. */
  id: string
  agent: string
  /** The run key the note came from, if any. */
  key?: string
  step?: string
  note: string
  tags: string[]
  at: string
}

export interface RecallQuery {
  /** Prefer notes from this key (same card / same project item). */
  key?: string
  /** Prefer notes carrying any of these tags. */
  tags?: string[]
  /** Max entries (default 20). */
  limit?: number
}

export interface MemoryStore {
  /** Idempotent on `id`. */
  record(entry: MemoryEntry): Promise<void>
  /** Key-tagged first, then most recent; at most `limit`. */
  recall(agent: string, query?: RecallQuery): Promise<MemoryEntry[]>
  /** Everything (one agent, or all), oldest first. */
  list(agent?: string): Promise<MemoryEntry[]>
  forget(agent: string, id: string): Promise<boolean>
}

/** The recall policy, shared by every adapter so they agree on "which notes". */
export function rankForRecall(entries: MemoryEntry[], q: RecallQuery = {}): MemoryEntry[] {
  const limit = q.limit ?? 20
  const tags = new Set(q.tags ?? [])
  const score = (e: MemoryEntry) => (q.key && e.key === q.key ? 2 : 0) + (e.tags.some((t) => tags.has(t)) ? 1 : 0)
  return [...entries]
    .sort((a, b) => score(b) - score(a) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
}
