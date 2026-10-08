// The person's side of a handover of the files (docs/canvas.md "Several agents on one board"), in the board panel:
// a quiet "Hand over files…" under the context note, a "Hand over…" on a diagram frame's panel, and while a
// handover is open its status (who still has to confirm, who accepts, who is here) with "Hand over anyway" and
// "Cancel handover". The agents confirm and accept through MCP; the person never accepts for them.
import { useEffect, useRef, useState } from 'react'
import type { Board } from '../../../src/model'
import { displayName, responderName, responderOf, sameAgent } from '../../../src/routing'
import { timeAgo } from '../time'
import {
  acceptLine,
  canHandOver,
  cancelBody,
  forceBody,
  forceQuestion,
  frameNotice,
  handoverOf,
  heldDiagrams,
  holderNames,
  involvedAgents,
  isAgentHere,
  presenceText,
  statusRows,
  unreadyKeys,
  allReady,
  type Handover,
} from '../inspector/handover'
import { useBoardSettings, useTick } from './BoardAgents'
import { HandoverDialog, postHandover } from './HandoverDialog'

/** Under the context note: "Files held by agent-a · Hand over files…", or the open handover's status. */
export function BoardHandover({ board, onLocate, onToast }: { board: Board; onLocate?: (ids: string[]) => void; onToast?: (text: string) => void }) {
  const tick = useTick(15_000)
  const h = handoverOf(board.meta)
  // who is here follows the clock while a handover waits for someone
  const settings = useBoardSettings(board.id, h ? `${h.id}|${tick}` : '')
  const [dialog, setDialog] = useState(false)
  const held = heldDiagrams(board)
  const agents = settings?.agents ?? []
  useDoneToast(board, h, onToast)
  if (h) return <HandoverStatus board={board} handover={h} agents={agents} onLocate={onLocate} />
  if (!held.length || !canHandOver(held, agents)) return null
  return (
    <section className="board-files" aria-label="Files behind the diagrams">
      <span className="board-files-text">
        <span className="muted">Files held by</span> {holderNames(held)}
      </span>
      <button type="button" className="ghost small" onClick={() => setDialog(true)} title="Let another agent hold these diagrams' files: it applies proposals and redraws, the others propose">
        Hand over files…
      </button>
      {dialog ? <HandoverDialog board={board} agents={agents} responder={responderName(responderOf(board.meta))} onClose={() => setDialog(false)} /> : null}
    </section>
  )
}

/** A toast when the open handover ends: "agent-b now holds the files of 2 diagrams", or that it was cancelled. */
function useDoneToast(board: Board, h: Handover | undefined, onToast?: (text: string) => void) {
  const prev = useRef<{ board: string; h?: Handover }>({ board: board.id, h })
  useEffect(() => {
    const was = prev.current
    prev.current = { board: board.id, h }
    if (was.board !== board.id || !was.h || h || !onToast) return
    const to = was.h.to
    const held = heldDiagrams(board)
    const moved = was.h.keys.flatMap((k) => held.filter((d) => d.key === k.key && sameAgent(d.holder.agent, to)))
    onToast(moved.length ? `${displayName(to)} now holds the files of ${moved.length === 1 ? moved[0].title : `${moved.length} diagrams`}` : 'The handover ended; nothing changed')
  }, [board, h, onToast])
}

/** The open handover: per diagram where it stands, the new holder's accept, who is here, and what the person can do. */
function HandoverStatus({ board, handover: h, agents, onLocate }: { board: Board; handover: Handover; agents: Array<{ name: string; watching: boolean; seen?: string }>; onLocate?: (ids: string[]) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = statusRows(h, board)
  const unready = unreadyKeys(h)
  const agentOf = (n: string) => agents.find((a) => sameAgent(a.name, n))
  const act = async (path: '/ready' | '/cancel', body: object) => {
    setBusy(true)
    setError(null)
    try {
      await postHandover(board.id, path, body)
      setConfirming(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const thread = h.thread && board.items[h.thread] ? h.thread : undefined
  return (
    <section className="board-handover" aria-label="Handover of the files" aria-busy={busy}>
      <div className="board-handover-head">
        <span className="board-handover-title">
          Handing over to <strong>{displayName(h.to)}</strong>
        </span>
        {thread && onLocate ? (
          <button type="button" className="link quiet" data-item-link={thread} onClick={() => onLocate([thread])} title="Show the handover's thread on the board">
            thread
          </button>
        ) : null}
      </div>
      <p className="board-handover-sub muted">
        {[[h.at ? `started ${timeAgo(h.at)}` : 'started', h.by && h.by !== 'user' ? `by ${displayName(h.by)}` : ''].filter(Boolean).join(' '), h.answeredBy ? 'also Answered by' : ''].filter(Boolean).join(' · ')}
      </p>
      <ul className="handover-status">
        {rows.map((r) => (
          <li key={r.key} className={`s-${r.state}`} title={r.detail}>
            <span className="handover-title">{r.title}</span>
            <span className="handover-state">
              {r.state === 'waiting' ? null : <span aria-hidden="true">✓ </span>}
              {r.text}
            </span>
          </li>
        ))}
        <li className={`handover-accept${allReady(h) ? ' now' : ''}`}>{acceptLine(h)}</li>
      </ul>
      <p className="handover-presence">
        {involvedAgents(h).map((n) => (
          <span key={n} className={`presence-dot-text${isAgentHere(agentOf(n)) ? ' here' : ''}`}>
            <span className="presence-dot" aria-hidden="true" />
            {displayName(n)} {presenceText(agentOf(n))}
          </span>
        ))}
      </p>
      {error ? (
        <p className="handover-error" role="alert">
          {error}
        </p>
      ) : null}
      {confirming ? (
        <div className="handover-confirm" role="group" aria-label="Hand over anyway?">
          <p>{forceQuestion(h, board)}</p>
          <div className="handover-buttons">
            <button type="button" className="ghost small" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </button>
            <button type="button" className="primary small" disabled={busy} onClick={() => void act('/ready', forceBody(unready))}>
              Hand over anyway
            </button>
          </div>
        </div>
      ) : (
        <div className="handover-buttons">
          {unready.length ? (
            <button type="button" className="small" disabled={busy} onClick={() => setConfirming(true)} title="The old holder is gone: hand over the files as the board has them, without its confirmation">
              Hand over anyway
            </button>
          ) : null}
          <button type="button" className="ghost small" disabled={busy} onClick={() => void act('/cancel', cancelBody())}>
            Cancel handover
          </button>
        </div>
      )}
    </section>
  )
}

/** A frame's panel, under its holder line: "Hand over…" (just this diagram selected), or where the open handover stands. */
export function FrameHandover({ board, diagramKey }: { board: Board; diagramKey: string }) {
  const h = handoverOf(board.meta)
  const settings = useBoardSettings(board.id)
  const [dialog, setDialog] = useState(false)
  const notice = frameNotice(h, diagramKey)
  if (notice)
    return (
      <p className="holder-handover" role="status">
        {notice}
      </p>
    )
  if (h) return null
  const held = heldDiagrams(board)
  const mine = held.filter((d) => d.key === diagramKey)
  if (!mine.length || !canHandOver(mine, settings?.agents ?? [])) return null
  return (
    <div className="holder-handover">
      <button type="button" className="link quiet" onClick={() => setDialog(true)} title="Let another agent hold this diagram's files">
        Hand over…
      </button>
      {dialog ? <HandoverDialog board={board} agents={settings?.agents ?? []} responder={responderName(responderOf(board.meta))} only={diagramKey} onClose={() => setDialog(false)} /> : null}
    </div>
  )
}
