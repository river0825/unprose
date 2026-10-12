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

/**
 * Trace link from an element to an element of a diagram (another one, or its own):
 * `from` = '<diagram key>/<element id>', or just '<diagram key>' for the whole diagram (its frame).
 * `relates` is the general link (相關) when none of the others fits.
 */
export const TRACE_RELS = ['derived-from', 'groups', 'shows', 'relates'] as const
export type TraceRel = (typeof TRACE_RELS)[number]
export interface Trace {
  from: string
  rel: TraceRel
}
/** A trace in a diagram file: `{ from: '<diagram key>/<element id>', rel }`. */
export const traceSchema = z.object({ from: z.string().min(1), rel: z.enum(TRACE_RELS) })

export const TRACE_LABEL: Record<TraceRel, string> = { 'derived-from': '來自', groups: '組成', shows: '畫面', relates: '相關' }

/**
 * An annotation in a diagram file (docs/diagrams.md "Annotations"), the top-level `annotations:` list of every kind:
 * what an item is for, `on` naming the item (its element id, its id inside the diagram, or its text). Drawn as a
 * numbered card beside the drawing and a pin with the same number on the item.
 */
export const annotationSchema = z.object({ id: z.string().optional(), on: z.string().min(1), text: z.string().min(1) })
export const annotationsSchema = z.array(annotationSchema)
export type AnnotationEntry = z.input<typeof annotationSchema>

/** '<key>/<element>' → both; '<key>' → the whole diagram (element undefined). */
export function parseTraceRef(ref: string): { key: string; element?: string } | undefined {
  const i = ref.indexOf('/')
  if (i < 0) return DIAGRAM_KEY.test(ref) ? { key: ref } : undefined
  if (i === 0 || i === ref.length - 1) return undefined
  return { key: ref.slice(0, i), element: ref.slice(i + 1) }
}
