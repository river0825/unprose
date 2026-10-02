// The viewer's way of looking at wires (docs/canvas.md → "Wires"): all / selected / none, catch-all
// listeners as badges or drawn. Purely visual and per viewer (localStorage); nothing is stored on the board.
import { Panel } from '@xyflow/react'
import { createContext, useCallback, useContext, useState } from 'react'
import { WIRE_MODES, type WireBadge, type WireMode } from './catchAll'

export interface WireView { mode: WireMode; catchAll: boolean }

const KEY = 'awd.canvas.wires'
const DEFAULT: WireView = { mode: 'all', catchAll: false }

function read(): WireView {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<WireView> | null
    return { mode: WIRE_MODES.includes(v?.mode as WireMode) ? (v!.mode as WireMode) : DEFAULT.mode, catchAll: typeof v?.catchAll === 'boolean' ? v.catchAll : DEFAULT.catchAll }
  } catch {
    return DEFAULT
  }
}

/** The wire view, remembered in this browser; `cycle` steps all → selected → none (the W key). */
export function useWireView(): [WireView, (patch: Partial<WireView>) => void, () => WireMode] {
  const [view, setView] = useState(read)
  const update = useCallback((patch: Partial<WireView>) => {
    setView((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // a per-viewer preference only; losing it is harmless
      }
      return next
    })
  }, [])
  const cycle = useCallback(() => {
    const next = WIRE_MODES[(WIRE_MODES.indexOf(view.mode) + 1) % WIRE_MODES.length]
    update({ mode: next })
    return next
  }, [view.mode, update])
  return [view, update, cycle]
}

export const MODE_NAMES: Record<WireMode, string> = { all: 'All', selected: 'Selected', none: 'None' }
const MODE_TIPS: Record<WireMode, string> = {
  all: 'Draw every wire',
  selected: 'Draw only the wires of the selected blocks',
  none: 'Hide all wires (the Inspector still lists them; a wire picked there is drawn)',
}

/** The small "Wires: all / selected / none" control in the bottom-right corner of the board. */
export function WireControls({ view, onChange, hasCatchAll }: { view: WireView; onChange: (patch: Partial<WireView>) => void; hasCatchAll: boolean }) {
  return (
    <Panel position="bottom-right" className="wire-controls" aria-label="Wires">
      {hasCatchAll && (
        <label className="wire-catchall" title="Catch-all listeners (*.failed, resume:, cron ticks, hubs) are badges on their blocks; tick to draw them as wires">
          <input type="checkbox" checked={view.catchAll} onChange={(e) => onChange({ catchAll: e.target.checked })} />
          Show catch-all wires
        </label>
      )}
      <div className="wire-modes" role="radiogroup" aria-label="Wires shown (W)">
        <span className="wire-modes-label" aria-hidden="true">
          Wires
        </span>
        {WIRE_MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={view.mode === m} className={view.mode === m ? 'on' : ''} title={`${MODE_TIPS[m]} (W cycles)`} onClick={() => onChange({ mode: m })}>
            {MODE_NAMES[m]}
          </button>
        ))}
      </div>
    </Panel>
  )
}

/** Clicking a badge draws its wires again (or folds them back). */
export const WireBadgeContext = createContext<(badge: WireBadge) => void>(() => undefined)

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/** Catch-all badges on a block: listeners above its top edge, emitters below its bottom edge. */
export function WireBadges({ badges }: { badges?: WireBadge[] }) {
  const toggle = useContext(WireBadgeContext)
  if (!badges?.length) return null
  const row = (end: 'in' | 'out') => {
    const list = badges.filter((b) => b.end === end)
    if (!list.length) return null
    return (
      <div className={`wire-badges ${end}`}>
        {list.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`wire-badge nodrag nopan ${b.open ? 'open' : ''}`}
            aria-pressed={b.open}
            title={`${b.title}\n\n${b.open ? 'Click to fold these wires back into the badge' : 'Click to draw these wires'}`}
            onPointerDown={stop}
            onMouseDown={stop}
            onDoubleClick={stop}
            onClick={(e) => {
              e.stopPropagation()
              toggle(b)
            }}
          >
            {b.text}
          </button>
        ))}
      </div>
    )
  }
  return (
    <>
      {row('in')}
      {row('out')}
    </>
  )
}
