// "Hand over files…" (docs/canvas.md "Several agents on one board"): the person picks the diagrams (all of them by
// default) and the agent that takes their files; the holder confirms, the other agent accepts. Nothing changes on
// the board until then. A modal <dialog> (the page behind is inert, focus stays inside, Escape closes).
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Board } from '../../../src/model'
import { displayName, handleOf, sameAgent } from '../../../src/routing'
import { checkedKeys, defaultTarget, heldDiagrams, initialUnchecked, isAgentHere, planSentence, presenceText, startBody, takeable, targetsOf, type AgentLike, type Handover } from '../inspector/handover'

/** POST /api/boards/:id/handover[/ready|/cancel] as the person; an error answer throws its `{ error }`. */
export async function postHandover<T = unknown>(boardId: string, path: '' | '/ready' | '/cancel', body: object): Promise<T> {
  const r = await fetch(`/api/boards/${encodeURIComponent(boardId)}/handover${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (r.status === 401) window.dispatchEvent(new Event('unprose:signin'))
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`)
  return (await r.json()) as T
}

export function HandoverDialog({
  board,
  agents,
  responder,
  only,
  onClose,
}: {
  board: Board
  agents: AgentLike[]
  /** the board's "Answered by" agent, if one is set (the suggested target) */
  responder?: string
  /** a frame's "Hand over…": only this diagram is selected to start with */
  only?: string
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<Element | null>(null)
  const uid = useId()
  const held = useMemo(() => heldDiagrams(board), [board])
  const targets = useMemo(() => targetsOf(held, agents), [held, agents])
  const [to, setTo] = useState<string | undefined>(() => defaultTarget(held, agents, responder))
  const [unchecked, setUnchecked] = useState<Set<string>>(() => initialUnchecked(held, only))
  const [answeredBy, setAnsweredBy] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
    dialog.current?.showModal()
    return () => (opener.current as HTMLElement | null)?.focus?.()
  }, [])

  const keys = checkedKeys(held, to, unchecked)
  const chosen = held.filter((d) => keys.includes(d.key))
  const target = agents.find((a) => to && sameAgent(a.name, to))
  const plan = planSentence(chosen, to, answeredBy)
  const nothing = to && !takeable(held, to).length

  const toggle = (key: string, on: boolean) =>
    setUnchecked((s) => {
      const n = new Set(s)
      if (on) n.delete(key)
      else n.add(key)
      return n
    })

  const start = async () => {
    if (!to || !keys.length) return
    setBusy(true)
    setError(null)
    try {
      await postHandover<{ seq: number; handover: Handover }>(board.id, '', startBody(to, keys, answeredBy))
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="handover-dialog"
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-intro`}
      data-no-board-keys
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <header className="handover-head">
          <h2 id={`${uid}-title`}>Hand over files</h2>
          <p id={`${uid}-intro`} className="muted">
            The agent holding a diagram's files applies proposals and redraws it; the others propose.
          </p>
        </header>
        <fieldset className="handover-diagrams">
          <legend>Diagrams</legend>
          <ul>
            {held.map((d) => {
              const theirs = !!to && sameAgent(d.holder.agent, to)
              const on = !theirs && !unchecked.has(d.key)
              return (
                <li key={d.key} className={theirs ? 'is-theirs' : undefined}>
                  <label>
                    <input type="checkbox" checked={on} disabled={theirs || busy} onChange={(e) => toggle(d.key, e.target.checked)} />
                    <span className="handover-row">
                      <span className="handover-row-head">
                        <span className="handover-title">{d.title}</span>
                        {d.kindName ? <span className="handover-kind muted">{d.kindName}</span> : null}
                      </span>
                      <span className="handover-row-meta muted">
                        {d.source ? <span className="mono">{d.source}</span> : <span>no file</span>}
                        {' · '}
                        {theirs ? 'already held by it' : <>held by {displayName(d.holder.agent)}</>}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>
        <div className="handover-to">
          <label htmlFor={`${uid}-to`}>Hand over to</label>
          <select id={`${uid}-to`} value={to ?? ''} disabled={busy || !targets.length} onChange={(e) => setTo(e.target.value || undefined)} aria-describedby={to && !isAgentHere(target) ? `${uid}-presence` : undefined}>
            {!targets.length ? <option value="">no other agent</option> : null}
            {targets.map((a) => (
              <option key={a.name} value={a.name}>
                {isAgentHere(a) ? '● ' : '○ '}@{a.handle ?? handleOf(a.name)}
                {handleOf(a.name) !== displayName(a.name) ? ` (${displayName(a.name)})` : ''} · {isAgentHere(a) ? 'here' : 'away'}
              </option>
            ))}
          </select>
          {to && !isAgentHere(target) ? (
            <span id={`${uid}-presence`} className="presence-dot-text">
              <span className="presence-dot" aria-hidden="true" />
              {presenceText(target)} — the handover waits for it
            </span>
          ) : null}
        </div>
        <label className="handover-answered">
          <input type="checkbox" checked={answeredBy} disabled={busy} onChange={(e) => setAnsweredBy(e.target.checked)} />
          <span>
            Also make it Answered by
            {to && responder && sameAgent(responder, to) ? <span className="muted"> — it already is</span> : null}
          </span>
        </label>
        <p className="handover-plan" aria-live="polite">
          {nothing ? `${displayName(to)} already holds the files of every diagram here.` : plan || 'Pick at least one diagram.'}
        </p>
        {error ? (
          <p className="handover-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="handover-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !to || !keys.length}>
            {busy ? 'Starting…' : 'Start handover'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
