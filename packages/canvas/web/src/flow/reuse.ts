// boardToFlow builds every node and edge afresh on each board change, so React Flow saw 300 new objects — it
// re-measured every node and re-rendered every node and wire — when one sticky's text changed. Here the earlier
// object is kept wherever the new one says the same thing, so React Flow (which goes by identity) leaves the rest
// alone. Pure, tested on its own. The kept node also keeps what React Flow wrote on it (`measured`, `selected`).
import type { Edge } from '@xyflow/react'
import type { ItemNode } from './boardToFlow'

const sameList = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined, same: (x: T, y: T) => boolean = Object.is): boolean => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false
  return true
}

/** Shallow equality of two plain records (or both absent). */
const sameRecord = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean => {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (!Object.is(a[k], b[k])) return false
  return true
}

type Badge = NonNullable<ItemNode['data']['wireBadges']>[number]
const sameBadge = (a: Badge, b: Badge) => a.key === b.key && a.end === b.end && a.text === b.text && a.title === b.title && a.open === b.open && sameList(a.wires, b.wires)

/** Does the earlier node say the same as the new one, in every field boardToFlow sets? */
export function sameNode(prev: ItemNode, next: ItemNode): boolean {
  if (prev.id !== next.id || prev.type !== next.type || prev.position.x !== next.position.x || prev.position.y !== next.position.y) return false
  if (prev.width !== next.width || prev.height !== next.height || prev.initialHeight !== next.initialHeight) return false
  if (prev.parentId !== next.parentId || prev.extent !== next.extent || prev.zIndex !== next.zIndex || prev.className !== next.className || prev.dragHandle !== next.dragHandle) return false
  if (prev.draggable !== next.draggable || prev.selectable !== next.selectable || prev.connectable !== next.connectable || prev.hidden !== next.hidden) return false
  const [p, n] = [prev.data, next.data]
  if (p.item !== n.item || p.pulse !== n.pulse || p.open !== n.open || p.done !== n.done || p.childCount !== n.childCount || !sameList(p.replies, n.replies)) return false
  const [pd, nd] = [p.diagram, n.diagram]
  if (pd !== nd && (!pd || !nd || pd.kind !== nd.kind || pd.name !== nd.name || pd.key !== nd.key || pd.findings !== nd.findings)) return false
  return sameList(p.wireBadges, n.wireBadges, sameBadge)
}

type EdgeData = { item?: unknown; port?: Record<string, number>; dsPlan?: unknown; bundle?: unknown }

/** Does the earlier edge say the same as the new one, in every field boardToFlow sets? */
export function sameEdge(prev: Edge, next: Edge): boolean {
  if (prev.id !== next.id || prev.source !== next.source || prev.target !== next.target || prev.sourceHandle !== next.sourceHandle || prev.targetHandle !== next.targetHandle) return false
  if (prev.type !== next.type || prev.label !== next.label || prev.hidden !== next.hidden || prev.className !== next.className || prev.reconnectable !== next.reconnectable) return false
  if (prev.selectable !== next.selectable || prev.focusable !== next.focusable || prev.deletable !== next.deletable) return false
  if (!sameRecord(prev.style as Record<string, unknown> | undefined, next.style as Record<string, unknown> | undefined)) return false
  if (!sameRecord(prev.markerEnd as Record<string, unknown> | undefined, next.markerEnd as Record<string, unknown> | undefined)) return false
  const [p, n] = [(prev.data ?? {}) as EdgeData, (next.data ?? {}) as EdgeData]
  if (p.item !== n.item || !sameRecord(p.port, n.port) || p.bundle !== n.bundle) return false
  return p.dsPlan === n.dsPlan || JSON.stringify(p.dsPlan) === JSON.stringify(n.dsPlan)
}

/** `next` with every element replaced by its earlier self where `same` says nothing changed. */
export function reuse<T extends { id: string }>(prev: readonly T[], next: T[], same: (p: T, n: T) => boolean): T[] {
  if (!prev.length) return next
  const byId = new Map<string, T>()
  for (const p of prev) byId.set(p.id, p)
  let kept = 0
  const out = next.map((n) => {
    const p = byId.get(n.id)
    if (p && same(p, n)) {
      kept++
      return p
    }
    return n
  })
  // the very same list, in the same order: the earlier array itself, so a memo on it holds too
  return kept === next.length && next.length === prev.length && out.every((o, i) => o === prev[i]) ? (prev as T[]) : out
}
