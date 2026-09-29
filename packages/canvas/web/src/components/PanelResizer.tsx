// Drag the panel's left edge (or focus it and press ←/→) to make the panel wider or narrower.
// The width is a per-viewer convenience, so it lives in localStorage.
import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import './panel-resize.css'

const KEY = 'awd.panelWidth'
export const PANEL_MIN = 280
const DEFAULT = 320
const maxWidth = () => Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.7))
const clamp = (w: number) => Math.min(maxWidth(), Math.max(PANEL_MIN, Math.round(w)))

function stored(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return n ? clamp(n) : DEFAULT
  } catch {
    return DEFAULT
  }
}

/** The panel width, remembered per viewer. */
export function usePanelWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(stored)
  const set = useCallback((w: number) => setWidth(clamp(w)), [])
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(width))
    } catch {
      /* private window: the width just is not remembered */
    }
  }, [width])
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return [width, set]
}

export function PanelResizer({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const [dragging, setDragging] = useState(false)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = width
    setDragging(true)
    // The panel is on the right: moving the edge left makes it wider.
    const move = (ev: PointerEvent) => onWidth(startW + (startX - ev.clientX))
    const up = () => {
      setDragging(false)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  return (
    <div
      className={`panel-resize${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-controls="board-panel"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onWidth(DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 20
        if (e.key === 'ArrowLeft') onWidth(width + step)
        else if (e.key === 'ArrowRight') onWidth(width - step)
        else if (e.key === 'Home') onWidth(PANEL_MIN)
        else if (e.key === 'End') onWidth(maxWidth())
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    />
  )
}
