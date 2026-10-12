// The person's annotation as a draft for the holder of the files (docs/canvas.md → "Notes"; src/annotations.ts): the
// edit that adds it to the design file, made on the board's copy of the file. Apart from flow/annotationsView.ts
// because it needs the yaml parser: the board loads it when the person annotates. Pure, tested.
import type { Board, Item } from '../../../src/model'
import { addAnnotationToFile } from '../../../src/annotationFile'
import { unifiedDiff } from '../../../src/patch'
import { annotateWhere } from './annotationsView'

/** What a draft becomes: its `data` (`annotation` + `discuss`), and the file text its edit was made on. */
export interface DraftPlan {
  data: Record<string, unknown>
  /** the file's text the diff was made on: its sha-1 goes in `discuss.edit.base` (withBase) */
  baseText?: string
  file?: string
  holder?: string
  /** why the draft carries no edit */
  why?: string
}

/**
 * The person's annotation on `item` as a draft for the holder of the files (src/annotations.ts): `data.annotation`
 * says what it is about and where it goes; `data.discuss.edit` carries the diff that adds it to the file — one more
 * `annotations:` entry, every other line as it was — when the board has the whole file and it takes the entry.
 * Without that it is still a proposal (the holder writes it in by hand), and `why` says so. Undefined when the item
 * has no file behind it: that annotation goes on the board only (boardAnnotation).
 */
export function annotationDraft(board: Board, item: Item, text: string): DraftPlan | undefined {
  const where = annotateWhere(board, item)
  if (where.kind === 'board') return undefined
  const annotation = { draft: true, on: where.on, ...(where.file ? { file: where.file } : {}) }
  const about = { about: [item.id] }
  const head = { ...(where.file ? { file: where.file } : {}), ...(where.holder ? { holder: where.holder } : {}) }
  if (where.text === undefined || !where.file) return { data: { annotation, discuss: about }, ...head, ...(where.why ? { why: where.why } : {}) }
  let after: string
  try {
    after = addAnnotationToFile(where.text, { on: where.on, text: text.trim() })
  } catch (err) {
    return { data: { annotation, discuss: about }, ...head, why: `${where.file} could not take the entry (${err instanceof Error ? err.message : String(err)})` }
  }
  const diff = unifiedDiff(where.text, after, where.file)
  return { data: { annotation, discuss: { ...about, edit: { file: where.file, base: '', diff } } }, baseText: where.text, ...head }
}

/** The draft's data with the sha-1 of the file text its edit was made on (`discuss.edit.base`). */
export function withBase(plan: DraftPlan, base: string): Record<string, unknown> {
  const discuss = plan.data.discuss as { edit?: Record<string, unknown> } | undefined
  if (!discuss?.edit) return plan.data
  return { ...plan.data, discuss: { ...discuss, edit: { ...discuss.edit, base } } }
}
