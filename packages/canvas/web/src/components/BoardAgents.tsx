// Several agents on one board (docs/canvas.md "Several agents on one board"): who answers the board (the header's
// "Answered by"), whether that agent is here ("<name> is away — your comments wait for it"), the board's context
// note at the top of the panel, and the holder of a diagram's files on its frame panel. The settings live in the
// board's meta; changing them is a logged change the canvas makes (PUT /api/boards/:id/settings).
import { useCallback, useEffect, useState } from 'react'
import type { Board } from '../../../src/model'
import { contextOf, displayName, LOCAL_AGENT, responderName, responderOf, sameAgent, type FileHolder } from '../../../src/routing'
import { Linkified } from '../flow/Linkified'
import { timeAgo } from '../time'
import './agents.css'

export interface AgentRow {
  name: string
  label: string
  /** What people @mention it by (absent on older canvases: derive it with handleOf). */
  handle?: string
  watching: boolean
  seen?: string
  holder: boolean
}
export interface BoardSettings {
  answeredBy: string
  suggestion?: string
  suggestionBy?: string | null
  suggestionWhy?: 'asked' | 'holder'
  agents: AgentRow[]
  holders: Array<{ key: string; source?: string; holder: FileHolder }>
  you?: string
}

const cache = new Map<string, { at: number; data: BoardSettings }>()
const listeners = new Set<() => void>()

/** The board's settings as the canvas sees them (agents it knows, suggestion). Re-read when `key` changes. */
export function useBoardSettings(boardId: string, key = ''): BoardSettings | undefined {
  const [data, setData] = useState<BoardSettings | undefined>(cache.get(boardId)?.data)
  useEffect(() => {
    let live = true
    const read = () =>
      fetch(`/api/boards/${encodeURIComponent(boardId)}/settings`)
        .then((r) => (r.ok ? (r.json() as Promise<BoardSettings>) : undefined))
        .then((d) => {
          if (!d || !live) return
          cache.set(boardId, { at: Date.now(), data: d })
          setData(d)
        })
        .catch(() => undefined)
    void read()
    const on = () => setData(cache.get(boardId)?.data)
    listeners.add(on)
    return () => {
      live = false
      listeners.delete(on)
    }
  }, [boardId, key])
  return data
}

/** Change "Answered by" / the context (logged on the board; the change comes back over the websocket). */
export async function saveSettings(boardId: string, patch: { answeredBy?: string | null; context?: string | null }): Promise<void> {
  const r = await fetch(`/api/boards/${encodeURIComponent(boardId)}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...patch, author: 'user' }) })
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`)
  const d = (await r.json()) as BoardSettings
  cache.set(boardId, { at: Date.now(), data: d })
  for (const fn of listeners) fn()
}

/** Re-render every `ms` (the "is away" notice follows the clock). */
function useTick(ms: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => set((n) => n + 1), ms)
    return () => window.clearInterval(t)
  }, [ms])
}

/** An agent that has not waited on the board for this long is away. */
export const AWAY_MS = 60_000

/** Is this agent watching the board now, or did it in the last minute? */
export function isHere(name: string, watching: string[], seen: Record<string, string>, now = Date.now()): boolean {
  if (watching.some((n) => sameAgent(n, name))) return true
  const at = Object.entries(seen).find(([n]) => sameAgent(n, name))?.[1]
  return !!at && now - Date.parse(at) < AWAY_MS
}

/** Header: "Answered by: [codex-b ▾]", a suggestion (the agent holding every diagram's files), and "<name> is away". */
export function ResponderControl({ board, watching, seen, onToast }: { board: Board; watching: string[]; seen: Record<string, string>; onToast: (t: string, kind?: 'error' | 'info') => void }) {
  useTick(15_000)
  const r = responderOf(board.meta)
  const settings = useBoardSettings(board.id, `${JSON.stringify(r ?? null)}|${JSON.stringify(board.meta?.responderSuggestion ?? null)}|${watching.join(',')}`)
  const [busy, setBusy] = useState(false)
  const value = !r ? 'default' : r.mode === 'agent' ? `agent:${r.agent}` : r.mode
  const names = (settings?.agents ?? []).filter((a) => a.name !== LOCAL_AGENT).map((a) => a.name)
  if (r?.mode === 'agent' && r.agent && !names.some((n) => sameAgent(n, r.agent))) names.push(r.agent)
  const set = useCallback(
    async (v: string) => {
      setBusy(true)
      try {
        await saveSettings(board.id, { answeredBy: v === 'default' ? null : v.startsWith('agent:') ? v.slice(6) : v })
      } catch (e) {
        onToast(`Could not change who answers: ${(e as Error).message}`, 'error')
      } finally {
        setBusy(false)
      }
    },
    [board.id, onToast],
  )
  const who = responderName(r)
  const away = who && !isHere(who, watching, seen)
  return (
    <span className="responder" role="group" aria-label="Who answers this board">
      <label className="responder-label">
        <span>Answered by</span>
        <select value={value} disabled={busy} onChange={(e) => void set(e.target.value)} aria-label="Answered by" aria-describedby={away ? 'responder-away' : undefined} title="Who answers the person's comments on this board">
          <option value="default">studio &amp; any agent</option>
          <option value="any">any agent</option>
          <option value="studio">studio (this machine)</option>
          {names.map((n) => {
            const a = settings?.agents.find((x) => sameAgent(x.name, n))
            return (
              <option key={n} value={`agent:${n}`}>
                {n}
                {a?.holder ? ' · holds files' : ''}
                {a?.watching ? ' · here' : ''}
              </option>
            )
          })}
        </select>
      </label>
      {!r && settings?.suggestion ? (
        <span className="responder-suggestion" role="status">
          <span className="muted">
            Suggested: <strong>{displayName(settings.suggestion)}</strong>
          </span>
          <button
            type="button"
            className="ghost small responder-suggest"
            disabled={busy}
            onClick={() => void set(settings.suggestion === 'any' || settings.suggestion === 'studio' ? settings.suggestion : `agent:${settings.suggestion}`)}
            title={
              settings.suggestionWhy === 'asked'
                ? `${settings.suggestionBy ? displayName(settings.suggestionBy) : 'An agent'} suggested it (for example by drawing this board). Agents never set "Answered by" themselves — confirm to let ${displayName(settings.suggestion)} answer your comments here.`
                : `${displayName(settings.suggestion)} drew every diagram on this board from its own files`
            }
          >
            Confirm
          </button>
          {settings.suggestionWhy === 'asked' ? (
            <button type="button" className="ghost small responder-dismiss" disabled={busy} onClick={() => void set('default')} aria-label="Dismiss the suggestion" title="Keep the default (studio and any agent)">
              ×
            </button>
          ) : null}
        </span>
      ) : null}
      {away ? (
        <span id="responder-away" className="away-note" role="status" title={`${displayName(who!)} is not waiting on this board — your comments wait for it`}>
          {displayName(who!)} is away<span className="away-long"> — your comments wait for it</span>
        </span>
      ) : null}
    </span>
  )
}

