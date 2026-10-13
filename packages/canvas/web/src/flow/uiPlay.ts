// Playing a UI mock (docs/diagrams.md §6c "Play"): this viewer's play state and how it changes what the board
// draws. Purely a way of looking and clicking — nothing is stored on the board, other viewers see the board as
// it is, the file does not change. The state lives here (not in BoardPage) so the frame header, the side
// panel, the context menu and the elements themselves can all reach it without being wired through each other.
import { useSyncExternalStore } from 'react'
import type { Edge } from '@xyflow/react'
import type { Board, Item } from '../../../src/model'
import { diagramOf } from '../diagrams/frame'
import { buildPlay, clickTarget, emptyPlay, playStatuses, type PlayModel, type PlayScreen, type PlayState } from '../diagrams/uiPlay'
import type { ItemNode } from './boardToFlow'

let state: PlayState | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const play = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
  /**
   * start playing a frame — on `screen` (the screen of what was right-clicked), else the page builds the model from the
   * board and settles the first screen (reconcilePlay)
   */
  start(frameId: string, screen?: string) {
    state = emptyPlay(frameId, screen)
    emit()
  },
  /** every move goes through a pure step of diagrams/uiPlay.ts */
  set(next: PlayState | null | undefined) {
    if (!state || next === state) return
    state = next ?? null
    emit()
  },
  step(f: (s: PlayState) => PlayState) {
    if (!state) return
    play.set(f(state))
  },
  stop() {
    if (!state) return
    state = null
    emit()
  },
}

export function usePlay(): PlayState | null {
  return useSyncExternalStore(play.subscribe, play.get, play.get)
}

/** The UI-mock frame an item is (or is in), for "Play"; undefined for anything else. */
export function playFrameOf(board: Board, it: Item | undefined): string | undefined {
  const d = diagramOf(board, it)
  return d?.kind === 'ui-mock' && d.frame ? d.frame.id : undefined
}

/** The screen (item id) of the UI mock an item is, or sits in, or is a note or thread about — where Play starts from it. */
export function playScreenOf(board: Board, it: Item | undefined): string | undefined {
  const frame = playFrameOf(board, it)
  return frame && it ? buildPlay(board, frame).screenOf.get(it.id) : undefined
}

/** Where a click on this element leads (its goto, a flow, the card it is in), outside Play: Option+click, the menu's "Click → …". */
export function clickTargetOf(board: Board, it: Item | undefined): PlayScreen | undefined {
  const frame = playFrameOf(board, it)
  return frame && it ? clickTarget(buildPlay(board, frame), it.id) : undefined
}

/**
 * The board as play shows it: the screen on view is live (`play-current`) and its elements take clicks instead of
 * drags; the other screens, their elements and the navigate arrows are faint and out of reach (`play-other`); nothing
 * in the frame can be dragged, selected or wired while it plays.
 */
export function applyPlay(nodes: ItemNode[], edges: Edge[], model: PlayModel | undefined, s: PlayState | null): { nodes: ItemNode[]; edges: Edge[] } {
  if (!model || !s || !model.screens.length) return { nodes, edges }
  const st = playStatuses(model, s)
  const cls = (base: string | undefined, add: string) => `${base ?? ''} ${add}`.trim()
  return {
    nodes: nodes.map((n) => {
      // the frame stays as it is but does not move while its screens are operated
      if (n.id === model.frameId) return { ...n, draggable: false, connectable: false }
      const status = st.get(n.id)
      if (!status) return n
      const live = status === 'current'
      return {
        ...n,
        className: cls(n.className, live ? 'play-current' : 'play-other'),
        draggable: false,
        selectable: false,
        connectable: false,
        // an open select's options drop over the elements below it
        ...(s.open === n.id ? { zIndex: 1000 } : {}),
        data: { ...n.data, play: { live, ...(live && model.gotoOf.has(n.id) ? { goto: model.gotoOf.get(n.id) } : {}) } },
      }
    }),
    edges: edges.map((e) => (st.get(e.id) ? { ...e, className: cls(e.className, 'play-other'), selectable: false } : e)),
  }
}
