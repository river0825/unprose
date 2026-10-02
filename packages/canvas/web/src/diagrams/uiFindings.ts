// A UI mock frame's findings (docs/diagrams.md §6c): what `awd design lint` says about its file, put by the
// drawing on the element each is about (`data.ui.findings`). Read straight off the board — no parser.
// Pure, so the tests can use it.
import type { Board, Item } from '../../../src/model'
import type { Finding } from './es'
import { membersOf } from './frame'

export interface UiItemFinding { severity: 'warning' | 'info'; message: string }

/** The findings the drawing put on this element. */
export function uiFindingsOf(it: Item | undefined): UiItemFinding[] {
  const f = it?.type === 'ui' ? (it.data?.ui as { findings?: unknown } | undefined)?.findings : undefined
  return Array.isArray(f) ? f.filter((x): x is UiItemFinding => typeof x?.message === 'string') : []
}

/** Every finding in the frame, warnings first, screens and elements in their drawn order. */
export function uiFindings(board: Board, frameId: string): Finding[] {
  const out: Finding[] = []
  for (const it of membersOf(board, frameId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
    for (const f of uiFindingsOf(it)) out.push({ elementId: it.id, message: f.message, page: '', severity: f.severity })
  return out.sort((a, b) => Number(a.severity === 'info') - Number(b.severity === 'info'))
}
