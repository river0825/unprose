// Tiny HTTP client for the canvas API — used by the MCP server and the CLI.
import type { Author, Board, Change, DiagramKind, Item, Op, Wake } from './model.js'
import type { CardMove } from './diff.js'

/**
 * The canvas origin from what a person pastes: `http://localhost:4400`, `https://canvas.example.com/`,
 * or a board link `https://canvas.example.com/b/<id>?focus=…` — anything after the origin is dropped
 * (river0825/unprose#5). A path prefix before `/b/` or `/api/` is kept, for canvases behind a proxy path.
 */
export function canvasOrigin(url: string): string {
  const u = new URL(url.trim())
  const cut = u.pathname.search(/\/(b|api|docs)(\/|$)/)
  const prefix = (cut >= 0 ? u.pathname.slice(0, cut) : u.pathname).replace(/\/+$/, '')
  return `${u.origin}${prefix}`
}

/** Can the canvas be reached? `GET /api/boards` within `timeoutMs`; the reason when it cannot. */
export async function probeCanvas(base: string, timeoutMs = 4000): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`${base}/api/boards`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` }
    const body = await res.json().catch(() => undefined)
    if (!body || typeof body !== 'object') return { ok: false, reason: 'the answer is not the canvas API (is this the canvas URL?)' }
    return { ok: true }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } }
    return { ok: false, reason: err.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000}s` : (err.cause?.code ?? err.message) }
  }
}

export class CanvasClient {
  readonly baseUrl: string
  constructor(baseUrl = process.env.AWD_CANVAS_URL ?? 'http://localhost:4400') {
    this.baseUrl = canvasOrigin(baseUrl)
  }

  private async req<T>(method: string, p: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(this.baseUrl + p, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      throw new Error(`canvas server not reachable at ${this.baseUrl} — start it with \`awd-canvas serve\` (${(e as Error).message})`)
    }
    const text = await res.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      // plain text endpoints (outline)
    }
    if (!res.ok) throw new Error((data as { error?: string })?.error ?? `${res.status} ${res.statusText}`)
    return data as T
  }

  /** Boards, optionally only those of one project (a project id, or 'personal'). */
  listBoards(project?: string) {
    const q = project ? `?project=${encodeURIComponent(project)}` : ''
    return this.req<{ boards: Array<Pick<Board, 'id' | 'title' | 'kind' | 'seq' | 'createdAt' | 'updatedAt' | 'meta'> & { items: number; project?: string }> }>('GET', `/api/boards${q}`).then((r) => r.boards)
  }
  createBoard(input: { title: string; kind: DiagramKind; content?: unknown; items?: Item[]; meta?: Record<string, unknown>; author?: Author; project?: string }) {
    return this.req<{ board: Board }>('POST', '/api/boards', input).then((r) => r.board)
  }
  projects() {
    return this.req<{ projects: Array<{ id: string; name: string; personal: boolean; boards: number; root?: string | null }> }>('GET', '/api/projects').then((r) => r.projects)
  }
  /** Register the project at `root` on this canvas (only accepted from the canvas's own machine). */
  registerProject(root: string) {
    return this.req<{ project: { id: string; name: string; root?: string | null } }>('POST', '/api/projects', { root }).then((r) => r.project)
  }
  /** Move a board (snapshot + log) into a project: a project id or, from this machine, `{ projectRoot }`. */
  moveBoard(id: string, to: { project?: string; projectRoot?: string }) {
    return this.req<{ board: string; project: string }>('POST', `/api/boards/${encodeURIComponent(id)}/move`, to)
  }
  getBoard(id: string) {
    return this.req<{ board: Board }>('GET', `/api/boards/${encodeURIComponent(id)}`).then((r) => r.board)
  }
  outline(id: string) {
    return this.req<string>('GET', `/api/boards/${encodeURIComponent(id)}/outline`)
  }
  apply(id: string, ops: Op[], author: Author = 'agent', note?: string) {
    return this.req<{ seq: number; change: Change }>('POST', `/api/boards/${encodeURIComponent(id)}/ops`, { author, ops, note })
  }
  template(id: string, kind: DiagramKind | undefined, content: unknown, at?: { x: number; y: number }, scope?: string) {
    return this.req<{ items: Item[]; ops: Op[] }>('POST', `/api/boards/${encodeURIComponent(id)}/template`, { kind, content, at, scope })
  }
  diff(id: string, since: number, author?: Author) {
    const q = new URLSearchParams({ since: String(since) })
    if (author) q.set('author', author)
    return this.req<{ since: number; seq: number; lines: string[]; count: number }>('GET', `/api/boards/${encodeURIComponent(id)}/diff?${q}`)
  }
  wait(id: string, since: number, timeoutMs: number, author?: Author, quietMs?: number, wake?: Wake) {
    const q = new URLSearchParams({ since: String(since), timeout: String(timeoutMs) })
    if (author) q.set('author', author)
    if (quietMs !== undefined) q.set('quiet', String(quietMs))
    if (wake) q.set('wake', wake)
    return this.req<{ since: number; seq: number; timedOut: boolean; changes: Change[]; lines: string[] }>('GET', `/api/boards/${encodeURIComponent(id)}/wait?${q}`)
  }
  /** Kanban: column moves since `since` (structured; see cardMoves). */
  cardMoves(id: string, since: number) {
    return this.req<{ moves: CardMove[]; seq: number }>('GET', `/api/boards/${encodeURIComponent(id)}/cards?since=${since}`)
  }
  addCard(id: string, card: { title: string; column: string; labels?: string[]; size?: string; assignee?: string; description?: string; id?: string; author?: Author; note?: string }) {
    return this.req<{ card: Item; seq: number }>('POST', `/api/boards/${encodeURIComponent(id)}/cards`, card)
  }
  moveCard(id: string, cardId: string, column: string, author: Author = 'agent', note?: string) {
    return this.req<{ card: Item; from: string; to: string; seq: number }>('POST', `/api/boards/${encodeURIComponent(id)}/cards/${encodeURIComponent(cardId)}/move`, { column, author, note })
  }
  /** "Look here": ask the board's open pages to bring these items / this diagram frame into view. */
  focus(id: string, target: { ids?: string[]; frame?: string; note?: string }, author: Author = 'agent') {
    return this.req<{ ok: true; viewers: number; focus: { ids: string[]; frame?: string; note?: string } }>('POST', `/api/boards/${encodeURIComponent(id)}/focus`, { ...target, author })
  }
  /** Board URL; `frame` / `focus` make the page open on that diagram frame / item. */
  boardUrl(id: string, at: { frame?: string; focus?: string } = {}) {
    const q = new URLSearchParams()
    if (at.frame) q.set('frame', at.frame)
    if (at.focus) q.set('focus', at.focus)
    const qs = q.toString()
    return `${this.baseUrl}/b/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`
  }
}
