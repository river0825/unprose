// Canned answers for tests and --dry-run. Looks for, in order:
//   <dir>/<agent>/<key>.json   <dir>/<agent>.json
//   <dir>/<role>/<key>.json    <dir>/<role>.json
//   <dir>/<step>/<key>.json    <dir>/<step>.json
// A fixture may be an array of outputs: consumed in order per (name, key).

import fs from 'node:fs'
import path from 'node:path'
import type { WorkerRuntime, WorkerRequest, WorkerResult } from '../../ports/workerRuntime.js'

export class FakeWorker implements WorkerRuntime {
  readonly name = 'fake'
  private cursor = new Map<string, number>()
  constructor(private dir?: string, private inline: Record<string, unknown> = {}) {}

  async run(req: WorkerRequest): Promise<WorkerResult> {
    const output = this.lookup(req)
    return { output, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }
  }

  private lookup(req: WorkerRequest): Record<string, unknown> {
    const names = [req.agent, req.role, req.step].filter((n): n is string => Boolean(n))
    const candidates = names.flatMap((n) => [`${n}/${req.key}.json`, `${n}.json`])
    for (const c of candidates) {
      const inlineHit = this.inline[c.replace(/\.json$/, '')]
      if (inlineHit !== undefined) return this.pick(c, inlineHit)
      if (!this.dir) continue
      const f = path.join(this.dir, c)
      if (fs.existsSync(f)) return this.pick(c, JSON.parse(fs.readFileSync(f, 'utf8')))
    }
    // Nothing recorded: satisfy the schema minimally with the first outcome.
    const props = (req.outputSchema.properties ?? {}) as Record<string, { enum?: unknown[] }>
    const first = props.outcome?.enum?.[0]
    return { outcome: first ?? 'done', _fake: true }
  }

  private pick(name: string, fixture: unknown): Record<string, unknown> {
    if (Array.isArray(fixture)) {
      const i = this.cursor.get(name) ?? 0
      this.cursor.set(name, i + 1)
      return fixture[Math.min(i, fixture.length - 1)] as Record<string, unknown>
    }
    return fixture as Record<string, unknown>
  }
}
