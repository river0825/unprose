// Which comments a viewer sees, and how (docs/canvas.md → "Notes"). A UI-mock frame collects notes and threads on
// its screens, and a finished proposal thread stays open for ever, so the viewer chooses: every comment as it is,
// every comment folded into a marker, or none — and a proposal that was applied folds by itself into a ✓ marker.
// Pure (no React), so the rules can be tested; the shape of flow/traceView.ts.
import type { Board, Item } from '../../../src/model'
import { threads } from './boardToFlow'

/**
 * - `all`: every comment as the viewer left it (open or folded; a settled proposal folds into a ✓);
 * - `badges`: every comment folded into a small marker at its anchor, opened by a click for this viewer;
 * - `none`: no comment is drawn (the panel's Chats tab still lists them).
 */
export type NotesMode = 'all' | 'badges' | 'none'
export const NOTES_MODES: NotesMode[] = ['all', 'badges', 'none']
export const DEFAULT_NOTES_MODE: NotesMode = 'all'
export const NOTES_MODE_NAMES: Record<NotesMode, string> = { all: 'All', badges: 'Badges', none: 'None' }

/**
 * How one thread is drawn: open (its messages), as a `badge` (the folded bubble), as `done` (the ✓ of a settled
 * proposal, folded until the viewer clicks it) or `hidden` (not drawn at all).
 */
export type CommentShown = 'open' | 'badge' | 'done' | 'hidden'

/** A proposal thread: its root was made by `canvas_propose_edit` (`prop_…`) or carries an edit (`data.discuss.edit`). */
export function isProposal(root: Item): boolean {
  if (root.type !== 'comment') return false
  if (root.id.startsWith('prop_')) return true
  const edit = (root.data?.discuss as { edit?: unknown } | undefined)?.edit
  return Boolean(edit && typeof edit === 'object')
}

/** The holder answered "Applied to <file>" in the thread (`--applied`, packages/cli/src/applied.ts: id `applied.<t>`). */
export function isApplied(messages: readonly Item[]): boolean {
  return messages.some((m, i) => i > 0 && (m.id.startsWith('applied.') || (m.text ?? '').trimStart().startsWith('Applied to ')))
}

/** The Decline button of the proposal (components/EditProposal.tsx) posted its answer in the thread. */
export const DECLINE_TEXT = 'No, leave the file as it is.'
export function isDeclined(messages: readonly Item[]): boolean {
  return messages.some((m, i) => i > 0 && m.createdBy === 'user' && (m.text ?? '').trim() === DECLINE_TEXT)
}

/** A proposal thread that is finished — applied by the holder, or declined by the person: nothing left to discuss. */
export function isSettled(messages: readonly Item[]): boolean {
  const root = messages[0]
  return Boolean(root) && isProposal(root) && (isApplied(messages) || isDeclined(messages))
}

export interface NotesView {
  mode: NotesMode
  /** threads the viewer opened (remembered per board in this browser) */
  open: ReadonlySet<string>
  /** threads the viewer opened in this session beyond that: a settled proposal, or a badge in `badges` mode */
  expanded: ReadonlySet<string>
  /** the comment being edited, if any: its thread is always drawn open */
  editing?: string | null
}

/**
 * How every thread (by its root id) is drawn under `view`. A thread being edited is open in every mode — a new
 * comment must be visible while it is typed — and one opened in this session (`expanded`) stays open until it is
 * folded, in `none` too. The `open` set alone (no mode) is what the board did before.
 */
export function notesShown(board: Board, view: NotesView): Map<string, CommentShown> {
  const out = new Map<string, CommentShown>()
  for (const [id, messages] of threads(board)) {
    if (view.editing && messages.some((m) => m.id === view.editing)) {
      out.set(id, 'open')
      continue
    }
    if (view.mode === 'none') {
      // a thread opened in this session (one just written, a ✓ clicked before the switch) stays until it is folded
      out.set(id, view.expanded.has(id) ? 'open' : 'hidden')
      continue
    }
    const settled = isSettled(messages)
    if (view.mode === 'badges') out.set(id, view.expanded.has(id) ? 'open' : settled ? 'done' : 'badge')
    else if (settled) out.set(id, view.expanded.has(id) ? 'open' : 'done')
    else out.set(id, view.open.has(id) || view.expanded.has(id) ? 'open' : 'badge')
  }
  return out
}

/** Does the board have a comment at all? The Notes switch is shown only then. */
export function hasComments(board: Board): boolean {
  for (const it of Object.values(board.items)) if (it.type === 'comment') return true
  return false
}

/** The ⓘ note on one entry of a list, tabs, sidebar, navbar or select (`data.ui.items[i].note`). */
export function itemNote(items: ReadonlyArray<{ note?: unknown }> | undefined, i: number): string | undefined {
  const n = items?.[i]?.note
  return typeof n === 'string' && n.trim() ? n : undefined
}

/** The ⓘ note on one row of a table (`data.ui.rowNotes`, keyed by the row index as a string). */
export function rowNote(ui: { rowNotes?: Record<string, unknown> } | undefined, i: number): string | undefined {
  const n = ui?.rowNotes?.[String(i)]
  return typeof n === 'string' && n.trim() ? n : undefined
}

/** The note comment about one entry or row of an element: `target` is the element, `data.item` / `data.row` its index. */
export function noteCommentOf(board: Board, elementId: string, kind: 'item' | 'row', index: number): Item | undefined {
  for (const it of Object.values(board.items)) {
    if (it.type !== 'comment' || it.target !== elementId) continue
    const at = it.data?.[kind]
    if (typeof at === 'number' && at === index) return it
  }
  return undefined
}
