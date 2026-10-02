// FeedbackStore adapters (docs/canvas.md "Feedback"): an append-only NDJSON file (0600) in the server's data dir,
// or memory. Never inside a board directory or a project.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FeedbackRecord, FeedbackStore } from '../../ports/feedbackStore.js'

export class MemoryFeedbackStore implements FeedbackStore {
  readonly where = 'memory'
  private records: FeedbackRecord[] = []
  append(record: FeedbackRecord): void {
    this.records.push(structuredClone(record))
  }
  list(): FeedbackRecord[] {
    return structuredClone(this.records)
  }
}

export class FileFeedbackStore implements FeedbackStore {
  constructor(readonly where: string) {}
  append(record: FeedbackRecord): void {
    fs.mkdirSync(path.dirname(this.where), { recursive: true, mode: 0o700 })
    fs.appendFileSync(this.where, JSON.stringify(record) + '\n', { mode: 0o600 })
  }
  list(): FeedbackRecord[] {
    let raw = ''
    try {
      raw = fs.readFileSync(this.where, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as FeedbackRecord]
        } catch {
          return [] // a torn last line
        }
      })
  }
}

/** `$UNPROSE_FEEDBACK_FILE`, else `feedback.ndjson` next to the agents file (`~/.awd/feedback.ndjson`). */
export function defaultFeedbackFile(agentsFile: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  if (env.UNPROSE_FEEDBACK_FILE) return path.resolve(env.UNPROSE_FEEDBACK_FILE)
  return path.join(agentsFile ? path.dirname(agentsFile) : path.join(home, '.awd'), 'feedback.ndjson')
}
