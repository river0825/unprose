// Tiny HTTP client for the canvas API — used by the MCP server and the CLI.
import type { Author, Board, Change, DiagramKind, Item, Op, Wake } from './model.js'
import type { CardMove } from './diff.js'
import type { BoardContext, FileHolder, Responder } from './routing.js'
import type { FeedbackRecord } from './ports/feedbackStore.js'
import { savedToken } from './credentials.js'
import { userAgent } from './version.js'

/** A board's settings (`GET /api/boards/:id/settings`, docs/canvas.md "Several agents on one board"). */
export interface BoardSettings {
  responder: Responder | null
  answeredBy: string
  context: BoardContext | null
  agentTurns: number
  holders: Array<{ key: string; source?: string; holder: FileHolder }>
  /** a responder the person may confirm: one an agent asked for ('asked', by suggestionBy), or the sole file holder ('holder') */
  suggestion?: string
  suggestionBy?: string | null
  suggestionWhy?: 'asked' | 'holder'
  agents: Array<{ name: string; label: string; /** what people @mention it by */ handle?: string; watching: boolean; seen?: string; holder: boolean }>
  you?: string
  seq?: number
}

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

/** Can the canvas be reached? `GET /api/boards` within `timeoutMs`; the reason when it cannot (`auth` when it wants a token). */
export async function probeCanvas(base: string, timeoutMs = 4000, token?: string, component = 'mcp'): Promise<{ ok: true } | { ok: false; reason: string; auth?: boolean }> {
  try {
    const res = await fetch(`${base}/api/boards`, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': userAgent(component), ...(token ? { authorization: `Bearer ${token}` } : {}) } })
    if (res.status === 403) {
      const why = ((await res.json().catch(() => ({}))) as { error?: string }).error
      return { ok: false, reason: why ? `HTTP 403: ${why}` : `HTTP 403 — not the canvas's answer: something in front of it (Cloudflare?) refused the request` }
    }
    if (res.status === 401) {
      const why = ((await res.json().catch(() => ({}))) as { error?: string }).error
      return { ok: false, auth: true, reason: token ? `the token was refused: ${why ?? 'HTTP 401'}` : 'this canvas wants an access token for requests from elsewhere (UNPROSE_TOKEN)' }
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` }
    const body = await res.json().catch(() => undefined)
    if (!body || typeof body !== 'object') return { ok: false, reason: 'the answer is not the canvas API (is this the canvas URL?)' }
    return { ok: true }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } }
    return { ok: false, reason: err.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000}s` : (err.cause?.code ?? err.message) }
  }
}

/** A file behind a board, as `GET /api/boards/:id/files` lists it. */
export interface BoardFileInfo {
  path: string
  sha: string
  truncated: boolean
  from: { workflow: true } | { diagram: string }
  size?: number
  lines?: number
}

export interface CanvasClientOptions {
  /** An access token (docs/canvas.md "Remote agents"); default `UNPROSE_TOKEN`. */
  token?: string
  /** The agent's name for a canvas on this machine (no token): `UNPROSE_AGENT_NAME`. */
  agentName?: string
  /** The address people open (board links); default: the address this client calls. */
  publicUrl?: string
  /** Who is calling, for the User-Agent (`unprose/<version> (<component>)`); default 'client'. */
  component?: string
}

export class CanvasClient {
  readonly baseUrl: string
  /** What board links start with. */
  readonly publicUrl: string
  private token?: string
  private agentName?: string
  private component: string
  /** Said instead of the canvas's 401 while this agent is not connected yet (the pairing code to type). */
  authHint?: string
  /** Called on a 401 (e.g. to start pairing again). */
  onAuthNeeded?: () => void
  constructor(baseUrl = process.env.AWD_CANVAS_URL ?? 'http://localhost:4400', opts: CanvasClientOptions = {}) {
    this.baseUrl = canvasOrigin(baseUrl)
    this.publicUrl = opts.publicUrl ? canvasOrigin(opts.publicUrl) : this.baseUrl
    // one credential for every client of a canvas (credentials.ts): UNPROSE_TOKEN, else the token a pairing code got
    this.token = opts.token ?? (process.env.UNPROSE_TOKEN || savedToken(this.baseUrl) || undefined)
    this.agentName = opts.agentName ?? (process.env.UNPROSE_AGENT_NAME || undefined)
    this.component = opts.component ?? 'client'
  }

  /** Use this token from now on (the device flow hands one over while the MCP server runs). */
  setToken(token: string | undefined) {
    this.token = token
  }
  /** The token this client sends (the MCP server hands it to the design tools and subprocesses). */
  get currentToken(): string | undefined {
    return this.token
  }
  get hasToken() {
    return !!this.token
  }

  /** The headers every call carries: who is calling (User-Agent), and the token or the local agent's name. */
  headers(): Record<string, string> {
    return { 'user-agent': userAgent(this.component), ...(this.token ? { authorization: `Bearer ${this.token}` } : this.agentName ? { 'x-unprose-agent': this.agentName } : {}) }
  }

  private async req<T>(method: string, p: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(this.baseUrl + p, {
        method,
        headers: { ...this.headers(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
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
    if (res.status === 401) {
      const hint = this.authHint
      this.onAuthNeeded?.()
      if (hint) throw new Error(hint)
    }
    if (!res.ok) {
      const msg = (data as { error?: string })?.error
      // a 403 without the canvas's own JSON: a proxy in front of it (Cloudflare) refused the request
      if (res.status === 403 && !msg) throw new Error(`HTTP 403 ${res.statusText} from ${this.baseUrl} — not the canvas's answer: something in front of it (Cloudflare?) refused the request`)
      throw new Error(msg ?? `${res.status} ${res.statusText}`)
    }
    return data as T
  }

  /** Boards, optionally only those of one project (a project id, or 'personal'). */
  listBoards(project?: string) {
    const q = project ? `?project=${encodeURIComponent(project)}` : ''
    return this.req<{ boards: Array<Pick<Board, 'id' | 'title' | 'kind' | 'seq' | 'createdAt' | 'updatedAt' | 'meta'> & { items: number; project?: string }> }>('GET', `/api/boards${q}`).then((r) => r.boards)
  }
  createBoard(input: { title: string; kind: DiagramKind; content?: unknown; items?: Item[]; meta?: Record<string, unknown>; author?: Author; project?: string; answeredBy?: 'me' }) {
    return this.req<{ board: Board }>('POST', '/api/boards', input).then((r) => r.board)
  }
  /**
   * The board titled `title`, else a new one — decided by the canvas in one step, so two agents drawing at once get the
   * same board (docs/canvas.md "Projects": the same project first, then the personal space, then any board you see).
   */
  boardByTitle(input: { title: string; kind: DiagramKind; project?: string; answeredBy?: 'me' }) {
    return this.req<{ board: Board; reused?: boolean; ambiguous?: Array<{ id: string; project: string }> }>('POST', '/api/boards', { ...input, author: 'agent', reuse: 'title' })
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
  template(id: string, kind: DiagramKind | undefined, content: unknown, at?: { x: number; y: number }, scope?: string, frame?: { key: string; title?: string; source?: string; level?: string; at?: { x: number; y: number } }) {
    return this.req<{ items: Item[]; ops: Op[]; unresolvedTraces?: Array<{ item: string; trace: { from: string; rel: string }; reason: string }> }>('POST', `/api/boards/${encodeURIComponent(id)}/template`, { kind, content, at, scope, ...(frame ? { frame } : {}) })
  }
  /** Board-level fields (title, meta — meta is replaced whole; prefer patchBoard, which merges). */
  updateBoard(id: string, patch: { title?: string; meta?: Record<string, unknown> }) {
    return this.req<{ board: Board }>('PUT', `/api/boards/${encodeURIComponent(id)}`, patch).then((r) => r.board)
  }
  /**
   * Merge into the board's meta (PATCH /api/boards/:id): only the keys given change (null removes one);
   * `meta.diagrams` merges per diagram key — so two agents drawing different diagrams never overwrite each other.
   */
  patchBoard(id: string, patch: { title?: string; meta?: Record<string, unknown> }) {
    return this.req<{ board: Board }>('PATCH', `/api/boards/${encodeURIComponent(id)}`, patch).then((r) => r.board)
  }
  changes(id: string, since = 0, author?: Author) {
    const q = new URLSearchParams({ since: String(since) })
    if (author) q.set('author', author)
    return this.req<{ changes: Change[]; seq: number }>('GET', `/api/boards/${encodeURIComponent(id)}/changes?${q}`)
  }
  /** `extra`: frame, from (names), kinds, summary, last, limit, cursor, maxChars (docs/canvas.md "Reading big boards"). */
  diff(id: string, since: number, author?: Author | 'others', extra?: AgentScaleQuery) {
    const q = new URLSearchParams({ since: String(since) })
    if (author) q.set('author', author)
    addQuery(q, extra)
    return this.req<{ since: number; seq: number; lines: string[]; count: number; total?: number; nextCursor?: string; more?: string; summary?: string }>('GET', `/api/boards/${encodeURIComponent(id)}/diff?${q}`)
  }
  /** `listen: 'all'`: everything on the board, not only what is for this agent (docs/canvas.md "Several agents on one board"). */
  wait(id: string, since: number, timeoutMs: number, author?: Author | 'others', quietMs?: number, wake?: Wake, listen?: 'mine' | 'all', extra?: AgentScaleQuery) {
    const q = new URLSearchParams({ since: String(since), timeout: String(timeoutMs) })
    addQuery(q, extra)
    if (author) q.set('author', author)
    if (quietMs !== undefined) q.set('quiet', String(quietMs))
    if (wake) q.set('wake', wake)
    if (listen === 'all') q.set('to', 'all')
    return this.req<{ since: number; seq: number; timedOut: boolean; changes: Change[]; lines: string[]; notForYou?: number; answeredBy?: string; responder?: Responder | null; context?: BoardContext | null }>('GET', `/api/boards/${encodeURIComponent(id)}/wait?${q}`)
  }
  /** Who answers the board, its context note, who holds the files, the agents it knows. */
  settings(id: string) {
    return this.req<BoardSettings>('GET', `/api/boards/${encodeURIComponent(id)}/settings`)
  }
  /** Change board settings (logged): `answeredBy` ('any' | 'studio' | 'me' | a name | null), `context` (markdown | null), `agentTurns`. */
  setSettings(id: string, patch: { answeredBy?: string | null; context?: string | null; agentTurns?: number | null }, author: Author = 'agent') {
    return this.req<BoardSettings>('PUT', `/api/boards/${encodeURIComponent(id)}/settings`, { ...patch, author })
  }
  /** Tell the owner something about Unprose itself (docs/canvas.md "Feedback"). */
  sendFeedback(input: { text: string; board?: string; about?: string[] }) {
    return this.req<{ ok: true; id: string }>('POST', '/api/feedback', input)
  }
  /** What agents said about Unprose — a local agent (or a page allowed to manage agents) only. */
  feedback() {
    return this.req<{ feedback: FeedbackRecord[] }>('GET', '/api/feedback').then((r) => r.feedback)
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
  /** The files behind a board (its snapshot) with their sha-1, or one file with its text (docs/canvas.md "Proposals and saving"). */
  files(id: string) {
    return this.req<{ files: BoardFileInfo[] }>('GET', `/api/boards/${encodeURIComponent(id)}/files`).then((r) => r.files)
  }
  file(id: string, path: string) {
    return this.req<{ file: BoardFileInfo & { text: string } }>('GET', `/api/boards/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`).then((r) => r.file)
  }
  /** Propose an edit to one of those files: checked against the snapshot, posted as a chat request on the board. */
  propose(id: string, input: { file: string; base: string; diff?: string; newText?: string; note: string; about?: string[]; wires?: Array<{ from: string; to: string; event: string; condition?: string; remove?: boolean }> }) {
    return this.req<{ seq: number; comment: string; file: string; diff: string; about: string[]; added: number; removed: number; offsets: number[] }>('POST', `/api/boards/${encodeURIComponent(id)}/proposals`, { ...input, author: 'agent' })
  }
  // ---- Agent-scale reading, seeing the board, the layout check, local approval (docs/canvas.md "Reading big boards") ----
  /** A board read with filters, a format and a size cap (`GET /api/boards/:id/read`). */
  read(id: string, o: AgentScaleQuery & { format?: 'outline' | 'json' | 'summary'; types?: string[]; ids?: string[]; text?: string; fields?: string[] } = {}) {
    const q = new URLSearchParams()
    addQuery(q, o)
    return this.req<{ format: string; text: string; matched: number; nextCursor?: string; more?: string; seq: number }>('GET', `/api/boards/${encodeURIComponent(id)}/read?${q}`)
  }
  /** The layout findings of a board or one frame. */
  layout(id: string, frame?: string, limit?: number) {
    const q = new URLSearchParams()
    addQuery(q, { frame, limit })
    return this.req<{ findings: Array<{ id: string; kind: string; message: string; suggestion: string; others?: string[]; frame?: string }>; checked: number; frame?: string; counts: Record<string, number> }>('GET', `/api/boards/${encodeURIComponent(id)}/layout?${q}`)
  }
  /** A server-side render: PNG bytes when the canvas can rasterize, else the SVG text; `info` says what is in it. */
  async snapshot(id: string, o: { frame?: string; ids?: string[]; scale?: number; maxPx?: number; theme?: 'light' | 'dark'; format?: 'png' | 'svg' } = {}): Promise<{ mime: string; png?: Buffer; svg?: string; info: { width: number; height: number; scale: number; items: number; region: { x: number; y: number; w: number; h: number }; notes: string[] } }> {
    const q = new URLSearchParams()
    addQuery(q, o)
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/boards/${encodeURIComponent(id)}/snapshot?${q}`, { headers: this.headers() })
    } catch (e) {
      throw new Error(`canvas server not reachable at ${this.baseUrl} — start it with \`awd-canvas serve\` (${(e as Error).message})`)
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 401 && this.authHint) throw new Error(this.authHint)
      throw new Error(body.error ?? `${res.status} ${res.statusText}`)
    }
    const mime = (res.headers.get('content-type') ?? '').split(';')[0]
    let info = { width: 0, height: 0, scale: 1, items: 0, region: { x: 0, y: 0, w: 0, h: 0 }, notes: [] as string[] }
    try {
      info = { ...info, ...(JSON.parse(res.headers.get('x-unprose-snapshot') ?? '{}') as Partial<typeof info>) }
    } catch {
      // no info header: an older canvas
    }
    if (mime === 'image/png') return { mime, png: Buffer.from(await res.arrayBuffer()), info }
    return { mime, svg: await res.text(), info }
  }
  /** Approve a pairing code as the local agent (only a canvas on this machine accepts it). */
  approve(code: string, o: { scope?: 'read' | 'write'; name?: string; board?: string } = {}) {
    return this.req<{ status: string; approved?: { name: string; via: string; scope: string; ip?: string }; audit: string; seq?: number }>('POST', '/api/approve', { code, ...o })
  }

  /** Board URL; `frame` / `focus` make the page open on that diagram frame / item. */
  boardUrl(id: string, at: { frame?: string; focus?: string } = {}) {
    const q = new URLSearchParams()
    if (at.frame) q.set('frame', at.frame)
    if (at.focus) q.set('focus', at.focus)
    const qs = q.toString()
    return `${this.publicUrl}/b/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`
  }
}

/** The query parameters of the agent-scale routes (docs/canvas.md "Reading big boards"); lists go comma-separated. */
export interface AgentScaleQuery {
  frame?: string
  /** who: agent names, "person", "studio" */
  from?: string[]
  kinds?: string[]
  summary?: boolean
  last?: number
  limit?: number
  cursor?: string
  maxChars?: number
  [k: string]: string | string[] | number | boolean | undefined
}

function addQuery(q: URLSearchParams, extra: Record<string, string | string[] | number | boolean | undefined> | undefined) {
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === undefined || v === false || (Array.isArray(v) && !v.length) || v === '') continue
    q.set(k, Array.isArray(v) ? v.join(',') : v === true ? '1' : String(v))
  }
}
