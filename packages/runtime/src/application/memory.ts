// Memory, the application part: turn `memory.learned` events into store
// entries (the projection), and render what an agent is told about its past.
// Pure except for the store calls; the engine and the CLI both use it.

import type { Event } from '@awd/core'
import type { MemoryEntry, MemoryStore } from '../ports/memory.js'
import type { RecalledMemory } from '../ports/workerRuntime.js'

export const MEMORY_LEARNED = 'memory.learned'

export interface LearnedData { agent: string; key?: string; step?: string; note: string; tags?: string[] }

export function memoryEntryFromEvent(ev: Event): MemoryEntry | undefined {
  if (ev.type !== MEMORY_LEARNED || !ev.data || typeof ev.data !== 'object') return undefined
  const d = ev.data as Partial<LearnedData>
  if (typeof d.agent !== 'string' || typeof d.note !== 'string') return undefined
  return { id: ev.id, agent: d.agent, key: d.key ?? ev.key, step: d.step, note: d.note, tags: Array.isArray(d.tags) ? d.tags.map(String) : [], at: ev.ts }
}

/** Bring the projection up to date with the log (idempotent — record() ignores known ids). */
export async function syncMemory(events: Event[], store: MemoryStore): Promise<number> {
  let n = 0
  for (const ev of events) {
    const e = memoryEntryFromEvent(ev)
    if (e) { await store.record(e); n++ }
  }
  return n
}

const NOTE_MAX = 200
const TRAIL_MAX = 12

/** The memory block appended to the system prompt. Empty string when there is nothing to say. */
export function renderMemory(m: RecalledMemory | undefined): string {
  if (!m) return ''
  const parts: string[] = []
  if (m.longTerm?.length) {
    parts.push('## What you learned before (long-term memory of this project)')
    for (const e of m.longTerm) parts.push(`- ${e.at.slice(0, 10)}${e.key ? ` [${e.key}]` : ''}: ${clip(e.note)}${e.tags.length ? ` (${e.tags.join(', ')})` : ''}`)
  }
  const short = m.short
  if (short && (short.trail.length || Object.keys(short.remembered).length)) {
    parts.push(parts.length ? '' : '', '## Earlier in this run (short-term memory)')
    for (const t of short.trail.slice(-TRAIL_MAX)) parts.push(`- ${t.step}${t.agent ? ` (@${t.agent})` : ''} → ${t.outcome}${t.summary ? `: ${clip(t.summary)}` : ''}`)
    if (Object.keys(short.remembered).length) parts.push(`- you asked to remember: ${clip(JSON.stringify(short.remembered), 600)}`)
  }
  if (parts.length) parts.push('', 'You may add `remember: {...}` (kept for this run) and `learn: [{ note, tags }]` (kept for future runs) to your JSON answer.')
  return parts.join('\n').trim()
}

function clip(s: string, max = NOTE_MAX): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
