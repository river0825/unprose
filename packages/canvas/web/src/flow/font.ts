import type { Item } from '../../../src/model'

/** Item types whose text grows and shrinks with the box. */
export const SCALES_FONT = new Set<Item['type']>(['text', 'sticky', 'card'])

/** The stylesheet's default size for an item (styles.css: .text-item, .sticky, .card). */
function defaultFont(it: Item): number {
  // a domain-story annotation (inspector.css .ds-annotation, src/textMetrics.ts)
  if (it.type === 'text') return it.role === 'title' || it.role === 'heading' ? 22 : it.role === 'annotation' ? 12.5 : 15
  if (it.type === 'sticky' && it.role === 'actor') return 12.5
  return 13
}

export const fontOf = (it: Item): number => it.fontSize ?? defaultFont(it)

/** Font after resizing from `it.h` to `h`: text scales with the height of its box. */
export function scaledFont(it: Item, h: number): number {
  const size = (fontOf(it) * h) / Math.max(it.h, 1)
  return Math.round(Math.min(160, Math.max(8, size)) * 2) / 2
}
