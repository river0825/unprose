// Mailbox adapter: two JSON files per command in a directory the agent can
// reach — the same protocol the herdr worker speaks today.

import fs from 'node:fs'
import path from 'node:path'
import type { Mailbox, MailboxEnvelope } from '../../ports/mailbox.js'
import { jsonFromText } from '../../application/prompting.js'

export class FileMailbox implements Mailbox {
  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true })
  }
  private paths(id: string) {
    const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_')
    return { inbox: path.join(this.dir, `${safe}.in.json`), outbox: path.join(this.dir, `${safe}.out.json`) }
  }
  async post(id: string, envelope: MailboxEnvelope) {
    const p = this.paths(id)
    fs.writeFileSync(p.inbox, JSON.stringify(envelope, null, 2))
    if (fs.existsSync(p.outbox)) fs.unlinkSync(p.outbox)
    return p
  }
  async answer(id: string) {
    const { outbox } = this.paths(id)
    if (!fs.existsSync(outbox)) return undefined
    return jsonFromText(fs.readFileSync(outbox, 'utf8'))
  }
  async clear(id: string) {
    for (const p of Object.values(this.paths(id))) if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}
