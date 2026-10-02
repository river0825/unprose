// Rubber-band selection rules (docs/canvas.md "Moving and selecting inside frames").
// Pure: no React, so the rules are unit-tested (packages/canvas/test/bandSelect.test.ts).

/** A rectangle in flow (board) coordinates. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The rectangle between two corners, in either order. */
export const rectBetween = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
})

export const fullyInside = (r: Rect, band: Rect): boolean => r.x >= band.x && r.y >= band.y && r.x + r.w <= band.x + band.w && r.y + r.h <= band.y + band.h

export interface BandNode {
  id: string
  rect: Rect
  /** a frame, lane, kanban column or screen: it holds other items */
  container: boolean
}

/**
 * What a rubber band selects, given what React Flow picked (any node the band touches):
 * - an item counts when the band touches it (partial, as on the empty canvas);
 * - a container counts only when the band encloses it whole, so a band drawn inside a frame selects the items in it,
 *   not the frame it was drawn on (Miro, FigJam and tldraw do the same);
 * - with Shift (or ⌘/Ctrl) held when the drag began, the band adds to the selection that was there before.
 */
export function bandSelection(picked: Iterable<string>, nodes: Map<string, BandNode>, band: Rect, before: Iterable<string> = [], additive = false): Set<string> {
  const out = new Set<string>()
  for (const id of picked) {
    const n = nodes.get(id)
    if (n && n.container && !fullyInside(n.rect, band)) continue
    out.add(id)
  }
  if (additive) for (const id of before) out.add(id)
  return out
}
