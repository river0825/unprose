// Reflection, the pure part. A signal is something worth looking at later:
// an agent's `reflect: [{ note, kind, tags }]` in its answer, a script's
// `reflect` next to its `outcome`, or — automatically — any `<step>.failed`
// and `<step>.timeout` event. The runtime records signals as `reflection.noted`
// events; grouping them into patterns and turning patterns into kanban cards
// lives in the runtime (it is a projection + IO). Here: the output field.

export type ReflectKind = 'friction' | 'bug' | 'idea' | 'rule'
export const REFLECT_KINDS: ReflectKind[] = ['friction', 'bug', 'idea', 'rule']

/** A `reflect` item as an agent or script writes it. */
export interface ReflectNote { note: string; kind: ReflectKind; tags?: string[] }

export const REFLECT_OUTPUT_PROPERTY = {
  type: 'array',
  description:
    'Something the people running this workflow should look at later — friction you hit, a bug you noticed, an idea, or a rule that should exist. Not memory: it is for the humans, grouped into patterns and turned into cards.',
  items: {
    type: 'object',
    required: ['note'],
    properties: {
      note: { type: 'string' },
      kind: { enum: REFLECT_KINDS },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
} as const

/** Pull `reflect` notes out of an ai output or a script's JSON, tolerating sloppy shapes. */
export function reflectNotesOf(output: unknown): ReflectNote[] {
  if (!output || typeof output !== 'object') return []
  const raw = (output as { reflect?: unknown }).reflect
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const out: ReflectNote[] = []
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) out.push({ note: item.trim(), kind: 'friction' })
    else if (item && typeof item === 'object' && typeof (item as { note?: unknown }).note === 'string') {
      const i = item as { note: string; kind?: unknown; tags?: unknown }
      const kind = REFLECT_KINDS.includes(i.kind as ReflectKind) ? (i.kind as ReflectKind) : 'friction'
      out.push({ note: i.note.trim(), kind, tags: Array.isArray(i.tags) ? i.tags.map(String) : undefined })
    }
  }
  return out.filter((n) => n.note)
}

/**
 * Wildcard listeners: `on: "*.failed"` (or `"*.timeout"`) fires for that outcome
 * of ANY other step — the hook a reflection step uses. Only this one form exists.
 */
export function wildcardOutcome(listener: string): string | undefined {
  const m = /^\*\.([a-z][a-z0-9-]*)$/.exec(listener)
  return m ? m[1] : undefined
}

/** Does listener `pattern` on step `listenerStep` match an event of `type`? */
export function listenerMatches(pattern: string, type: string, listenerStep: string, knownSteps: Iterable<string>): boolean {
  if (pattern === type) return true
  const outcome = wildcardOutcome(pattern)
  if (!outcome) return false
  const i = type.lastIndexOf('.')
  if (i <= 0 || type.slice(i + 1) !== outcome) return false
  const step = type.slice(0, i)
  if (step === listenerStep) return false // a step never reflects on itself — that would loop
  for (const s of knownSteps) if (s === step) return true
  return false
}
