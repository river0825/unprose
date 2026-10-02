// Replay of a domain story (docs/diagrams.md §6b "Replay"): this viewer's replay state and how it changes
// what the board draws. Purely a way of looking — nothing is stored on the board, other viewers see the
// board as it is. The state lives here (not in BoardPage) so the frame header, the side panel and the
// context menu can all start a replay without being wired through each other.
import { useSyncExternalStore } from 'react'
import type { Edge } from '@xyflow/react'
import type { Board, Item } from '../../../src/model'
import { diagramOf } from '../diagrams/frame'
import { statusesAt, type ReplayModel } from '../diagrams/replay'
import type { ItemNode } from './boardToFlow'

export interface ReplayView {
  frameId: string
  /** 1-based step */
  step: number
  /** show what is not told yet faintly instead of hiding it (Egon.io hides it) */
  ghost: boolean
  /** auto-play */
  playing: boolean
  /** seconds per step while auto-playing */
  speed: number
}

export const SPEEDS = [1.5, 2.5, 4] as const

let view: ReplayView | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let lastGhost = false
let lastSpeed = 2.5

export const replay = {
  get: () => view,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
  start(frameId: string) {
    view = { frameId, step: 1, ghost: lastGhost, playing: false, speed: lastSpeed }
    emit()
  },
  update(patch: Partial<ReplayView>) {
    if (!view) return
    view = { ...view, ...patch }
    lastGhost = view.ghost
    lastSpeed = view.speed
    emit()
  },
  stop() {
    if (!view) return
    view = null
    emit()
  },
}

export function useReplay(): ReplayView | null {
  return useSyncExternalStore(replay.subscribe, replay.get, replay.get)
}

/** The domain-story frame an item is (or is in), for "Play story"; undefined for anything else. */
export function replayFrameOf(board: Board, it: Item | undefined): string | undefined {
  const d = diagramOf(board, it)
  return d?.kind === 'domain-story' && d.frame ? d.frame.id : undefined
}

const CURRENT_STROKE = 3.4

/**
 * The board as the replay shows it at the current step: what is not told yet is hidden (or ghosted), the
 * current sentence is highlighted, and the story's items cannot be dragged while it plays.
 */
export function applyReplay(nodes: ItemNode[], edges: Edge[], model: ReplayModel | undefined, v: ReplayView | null): { nodes: ItemNode[]; edges: Edge[] } {
  if (!model || !v || !model.steps.length) return { nodes, edges }
  const st = statusesAt(model, v.step)
  const cls = (base: string | undefined, add: string) => `${base ?? ''} ${add}`.trim()
  return {
    nodes: nodes.map((n) => {
      const s = st.get(n.id)
      if (!s) return n
      if (s === 'untold') return v.ghost ? { ...n, className: cls(n.className, 'replay-ghost'), draggable: false, selectable: false, connectable: false } : { ...n, hidden: true }
      return { ...n, className: cls(n.className, s === 'current' ? 'replay-current' : 'replay-told'), draggable: false, connectable: false }
    }),
    edges: edges.map((e) => {
      const s = st.get(e.id)
      if (!s) return e
      if (s === 'untold') return v.ghost ? { ...e, className: cls(e.className, 'replay-ghost'), selectable: false, data: { ...e.data, replay: 'ghost' } } : { ...e, hidden: true }
      if (s === 'current') return { ...e, className: cls(e.className, 'replay-current'), style: { ...e.style, strokeWidth: CURRENT_STROKE }, data: { ...e.data, replay: 'current' } }
      return e
    }),
  }
}
