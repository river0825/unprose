// Port: Mailbox — the JSON in/out envelope an interactive agent reads and
// writes. The file (or record) is the contract with the agent; the terminal
// text never is.

export interface MailboxEnvelope {
  step: string
  key: string
  system: string | null
  input: unknown
  outputSchema: Record<string, unknown>
}

export interface Mailbox {
  /** Write the envelope; returns the two addresses the agent is told about. */
  post(id: string, envelope: MailboxEnvelope): Promise<{ inbox: string; outbox: string }>
  /** The agent's answer if it has written a parseable one yet. */
  answer(id: string): Promise<Record<string, unknown> | undefined>
  /** Forget both halves (tests, cleanup). */
  clear(id: string): Promise<void>
}
