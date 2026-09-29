import { randomUUID } from 'node:crypto'

/** Short, unique, readable in a log line. */
export function newEventId(): string {
  return randomUUID().slice(0, 8)
}
