import { createHash } from 'node:crypto'
import type { Author, ColorToken, Item, ItemType } from '../model.js'

export const STICKY_W = 160
export const STICKY_H = 110
export const SMALL_W = 120
export const SMALL_H = 80
export const GAP = 30
export const PAD = 40
export const LANE_HEADER = 44

export { slugify } from '../diagrams/ids.js'
import { slugify } from '../diagrams/ids.js'

export function shortHash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 6)
}

/** Deterministic id: same (kind, role, name) → same id across renders. */
export function stableId(scope: string, role: string, name: string): string {
  const base = slugify(name) || 'item'
  return `${scope}.${role}.${base}-${shortHash(`${scope}|${role}|${name}`)}`
}

export interface MakeOpts {
  id: string
  type: ItemType
  x: number
  y: number
  w: number
  h: number
  text?: string
  color?: ColorToken
  role?: string
  parent?: string
  from?: string
  to?: string
  label?: string
  target?: string
  order?: number
  data?: Record<string, unknown>
  author?: Author
}

export function make(o: MakeOpts, now: string): Item {
  const author = o.author ?? 'agent'
  const item: Item = {
    id: o.id,
    type: o.type,
    x: Math.round(o.x),
    y: Math.round(o.y),
    w: Math.round(o.w),
    h: Math.round(o.h),
    createdBy: author,
    updatedBy: author,
    updatedAt: now,
  }
  if (o.text !== undefined) item.text = o.text
  if (o.color) item.color = o.color
  if (o.role) item.role = o.role
  if (o.parent) item.parent = o.parent
  if (o.from) item.from = o.from
  if (o.to) item.to = o.to
  if (o.label !== undefined) item.label = o.label
  if (o.target) item.target = o.target
  if (o.order !== undefined) item.order = o.order
  if (o.data) item.data = o.data
  return item
}

/** Arrow id derived from its endpoints so re-rendering never duplicates. */
/** `key` tells apart several arrows between the same two items (a workflow wire per event). */
export function arrowId(scope: string, from: string, to: string, key?: string): string {
  return `${scope}.arrow.${shortHash(`${from}->${to}${key ? `:${key}` : ''}`)}`
}

export function arrow(scope: string, from: string, to: string, now: string, label?: string, role?: string, extra: { key?: string; data?: Record<string, unknown> } = {}): Item {
  return make({ id: arrowId(scope, from, to, extra.key), type: 'arrow', x: 0, y: 0, w: 0, h: 0, from, to, label, role, color: 'grey', ...(extra.data ? { data: extra.data } : {}) }, now)
}

/** Grow a frame/lane so it encloses the given children with padding. */
export function fit(container: Item, children: Item[], pad = PAD, header = LANE_HEADER): Item {
  if (children.length === 0) return container
  const minX = Math.min(...children.map((c) => c.x))
  const minY = Math.min(...children.map((c) => c.y))
  const maxX = Math.max(...children.map((c) => c.x + c.w))
  const maxY = Math.max(...children.map((c) => c.y + c.h))
  return {
    ...container,
    x: Math.min(container.x, minX - pad),
    y: Math.min(container.y, minY - pad - header),
    w: Math.max(container.w, maxX + pad - Math.min(container.x, minX - pad)),
    h: Math.max(container.h, maxY + pad - Math.min(container.y, minY - pad - header)),
  }
}

export interface RenderOpts {
  /** Offset every item by this origin (to add a template next to existing items). */
  at?: { x: number; y: number }
  /** Scope prefix for ids; defaults to the diagram kind. */
  scope?: string
  now?: string
  author?: Author
  /** The design file the drawing comes from (`data.diagram.source`): annotation cards name it in `data.annotation.file`. */
  source?: string
}

export function offsetAll(items: Item[], at?: { x: number; y: number }): Item[] {
  if (!at || (at.x === 0 && at.y === 0)) return items
  return items.map((i) => (i.type === 'arrow' ? i : { ...i, x: i.x + at.x, y: i.y + at.y }))
}
