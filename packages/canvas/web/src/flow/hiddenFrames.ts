// Hidden frames on the page (docs/canvas.md "Hiding a frame"): the board as drawn — what a hidden frame holds is not
// drawn at all, the frame is collapsed to its header strip with "N items hidden" and Show — and where a jump to something
// inside one lands instead. The rules are shared with the outline, the layout check and the snapshot (src/hidden.ts).
import type { Board, Item } from '../../../src/model'
import { hiddenOf } from '../../../src/hidden'

export { drawnBoard, hiddenCountOf, hiddenOf, hiddenOp, isHiddenFrame, HIDDEN_FRAME_H, HIDDEN_FRAME_W } from '../../../src/hidden'

/**
 * Where "take me to these items" goes on the board as drawn: an item a hidden frame holds — or a wire or a comment about
 * one — is that collapsed frame instead (once). `hiddenIn` are those frames, for the toast that says so.
 */
export function drawnTargets(board: Board, ids: string[]): { ids: string[]; hiddenIn: Item[] } {
  const h = hiddenOf(board)
  if (!h || !ids.some((id) => h.ids.has(id))) return { ids, hiddenIn: [] }
  const out = new Set<string>()
  const frames = new Map<string, Item>()
  for (const id of ids) {
    const f = h.frameOf.get(id)
    if (f && board.items[f]) frames.set(f, board.items[f])
    out.add(f ?? id)
  }
  return { ids: [...out], hiddenIn: [...frames.values()] }
}

/** The toast when a jump lands on a collapsed frame: which frame, and how to see inside. */
export function hiddenToast(frames: Item[]): string {
  const names = frames.map((f) => `“${(f.text ?? '').split('\n')[0].trim().slice(0, 40) || 'Frame'}”`).join(', ')
  return frames.length === 1 ? `In the hidden frame ${names} — click Show on it to see its contents` : `In the hidden frames ${names} — click Show on them to see their contents`
}
