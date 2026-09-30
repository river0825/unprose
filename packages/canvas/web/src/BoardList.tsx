import { useEffect, useMemo, useState } from 'react'
import { api, asArray, type BoardSummary, type ProjectSummary } from './api'
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

const PROJECT_KEY = 'awd.boardList.project'
const ALL = '*'

function remembered(): string {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? ALL
  } catch {
    return ALL
  }
}

export function BoardList() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<string>(remembered)

  useEffect(() => {
    document.title = 'Boards — awd canvas'
    api
      .listBoards()
      .then((b) => setBoards(asArray(b, 'boards').sort((a, z) => (z.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))))
      .catch((e: Error) => setError(e.message))
    void api.listProjects().then(setProjects)
  }, [])

  const pick = (id: string) => {
    setProject(id)
    try {
      localStorage.setItem(PROJECT_KEY, id)
    } catch {
      // private mode: the choice just is not remembered
    }
  }

  // Boards grouped by the project that stores them, projects in the server's order, personal last.
  const groups = useMemo(() => {
    if (!boards) return []
    const order = [...projects.filter((p) => !p.personal), ...projects.filter((p) => p.personal)]
    const known = new Set(order.map((p) => p.id))
    const byId = new Map<string, BoardSummary[]>()
    for (const b of boards) {
      const id = b.project ?? 'personal'
      if (!byId.has(id)) byId.set(id, [])
      byId.get(id)!.push(b)
    }
    const out = order.filter((p) => byId.has(p.id)).map((p) => ({ id: p.id, name: p.name, boards: byId.get(p.id)! }))
    for (const [id, list] of byId) if (!known.has(id)) out.push({ id, name: id === 'personal' ? 'Personal' : id, boards: list })
    return out
  }, [boards, projects])
  const shown = project === ALL ? groups : groups.filter((g) => g.id === project)
  const grouped = groups.length > 1 || (groups.length === 1 && groups[0].id !== 'personal')

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
      ) : !grouped ? (
        <ul className="wall">
          {boards.map((b) => (
            <li key={b.id}>
              <BoardCard b={b} />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="project-filter" role="group" aria-label="Show boards of">
            <button type="button" aria-pressed={project === ALL} onClick={() => pick(ALL)}>
              All projects
            </button>
            {groups.map((g) => (
              <button key={g.id} type="button" aria-pressed={project === g.id} onClick={() => pick(g.id)}>
                {g.name} <span className="muted">{g.boards.length}</span>
              </button>
            ))}
          </div>
          {(shown.length ? shown : groups).map((g) => (
            <section key={g.id} className="project-group" aria-labelledby={`project-${g.id}`}>
              <h2 id={`project-${g.id}`} className="project-name">
                {g.name}
                {g.id !== 'personal' && <span className="project-hint">.unprose/boards</span>}
              </h2>
              <ul className="wall">
                {g.boards.map((b) => (
                  <li key={b.id}>
                    <BoardCard b={b} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
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
