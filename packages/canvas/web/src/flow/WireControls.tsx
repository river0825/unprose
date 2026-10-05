// The viewer's way of looking at wires (docs/canvas.md → "Wires"): all / selected / none, catch-all
// listeners as badges or drawn. Purely visual and per viewer (localStorage); nothing is stored on the board.
import { Panel } from '@xyflow/react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { REL_NAMES } from '../diagrams/traces'
import { DEFAULT_TRACE_VIEW, TRACE_MODES, TRACE_RELS, type TraceMode, type TraceView } from './traceView'
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

/**
 * What this viewer sees of the lines, in the bottom-right corner: one quiet button that says the current choice
 * ("Traces: selected · Wires: all") and opens the settings — the trace view (`children`), the wire modes and the
 * catch-all switch. Closed by default, closed again by Escape or a click elsewhere; W and Shift+W still cycle.
 */
export function WireControls({ view, onChange, hasCatchAll, traces, children }: { view: WireView; onChange: (patch: Partial<WireView>) => void; hasCatchAll: boolean; traces?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <Panel position="bottom-right" className="wire-controls" aria-label="Lines shown">
      <div ref={ref} className="view-settings">
        {open && (
          <div className="view-pop" role="group" aria-label="Lines shown">
            {children}
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
            {hasCatchAll && (
              <label className="view-check" title="Catch-all listeners (*.failed, resume:, cron ticks, hubs) are badges on their blocks; tick to draw them as wires">
                <input type="checkbox" checked={view.catchAll} onChange={(e) => onChange({ catchAll: e.target.checked })} />
                Show catch-all wires
              </label>
            )}
          </div>
        )}
        <button type="button" className="view-toggle" aria-expanded={open} title="Which lines are drawn: traces between diagrams and wires (W and Shift+W cycle)" onClick={() => setOpen((v) => !v)}>
          {traces ? `Traces: ${traces} · ` : ''}Wires: {MODE_NAMES[view.mode].toLowerCase()}
        </button>
      </div>
    </Panel>
  )
}

const TRACE_KEY = 'awd.canvas.traces'

function readTraces(): TraceView {
  try {
    const v = JSON.parse(localStorage.getItem(TRACE_KEY) ?? 'null') as Partial<TraceView> | null
    return {
      mode: TRACE_MODES.includes(v?.mode as TraceMode) ? (v!.mode as TraceMode) : DEFAULT_TRACE_VIEW.mode,
      badges: typeof v?.badges === 'boolean' ? v.badges : DEFAULT_TRACE_VIEW.badges,
      rels: { ...DEFAULT_TRACE_VIEW.rels, ...Object.fromEntries(TRACE_RELS.filter((r) => typeof v?.rels?.[r] === 'boolean').map((r) => [r, v!.rels![r]])) },
    }
  } catch {
    return DEFAULT_TRACE_VIEW
  }
}

/** The trace view (flow/traceView.ts), remembered in this browser. */
export function useTraceView(): [TraceView, (patch: Partial<TraceView>) => void] {
  const [view, setView] = useState(readTraces)
  const update = useCallback((patch: Partial<TraceView>) => {
    setView((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(TRACE_KEY, JSON.stringify(next))
      } catch {
        // a per-viewer preference only; losing it is harmless
      }
      return next
    })
  }, [])
  return [view, update]
}

export const TRACE_MODE_NAMES: Record<TraceMode, string> = { all: 'All', faded: 'Faded', bundled: 'Bundled', selected: 'Selected', none: 'None' }
const TRACE_MODE_TIPS: Record<TraceMode, string> = {
  all: 'Draw every trace',
  faded: 'Draw every trace faintly; those of the selected or hovered element in full',
  bundled: 'One line per pair of diagrams with the number of traces — click it to draw them all, again to fold them',
  selected: 'Draw only the traces of the selected or hovered element',
  none: 'Hide all traces (the Inspector still lists them; a trace picked there is drawn)',
}

/** The trace part of the settings: the five modes, then counts on elements and which relations are shown. */
export function TraceControls({ view, onChange }: { view: TraceView; onChange: (patch: Partial<TraceView>) => void }) {
  return (
    <>
      <div className="wire-modes" role="radiogroup" aria-label="Traces shown (Shift+W)">
        <span className="wire-modes-label" aria-hidden="true">
          Traces
        </span>
        {TRACE_MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={view.mode === m} className={view.mode === m ? 'on' : ''} title={`${TRACE_MODE_TIPS[m]} (Shift+W cycles)`} onClick={() => onChange({ mode: m })}>
            {TRACE_MODE_NAMES[m]}
          </button>
        ))}
      </div>
      <div className="trace-options" role="group" aria-label="Trace options">
        <label className="view-check" title="A faint ↗ n beside every element that has traces, so a hidden trace can still be found: select the element to see where it goes">
          <input type="checkbox" checked={view.badges} onChange={(e) => onChange({ badges: e.target.checked })} />
          Counts
        </label>
        {TRACE_RELS.map((r) => (
          <button key={r} type="button" className="trace-rel" aria-pressed={view.rels[r]} title={`${view.rels[r] ? 'Hide' : 'Show'} ${r} (${REL_NAMES[r]}) traces`} onClick={() => onChange({ rels: { ...view.rels, [r]: !view.rels[r] } })}>
            {REL_NAMES[r]}
          </button>
        ))}
      </div>
    </>
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
