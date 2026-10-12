// The markers on an item (docs/canvas.md → "Notes"): an annotation's numbered pin, the person's draft as a dashed ✎,
// a TODO as a small amber square. They come in node data (flow/annotationsView.ts marksByTarget, once per board
// change) and are drawn on the item's top-right corner by the shared Shell — a UI mock element draws them in its own
// corner group, beside its callout pins (UiNode).
import type { NodeProps } from '@xyflow/react'
import { createContext, useContext, useMemo, type ComponentType } from 'react'
import type { ItemNode } from '../boardToFlow'
import type { ItemMarks, Pin, TodoPin } from '../annotationsView'
import { useEdit } from '../EditContext'
import '../../annotations.css'

/** The marks of the node being drawn, and the card whose marker is lit: given by `withMarks`, read by Shell / UiNode. */
export const MarksContext = createContext<{ marks: ItemMarks; lit?: string } | null>(null)
export const useMarks = () => useContext(MarksContext)

/** A node type whose marks (node data) reach its Shell; a node with none gets null, so nothing changes for it. */
export function withMarks(Node: ComponentType<NodeProps<ItemNode>>): ComponentType<NodeProps<ItemNode>> {
  function Marked(props: NodeProps<ItemNode>) {
    const { marks, markLit } = props.data
    const value = useMemo(() => (marks ? { marks, lit: markLit } : null), [marks, markLit])
    return (
      <MarksContext.Provider value={value}>
        <Node {...props} />
      </MarksContext.Provider>
    )
  }
  Marked.displayName = `Marked(${Node.displayName ?? Node.name})`
  return Marked
}

const stopPin = (e: { stopPropagation: () => void }) => e.stopPropagation()
const pinEvents = { onPointerDown: stopPin, onMouseDown: stopPin, onDoubleClick: stopPin }

/**
 * A callout pin: a 16 px graphite circle on paper with its number, in the canvas's own type, not the mock's — a design
 * annotation, never product UI. Pointing at it lights up its card (and the card lights it up, `lit`); a click selects
 * the card and brings it into view. The note is its tooltip, so `Annotations: pins` (cards hidden) still says it.
 * While the mock plays, or inside the card itself (no `elementId`), it is a label only. Annotations: none hides
 * every UI mock pin (CSS).
 */
export function CalloutPin({ n, note, elementId, playing = false, lit = false, className = '' }: { n: number; note?: string; elementId?: string; playing?: boolean; lit?: boolean; className?: string }) {
  const edit = useEdit()
  const cls = `ui-pin ${lit ? 'lit' : ''} ${playing ? 'playing' : ''} ${className}`
  const label = note ? `Note ${n}: ${note}` : `Note ${n}`
  if (playing || !elementId)
    return (
      <span className={cls} role="img" aria-label={label} title={elementId ? note : undefined}>
        {n}
      </span>
    )
  return (
    <button
      type="button"
      className={`${cls} nodrag nopan`}
      aria-label={`${label}. Show the note`}
      title={note}
      onPointerEnter={() => edit.hoverCallout?.(elementId, n, true, 'pin')}
      onPointerLeave={() => edit.hoverCallout?.(elementId, n, false, 'pin')}
      {...pinEvents}
      onClick={(e) => {
        e.stopPropagation()
        edit.showCallout?.(elementId, n)
      }}
    >
      {n}
    </button>
  )
}

/** The pen of a draft: the person's annotation, not in the file yet. */
export const DraftGlyph = () => (
  <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 13l1-3.5 6.5-6.5 2.5 2.5L6.5 12z" />
  </svg>
)

/** An annotation's pin on an item, by its card: numbered, or a dashed ✎ for a draft. Its text is the tooltip. */
export function MarkPin({ pin, lit, playing = false }: { pin: Pin; lit: boolean; playing?: boolean }) {
  const edit = useEdit()
  const what = pin.draft ? 'Draft annotation' : `Annotation ${pin.n}`
  const cls = `ui-pin ${pin.draft ? 'draft' : ''} ${lit ? 'lit' : ''}`
  const face = pin.draft ? <DraftGlyph /> : pin.n
  if (playing)
    return (
      <span className={`${cls} playing`} role="img" aria-label={`${what}: ${pin.text}`}>
        {face}
      </span>
    )
  return (
    <button
      type="button"
      className={`${cls} nodrag nopan`}
      aria-label={`${what}: ${pin.text}. ${pin.draft ? 'Open its thread' : 'Show the card'}`}
      title={pin.draft ? `Draft: ${pin.text}` : pin.text}
      onPointerEnter={() => edit.hoverMark?.(pin.card, true, 'pin')}
      onPointerLeave={() => edit.hoverMark?.(pin.card, false, 'pin')}
      {...pinEvents}
      onClick={(e) => {
        e.stopPropagation()
        edit.showMark?.(pin.card)
      }}
    >
      {face}
    </button>
  )
}

/** A TODO's marker on its item: a small amber square (no number), ticked once it is done; a click shows its card. */
export function TodoMarker({ todo, lit, playing = false }: { todo: TodoPin; lit: boolean; playing?: boolean }) {
  const edit = useEdit()
  const label = `${todo.done ? 'Done' : 'To do'}: ${todo.text}${todo.ask ? ` (ask ${todo.ask})` : ''}`
  const cls = `todo-mark ${todo.done ? 'done' : ''} ${lit ? 'lit' : ''}`
  const face = todo.done ? (
    <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  ) : null
  if (playing)
    return (
      <span className={`${cls} playing`} role="img" aria-label={label}>
        {face}
      </span>
    )
  return (
    <button
      type="button"
      className={`${cls} nodrag nopan`}
      aria-label={`${label}. Show the TODO`}
      title={label}
      onPointerEnter={() => edit.hoverMark?.(todo.card, true, 'pin')}
      onPointerLeave={() => edit.hoverMark?.(todo.card, false, 'pin')}
      {...pinEvents}
      onClick={(e) => {
        e.stopPropagation()
        edit.showMark?.(todo.card)
      }}
    >
      {face}
    </button>
  )
}

/**
 * The markers on one item, right to left from its top-right corner: annotation pins in number order, then drafts,
 * then TODO squares. `numbered: false` leaves the numbered pins out (a UI mock element draws those where they belong).
 */
export function MarkRow({ marks, lit, numbered = true, playing = false, className = 'item-marks' }: { marks: ItemMarks; lit?: string; numbered?: boolean; playing?: boolean; className?: string }) {
  const pins = numbered ? marks.pins : marks.pins.filter((p) => p.n === undefined)
  if (!pins.length && !marks.todos.length) return null
  return (
    <span className={className}>
      {pins.map((p) => (
        <MarkPin key={p.card} pin={p} lit={lit === p.card} playing={playing} />
      ))}
      {marks.todos.map((t) => (
        <TodoMarker key={t.card} todo={t} lit={lit === t.card} playing={playing} />
      ))}
    </span>
  )
}

/** The marks the node being drawn carries, as Shell draws them (nothing for a node without). */
export function ItemMarksRow() {
  const m = useMarks()
  return m ? <MarkRow marks={m.marks} lit={m.lit} /> : null
}
