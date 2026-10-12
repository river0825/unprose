import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ColorToken } from '../../../src/model'
import { COLORS, COLOR_NAMES } from './Rail'

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl '

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
  /** render the item — or the whole selection when the item is part of it — to a PNG on the clipboard */
  onCopyImage: (id: string) => void
  /** how many items "Copy as image" will take (the selection size when the item is in it) */
  copyCount: number
  /** copy the item's link (itemLink: a frame by its key, anything else — a comment, an annotation card — by its id) */
  onCopyLink: (id: string) => void
  canColor: boolean
  askEnabled: boolean
  /** a domain-story frame (or an item in one): replay its story sentence by sentence (docs/diagrams.md §6b) */
  onPlayStory?: () => void
  /** a UI-mock frame (or an element in one): operate its screens — goto buttons, selects, tabs, fields (docs/diagrams.md §6c "Play") */
  onPlayMock?: () => void
  /** the layout lock (docs/diagrams.md "What a redraw keeps"): absent for comments and wires */
  lock?: { locked: boolean; frame: boolean; byFrame: boolean }
  onToggleLock?: (id: string) => void
  /** write an annotation (what the item is for) or a TODO (still to be confirmed) on it: absent for comments and wires */
  onAnnotate?: (id: string) => void
  onTodo?: (id: string) => void
}

/** Item context menu: a small hairline panel at the pointer, arrow-key navigable. */
export function ContextMenu({ menu, onClose, onComment, onAsk, onEdit, onColor, onDuplicate, onDelete, onCopyImage, copyCount, onCopyLink, canColor, askEnabled, onPlayStory, onPlayMock, lock, onToggleLock, onAnnotate, onTodo }: Props) {
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
      {onAnnotate && (
        <button role="menuitem" title="What this item is for: a numbered note beside it (a draft for the holder of the files when it is drawn from one)" onClick={act(() => onAnnotate(menu.itemId))}>
          Annotate…
        </button>
      )}
      {onTodo && (
        <button role="menuitem" title="Something still to be confirmed with someone else — on the board only, it wakes no agent" onClick={act(() => onTodo(menu.itemId))}>
          Add TODO…
        </button>
      )}
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
      {onPlayStory && (
        <button role="menuitem" onClick={act(onPlayStory)}>
          Play story
          <span aria-hidden="true" className="sub-arrow">
            ▶
          </span>
        </button>
      )}
      {onPlayMock && (
        <button role="menuitem" onClick={act(onPlayMock)}>
          Play
          <span aria-hidden="true" className="sub-arrow">
            ▶
          </span>
        </button>
      )}
      {lock && onToggleLock && (
        <button
          role="menuitem"
          title={
            lock.frame
              ? 'Redraws and the kanban layout keep this frame and everything in it where it is (docs/diagrams.md "What a redraw keeps")'
              : lock.byFrame
                ? 'Its frame is locked already: redraws keep it where it is. This also stops it being dragged.'
                : 'Redraws and the kanban layout keep it where it is, and it cannot be dragged until you unlock it'
          }
          onClick={act(() => onToggleLock(menu.itemId))}
        >
          {lock.locked ? (lock.frame ? 'Unlock layout' : 'Unlock position') : lock.frame ? 'Lock layout' : 'Lock position'}
        </button>
      )}
      <button role="menuitem" onClick={act(() => onDuplicate(menu.itemId))}>
        Duplicate
      </button>
      <button role="menuitem" title="A link that opens this board on it (a frame by its key, so it survives redraws)" onClick={act(() => onCopyLink(menu.itemId))}>
        Copy link
      </button>
      <button role="menuitem" onClick={act(() => onCopyImage(menu.itemId))}>
        {copyCount > 1 ? `Copy ${copyCount} items as image` : 'Copy as image'}
        <span aria-hidden="true" className="sub-arrow">
          {MOD}⇧C
        </span>
      </button>
      <button role="menuitem" className="danger" onClick={act(() => onDelete(menu.itemId))}>
        Delete
      </button>
    </div>
  )
}
