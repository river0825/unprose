import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ColorToken } from '../../../src/model'
import { COLORS, COLOR_NAMES } from './Rail'

export interface MenuState {
  itemId: string
  x: number
  y: number
  /** what to focus when the menu closes */
  returnTo: HTMLElement | null
}

interface Props {
  menu: MenuState
  onClose: () => void
  onComment: (id: string) => void
  onAsk: (id: string) => void
  onEdit: (id: string) => void
  onColor: (id: string, c: ColorToken) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  canColor: boolean
  askEnabled: boolean
}

/** Item context menu: a small hairline panel at the pointer, arrow-key navigable. */
export function ContextMenu({ menu, onClose, onComment, onAsk, onEdit, onColor, onDuplicate, onDelete, canColor, askEnabled }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [colorsOpen, setColorsOpen] = useState(false)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })

  // keep the panel on screen
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    })
  }, [menu.x, menu.y, colorsOpen])

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const close = () => {
      onClose()
      menu.returnTo?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]), .swatch') ?? [])]
      const i = items.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        items[(i + 1) % items.length]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        items[(i - 1 + items.length) % items.length]?.focus()
      } else if (e.key === 'ArrowRight' && (document.activeElement as HTMLElement)?.dataset.sub) {
        e.preventDefault()
        setColorsOpen(true)
      } else if (e.key === 'ArrowLeft' && colorsOpen) {
        e.preventDefault()
        setColorsOpen(false)
        ref.current?.querySelector<HTMLElement>('[data-sub]')?.focus()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu, onClose, colorsOpen])

  const act = (fn: () => void) => () => {
    fn()
    onClose()
    menu.returnTo?.focus()
  }

  return (
    <div ref={ref} className="ctx" role="menu" aria-label="Item actions" style={{ left: pos.x, top: pos.y }}>
      <button role="menuitem" onClick={act(() => onEdit(menu.itemId))}>
        Edit text
        <span aria-hidden="true" className="sub-arrow">
          Enter
        </span>
      </button>
      <button role="menuitem" onClick={act(() => onComment(menu.itemId))}>
        Add comment
      </button>
      <button role="menuitem" disabled={!askEnabled} title={askEnabled ? undefined : 'Agent is not watching'} onClick={act(() => onAsk(menu.itemId))}>
        Ask agent
      </button>
      {canColor && (
        <>
          <button role="menuitem" data-sub aria-expanded={colorsOpen} aria-haspopup="true" onClick={() => setColorsOpen((o) => !o)}>
            Change colour
            <span aria-hidden="true" className="sub-arrow">
              ›
            </span>
          </button>
          {colorsOpen && (
            <div className="ctx-colors" role="group" aria-label="Colour">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  aria-label={COLOR_NAMES[c]}
                  title={COLOR_NAMES[c]}
                  style={{ ['--sw' as string]: `var(--c-${c})` }}
                  onClick={act(() => onColor(menu.itemId, c))}
                />
              ))}
            </div>
          )}
        </>
      )}
      <button role="menuitem" onClick={act(() => onDuplicate(menu.itemId))}>
        Duplicate
      </button>
      <button role="menuitem" className="danger" onClick={act(() => onDelete(menu.itemId))}>
        Delete
      </button>
    </div>
  )
}
