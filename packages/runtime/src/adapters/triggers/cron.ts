// `every: 30m` intervals and `at: "HH:MM"` daily ticks. Deliberately no
// cron-expression parser: if you need one, a script step + system cron is
// a better home for it.

import type { WorkflowDefinition, TriggerDef } from '@awd/core'
import type { EventStore } from '../../ports/eventStore.js'
import { keyFor } from '../../application/keys.js'

export interface CronHandle { stop(): void }

export function fireCron(t: TriggerDef, def: WorkflowDefinition, store: EventStore, env: Record<string, string> = {}) {
  const now = new Date().toISOString()
  const data = t.data ?? { at: now }
  const draft = { id: 'pending', type: t.emit, data, ts: now }
  let key: string
  try { key = keyFor(def, draft, env) } catch { key = `${t.id}@${now}` }
  return store.append({ type: t.emit, key, data, meta: { trigger: t.id } })
}

export function startCron(def: WorkflowDefinition, store: EventStore, env: Record<string, string> = {}, log?: (l: string) => void): CronHandle {
  const handles: NodeJS.Timeout[] = []
  for (const t of def.triggers) {
    if (t.on !== 'cron') continue
    if (t.every) {
      const h = setInterval(() => { const ev = fireCron(t, def, store, env); log?.(`cron ${t.id} → ${ev.type} [${ev.key}]`) }, t.every)
      h.unref?.(); handles.push(h)
    }
    if (t.at) {
      const [hh, mm] = t.at.split(':').map(Number)
      const schedule = () => {
        const now = new Date(); const next = new Date(now)
        next.setHours(hh, mm, 0, 0)
        if (next <= now) next.setDate(next.getDate() + 1)
        const h = setTimeout(() => { const ev = fireCron(t, def, store, env); log?.(`cron ${t.id} (at ${t.at}) → ${ev.type}`); schedule() }, next.getTime() - now.getTime())
        h.unref?.(); handles.push(h)
      }
      schedule()
    }
  }
  return { stop: () => handles.forEach((h) => clearTimeout(h)) }
}
