import { useEffect, useRef, useState } from 'react'
import type { ColorToken } from '../../../src/model'
import { VersionButton } from './ReleaseNotes'

export const COLORS: ColorToken[] = [
  'yellow',
  'orange',
  'blue',
  'lilac',
  'green',
  'pink',
  // the book's hotspot colour (Introducing EventStorming p.307); cast until the model lists the token
  'purple' as ColorToken,
  'red',
  'pale-yellow',
  'grey',
  'white',
]

export const COLOR_NAMES: Record<string, string> = {
  yellow: 'Yellow (actor)',
  orange: 'Orange (event)',
  blue: 'Blue (command)',
  lilac: 'Lilac (policy)',
  green: 'Green (read model)',
  pink: 'Pink (external system)',
  purple: 'Purple (hotspot)',
  red: 'Red (value destroyed)',
  'pale-yellow': 'Pale yellow (aggregate)',
  grey: 'Grey',
  white: 'White',
}

export type Tool = 'select' | 'comment'

interface Props {
  color: ColorToken
  setColor: (c: ColorToken) => void
  tool: Tool
  setTool: (t: Tool) => void
  onAdd: (kind: 'sticky' | 'text' | 'frame') => void
  onDelete: () => void
  selectedCount: number
  onFit: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onHelp: () => void
}

/* Icons are inline SVG so they inherit the rail colour; each button also carries a text label. */
const Icon = {
  sticky: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16v10l-6 6H4z" />
      <path d="M14 20v-6h6" />
    </svg>
  ),
  colour: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h7v7H4zM13 5h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </svg>
  ),
  text: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6h14M12 6v13M9 19h6" />
    </svg>
  ),
  frame: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />
    </svg>
  ),
  comment: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" />
    </svg>
  ),
  fit: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h9a6 6 0 0 1 0 12h-3" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9h-9a6 6 0 0 0 0 12h3" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01" />
    </svg>
  ),
}

export function Rail({ color, setColor, tool, setTool, onAdd, onDelete, selectedCount, onFit, onUndo, onRedo, canUndo, canRedo, onHelp }: Props) {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
  const [popOpen, setPopOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const colourBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!popOpen) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || colourBtn.current?.contains(e.target as Node)) return
      setPopOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopOpen(false)
        colourBtn.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [popOpen])

  const deleteLabel = selectedCount > 0 ? `Delete ${selectedCount} item${selectedCount === 1 ? '' : 's'}` : 'Delete selection'

  return (
    <nav className="rail" aria-label="Marker tray">
      <button
        className="rail-btn"
        aria-label="Add sticky (S)"
        data-tip="Add sticky  S"
        onClick={() => onAdd('sticky')}
        style={{ ['--sw' as string]: `var(--c-${color})` }}
      >
        {Icon.sticky}
        <span className="chip" aria-hidden="true" />
      </button>
      <button
        ref={colourBtn}
        className="rail-btn"
        aria-label={`Sticky colour: ${COLOR_NAMES[color]}`}
        aria-expanded={popOpen}
        aria-haspopup="true"
        data-tip="Sticky colour"
        onClick={() => setPopOpen((o) => !o)}
      >
        {Icon.colour}
      </button>
      <button className="rail-btn" aria-label="Add text (T)" data-tip="Add text  T" onClick={() => onAdd('text')}>
        {Icon.text}
      </button>
      <button className="rail-btn" aria-label="Add frame (F)" data-tip="Add frame  F" onClick={() => onAdd('frame')}>
        {Icon.frame}
      </button>
      <button
        className="rail-btn"
        aria-label="Comment on an item (C)"
        aria-pressed={tool === 'comment'}
        data-tip="Comment on an item  C"
        onClick={() => setTool(tool === 'comment' ? 'select' : 'comment')}
      >
        {Icon.comment}
      </button>
      <span className="gap" aria-hidden="true" />
      <button className="rail-btn" aria-label={deleteLabel} data-tip={`${deleteLabel}  ⌫`} disabled={selectedCount === 0} onClick={onDelete}>
        {Icon.trash}
      </button>
      <button className="rail-btn" aria-label="Fit view (1)" data-tip="Fit view  1" onClick={onFit}>
        {Icon.fit}
      </button>
      <span className="gap" aria-hidden="true" />
      <button className="rail-btn" aria-label="Undo" data-tip={`Undo  ${mod} Z`} disabled={!canUndo} onClick={onUndo}>
        {Icon.undo}
      </button>
      <button className="rail-btn" aria-label="Redo" data-tip={`Redo  ${mod} Shift Z`} disabled={!canRedo} onClick={onRedo}>
        {Icon.redo}
      </button>
      <span className="rail-spacer" aria-hidden="true" />
      <button className="rail-btn" aria-label="Keyboard shortcuts (?)" data-tip="Keyboard shortcuts  ?" onClick={onHelp}>
        {Icon.help}
      </button>
      <VersionButton />

      {popOpen && (
        <div ref={popRef} className="swatch-pop" role="group" aria-label="Sticky colour" style={{ ['--pop-top' as string]: '52px' }}>
          {COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              aria-label={COLOR_NAMES[c]}
              title={COLOR_NAMES[c]}
              aria-pressed={c === color}
              style={{ ['--sw' as string]: `var(--c-${c})` }}
              onClick={() => {
                setColor(c)
                setPopOpen(false)
                colourBtn.current?.focus()
              }}
            />
          ))}
        </div>
      )}
    </nav>
  )
}
