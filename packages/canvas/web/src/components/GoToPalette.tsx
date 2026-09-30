// "Go to…" (⌘K / Ctrl+K): type a few letters, pick a diagram frame or an item, and the view jumps there.
// Frames are listed first; the ranking is the pure helper in src/diagrams/goto.ts.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Board } from '../../../src/model'
import { gotoTargets, rankTargets, type GotoTarget } from '../../../src/diagrams/goto'
import './goto.css'

export function GoToPalette({ board, open, onGo, onClose }: { board: Board; open: boolean; onGo: (t: GotoTarget) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const returnTo = useRef<Element | null>(null)
  const targets = useMemo(() => (open ? gotoTargets(board) : []), [board, open])
  const shown = useMemo(() => rankTargets(targets, query, 40), [targets, query])

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement
    setQuery('')
    setActive(0)
    requestAnimationFrame(() => input.current?.focus())
    return () => (returnTo.current as HTMLElement | null)?.focus?.()
  }, [open])
  // Esc closes wherever focus is (right after opening it may not have reached the input yet)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null
  const go = (t: GotoTarget | undefined) => {
    if (!t) return
    onClose()
    onGo(t)
  }
  return (
    <div className="goto-backdrop" onMouseDown={onClose}>
      <div className="goto" role="dialog" aria-modal="true" aria-label="Go to a frame or item" onMouseDown={(e) => e.stopPropagation()} data-no-board-keys>
        <input
          ref={input}
          className="goto-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="goto-list"
          aria-activedescendant={shown[active] ? `goto-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Go to a frame or item…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, shown.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              go(shown[active])
            } else if (e.key === 'Tab') {
              e.preventDefault() // keep focus in the palette
            }
          }}
        />
        <ul ref={list} id="goto-list" className="goto-list" role="listbox" aria-label="Frames and items">
          {shown.length === 0 && <li className="goto-empty">Nothing matches “{query}”.</li>}
          {shown.map((t, i) => (
            <li
              key={t.id}
              id={`goto-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={`goto-row k-${t.kind}${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(t)}
            >
              <span className={`goto-badge k-${t.kind}`}>{t.badge}</span>
              <span className="goto-label">{t.label}</span>
              {t.detail && <span className="goto-detail">{t.detail}</span>}
            </li>
          ))}
        </ul>
        <p className="goto-hint">↑ ↓ to choose · Enter to go · Esc to close</p>
      </div>
    </div>
  )
}
