// Shared in-memory index + fan-out for every EventStore adapter. Subclasses
// decide only how an event is persisted.

import type { Event } from '@awd/core'
import type { EventStore, EventDraft, Listener } from '../../ports/eventStore.js'
import { newEventId } from '../../application/ids.js'

export abstract class BaseEventStore implements EventStore {
  protected events: Event[] = []
  protected listeners = new Set<Listener>()

  append(ev: EventDraft): Event {
    const full: Event = { id: ev.id ?? newEventId(), ts: ev.ts ?? new Date().toISOString(), ...ev } as Event
    this.persist(full)
    this.events.push(full)
    for (const fn of this.listeners) fn(full)
    return full
  }
  protected abstract persist(ev: Event): void
  all(): Event[] { return this.events.slice() }
  size(): number { return this.events.length }
  read(opts: { since?: number; key?: string; type?: string } = {}): Event[] {
    let out = this.events.slice(opts.since ?? 0)
    if (opts.key !== undefined) out = out.filter((e) => e.key === opts.key)
    if (opts.type !== undefined) out = out.filter((e) => e.type === opts.type)
    return out
  }
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
