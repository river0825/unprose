// The run key (aggregate id) of a trigger event. Pure.
import { template, type WorkflowDefinition, type Event } from '@awd/core'

/** The run key for a trigger event: the workflow `key` template, else the event id. */
export function keyFor(def: WorkflowDefinition, event: Pick<Event, 'id' | 'type' | 'data' | 'ts'>, env: Record<string, string> = {}): string {
  if (!def.key) return event.id
  const v = template(def.key, { event, env, now: event.ts })
  if (v === undefined || v === null || v === '') throw new Error(`key template "${def.key}" produced nothing for event ${event.type}`)
  return String(v)
}
