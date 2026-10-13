// The Play controls of a UI mock (docs/diagrams.md §6c "Play"): which screen is on view, back, restart, exit.
// The screens themselves take the clicks — a button whose `goto` names a screen moves the view there, a select
// opens, a tab switches, a field takes typing, a checkbox toggles (flow/nodes/UiNode.tsx). Keys: ← back,
// Home restart, Esc exit; none of them while typing into a mocked field. The view follows the screen on view:
// the whole screen, never zoomed in past 100 %.
import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { currentScreen, playBack, playRestart, startScreen, type PlayModel, type PlayState } from '../diagrams/uiPlay'
import { play } from '../flow/uiPlay'
import './replay.css'

const Icon = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
const RESTART = 'M6 5v14M18 6l-8 6 8 6z'
const BACK = 'M15 6l-6 6 6 6'
const PLAY = 'M8 5.5v13l10.5-6.5z'
const STOP = 'M6 6l12 12M18 6L6 18'

export function PlayBar({ model, state, title }: { model: PlayModel; state: PlayState; title: string }) {
  const flow = useReactFlow()
  const screen = currentScreen(model, state)
  const atStart = !state.history.length && state.screen === startScreen(model, state.start)
  const barRef = useRef<HTMLDivElement>(null)

  // keys, while it plays (the board's own keys are off meanwhile; a mocked field keeps its own typing)
  const keys = useRef({ model, state })
  keys.current = { model, state }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.closest?.('[data-no-board-keys], [role="dialog"], [role="menu"]'))) return
      if (e.key === ' ' && t?.tagName === 'BUTTON') return
      const { model, state } = keys.current
      const act: Record<string, () => void> = {
        ArrowLeft: () => play.set(playBack(state)),
        Backspace: () => play.set(playBack(state)),
        Home: () => play.set(playRestart(model, state)),
        Escape: () => play.stop(),
      }
      const f = act[e.key]
      if (!f) return
      e.preventDefault()
      e.stopPropagation()
      f()
    }
    // capture phase: before React Flow, which would nudge a focused node with the arrow keys
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // keyboard focus moves to the controls and returns where it was afterwards
  const exitRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    exitRef.current?.focus({ preventScroll: true })
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [model.frameId])

  // the view: the screen on view, whole and below this bar, each time it changes; never zoomed in past 100 %
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!flow.getNode(state.screen)) return
      const root = document.querySelector<HTMLElement>('.canvas-wrap .react-flow')
      const r = root?.getBoundingClientRect()
      const bar = barRef.current?.getBoundingClientRect()
      if (!r) return
      const nb = flow.getNodesBounds([state.screen])
      // the screen's name sits above the device (ui-mock.css .ui-screen-name)
      const b = { x: nb.x, y: nb.y - 34, width: nb.width, height: nb.height + 34 }
      const m = 24
      const top = (bar ? bar.bottom - r.top : 0) + m
      const availW = r.width - 2 * m
      const availH = r.height - top - m
      const zoom = Math.min(1, availW / Math.max(1, b.width), availH / Math.max(1, b.height))
      const x = m + (availW - b.width * zoom) / 2 - b.x * zoom
      const y = top + Math.max(0, (availH - b.height * zoom) / 2) - b.y * zoom
      void flow.setViewport({ x, y, zoom }, { duration: 400 })
    }, 30)
    return () => clearTimeout(timer)
  }, [state.screen, model.frameId])

  const n = model.screens.length
  const at = Math.max(0, model.screens.findIndex((x) => x.id === state.screen)) + 1
  return (
    <div ref={barRef} className="replay-bar play-bar" role="toolbar" aria-label={`Play of ${title}`}>
      <div className="replay-row">
        <span className="replay-title" title={title}>
          <span className="replay-kicker">Play</span> {title}
        </span>
        <span className="replay-count mono" aria-label={`Screen ${at} of ${n}`}>
          {at} / {n}
        </span>
        <span className="replay-buttons">
          <button type="button" className="ghost icon" onClick={() => play.set(playRestart(model, state))} disabled={atStart && !Object.keys(state.typed).length && !Object.keys(state.picked).length && !Object.keys(state.checked).length && !Object.keys(state.tab).length} aria-label="Restart" title={state.start && state.start !== model.screens[0]?.id ? `Restart on ${model.screens.find((x) => x.id === state.start)?.name ?? 'the screen you started on'} (Home)` : 'Restart on the first screen (Home)'}>
            <Icon d={RESTART} />
          </button>
          <button type="button" className="ghost icon" onClick={() => play.set(playBack(state))} disabled={!state.history.length} aria-label="Back" title="Back to the screen before (←)">
            <Icon d={BACK} />
          </button>
        </span>
        <button ref={exitRef} type="button" className="ghost icon replay-stop" onClick={() => play.stop()} aria-label="Exit play" title="Exit play (Esc)">
          <Icon d={STOP} />
        </button>
      </div>
      <div className="replay-sentence" aria-live="polite" aria-atomic="true">
        <span className="replay-sr">Screen: </span>
        <span className="replay-line">{screen?.name ?? '(no screen)'}</span>
        <span className="play-hint">Click a button that goes somewhere, open a select, switch a tab, type into a field.</span>
      </div>
    </div>
  )
}

/** "Play": start playing a UI-mock frame — on its header (compact) and in the side panel. */
export function PlayMockButton({ frameId, compact }: { frameId: string; compact?: boolean }) {
  return (
    <button
      type="button"
      className={compact ? 'ghost replay-play nodrag' : 'primary replay-play-panel'}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        play.start(frameId)
      }}
      title="Operate the screens: buttons with a goto, selects, tabs, fields (Esc to exit)"
    >
      <Icon d={PLAY} fill />
      Play
    </button>
  )
}