/** Top of the panel: what the board is about (markdown-ish text, links clickable), editable by the person. */
export function BoardContextPanel({ board, onToast }: { board: Board; onToast?: (t: string, kind?: 'error' | 'info') => void }) {
  const c = contextOf(board.meta)
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`unprose.context.${board.id}`) !== 'closed'
    } catch {
      return true
    }
  })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c?.text ?? '')
  useEffect(() => {
    if (!editing) setDraft(c?.text ?? '')
  }, [c?.text, editing])
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(`unprose.context.${board.id}`, next ? 'open' : 'closed')
    } catch {
      // per viewer only
    }
  }
  const save = async () => {
    try {
      await saveSettings(board.id, { context: draft.trim() || null })
      setEditing(false)
    } catch (e) {
      onToast?.(`Could not save the context: ${(e as Error).message}`, 'error')
    }
  }
  const first = c?.text.split('\n').find((l) => l.trim()) ?? ''
  return (
    <section className={`board-context${open ? ' open' : ''}`} aria-label="Board context">
      <button type="button" className="board-context-head" aria-expanded={open} onClick={toggle}>
        <span className="chat-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="board-context-title">Context</span>
        {!open && <span className="board-context-preview muted">{first || 'none yet'}</span>}
      </button>
      {open &&
        (editing ? (
          <form
            className="board-context-edit"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <label className="visually-hidden" htmlFor={`ctx-${board.id}`}>
              What this board is about
            </label>
            <textarea
              id={`ctx-${board.id}`}
              rows={5}
              value={draft}
              maxLength={4000}
              placeholder="Meeting 2026-10-02: what we decided… — see docs/meetings/2026-10-02.md"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <div className="board-context-actions">
              <span className="muted">Every agent on the board reads this first.</span>
              <button type="button" className="ghost small" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="submit" className="primary small">
                Save
              </button>
            </div>
          </form>
        ) : (
          <div className="board-context-body">
            {c ? (
              <>
                <div className="board-context-text">
                  {c.text.split('\n').map((l, i) => (
                    <p key={i}>{l.trim() ? <Linkified text={l} /> : ' '}</p>
                  ))}
                </div>
                <p className="muted board-context-by">
                  {c.by ? `${displayName(c.by)} · ` : ''}
                  {c.at ? timeAgo(c.at) : ''}
                  {' · '}
                  <button type="button" className="link" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                </p>
              </>
            ) : (
              <p className="muted">
                No context yet: say what this board is about (the meeting, decisions, links to notes) so every agent that picks it up knows.{' '}
                <button type="button" className="link" onClick={() => setEditing(true)}>
                  Add context
                </button>
              </p>
            )}
          </div>
        ))}
    </section>
  )
}

/** Frame panel: "Files: team-notes · held by codex-b · last applied 3 min ago" (machine and path only on this machine). */
export function HolderLine({ holder }: { holder: FileHolder | undefined }) {
  if (!holder) return null
  const when = holder.appliedAt ? `last applied ${timeAgo(holder.appliedAt)}` : holder.at ? `drawn ${timeAgo(holder.at)}` : ''
  const tail = holder.root ? holder.root.split('/').filter(Boolean).slice(-2).join('/') : ''
  const where = holder.machine ? `on ${holder.machine}${tail ? ` (…/${tail})` : ''}` : ''
  const remote = holder.remote?.replace(/^https?:\/\//, '').replace(/^git@([^:]+):/, '$1/').replace(/\.git$/, '')
  return (
    <div className="holder-line" title={[holder.machine && holder.root ? `${holder.machine}:${holder.root}` : '', holder.remote ? `git remote: ${holder.remote}` : ''].filter(Boolean).join('\n') || undefined}>
      <p>
        <span className="muted">Files:</span> <strong>{holder.repo ?? "the agent's copy"}</strong>
        {' · '}held by <strong>{displayName(holder.agent)}</strong>
        {when ? <span className="muted"> · {when}</span> : null}
      </p>
      {remote || where ? <p className="muted mono holder-where">{[remote, where].filter(Boolean).join(' · ')}</p> : null}
    </div>
  )
}
