import { createContext, useContext } from 'react'
import type { Op } from '../../../src/model'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface EditApi {
  /** id of the item (or arrow) whose text / label is being edited */
  editingId: string | null
  startEdit: (id: string) => void
  /** `andContinue` = ⌘Enter: save, then open a sibling sticky below in edit mode. */
  commitText: (id: string, text: string, andContinue?: boolean) => void
  commitLabel: (id: string, label: string) => void
  cancelEdit: () => void
  /** comment-attach mode: clicking an item attaches a new comment to it */
  attachTarget: ((id: string) => void) | null
  /** open the item context menu at a screen position */
  openMenu: (id: string, x: number, y: number) => void
  /** end of a resize gesture; `rect` is relative to the node's parent, as React Flow reports it */
  resize: (id: string, rect: Rect) => void
  /** move a wire's single bend point (flow coordinates) */
  bend: (id: string, point: { x: number; y: number }) => void
  /** expand or fold a comment (a per-viewer preference); expanding marks it read */
  setCommentOpen: (id: string, open: boolean) => void
  /** add a reply to a comment thread; empty text is ignored */
  reply: (rootId: string, text: string) => void
  /** a workflow script block: open its source in the large view (`edit`: straight in Edit mode) */
  openSource: (id: string, mode: 'view' | 'edit') => void
  /** apply ops made on a node itself, e.g. a UI mock table cell edited in place (a proposal, docs/diagrams.md §6c) */
  commitOps?: (ops: Op[], label: string) => void
  /** UI mock items proposed for removal, and what they hold: drawn struck until the file changes */
  uiRemoved?: ReadonlySet<string>
  /**
   * the pointer is on (or off) callout `n` of a UI element (docs/diagrams.md §6c): on its pin — light up its card —
   * or on its card — outline its pin
   */
  hoverCallout?: (elementId: string, n: number, on: boolean, from: 'pin' | 'card') => void
  /** a click on callout `n`'s pin: select its card and bring it into view (in Notes: badges, show or hide the card) */
  showCallout?: (elementId: string, n: number) => void
}

export const EditContext = createContext<EditApi>({
  editingId: null,
  startEdit: () => undefined,
  commitText: () => undefined,
  commitLabel: () => undefined,
  cancelEdit: () => undefined,
  attachTarget: null,
  openMenu: () => undefined,
  resize: () => undefined,
  bend: () => undefined,
  setCommentOpen: () => undefined,
  reply: () => undefined,
  openSource: () => undefined,
})

export const useEdit = () => useContext(EditContext)
