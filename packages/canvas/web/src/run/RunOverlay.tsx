// The n8n-style execution view: state badges on the workflow's step cards (and
// on agent cards), plus a drawer with the runs and the live event feed. Nothing
// here writes to the board — it is a projection of the runtime's event log.
import { useStore, useViewport } from '@xyflow/react'
import { useMemo, useState } from 'react'
import type { Board } from '../../../src/model'
import { agentBadges, agentItems, currentStep, relTime, statusUrlOf, stepBadges, stepItems, type RunEvent, type StepBadgeKind } from './model'
import { useRuntime } from './runtime'

const KIND_LABEL: Record<StepBadgeKind, string> = { running: 'running', waiting: 'waiting for a person', done: 'done', failed: 'failed' }
const KIND_GLYPH: Record<StepBadgeKind, string> = { running: '●', waiting: '⧗', done: '✓', failed: '✕' }

export function RunOverlay({ board }: { board: Board | null }) {
  const statusUrl = statusUrlOf(board)
  if (!statusUrl || !board) return null
  return <Overlay board={board} statusUrl={statusUrl} />
}

function Overlay({ board, statusUrl }: { board: Board; statusUrl: string }) {
  const feed = useRuntime(statusUrl)
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<'runs' | 'events'>('runs')
  const [filterKey, setFilterKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunEvent | null>(null)
  const viewport = useViewport()
  // React Flow's measured nodes: absolute positions + sizes, in flow coordinates.
  const nodeLookup = useStore((s) => s.nodeLookup)

  const steps = useMemo(() => stepItems(board), [board])
  const agents = useMemo(() => agentItems(board), [board])
  const badges = useMemo(() => stepBadges(feed.runs, filterKey), [feed.runs, filterKey])
  const agentState = useMemo(() => agentBadges(feed.runs, filterKey), [feed.runs, filterKey])

  const place = (itemId: string) => {
    const n = nodeLookup.get(itemId)
    if (!n) return null
    const p = n.internals.positionAbsolute
    const w = n.measured?.width ?? 160
    return { left: (p.x + w) * viewport.zoom + viewport.x, top: p.y * viewport.zoom + viewport.y }
  }

  const runs = useMemo(() => [...feed.runs].sort((a, b) => (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? '')), [feed.runs])
  const events = useMemo(() => [...feed.events].reverse().filter((e) => !filterKey || e.key === filterKey), [feed.events, filterKey])
  const scale = Math.max(0.6, Math.min(1, viewport.zoom))
  // zoomed far out the cards are tiny: keep only the glyph so neighbours' badges do not collide
  const compact = viewport.zoom < 0.5

  return (
    <>
      <div className="run-badges" aria-hidden="true">
        {[...badges].map(([step, b]) => {
          const it = steps.get(step)
          const pos = it && place(it.id)
          if (!pos) return null
          return (
            <div key={step} className={`run-badge ${b.kind}`} style={{ left: pos.left, top: pos.top, transform: `translate(-100%, -50%) scale(${scale})` }} title={`${step}: ${KIND_LABEL[b.kind]} — ${b.keys.join(', ')}`}>
              <span className="glyph">{KIND_GLYPH[b.kind]}</span>
              {!compact && <span className="text">{KIND_LABEL[b.kind]}</span>}
              {b.count > 1 && <span className="count">×{b.count}</span>}
            </div>
          )
        })}
        {[...agents].map(([id, it]) => {
          const pos = place(it.id)
          if (!pos) return null
          const a = agentState.get(id)
          return (
            <div key={id} className={`run-badge agent ${a?.working ? 'running' : 'idle'}`} style={{ left: pos.left, top: pos.top, transform: `translate(-100%, -50%) scale(${scale})` }} title={a?.label ?? `${id}: idle`}>
              <span className="glyph">{a?.working ? '●' : '○'}</span>
              {!compact && <span className="text">{a?.working ? a.label : 'idle'}</span>}
              {a && a.count > 1 && <span className="count">×{a.count}</span>}
            </div>
          )
        })}
      </div>

      <section className={`run-drawer ${open ? 'open' : ''}`} aria-label="Workflow runs">
        <header className="run-head">
          <span className={`dot ${feed.connected ? 'on' : 'off'}`} aria-hidden="true" />
          <span className="run-title">
            {feed.connected ? `live · ${feed.runs.length} run${feed.runs.length === 1 ? '' : 's'}` : 'runtime offline'}
            {feed.workflow && <span className="mono"> · {feed.workflow}</span>}
            {feed.mode === 'poll' && <span className="mono"> · polling</span>}
          </span>
          {filterKey && (
            <button type="button" className="run-chip" onClick={() => setFilterKey(null)} aria-label={`Stop filtering to ${filterKey}`}>
              {filterKey} ✕
            </button>
          )}
          <span className="spacer" />
          <div className="run-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'runs'} className={tab === 'runs' ? 'on' : ''} onClick={() => { setTab('runs'); setOpen(true) }}>Runs</button>
            <button type="button" role="tab" aria-selected={tab === 'events'} className={tab === 'events' ? 'on' : ''} onClick={() => { setTab('events'); setOpen(true) }}>Events</button>
          </div>
          <button type="button" className="run-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide' : 'Show'}
          </button>
        </header>
        {open && tab === 'runs' && (
          <div className="run-body">
            {runs.length === 0 && <p className="run-empty">No runs yet. Emit an event (or move a card) and the steps light up here.</p>}
            <table className="run-table">
              <thead>
                <tr><th>key</th><th>status</th><th>current step</th><th>agent</th><th>since</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const cur = currentStep(r)
                  return (
                    <tr key={r.key} className={`${r.status} ${filterKey === r.key ? 'selected' : ''}`} onClick={() => setFilterKey(filterKey === r.key ? null : r.key)}>
                      <td className="mono">{r.key}</td>
                      <td><span className={`state ${r.status}`}>{r.status}</span></td>
                      <td className="mono">{cur.step}</td>
                      <td className="mono">{cur.agent ? `@${cur.agent}` : ''}</td>
                      <td className="muted">{relTime(r.lastEventAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {open && tab === 'events' && (
          <div className="run-body run-split">
            <ul className="run-events">
              {events.length === 0 && <li className="run-empty">No events yet.</li>}
              {events.map((e) => (
                <li key={e.id} className={detail?.id === e.id ? 'selected' : ''}>
                  <button type="button" onClick={() => setDetail(detail?.id === e.id ? null : e)}>
                    <span className="mono key">{e.key}</span>
                    <span className="mono type">{e.type}</span>
                    <span className="muted">{relTime(e.ts)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <pre className="run-detail">{detail ? JSON.stringify({ type: detail.type, key: detail.key, ts: detail.ts, data: detail.data, meta: detail.meta }, null, 2) : 'Select an event to see its data.'}</pre>
          </div>
        )}
      </section>
    </>
  )
}
