// Element ids inside a diagram file (docs/diagrams.md §2): explicit `id`, else the slug of the text.
// No node builtins here, so the web can import it too.
import { z } from 'zod'

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** Hands out element ids that are unique within one diagram: `id` if given, else slug(text); clashes get -2, -3 … */
export function idAllocator() {
  const used = new Set<string>()
  return (explicit: string | undefined, text: string, fallback = 'item'): string => {
    const base = (explicit && explicit.trim()) || slugify(text) || fallback
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  }
}

/** A diagram key: lower-case letters, digits and dashes, 1–40 chars ('studio-es'). */
export const DIAGRAM_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/

/** Trace link from an element to an element of another diagram: `from` = '<diagram key>/<element id>'. */
export type TraceRel = 'derived-from' | 'groups' | 'shows'
export interface Trace {
  from: string
  rel: TraceRel
}
/** A trace in a diagram file: `{ from: '<diagram key>/<element id>', rel }`. */
export const traceSchema = z.object({ from: z.string(), rel: z.enum(['derived-from', 'groups', 'shows']) })

export const TRACE_LABEL: Record<TraceRel, string> = { 'derived-from': '來自', groups: '組成', shows: '畫面' }

export function parseTraceRef(ref: string): { key: string; element: string } | undefined {
  const i = ref.indexOf('/')
  if (i <= 0 || i === ref.length - 1) return undefined
  return { key: ref.slice(0, i), element: ref.slice(i + 1) }
}
