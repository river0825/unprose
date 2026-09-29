// EventStore adapter: one NDJSON file, append-only. The file is the source of
// truth; a crash mid-line is tolerated on read.

import fs from 'node:fs'
import path from 'node:path'
import type { Event } from '@awd/core'
import { BaseEventStore } from './base.js'

export class FileEventStore extends BaseEventStore {
  constructor(readonly file: string) {
    super()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try { this.events.push(JSON.parse(line)) } catch { /* a torn last line from a crash: ignore */ }
      }
    }
  }
  protected persist(ev: Event): void {
    // O_APPEND writes under PIPE_BUF are atomic, so concurrent emitters never interleave.
    fs.appendFileSync(this.file, JSON.stringify(ev) + '\n')
  }
  /** Pick up events appended by another process (e.g. `awd emit`). */
  refresh(): Event[] {
    const known = this.events.length
    const lines = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').split('\n').filter((l) => l.trim()) : []
    const fresh: Event[] = []
    for (const line of lines.slice(known)) {
      try { fresh.push(JSON.parse(line)) } catch { /* torn line */ }
    }
    for (const ev of fresh) {
      this.events.push(ev)
      for (const fn of this.listeners) fn(ev)
    }
    return fresh
  }
}
