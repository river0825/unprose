// Spreadsheet-style frozen headers for diagram frames: when a frame's column titles scroll above the
// top of the canvas (or its row titles off the left edge) while the frame is still in view, a copy of
// them is pinned to that edge, lined up with the real columns / rows and clipped to the frame.
// Visual only (pointer-events: none); it lives inside the canvas, so it never covers the side panel.
import { useMemo } from 'react'
import { useStore } from '@xyflow/react'
import type { Board } from '../../../src/model'
import { headerGroups, stripsFor } from './headerStrips'
import { isFrozen, useFreezeVersion } from './freeze'
import './frozen-headers.css'

export function FrozenHeaders({ board }: { board: Board }) {
  const [x, y, zoom] = useStore((s) => s.transform)
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  const version = useFreezeVersion()
  const groups = useMemo(() => headerGroups(board).filter((g) => isFrozen(board.id, g.key)), [board, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const strips = groups.flatMap((g) => {
    const s = stripsFor(g, { x, y, zoom }, width, height)
    return s ? [s] : []
  })
  if (!strips.length) return null
  const font = Math.round(Math.min(14, Math.max(10, 13 * zoom)))
  return (
    <div className="frozen-headers" aria-hidden="true" style={{ fontSize: font }}>
      {strips.map((s) => (
        <div key={s.key} className="fh-clip" style={{ left: s.clip.left, top: s.clip.top, width: s.clip.right - s.clip.left, height: s.clip.bottom - s.clip.top }}>
          {s.top && (
            <div className="fh-top" style={{ height: s.top.height }}>
              {s.top.cells.map((c) => (
                <div key={c.id} className="fh-cell fh-col" style={{ left: c.left - s.clip.left, top: c.top, width: c.width, height: c.height }} title={c.text}>
                  {c.text}
                </div>
              ))}
            </div>
          )}
          {s.left && (
            <div className="fh-left" style={{ width: s.left.width, top: 0, height: '100%' }}>
              {s.left.cells.map((c) => (
                <div key={c.id} className="fh-cell fh-row" style={{ top: c.top - s.clip.top, width: c.width, height: c.height }} title={c.text}>
                  <span>{c.text}</span>
                </div>
              ))}
            </div>
          )}
          {s.corner && s.top && s.left && (
            <div className="fh-corner" style={{ width: s.left.width, height: s.top.height }} title={s.corner}>
              {s.corner}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
