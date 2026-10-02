// Deleting something a diagram file drew (docs/diagrams.md "What a redraw keeps"): the person's deletion wins over
// the file, like their moves do. The item (or wire) is not dropped — a redraw would draw it again from the file —
// it is marked `data.pending = { kind: 'remove', deleted }` and drawn struck: a proposal to remove it from the file,
// which the file holder applies after the person agrees. A redraw keeps the mark while the file still has it and
// removes the item for good once the file no longer does. Workflow wires (inspector/pending.ts) and UI mock
// elements (uiProposal.ts) have their own proposals; containers, comments and hand-drawn items are deleted as before.
import type { Board, Item, Op } from '../../../src/model'
import { diagramOf } from './frame'

type Deleted = { kind: 'remove'; deleted: 'item' | 'wire'; by: 'user'; at: string }

export const deletedOf = (it: Item | undefined): Deleted | undefined => {
  const p = it?.data?.pending as Partial<Deleted> | undefined
  return p?.kind === 'remove' && (p.deleted === 'item' || p.deleted === 'wire') ? (p as Deleted) : undefined
}

/** Is this an item a diagram file drew — so deleting it is a proposal, not a plain delete? */
export function isFileDrawn(board: Board, it: Item | undefined): boolean {
  if (!it || it.type === 'comment' || it.type === 'frame' || it.type === 'lane') return false
  if (it.type === 'wireframe' && it.role === 'screen') return false
  const d = diagramOf(board, it)
  if (!d?.frame || !d.source || d.kind === 'workflow' || d.kind === 'ui-mock') return false
  if (!it.id.startsWith(`${d.key}.`) || it.id === d.frame.id) return false
  // an agent's proposal (a story from EventStorming) or the person's own wire edit: deleting takes it back
  if (it.data?.pending && !deletedOf(it)) return false
  return it.createdBy !== 'user'
}

/**
 * Deleting file-drawn diagram items: each is marked deleted (it stays, struck) instead of going away; one already
 * marked stays as it is. `handled` = ids the caller must not delete.
 */
export function diagramRemoveOps(board: Board, ids: string[], now: string): { ops: Op[]; handled: string[] } {
  const ops: Op[] = []
  const handled: string[] = []
  for (const id of ids) {
    const it = board.items[id]
    if (!isFileDrawn(board, it)) continue
    handled.push(id)
    if (deletedOf(it)) continue
    const pending: Deleted = { kind: 'remove', deleted: it.type === 'arrow' ? 'wire' : 'item', by: 'user', at: now }
    ops.push({ kind: 'update', id, patch: { data: { ...(it.data ?? {}), pending } } })
  }
  return { ops, handled }
}

/** Undo: back to what the file draws (the mark goes). */
export function undoDeleteOps(it: Item): Op[] {
  if (!deletedOf(it)) return []
  const { pending: _gone, ...rest } = it.data ?? {}
  return [{ kind: 'update', id: it.id, patch: { data: rest } }]
}

/** In words, for the panel and the chat: what the person did and what is proposed. */
export function describeDeleted(it: Item): string {
  const what = it.type === 'arrow' ? 'this wire' : `this ${it.role ? it.role.replace(/-/g, ' ') : 'item'}`
  return `You deleted ${what} on the board; the file still has it. A redraw keeps it removed (struck) until the file no longer has it.`
}
