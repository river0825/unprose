// "Agent wants to show you …": a canvas_focus request from the agent (or another viewer). Go fits the view
// to those items; Follow agent (remembered per viewer) makes it jump without asking.
import { useEffect } from 'react'
import type { Board } from '../../../src/model'
import type { FocusRequest } from '../store'
import './goto.css'

const FOLLOW_KEY = 'awd.followAgent'
export const readFollow = (): boolean => {
  try {
    return localStorage.getItem(FOLLOW_KEY) === '1'
  } catch {
    return false
  }
}
export const writeFollow = (on: boolean) => {
  try {
    localStorage.setItem(FOLLOW_KEY, on ? '1' : '0')
  } catch {
    /* private window: the choice lasts until reload */
  }
}

const nameOf = (board: Board, id: string) => {
  const it = board.items[id]
  const t = it?.text?.split('\n')[0].trim()
  return t ? (t.length > 40 ? `${t.slice(0, 39)}…` : t) : it ? it.type : id
}

export function FocusBanner({ board, request, follow, onFollow, onGo, onDismiss }: {
  board: Board
  request: FocusRequest | null
  follow: boolean
  onFollow: (on: boolean) => void
  onGo: (r: FocusRequest) => void
  onDismiss: () => void
}) {
  // Follow agent: go at once
  useEffect(() => {
    if (request && follow) onGo(request)
  }, [request, follow, onGo])
  if (!request || follow) return null
  const who = request.author === 'agent' ? 'Agent' : 'Someone'
  const names = request.ids.length ? request.ids.slice(0, 3).map((i) => nameOf(board, i)).join(', ') + (request.ids.length > 3 ? ` +${request.ids.length - 3}` : '') : request.frame ?? 'the board'
  return (
    <div className="focus-banner" role="status" aria-live="polite">
      <span className="focus-text">
        <strong>{who} wants to show you:</strong> {names}
        {request.note ? <span className="focus-note"> — {request.note}</span> : null}
      </span>
      <button type="button" className="primary small" onClick={() => onGo(request)}>
        Go
      </button>
      <button type="button" className="ghost small" onClick={onDismiss}>
        Dismiss
      </button>
      <label className="focus-follow">
        <input type="checkbox" checked={follow} onChange={(e) => onFollow(e.target.checked)} /> Follow agent
      </label>
    </div>
  )
}
