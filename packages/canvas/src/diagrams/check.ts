// Offline checks for a diagram file's content (river0825/unprose#8, #9): which schema a kind has, and
// which fields the schema does not know. Rendering stays lenient (zod drops extra keys); the author is
// told instead of the field silently vanishing. Pure — the CLI and the web can both use it.
import type { z } from 'zod'
import { contentSchemas } from '../templates/index.js'
import { unknownFields, type UnknownField } from './unknownFields.js'

export { unknownFields, type UnknownField } from './unknownFields.js'

/** The content schema of a diagram kind, when it has one ('workflow' has its own linter). */
export function contentSchemaFor(kind: string): z.ZodTypeAny | undefined {
  if (kind === 'workflow' || kind === 'freeform') return undefined
  return (contentSchemas as Record<string, z.ZodTypeAny>)[kind]
}

/** Unknown fields of a diagram file's content, or [] when the kind has no schema. */
export function unknownContentFields(kind: string, content: unknown): UnknownField[] {
  const schema = contentSchemaFor(kind)
  return schema ? unknownFields(schema, content) : []
}
