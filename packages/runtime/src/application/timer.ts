// Durable timers. Setting a timer writes a `timer.set` event; firing appends
// the scheduled event with `causationId = timer id`; cancelling writes
// `timer.cancel`. On restart the engine re-arms whatever is still pending.

import type { Event } from '@awd/core'
import type { EventStore } from '../ports/eventStore.js'
import type { Clock, ClockHandle } from '../ports/clock.js'

export interface PendingTimer { id: string; key: string; at: number; event: Omit<Event, 'id' | 'ts' | 'key'> }

export class Timer {
  private pending = new Map<string, PendingTimer>()
  private handle?: ClockHandle
  constructor(private store: EventStore, private intervalMs = 1000, private clock?: Clock) {}

  /** Rebuild the pending set from the log. */
  load(events: Event[]) {
    const fired = new Set(events.filter((e) => e.causationId).map((e) => e.causationId!))
    for (const e of events) {
      if (e.type === 'timer.set') {
        const t = e.data as PendingTimer
        if (!fired.has(t.id)) this.pending.set(t.id, t)
      } else if (e.type === 'timer.cancel') {
        this.pending.delete((e.data as { id: string }).id)
      }
    }
  }

  set(t: PendingTimer) {
    if (this.pending.has(t.id)) return
    this.pending.set(t.id, t)
    this.store.append({ type: 'timer.set', key: t.key, data: t, meta: { system: true } })
  }

  cancel(id: string, key: string) {
    if (!this.pending.has(id)) return
    this.pending.delete(id)
    this.store.append({ type: 'timer.cancel', key, data: { id }, meta: { system: true } })
  }

  /** Fire everything that is due. Returns the fired ids. */
  tick(now = this.clock?.now() ?? Date.now()): string[] {
    const fired: string[] = []
    for (const t of [...this.pending.values()].sort((a, b) => a.at - b.at)) {
      if (t.at > now) break
      this.pending.delete(t.id)
      this.store.append({ ...t.event, key: t.key, causationId: t.id, meta: { ...(t.event.meta ?? {}), timer: t.id } })
      fired.push(t.id)
    }
    return fired
  }

  start() {
    this.stop()
    if (this.clock) this.handle = this.clock.setInterval(() => this.tick(), this.intervalMs)
    else {
      const h = setInterval(() => this.tick(), this.intervalMs)
      h.unref?.()
      this.handle = { clear: () => clearInterval(h) }
    }
  }
  stop() { this.handle?.clear(); this.handle = undefined }
  list(): PendingTimer[] { return [...this.pending.values()] }
}
