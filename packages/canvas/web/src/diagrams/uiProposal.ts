// A text edit on a UI mock element is a proposal (docs/diagrams.md §6c): the board keeps the new words and
// remembers the old ones in `data.pending`; the file does not change until the AI applies the diff this
// module describes and redraws (the diff itself: uiProposalFile.ts, loaded on demand with the yaml parser).
// Pure (no React), so the tests can use it.
import type { Item, Op } from '../../../src/model'

export interface UiTextPending {
  kind: 'text'
  before: { text: string }
  after: { text: string }
  /** the element in the file: ['screens', 0, 'body', 2] */
  path: Array<string | number>
  /** the key holding its words: 'text', 'label', or 'name' (a screen) */
  key: string
  by: 'user'
  at: string
}

type UiMeta = { path?: unknown; textKey?: unknown; type?: unknown }
const metaOf = (it: Item | undefined): UiMeta | undefined => (it?.type === 'ui' ? (it.data?.ui as UiMeta | undefined) : undefined)

/** A UI mock element drawn from a file (its place in the file is known). */
export function isUiElement(it: Item | undefined): boolean {
  return Array.isArray(metaOf(it)?.path)
}

export function uiPendingOf(it: Item | undefined): UiTextPending | undefined {
  const p = it?.data?.pending as UiTextPending | undefined
  return p && p.kind === 'text' && typeof p.after?.text === 'string' ? p : undefined
}

/** The op for editing the words on the board: a proposal; back to what the file says → no longer pending. */
export function uiTextOp(it: Item, text: string, now: string): Op {
  const m = metaOf(it)!
  const cur = uiPendingOf(it)
  const before = cur ? cur.before.text : (it.text ?? '')
  const { pending: _old, ...rest } = it.data ?? {}
  const pending: UiTextPending | undefined =
    text === before ? undefined : { kind: 'text', before: { text: before }, after: { text }, path: m.path as Array<string | number>, key: typeof m.textKey === 'string' ? m.textKey : 'text', by: 'user', at: now }
  return { kind: 'update', id: it.id, patch: { text, data: pending ? { ...rest, pending } : rest } }
}

/** Undo: the words the file has, and no proposal. */
export function uiUndoOps(it: Item): Op[] {
  const p = uiPendingOf(it)
  if (!p) return []
  const { pending: _old, ...rest } = it.data ?? {}
  return [{ kind: 'update', id: it.id, patch: { text: p.before.text, data: rest } }]
}
