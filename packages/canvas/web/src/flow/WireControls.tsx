// The viewer's way of looking at wires (docs/canvas.md → "Wires"): all / selected / none, catch-all
// listeners as badges or drawn. Purely visual and per viewer (localStorage); nothing is stored on the board.
import { Panel } from '@xyflow/react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { REL_NAMES } from '../diagrams/traces'
import { DEFAULT_TRACE_VIEW, TRACE_MODES, TRACE_RELS, type TraceMode, type TraceView } from './traceView'
import { WIRE_MODES, type WireBadge, type WireMode } from './catchAll'
import { DEFAULT_NOTES_MODE, NOTES_MODE_NAMES, NOTES_MODES, type NotesMode } from './notesView'
import { ANNOTATIONS_MODE_NAMES, ANNOTATIONS_MODES, DEFAULT_ANNOTATIONS_MODE, type AnnotationsMode } from './annotationsView'
import { DEFAULT_TODOS_MODE, TODOS_MODE_NAMES, TODOS_MODES, type TodosMode } from './todoView'

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
 * What this viewer sees of the lines and the notes, in the bottom-right corner: one quiet button that says the
 * current choice ("Traces: selected · Lines: all · Comments: badges · Annotations: pins · TODOs: open") and opens
 * the settings — the trace view (`children`), the wire modes, the catch-all switch and the comments, annotations and
 * TODOs modes (`after`). Closed by default, closed again by Escape or a click elsewhere; W, Shift+W, Shift+N, Shift+A
 * and Shift+T still cycle.
 */
export function WireControls({
  view,
  onChange,
  hasCatchAll,
  traces,
  notes,
  children,
  after,
}: {
  view: WireView
  onChange: (patch: Partial<WireView>) => void
  hasCatchAll: boolean
  traces?: string
  /** what is said after the lines, in order: the comments, annotations and TODOs modes the board has, e.g. ['Comments', 'badges'] */
  notes?: Array<[string, string]>
  /** the trace view, above the wire modes */
  children?: ReactNode
  /** the notes modes, below them */
  after?: ReactNode
}) {
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
            <div className="wire-modes" role="radiogroup" aria-label="Lines shown (W)">
              <span className="wire-modes-label" aria-hidden="true">
                Lines
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
            {after}
          </div>
        )}
        <button type="button" className="view-toggle" aria-expanded={open} title={`What is drawn: the lines inside diagrams (W cycles), the traces between them (Shift+W)${notes?.length ? ', the comments (Shift+N), annotations (Shift+A) and TODOs (Shift+T)' : ''}`} onClick={() => setOpen((v) => !v)}>
          {traces ? `Traces: ${traces} · ` : ''}Lines: {MODE_NAMES[view.mode].toLowerCase()}
          {notes?.map(([what, mode]) => ` · ${what}: ${mode}`).join('')}
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

/** A mode remembered in this browser under `key` (as `{ mode }`); `cycle` steps to the next one and says which. */
function useStoredMode<M extends string>(key: string, modes: readonly M[], fallback: M): [M, (mode: M) => void, () => M] {
  const [mode, setMode] = useState<M>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null') as { mode?: unknown } | null
      return modes.includes(v?.mode as M) ? (v!.mode as M) : fallback
    } catch {
      return fallback
    }
  })
  const update = useCallback(
    (next: M) => {
      setMode(next)
      try {
        localStorage.setItem(key, JSON.stringify({ mode: next }))
      } catch {
        // a per-viewer preference only; losing it is harmless
      }
    },
    [key],
  )
  const cycle = useCallback(() => {
    const next = modes[(modes.indexOf(mode) + 1) % modes.length]
    update(next)
    return next
  }, [mode, modes, update])
  return [mode, update, cycle]
}

/** The comments mode (flow/notesView.ts), remembered in this browser; `cycle` steps all → badges → none (Shift+N). */
export const useNotesMode = () => useStoredMode<NotesMode>('awd.canvas.notes', NOTES_MODES, DEFAULT_NOTES_MODE)
/** The annotations mode (flow/annotationsView.ts): all → pins → none (Shift+A). */
export const useAnnotationsMode = () => useStoredMode<AnnotationsMode>('awd.canvas.annotations', ANNOTATIONS_MODES, DEFAULT_ANNOTATIONS_MODE)
/** The TODOs mode (flow/todoView.ts): open → all → none (Shift+T). */
export const useTodosMode = () => useStoredMode<TodosMode>('awd.canvas.todos', TODOS_MODES, DEFAULT_TODOS_MODE)

/** One row of modes in the settings: a label, then a button per mode. */
function Modes<M extends string>({ label, keys, modes, names, tips, mode, onChange }: { label: string; keys: string; modes: readonly M[]; names: Record<M, string>; tips: Record<M, string>; mode: M; onChange: (mode: M) => void }) {
  return (
    <div className="wire-modes" role="radiogroup" aria-label={`${label} shown (${keys})`}>
      <span className="wire-modes-label" aria-hidden="true">
        {label}
      </span>
      {modes.map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} title={`${tips[m]} (${keys} cycles)`} onClick={() => onChange(m)}>
          {names[m]}
        </button>
      ))}
    </div>
  )
}

const NOTES_MODE_TIPS: Record<NotesMode, string> = {
  all: 'Draw every comment as you left it, open or folded; a proposal that was applied folds into a ✓',
  badges: 'Fold every comment into a small marker at what it is about — click one to read it',
  none: 'Draw no comment (the panel’s Chats tab still lists them)',
}

/** The comments part of the settings: threads only, shown when the board has a conversation. */
export function NotesControls({ mode, onChange }: { mode: NotesMode; onChange: (mode: NotesMode) => void }) {
  return <Modes label="Comments" keys="Shift+N" modes={NOTES_MODES} names={NOTES_MODE_NAMES} tips={NOTES_MODE_TIPS} mode={mode} onChange={onChange} />
}

const ANNOTATIONS_MODE_TIPS: Record<AnnotationsMode, string> = {
  all: 'Draw every annotation as a numbered pin on its item and a card with the same number beside it; your drafts dashed',
  pins: 'Draw the pins only — point at one to read it, click it to show its card',
  none: 'Draw no annotation (the item’s panel still lists them)',
}

/** The annotations part of the settings, shown when the board has an annotation. */
export function AnnotationsControls({ mode, onChange }: { mode: AnnotationsMode; onChange: (mode: AnnotationsMode) => void }) {
  return <Modes label="Annotations" keys="Shift+A" modes={ANNOTATIONS_MODES} names={ANNOTATIONS_MODE_NAMES} tips={ANNOTATIONS_MODE_TIPS} mode={mode} onChange={onChange} />
}

const TODOS_MODE_TIPS: Record<TodosMode, string> = {
  open: 'Draw the open TODOs; done ones are only in the panel’s TODO list',
  all: 'Draw every TODO, the done ones muted with their answer',
  none: 'Draw no TODO (the panel’s TODO list still has them)',
}

/** The TODOs part of the settings, shown when the board has a TODO. */
export function TodosControls({ mode, onChange }: { mode: TodosMode; onChange: (mode: TodosMode) => void }) {
  return <Modes label="TODOs" keys="Shift+T" modes={TODOS_MODES} names={TODOS_MODE_NAMES} tips={TODOS_MODE_TIPS} mode={mode} onChange={onChange} />
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
