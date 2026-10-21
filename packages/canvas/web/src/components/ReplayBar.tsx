// The replay controls of a domain story (docs/diagrams.md §6b "Replay"): restart, previous, next, the step
// "3 / 12", the current sentence read out, auto-play with a speed, ghosting what is not told yet, stop.
// Keys: ← / → (and ↑ / ↓, PageUp / PageDown, Space — as Egon.io and presentation clickers do), Home / End,
// P plays / pauses, Esc stops. The view follows the current sentence, gently: it only moves when the
// sentence is out of view or too small to read, and a zoom the person makes is kept (flow/replayCamera.ts).
import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { ReplayModel } from '../diagrams/replay'
import { SPEEDS, replay, type ReplayView } from '../flow/replay'
import { centred, keptZoom, stepView, tellingZoom, type Viewport } from '../flow/replayCamera'
import './replay.css'

const Icon = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
const RESTART = 'M6 5v14M18 6l-8 6 8 6z'
const PREV = 'M15 6l-6 6 6 6'
const NEXT = 'M9 6l6 6-6 6'
const PLAY = 'M8 5.5v13l10.5-6.5z'
const PAUSE = 'M8 5v14M16 5v14'
const STOP = 'M6 6l12 12M18 6L6 18'

export function ReplayBar({ model, view, title }: { model: ReplayModel; view: ReplayView; title: string }) {
  const flow = useReactFlow()
  const n = model.steps.length
  const k = view.step
  const step = model.steps[k - 1]
  const go = (to: number) => replay.update({ step: Math.max(1, Math.min(n, to)) })
  const barRef = useRef<HTMLDivElement>(null)

  // keys, while the replay runs (the board's own keys are off meanwhile)
  const keys = useRef({ k, n, view })
  keys.current = { k, n, view }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.closest?.('[data-no-board-keys], [role="dialog"], [role="menu"]'))) return
      // Space on a focused button presses that button
      if (e.key === ' ' && t?.tagName === 'BUTTON') return
      const { k, n, view } = keys.current
      const step = (to: number) => replay.update({ step: Math.max(1, Math.min(n, to)), playing: false })
      const act: Record<string, () => void> = {
        ArrowRight: () => step(k + 1),
        ArrowDown: () => step(k + 1),
        PageDown: () => step(k + 1),
        ' ': () => step(k + 1),
        ArrowLeft: () => step(k - 1),
        ArrowUp: () => step(k - 1),
        PageUp: () => step(k - 1),
        Home: () => step(1),
        End: () => step(n),
        p: () => replay.update({ playing: !view.playing, ...(k >= n && !view.playing ? { step: 1 } : {}) }),
        Escape: () => replay.stop(),
      }
      const f = act[e.key] ?? act[e.key.toLowerCase()]
      if (!f) return
      e.preventDefault()
      e.stopPropagation()
      f()
    }
    // capture phase: before React Flow, which would nudge a focused node with the arrow keys
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // keyboard focus moves to the controls (Space then presses "Next", Tab reaches the rest)
  const nextRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    nextRef.current?.focus({ preventScroll: true })
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [model.frameId])

  // auto-play: one step per `speed` seconds, stopping at the end
  useEffect(() => {
    if (!view.playing) return
    if (k >= n) {
      replay.update({ playing: false })
      return
    }
    const t = setTimeout(() => replay.update({ step: k + 1 }), view.speed * 1000)
    return () => clearTimeout(t)
  }, [view.playing, view.speed, k, n])

  // the view (flow/replayCamera.ts): the whole story when it can be read whole, else the sentences at a zoom where
  // their text can be read; then the current sentence when it is out of view or too small
  const cam = useRef<{ frame?: string; tell: number; to?: Viewport; until: number }>({ tell: 1, until: 0 })
  useEffect(() => {
    const timer = setTimeout(() => {
      const root = document.querySelector<HTMLElement>('.canvas-wrap .react-flow')
      const r = root?.getBoundingClientRect()
      if (!r) return
      const bar = barRef.current?.getBoundingClientRect()
      const m = 24
      const top = Math.max(0, bar ? bar.bottom - r.top : 0) + m
      const area = { left: m, top, width: Math.max(1, r.width - 2 * m), height: Math.max(1, r.height - top - m) }
      const known = (ids: string[]) => ids.filter((id) => flow.getNode(id))
      const c = cam.current
      const move = (to: Viewport | null, duration: number) => {
        if (!to) return
        c.to = to
        c.until = Date.now() + duration + 80
        void flow.setViewport(to, { duration })
      }
      const ids = known(step?.focus ?? [])
      if (c.frame !== model.frameId) {
        c.frame = model.frameId
        c.to = flow.getViewport()
        c.until = 0
        const story = known([...model.appear].filter(([, at]) => Number.isFinite(at)).map(([id]) => id)).filter((id) => flow.getNode(id)?.type !== 'frame')
        const t = tellingZoom(story.length ? flow.getNodesBounds(story) : undefined, area)
        c.tell = t.zoom
        if (t.whole) move(centred(flow.getNodesBounds(story), area, t.zoom), 400)
        else if (ids.length) move(stepView(flow.getNodesBounds(ids), c.to, area, c.tell), 400)
        return
      }
      if (!ids.length) return
      // still on its way from the last step: judge from where it is going; else a zoom the person made is kept
      const busy = Date.now() < c.until
      if (!busy) c.tell = keptZoom(c.tell, c.to?.zoom, flow.getZoom())
      move(stepView(flow.getNodesBounds(ids), busy && c.to ? c.to : flow.getViewport(), area, c.tell), 500)
    }, 30)
    return () => clearTimeout(timer)
  }, [k, model.frameId])

  const said = step?.sentences.length ? step.sentences : ['(no sentence)']
  return (
    <div ref={barRef} className="replay-bar" role="toolbar" aria-label={`Replay of ${title}`}>
      <div className="replay-row">
        <span className="replay-title" title={title}>
          <span className="replay-kicker">Replay</span> {title}
        </span>
        <span className="replay-count mono" aria-label={`Step ${k} of ${n}`}>
          {k} / {n}
        </span>
        <span className="replay-buttons">
          <button type="button" className="ghost icon" onClick={() => go(1)} disabled={k <= 1} aria-label="Restart" title="Restart (Home)">
            <Icon d={RESTART} />
          </button>
          <button type="button" className="ghost icon" onClick={() => go(k - 1)} disabled={k <= 1} aria-label="Previous sentence" title="Previous sentence (←)">
            <Icon d={PREV} />
          </button>
          <button ref={nextRef} type="button" className="primary icon" onClick={() => go(k + 1)} disabled={k >= n} aria-label="Next sentence" title="Next sentence (→ or Space)">
            <Icon d={NEXT} />
          </button>
          <button
            type="button"
            className="ghost icon"
            aria-pressed={view.playing}
            onClick={() => replay.update({ playing: !view.playing, ...(k >= n && !view.playing ? { step: 1 } : {}) })}
            aria-label={view.playing ? 'Pause auto-play' : 'Auto-play'}
            title={view.playing ? 'Pause (P)' : `Auto-play, ${view.speed} s per sentence (P)`}
          >
            <Icon d={view.playing ? PAUSE : PLAY} fill={!view.playing} />
          </button>
          <select className="replay-speed" aria-label="Seconds per sentence" value={view.speed} onChange={(e) => replay.update({ speed: Number(e.target.value) })}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
          <label className="replay-ghost-toggle" title="Show the sentences still to come faintly instead of hiding them">
            <input type="checkbox" checked={view.ghost} onChange={(e) => replay.update({ ghost: e.target.checked })} />
            Ghost
          </label>
        </span>
        <button type="button" className="ghost icon replay-stop" onClick={() => replay.stop()} aria-label="Stop replay" title="Stop replay (Esc)">
          <Icon d={STOP} />
        </button>
      </div>
      <div className="replay-sentence" aria-live="polite" aria-atomic="true">
        <span className="replay-sr">
          Sentence {k} of {n}:{' '}
        </span>
        {said.map((s, i) => (
          <span key={i} className="replay-line">
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

/** "Play story": start the replay of a domain-story frame — on its header (compact) and in the side panel. */
export function PlayStoryButton({ frameId, compact }: { frameId: string; compact?: boolean }) {
  return (
    <button
      type="button"
      className={compact ? 'ghost replay-play nodrag' : 'primary replay-play-panel'}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        replay.start(frameId)
      }}
      title="Replay the story sentence by sentence (← → to step, Esc to stop)"
    >
      <Icon d={PLAY} fill />
      Play story
    </button>
  )
}
