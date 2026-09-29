// Mailbox adapter: in memory. The "agent" in a test answers with `deliver`.

import type { Mailbox, MailboxEnvelope } from '../../ports/mailbox.js'

export class MemoryMailbox implements Mailbox {
  readonly inbox = new Map<string, MailboxEnvelope>()
  readonly outbox = new Map<string, Record<string, unknown>>()
  async post(id: string, envelope: MailboxEnvelope) {
    this.inbox.set(id, envelope)
    this.outbox.delete(id)
    return { inbox: `memory://${id}/in`, outbox: `memory://${id}/out` }
  }
  async answer(id: string) { return this.outbox.get(id) }
  async clear(id: string) { this.inbox.delete(id); this.outbox.delete(id) }
  /** Test hook: the agent's reply. */
  deliver(id: string, answer: Record<string, unknown>) { this.outbox.set(id, answer) }
}
