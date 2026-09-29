import { useEffect, useState } from 'react'
import { api, asArray, type BoardSummary } from './api'
import { navigate } from './BoardPage'
import { timeAgo } from './time'

const KIND_NAMES: Record<string, string> = {
  'event-storming': 'Event storming',
  'user-story-map': 'User story map',
  'user-journey': 'User journey',
  wireframe: 'Wireframe',
  workflow: 'Workflow',
  freeform: 'Freeform',
}

export function BoardList() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Boards — awd canvas'
    api
      .listBoards()
      .then((b) => setBoards(asArray(b, 'boards').sort((a, z) => (z.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))))
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="list-page">
      <div className="list-head">
        <h1>Boards</h1>
        <a className="docs-link" href="/docs">
          Docs
        </a>
      </div>
      <p className="sub">The wall where the agent draws its thinking. Move stickies, add comments, and it sees the change.</p>
      {error ? (
        <div className="empty">Could not reach the canvas server: {error}</div>
      ) : boards === null ? (
        <p className="muted">Loading boards</p>
      ) : boards.length === 0 ? (
        <div className="empty">
          <p style={{ margin: '0 0 8px' }}>No boards yet.</p>
          <p style={{ margin: 0 }}>
            Ask the agent to draw one (it uses the <code>canvas_create_board</code> tool), or create one yourself with{' '}
            <code>POST /api/boards</code>.
          </p>
        </div>
      ) : (
        <ul className="wall">
          {boards.map((b) => (
            <li key={b.id}>
              <BoardCard b={b} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function BoardCard({ b }: { b: BoardSummary }) {
  const [thumbOk, setThumbOk] = useState(true)
  const count = b.itemCount ?? (b as { items?: number }).items
  return (
    <a
      className="board-card"
      href={`/b/${b.id}`}
      onClick={(e) => {
        e.preventDefault()
        navigate(`/b/${b.id}`)
      }}
    >
      <div className="thumb" aria-hidden="true">
        {thumbOk ? (
          <img src={`/api/boards/${encodeURIComponent(b.id)}/thumb.svg`} alt="" loading="lazy" onError={() => setThumbOk(false)} />
        ) : (
          <span className="fallback">{typeof count === 'number' ? `${count} items` : 'No preview'}</span>
        )}
      </div>
      <div className="meta">
        <p className="name">{b.title || b.id}</p>
        <div className="line">
          <span>{KIND_NAMES[b.kind] ?? b.kind}</span>
          <span>{b.updatedAt ? `updated ${timeAgo(b.updatedAt)}` : ''}</span>
        </div>
      </div>
    </a>
  )
}
