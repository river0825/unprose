// The link to something on a board (docs/canvas.md → "Going to something"): a diagram frame by its stable key
// (`?frame=<key>`, which survives redraws), anything else by its item id (`?focus=<id>` — a comment or an annotation
// card opens there), the board itself without either. The panel's Copy link and the item menu's give the same one.
import type { Item } from '../../src/model'

export function itemLink(board: { id: string }, item: Pick<Item, 'id' | 'type' | 'data'> | undefined, origin: string): string {
  const at = `${origin}/b/${encodeURIComponent(board.id)}`
  if (!item) return at
  const key = item.type === 'frame' ? (item.data?.diagram as { key?: unknown } | undefined)?.key : undefined
  return typeof key === 'string' && key ? `${at}?frame=${encodeURIComponent(key)}` : `${at}?focus=${encodeURIComponent(item.id)}`
}
