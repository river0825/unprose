// "Clickable" (docs/diagrams.md §6c): this viewer's switch that outlines every UI mock element a click leads from,
// with a small tag naming the screen it goes to — so a developer sees the navigation at a glance and the file says it
// once (`goto`, `flows`) instead of a note per button. Purely a way of looking: nothing is stored on the board, the
// choice is remembered in this browser. The state lives here (not in BoardPage), like Play's (flow/uiPlay.ts), so the
// frame header, the side panel and the board's keys can all reach it. Also Play's hotspot hint: a click on something
// that leads nowhere flashes, for a moment, what on the screen does.
import { useSyncExternalStore } from 'react'
import type { ClickTag } from '../diagrams/uiClickable'
import type { ItemNode } from './boardToFlow'

const KEY = 'awd.canvas.clickable'

function read(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { on?: unknown } | null
    return v?.on === true
  } catch {
    return false
  }
}

let on: boolean | undefined
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const clickable = {
  /** off until this viewer turns it on */
  get: (): boolean => (on ??= read()),
  subscribe,
  set(next: boolean) {
    if (next === clickable.get()) return
    on = next
    try {
      localStorage.setItem(KEY, JSON.stringify({ on: next }))
    } catch {
      // a per-viewer preference only; losing it is harmless
    }
    listeners.forEach((l) => l())
  },
  /** Shift+G: flip it and say which */
  toggle(): boolean {
    clickable.set(!clickable.get())
    return clickable.get()
  },
}

export function useClickable(): boolean {
  return useSyncExternalStore(clickable.subscribe, clickable.get, clickable.get)
}

// ── Play's hotspot hint: shown for a moment after a click that leads nowhere ──
const HINT_MS = 900
let hinting = false
let hintTimer: ReturnType<typeof setTimeout> | undefined
const hintListeners = new Set<() => void>()

export const clickHint = {
  get: () => hinting,
  subscribe(l: () => void) {
    hintListeners.add(l)
    return () => void hintListeners.delete(l)
  },
  /** a click on the screen on view did nothing: show what would have */
  show() {
    if (hintTimer) clearTimeout(hintTimer)
    hintTimer = setTimeout(() => {
      hinting = false
      hintListeners.forEach((l) => l())
    }, HINT_MS)
    if (hinting) return
    hinting = true
    hintListeners.forEach((l) => l())
  },
}

export function useClickHint(): boolean {
  return useSyncExternalStore(clickHint.subscribe, clickHint.get, clickHint.get)
}

/** What a node is told: the tag's words and the screen's name (both absent while Play's hint flashes it: outline only). */
export interface ClickOn {
  tag?: string
  name?: string
  hint?: true
}

const sameLook = (a: ClickOn, b: ClickOn) => a.tag === b.tag && a.name === b.name && a.hint === b.hint

/**
 * The nodes with what Clickable draws on them (`data.click`, drawn by UiNode as an outline and a tag beside the box —
 * no class on the node, so nothing about its own look or size changes). Only the tagged nodes are new objects, and
 * the same ones as last time while their node and look are (`cache`, keyed by the node before), so a drag or a redraw
 * elsewhere re-renders none of them.
 */
export function applyClickable(nodes: ItemNode[], looks: ReadonlyMap<string, ClickOn>, cache: WeakMap<ItemNode, { look: ClickOn; out: ItemNode }>): ItemNode[] {
  if (!looks.size) return nodes
  return nodes.map((n) => {
    const look = looks.get(n.id)
    if (!look) return n
    const hit = cache.get(n)
    if (hit && sameLook(hit.look, look)) return hit.out
    const out = { ...n, data: { ...n.data, click: look } }
    cache.set(n, { look, out })
    return out
  })
}

const HINT: ClickOn = { hint: true }

/**
 * Which elements get what: with the switch on, every tag (`tags`, the whole board) — except in the frame being played,
 * whose own look wins (`played`: every item of that frame); while Play's hint shows, the tagged elements of the screen
 * on view (`hint`), outline only.
 */
export function clickLooks(tags: ReadonlyMap<string, ClickTag>, opts: { on: boolean; played?: ReadonlyMap<string, string>; hint?: Iterable<string> }): Map<string, ClickOn> {
  const out = new Map<string, ClickOn>()
  if (opts.on)
    for (const [id, t] of tags) {
      if (opts.played?.has(id)) continue
      out.set(id, { tag: t.text, name: t.name })
    }
  for (const id of opts.hint ?? []) out.set(id, HINT)
  return out
}
