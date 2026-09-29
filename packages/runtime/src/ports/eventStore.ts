// Port: EventStore — the append-only log that is the source of truth.
// Everything else (run state, dashboards, the canvas) is a projection of it.

import type { Event } from '@awd/core'

export type Listener = (event: Event) => void

export type EventDraft = Omit<Event, 'id' | 'ts'> & Partial<Pick<Event, 'id' | 'ts'>>

export interface EventStore {
  append(ev: EventDraft): Event
  all(): Event[]
  read(opts?: { since?: number; key?: string; type?: string }): Event[]
  subscribe(fn: Listener): () => void
  /** Number of events in the log. */
  size(): number
  /**
   * Optional: pick up events another process appended (a file-backed store
   * shared with `awd emit`). Stores that cannot be written from outside omit it.
   */
  refresh?(): Event[]
}
