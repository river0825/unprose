// Port: FeedbackStore — what agents tell the owner about Unprose itself (docs/canvas.md "Feedback"): friction,
// ideas, bugs, recorded with `unprose_feedback`. Append-only; kept in the server's data dir (next to agents.json),
// never in a project or a board. Adapters: an NDJSON file, and memory (tests).

export interface FeedbackRecord {
  id: string
  at: string
  /** who sent it: the agent's name ('agent' for the default local one), or the signed-in person's */
  by: string
  /** how the caller got in: 'local' | 'agent' | 'person' | 'open' */
  via: string
  text: string
  board?: string
  about?: string[]
}

export interface FeedbackStore {
  append(record: FeedbackRecord): void
  /** Every record, oldest first. */
  list(): FeedbackRecord[]
  /** Where it is kept, for messages ('memory' for the memory adapter). */
  readonly where: string
}
