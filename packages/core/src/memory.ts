// Agent memory, the pure part. Two horizons:
//   short-term = this run (key): what the agents on this key already did and
//                what they asked to keep (`remember: {...}` in an ai output);
//   long-term  = the project: notes an agent asked to keep across runs
//                (`learn: [{ note, tags }]`) — recorded as `memory.learned`
//                events by the runtime, recalled by the MemoryStore port.
// The reducer owns short-term (it is state); the runtime owns long-term (it is IO).

import { REFLECT_OUTPUT_PROPERTY } from './reflection.js'

/** `agents.<id>.memory` after defaults. */
export interface AgentMemoryConfig {
  /** Recall `learn` notes from earlier runs (default true). */
  longTerm: boolean
  /** How many long-term notes to recall (default 20). */
  recall: number
  /** Show this run's earlier ai outcomes + `remember` values (default true). */
  shortTerm: boolean
}

export const DEFAULT_MEMORY: AgentMemoryConfig = { longTerm: true, recall: 20, shortTerm: true }

export function parseMemoryConfig(raw: unknown, where: string): AgentMemoryConfig {
  if (raw === undefined || raw === null || raw === true) return { ...DEFAULT_MEMORY }
  if (raw === false) return { longTerm: false, recall: 0, shortTerm: false }
  if (typeof raw !== 'object') throw new Error(`${where}: memory must be true | false | { longTerm, recall, shortTerm }`)
  const r = raw as Record<string, unknown>
  return {
    longTerm: r.longTerm === undefined ? DEFAULT_MEMORY.longTerm : Boolean(r.longTerm),
    recall: r.recall === undefined ? DEFAULT_MEMORY.recall : Number(r.recall),
    shortTerm: r.shortTerm === undefined ? DEFAULT_MEMORY.shortTerm : Boolean(r.shortTerm),
  }
}

/** One earlier ai outcome on this key — the short-term trail. */
export interface MemoryTrailEntry {
  step: string
  agent?: string
  outcome: string
  /** `summary` from the output when it was a string. */
  summary?: string
  at: string
}

/** What an ai step is handed about memory (pure part; long-term is fetched by the runtime). */
export interface CommandMemory {
  short?: { trail: MemoryTrailEntry[]; remembered: Record<string, unknown> }
  longTerm?: { recall: number }
}

/** A `learn` item as an agent writes it. */
export interface LearnNote { note: string; tags?: string[] }

/**
 * The two output properties every ai step may use whatever its own schema says.
 * Adapters send the augmented schema to the model; the executor validates with it.
 */
export const MEMORY_OUTPUT_PROPERTIES = {
  remember: {
    type: 'object',
    description: 'Anything to keep for later steps of this run (short-term memory). Free-form object; merged with what you remembered before.',
  },
  learn: {
    type: 'array',
    description: 'Lessons worth keeping for future runs of this project (long-term memory). Each note is one sentence; tags help recall.',
    items: { type: 'object', required: ['note'], properties: { note: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } },
  },
} as const

/** The step's output schema with `remember` / `learn` / `reflect` allowed (never required). */
export function withMemoryProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const props = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) }
  if (!('remember' in props)) props.remember = MEMORY_OUTPUT_PROPERTIES.remember
  if (!('learn' in props)) props.learn = MEMORY_OUTPUT_PROPERTIES.learn
  if (!('reflect' in props)) props.reflect = REFLECT_OUTPUT_PROPERTY
  return { ...schema, properties: props }
}

/** Pull `learn` notes out of an ai output, tolerating sloppy shapes (a string, a bare note). */
export function learnNotesOf(output: unknown): LearnNote[] {
  if (!output || typeof output !== 'object') return []
  const raw = (output as { learn?: unknown }).learn
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const out: LearnNote[] = []
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) out.push({ note: item.trim() })
    else if (item && typeof item === 'object' && typeof (item as { note?: unknown }).note === 'string') {
      const tags = (item as { tags?: unknown }).tags
      out.push({ note: (item as { note: string }).note.trim(), tags: Array.isArray(tags) ? tags.map(String) : undefined })
    }
  }
  return out.filter((n) => n.note)
}

/** `remember` as an object, or undefined. */
export function rememberOf(output: unknown): Record<string, unknown> | undefined {
  if (!output || typeof output !== 'object') return undefined
  const r = (output as { remember?: unknown }).remember
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : undefined
}

/** Step output minus the memory / reflection channels — what `vars.<step>` should hold. */
export function stripMemoryFields<T>(data: T): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const { remember: _r, learn: _l, reflect: _f, ...rest } = data as Record<string, unknown>
  return rest as T
}
