// Offline checks for a diagram file's content (river0825/unprose#8, #9): which schema a kind has, and
// which fields the schema does not know. Rendering stays lenient (zod drops extra keys); the author is
// told instead of the field silently vanishing. Pure — the CLI and the web can both use it.
import type { z } from 'zod'
import { contentSchemas } from '../templates/index.js'

/** The content schema of a diagram kind, when it has one ('workflow' has its own linter). */
export function contentSchemaFor(kind: string): z.ZodTypeAny | undefined {
  if (kind === 'workflow' || kind === 'freeform') return undefined
  return (contentSchemas as Record<string, z.ZodTypeAny>)[kind]
}

export interface UnknownField {
  /** Where, in the file's terms: `cards[2]`, `activities[0].steps[1]`, `(root)`. */
  path: string
  field: string
}

type Def = { type: string; shape?: Record<string, z.ZodTypeAny>; catchall?: z.ZodTypeAny; innerType?: z.ZodTypeAny; element?: z.ZodTypeAny; options?: z.ZodTypeAny[]; in?: z.ZodTypeAny; out?: z.ZodTypeAny; valueType?: z.ZodTypeAny; getter?: () => z.ZodTypeAny }
const def = (s: z.ZodTypeAny) => (s as unknown as { _zod: { def: Def } })._zod.def
const WRAPPERS = new Set(['optional', 'default', 'nullable', 'readonly', 'catch', 'prefault', 'nonoptional'])

/** Peel wrappers, lazies and pipes (preprocess → its output schema) down to the schema that shapes the value. */
function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  for (let i = 0; i < 20; i++) {
    const d = def(s)
    if (WRAPPERS.has(d.type) && d.innerType) s = d.innerType
    else if (d.type === 'lazy' && d.getter) s = d.getter()
    else if (d.type === 'pipe' && d.in && d.out) s = def(d.in).type === 'transform' ? d.out : d.in
    else return s
  }
  return s
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const at = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key)

/** Every key the file uses that the schema would drop. */
export function unknownFields(schema: z.ZodTypeAny, value: unknown, path = ''): UnknownField[] {
  const s = unwrap(schema)
  const d = def(s)
  if (d.type === 'object' && isPlainObject(value)) {
    const shape = d.shape ?? {}
    const open = d.catchall && def(d.catchall).type !== 'never'
    const out: UnknownField[] = []
    for (const [k, v] of Object.entries(value)) {
      if (k in shape) out.push(...unknownFields(shape[k], v, at(path, k)))
      else if (!open) out.push({ path: path || '(root)', field: k })
    }
    return out
  }
  if (d.type === 'array' && Array.isArray(value) && d.element) return value.flatMap((v, i) => unknownFields(d.element!, v, at(path, i)))
  if (d.type === 'record' && isPlainObject(value) && d.valueType) return Object.entries(value).flatMap(([k, v]) => unknownFields(d.valueType!, v, at(path, k)))
  if (d.type === 'union' && d.options) {
    // the option whose shape fits the value; for objects, the one that knows the most of its keys
    const fits = d.options.filter((o) => {
      const t = def(unwrap(o)).type
      return Array.isArray(value) ? t === 'array' : isPlainObject(value) ? t === 'object' || t === 'record' : t !== 'object' && t !== 'array'
    })
    if (!fits.length) return []
    const ranked = fits.map((o) => ({ o, extra: unknownFields(o, value, path) })).sort((a, b) => a.extra.length - b.extra.length)
    return ranked[0].extra
  }
  return []
}

/** Unknown fields of a diagram file's content, or [] when the kind has no schema. */
export function unknownContentFields(kind: string, content: unknown): UnknownField[] {
  const schema = contentSchemaFor(kind)
  return schema ? unknownFields(schema, content) : []
}
