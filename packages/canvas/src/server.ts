// HTTP + WebSocket server over a BoardRepository (the port); also serves the web UI build.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { NotFound, type BoardRepository } from './ports/boardRepository.js'
import type { ProcessInfo, ProcessSupervisor } from './ports/processSupervisor.js'
import { createBoardRepository } from './adapters/boards/index.js'
import { hasProjects } from './ports/boardRepository.js'
import { isLocalRequest, moveRoute, ProjectHttpError, projectsRoute, resolveProject } from './projectsApi.js'
import type { Handoff, UpdateService } from './updater.js'
import { redactPaths } from './updatePolicy.js'
import { agentSeenOps, cardMoves, outline, summarize } from './diff.js'
import { contentSchemas, diagramKinds, render, cardHeight, columnsOf, bottomOf, cardId as kanbanCardId, CARD_W, CARD_SIZES, frameOrigin, placeInFrame, resolveTraces, type FrameRequest } from './templates/index.js'
import { DIAGRAM_KEY } from './diagrams/ids.js'
import { findDocsDir, renderDoc, renderIndex, resolveDocAsset } from './docs.js'
import { findRelease, type Release } from './release.js'
import { renderThumb } from './thumb.js'
import { autoPlaceComments } from './place.js'
import { diagramFrameId, isBookkeeping, type Author, type Board, type Change, type DiagramKind, type Op, type Wake, type WsMessage } from './model.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// The web UI: next to the bundled server (`dist/web`, the published plugin — unprose#4), else the workspace build.
const WEB_DIST = [path.join(__dirname, 'web'), path.resolve(__dirname, '../web/dist')].find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? path.resolve(__dirname, '../web/dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
}

export interface ServerOptions {
  port?: number
  dir?: string
  /** Any BoardRepository; default: files under `dir`, or memory when `AWD_CANVAS_STORE=memory`. */
  store?: BoardRepository
  webDist?: string
  /** Directory of markdown docs served at /docs (default: the repo's docs/). */
  docsDir?: string
  /** Where to look for CHANGELOG.md / package.json for GET /api/version (default: walk up from the running code). */
  releaseDir?: string
  /** Projects this server may start `awd studio` for (docs/diagrams.md §8). Absent: no board is studio-capable. */
  studio?: StudioConfig
  /** Upgrading the canvas from the canvas (docs/canvas.md "Updating"). Absent: GET /api/update says it is off. */
  update?: UpdateService
  /** Replaces process.exit after a successful upgrade handoff (tests). */
  exit?: (code: number) => void
}

/** One project the owner allowed studio for, resolved at startup — never taken from a board or a request. */
export interface StudioProject {
  /** Absolute, real path of the project (repo) root; the child runs there. */
  root: string
  /** Short name for logs (`studio-<name>.log`). */
  name: string
}

export interface StudioConfig {
  projects: StudioProject[]
  /** Command template, split on whitespace; `{project}` is the only substitution (`{file}` is accepted as an old spelling of it). */
  command: string
  supervisor: ProcessSupervisor
  /** Where `studio-<name>.log` goes (default: no log file, the in-memory tail only). */
  logDir?: string
}

/** The command for one project: the configured template with `{project}` replaced — nothing else is interpolated. */
export function studioArgv(template: string, project: string): { command: string; args: string[] } {
  const [command, ...args] = template.trim().split(/\s+/).map((t) => t.split('{project}').join(project).split('{file}').join(project))
  if (!command) throw new Error('studio command is empty')
  return { command, args }
}

const realOf = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/**
 * The configured project a board belongs to, or undefined: its `meta.project.root` or
 * `meta.workflow.file` (absolute) must be inside one of them — a board's own paths only select.
 */
export function studioProjectOf(board: Board, projects: StudioProject[]): StudioProject | undefined {
  const claims = [(board.meta?.project as { root?: unknown } | undefined)?.root, (board.meta?.workflow as { file?: unknown } | undefined)?.file]
  for (const c of claims) {
    if (typeof c !== 'string' || !path.isAbsolute(c)) continue
    const want = realOf(c)
    const hit = projects.find((p) => want === p.root || want.startsWith(p.root + path.sep))
    if (hit) return hit
  }
  return undefined
}

/** Session counts studio writes to `<project>/.awd/studio/status.json` (ignored when it names another project). */
function studioSessions(p: StudioProject): { open: number; max: number; queued: number; boards: number } | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(p.root, '.awd', 'studio', 'status.json'), 'utf8')) as Record<string, unknown>
    if (typeof j.project === 'string' && realOf(j.project) !== p.root) return undefined
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    return { open: n(j.open), max: n(j.max), queued: n(j.queued), boards: n(j.boards) }
  } catch {
    return undefined
  }
}

export interface RunningServer {
  server: http.Server
  store: BoardRepository
  port: number
  url: string
  close(): Promise<void>
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function isAuthor(a: unknown): a is Author {
  return a === 'agent' || a === 'user'
}

const WAKES: Wake[] = ['any', 'meaningful', 'handoff']

function assertOps(ops: unknown): Op[] {
  if (!Array.isArray(ops)) throw new HttpError(400, 'ops must be an array')
  for (const op of ops) {
    if (!op || typeof op !== 'object') throw new HttpError(400, 'op must be an object')
    const k = (op as { kind?: string }).kind
    if (k === 'add') {
      const it = (op as { item?: { id?: string; type?: string } }).item
      if (!it || typeof it.id !== 'string' || typeof it.type !== 'string') throw new HttpError(400, 'add op needs item.id and item.type')
    } else if (k === 'update') {
      const o = op as { id?: string; patch?: unknown }
      if (typeof o.id !== 'string' || !o.patch || typeof o.patch !== 'object') throw new HttpError(400, 'update op needs id and patch')
    } else if (k === 'remove') {
      if (typeof (op as { id?: string }).id !== 'string') throw new HttpError(400, 'remove op needs id')
    } else throw new HttpError(400, `unknown op kind ${String(k)}`)
  }
  return ops as Op[]
}

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const store = opts.store ?? createBoardRepository(process.env.AWD_CANVAS_STORE, opts.dir)
  const webDist = opts.webDist ?? WEB_DIST
  // read once per server; the notes do not change while it runs
  let cachedRelease: Release | undefined
  const release = () => (cachedRelease ??= findRelease(opts.releaseDir))

  // "Look here" messages go straight to the board's open pages; they are not board changes (docs/canvas.md).
  type FocusMessage = Extract<WsMessage, { type: 'focus' }>
  const focusListeners = new Map<string, Set<(m: FocusMessage) => void>>()
  const onFocus = (boardId: string, fn: (m: FocusMessage) => void) => {
    let set = focusListeners.get(boardId)
    if (!set) focusListeners.set(boardId, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }
  const emitFocus = (boardId: string, m: FocusMessage) => {
    const set = focusListeners.get(boardId)
    for (const fn of set ?? []) fn(m)
    return set?.size ?? 0
  }

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  /** Run a projects route and answer with its result or its ProjectHttpError. */
  const projectReply = async (res: http.ServerResponse, run: () => Promise<{ status: number; body: unknown }>) => {
    try {
      const r = await run()
      return json(res, r.status, r.body)
    } catch (e) {
      if (e instanceof ProjectHttpError) return json(res, e.status, { error: e.message })
      throw e
    }
  }
  /** A project id (or undefined for "any"), or null after answering with the error. */
  const projectOrError = (res: http.ServerResponse, run: () => string | undefined): string | undefined | null => {
    try {
      return run()
    } catch (e) {
      if (e instanceof ProjectHttpError) {
        json(res, e.status, { error: e.message })
        return null
      }
      throw e
    }
  }

  const readBody = (req: http.IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw.trim()) return resolve({})
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new HttpError(400, 'invalid JSON body'))
        }
      })
      req.on('error', reject)
    })

  /** The agent has now read these changes: record receipts on the user's comments, return the board after. */
  const readByAgent = (id: string, changes: Change[], author: Author | undefined): Board => {
    const ops = author === 'agent' ? [] : agentSeenOps(store.get(id)!, changes)
    if (ops.length) store.apply(id, ops, 'agent', 'seen')
    return store.get(id)!
  }

  const serveStatic = (res: http.ServerResponse, rel: string): boolean => {
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '')
    const file = path.join(webDist, safe)
    if (!file.startsWith(webDist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
    return true
  }

  const fallbackPage = (boards: Board[]) => `<!doctype html><meta charset="utf-8"><title>awd-canvas</title>
<style>body{font:15px/1.5 system-ui;margin:2rem auto;max-width:720px;color:#222}code{background:#eee;padding:0 .3em}</style>
<h1>awd-canvas</h1>
<p>The web UI is not built yet — run <code>npm run build -w @awd/canvas-web</code> (see <code>docs/canvas.md</code>). The API and MCP server work regardless.</p>
<h2>Boards</h2><ul>${boards.map((b) => `<li><a href="/api/boards/${b.id}">${escapeHtml(b.title)}</a> <small>(${b.kind}, seq ${b.seq})</small></li>`).join('') || '<li><em>none yet</em></li>'}</ul>`

  // ---- Updating the canvas itself (docs/canvas.md "Updating") ----
  /** Every open page on every board gets upgrade progress. */
  // sockets opened from this machine; everyone else (a tunnel) gets update messages without local paths
  const localSockets = new WeakSet<WebSocket>()
  const broadcast = (msg: WsMessage) => {
    const full = JSON.stringify(msg)
    const redacted = JSON.stringify(redactPaths(msg))
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(localSockets.has(c) ? full : redacted)
  }
  const handoff = (): Handoff => ({
    port: listeningPort,
    emit: (e) => broadcast(e),
    pause: () =>
      new Promise<void>((resolve) => {
        broadcast({ type: 'update', phase: 'restarting', message: 'restarting on the new version — this page reconnects by itself', at: new Date().toISOString() })
        for (const c of wss.clients) c.close(1012, 'restarting')
        server.close(() => resolve())
        server.closeAllConnections?.()
      }),
    resume: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(listeningPort, () => {
          server.off('error', reject)
          resolve()
        })
      }),
    exit: (code) => {
      opts.studio?.supervisor.stopAll()
      ;(opts.exit ?? process.exit)(code)
    },
  })
  const updateRoute = async (req: http.IncomingMessage, res: http.ServerResponse, method: string, sub: string | undefined, url: URL) => {
    const up = opts.update
    const local = isLocalRequest(req)
    // the canvas has no login: a page reached from elsewhere (a tunnel) must not learn where things live on this machine
    const reply = (r: http.ServerResponse, status: number, body: unknown) => json(r, status, local ? body : redactPaths(body))
    if (!sub && method === 'GET') {
      if (!up) return reply(res, 200, { current: release().version, available: false, install: 'unknown', supported: false, canUpgrade: false, error: 'update checks are not set up on this server', command: '' })
      const c = await up.check(url.searchParams.get('refresh') === '1')
      const canUpgrade = local && c.supported
      const why = !c.supported ? c.reason : !local ? 'upgrading is only possible from a page opened on this machine (http://localhost…)' : undefined
      return reply(res, 200, { ...c, canUpgrade, ...(why ? { reason: why } : {}) })
    }
    if (sub === 'status' && method === 'GET') return reply(res, 200, up ? up.status() : { running: false, log: [] })
    if (!sub && method === 'POST') {
      if (!local) throw new HttpError(403, 'upgrading is only possible from this machine (the canvas has no login)')
      if (!up) throw new HttpError(400, 'update checks are not set up on this server')
      const r = await up.start(handoff())
      return reply(res, r.started ? 202 : 409, r)
    }
    throw new HttpError(405, 'method not allowed')
  }

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'content-type')
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
    if (method === 'OPTIONS') return void res.writeHead(204).end()

    const parts = url.pathname.split('/').filter(Boolean)

    // ---- API ----
    if (parts[0] === 'api') {
      if (parts[1] === 'kinds' && method === 'GET') return json(res, 200, { kinds: diagramKinds })
      // pid: lets the plugin tell a canvas it started (and may restart after an update) from one the person runs
      if (parts[1] === 'version' && method === 'GET') return json(res, 200, { ...release(), pid: process.pid })
      if (parts[1] === 'projects' && !parts[2]) return projectReply(res, () => projectsRoute(store, req, method, () => readBody(req)))
      if (parts[1] === 'update') return updateRoute(req, res, method, parts[2], url)
      if (parts[1] !== 'boards') throw new HttpError(404, 'not found')
      const id = parts[2]
      const sub = parts[3]

      if (!id) {
        if (method === 'GET') {
          const only = projectOrError(res, () => resolveProject(store, req, url.searchParams.get('project') ?? undefined))
          if (only === null) return
          const projectOf = (b: Board) => (hasProjects(store) ? store.projectOf(b.id) : 'personal')
          return json(res, 200, { boards: store.list().filter((b) => !only || projectOf(b) === only).map((b) => ({ ...summary(b), project: projectOf(b) })) })
        }
        if (method === 'POST') {
          const body = (await readBody(req)) as { title?: string; kind?: DiagramKind; meta?: Record<string, unknown>; items?: Board['items'][string][]; author?: Author; content?: unknown; project?: string; projectRoot?: string }
          const project = projectOrError(res, () => resolveProject(store, req, body.project, body.projectRoot))
          if (project === null) return
          if (!body.title || typeof body.title !== 'string') throw new HttpError(400, 'title required')
          if (!body.kind || !diagramKinds.includes(body.kind)) throw new HttpError(400, `kind must be one of ${diagramKinds.join(', ')}`)
          let items = body.items
          if (!items && body.content !== undefined) {
            const parsed = contentSchemas[body.kind].safeParse(body.content)
            if (!parsed.success) throw new HttpError(400, `invalid content: ${parsed.error.message}`)
            items = render(body.kind, parsed.data)
          }
          const board = store.create({ title: body.title, kind: body.kind, meta: body.meta, items, ...(project ? { project } : {}) }, isAuthor(body.author) ? body.author : 'agent')
          return json(res, 201, { board, project: hasProjects(store) ? store.projectOf(board.id) : 'personal' })
        }
        throw new HttpError(405, 'method not allowed')
      }

      const board = store.get(id)
      if (!board) throw new HttpError(404, `board ${id} not found`)

      if (!sub) {
        if (method === 'GET') return json(res, 200, { board })
        if (method === 'PUT' || method === 'PATCH') {
          const body = (await readBody(req)) as { title?: string; meta?: Record<string, unknown> }
          return json(res, 200, { board: store.updateBoard(id, body) })
        }
        if (method === 'DELETE') return json(res, 200, { deleted: store.delete(id) })
        throw new HttpError(405, 'method not allowed')
      }

      if (sub === 'move' && method === 'POST') return projectReply(res, () => moveRoute(store, req, id, () => readBody(req)))

      if (sub === 'ops' && method === 'POST') {
        const body = (await readBody(req)) as { author?: unknown; ops?: unknown; note?: string }
        if (!isAuthor(body.author)) throw new HttpError(400, "author must be 'agent' or 'user'")
        const ops = assertOps(body.ops)
        const change = store.apply(id, ops, body.author, body.note)
        return json(res, 200, { seq: change.seq, change })
      }
      if (sub === 'focus' && method === 'POST') {
        const body = (await readBody(req)) as { ids?: unknown; frame?: unknown; note?: unknown; author?: unknown }
        const author = body.author ?? 'agent'
        if (!isAuthor(author)) throw new HttpError(400, "author must be 'agent' or 'user'")
        if (body.ids !== undefined && !(Array.isArray(body.ids) && body.ids.every((i) => typeof i === 'string'))) throw new HttpError(400, 'ids must be an array of item ids')
        if (body.frame !== undefined && (typeof body.frame !== 'string' || !DIAGRAM_KEY.test(body.frame))) throw new HttpError(400, 'frame must be a diagram key')
        if (body.note !== undefined && typeof body.note !== 'string') throw new HttpError(400, 'note must be a string')
        const board = store.get(id)!
        const ids = [...new Set((body.ids as string[] | undefined) ?? [])]
        const missing = ids.filter((i) => !board.items[i])
        if (missing.length) throw new HttpError(404, `no item ${missing.map((m) => `"${m}"`).join(', ')} on this board`)
        const frame = body.frame as string | undefined
        if (frame) {
          const fid = diagramFrameId(frame)
          if (board.items[fid]) ids.unshift(fid)
          else if (!(board.kind !== 'freeform' && frame === board.kind)) throw new HttpError(404, `no diagram "${frame}" on this board`)
        }
        if (!ids.length && !frame) throw new HttpError(400, 'give ids and/or frame')
        const note = (body.note as string | undefined)?.trim().slice(0, 500) || undefined
        const msg: FocusMessage = { type: 'focus', ids, ...(frame ? { frame } : {}), ...(note ? { note } : {}), author, at: new Date().toISOString() }
        return json(res, 200, { ok: true, viewers: emitFocus(id, msg), focus: msg })
      }
      if (sub === 'changes' && method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0)
        const author = url.searchParams.get('author')
        const changes = store.changes(id, { since, author: isAuthor(author) ? author : undefined })
        return json(res, 200, { changes, seq: store.get(id)!.seq })
      }
      if (sub === 'diff' && method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0)
        const author = url.searchParams.get('author')
        const who = isAuthor(author) ? author : undefined
        const changes = store.changes(id, { since, author: who }).filter((c) => !isBookkeeping(c))
        const lines = summarize(store.get(id)!, changes)
        const cur = readByAgent(id, changes, who)
        return json(res, 200, { since, seq: cur.seq, lines, count: changes.length })
      }
      if (sub === 'wait' && method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? board.seq)
        const timeout = Math.min(Number(url.searchParams.get('timeout') ?? 30000), 120000)
        const author = url.searchParams.get('author')
        const quietRaw = url.searchParams.get('quiet')
        const quietMs = quietRaw === null ? undefined : Math.max(0, Math.min(Number(quietRaw) || 0, 30000))
        const wakeRaw = url.searchParams.get('wake') ?? 'meaningful'
        if (!WAKES.includes(wakeRaw as Wake)) throw new HttpError(400, `wake must be one of ${WAKES.join(', ')}`)
        const wake = wakeRaw as Wake
        const who = isAuthor(author) ? author : undefined
        const changes = await store.waitFor(id, since, timeout, who, { quietMs, wake })
        const lines = summarize(store.get(id)!, changes, { collapseMoves: wake !== 'any' })
        const cur = readByAgent(id, changes, who)
        return json(res, 200, { since, seq: cur.seq, timedOut: changes.length === 0, changes, lines })
      }
      // ---- Kanban: cards as an event source (see docs/canvas.md) ----
      if (sub === 'cards') {
        const cardIdParam = parts[4]
        if (!cardIdParam && method === 'GET') {
          const since = Number(url.searchParams.get('since') ?? 0)
          const changes = store.changes(id, { since })
          return json(res, 200, { moves: cardMoves(board, changes), seq: board.seq })
        }
        if (!cardIdParam && method === 'POST') {
          const body = (await readBody(req)) as { title?: string; column?: string; labels?: string[]; size?: string; assignee?: string; description?: string; id?: string; author?: unknown; note?: string }
          if (!body.title || typeof body.title !== 'string') throw new HttpError(400, 'title required')
          const column = findColumn(board, body.column)
          if (!column) throw new HttpError(400, `column required; one of ${columnsOf(board).map((c) => c.text).join(', ') || '(none — not a kanban board?)'}`)
          if (body.size !== undefined && !CARD_SIZES.includes(body.size as never)) throw new HttpError(400, `size must be one of ${CARD_SIZES.join(', ')}`)
          const h = cardHeight({ title: body.title, labels: body.labels, size: body.size, assignee: body.assignee })
          const spot = bottomOf(board, column, h)
          const data: Record<string, unknown> = {}
          if (body.labels?.length) data.labels = body.labels
          if (body.size) data.size = body.size
          if (body.assignee) data.assignee = body.assignee
          if (body.description) data.description = body.description
          const author: Author = isAuthor(body.author) ? body.author : 'agent'
          const now = new Date().toISOString()
          const newId = body.id ? kanbanCardId('kb', body.id) : kanbanCardId('kb', `${body.title}-${Date.now().toString(36)}`)
          if (board.items[newId]) throw new HttpError(409, `card ${newId} already exists`)
          const item: Board['items'][string] = { id: newId, type: 'card', x: spot.x, y: spot.y, w: CARD_W, h, text: body.title, color: 'white', role: 'card', parent: column.id, order: 1e6, data, createdBy: author, updatedBy: author, updatedAt: now }
          const ops: Op[] = [{ kind: 'add', item }]
          if (spot.laneH > column.h) ops.push({ kind: 'update', id: column.id, patch: { h: spot.laneH } })
          const change = store.apply(id, ops, author, body.note ?? `added card "${body.title}" to ${column.text}`)
          return json(res, 201, { card: store.get(id)!.items[newId], seq: change.seq })
        }
        if (cardIdParam && parts[5] === 'move' && method === 'POST') {
          const card = board.items[cardIdParam]
          if (!card || card.type !== 'card') throw new HttpError(404, `card ${cardIdParam} not found`)
          const body = (await readBody(req)) as { column?: string; author?: unknown; note?: string }
          const column = findColumn(board, body.column)
          if (!column) throw new HttpError(400, `column required; one of ${columnsOf(board).map((c) => c.text).join(', ')}`)
          const author: Author = isAuthor(body.author) ? body.author : 'agent'
          const fromName = board.items[card.parent ?? '']?.text ?? 'nowhere'
          const without: Board = { ...board, items: { ...board.items, [card.id]: { ...card, parent: '__moving__' } } }
          const spot = bottomOf(without, column, card.h)
          const ops: Op[] = [{ kind: 'update', id: card.id, patch: { x: spot.x, y: spot.y, parent: column.id, order: 1e6 } }]
          if (spot.laneH > column.h) ops.push({ kind: 'update', id: column.id, patch: { h: spot.laneH } })
          const change = store.apply(id, ops, author, body.note ?? `moved "${card.text}" ${fromName} → ${column.text}`)
          return json(res, 200, { card: store.get(id)!.items[card.id], from: fromName, to: column.text, seq: change.seq })
        }
        throw new HttpError(404, 'not found')
      }
      if (sub === 'outline' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        return void res.end(outline(board))
      }
      if (sub === 'thumb.svg' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache' })
        return void res.end(renderThumb(board))
      }
      if (sub === 'template' && method === 'POST') {
        const body = (await readBody(req)) as { kind?: DiagramKind; content?: unknown; at?: { x: number; y: number }; scope?: string; frame?: Omit<FrameRequest, 'kind'> }
        const kind = body.kind ?? board.kind
        if (!diagramKinds.includes(kind)) throw new HttpError(400, 'unknown kind')
        // Drawn inside a diagram frame (docs/diagrams.md §1): ids scoped by the frame's key, children of the frame.
        const frame = body.frame
        if (frame && (kind === 'freeform' || typeof frame.key !== 'string' || !DIAGRAM_KEY.test(frame.key))) throw new HttpError(400, 'frame.key must match [a-z0-9-] (1-40 chars), and a frame needs a diagram kind')
        const request: FrameRequest | undefined = frame && kind !== 'freeform' ? { ...frame, kind } : undefined
        const content = kind === 'freeform' ? autoPlaceComments(board, body.content) : body.content
        const parsed = contentSchemas[kind].safeParse(content)
        if (!parsed.success) throw new HttpError(400, `invalid content: ${parsed.error.message}`)
        const now = new Date().toISOString()
        const rendered = render(kind, parsed.data, request ? { at: frameOrigin(board.items, request), scope: request.key, now } : { at: body.at, scope: body.scope, now })
        const drawn = request ? placeInFrame(board.items, request, rendered, now).items : rendered
        // traces whose target is not on the board are reported, not silently dropped (river0825/unprose#6)
        const traces = resolveTraces(drawn, board.items, now)
        const items = [...drawn, ...traces.wires]
        const ops: Op[] = items.map((item) => (board.items[item.id] ? { kind: 'update', id: item.id, patch: item } : { kind: 'add', item }))
        return json(res, 200, { items, ops, unresolvedTraces: traces.unresolved })
      }
      if (sub === 'studio') {
        const studio = opts.studio
        const project = studio && studioProjectOf(board, studio.projects)
        const view = (info: ProcessInfo | undefined) => ({
          capable: true,
          project: project?.name,
          running: Boolean(info?.running),
          pid: info?.pid,
          since: info?.since,
          exitedAt: info?.exitedAt,
          exitCode: info?.exitCode,
          log: info?.log ?? [],
          sessions: info?.running && project ? studioSessions(project) : undefined,
        })
        if (method === 'GET') return json(res, 200, studio && project ? view(studio.supervisor.info(project.root)) : { capable: false, running: false, log: [] })
        if (method === 'POST') {
          if (!studio || !project) throw new HttpError(403, 'studio is not enabled for this project on this server (canvas serve --studio-project <dir>)')
          const body = (await readBody(req)) as { action?: unknown }
          if (body.action === 'start') {
            const { command, args } = studioArgv(studio.command, project.root)
            const info = studio.supervisor.start(project.root, {
              command,
              args,
              cwd: project.root,
              env: { AWD_CANVAS_URL: `http://localhost:${port()}` },
              logFile: studio.logDir ? path.join(studio.logDir, `studio-${project.name}.log`) : undefined,
            })
            return json(res, 200, view(info))
          }
          if (body.action === 'stop') return json(res, 200, view(await studio.supervisor.stop(project.root)))
          if (body.action === 'new-session') {
            // studio reads the stamp on its next pass: the board session retires, the next chat starts fresh
            const meta = board.meta ?? {}
            store.updateBoard(board.id, { meta: { ...meta, studio: { ...(meta.studio as Record<string, unknown> | undefined), newSessionAt: new Date().toISOString() } } })
            return json(res, 200, view(studio.supervisor.info(project.root)))
          }
          throw new HttpError(400, "action must be 'start', 'stop' or 'new-session'")
        }
        throw new HttpError(405, 'method not allowed')
      }
      throw new HttpError(404, 'not found')
    }

    // ---- Docs (rendered from the repo's docs/*.md) ----
    if (parts[0] === 'docs') {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed')
      const docsDir = opts.docsDir ?? findDocsDir()
      if (!docsDir) throw new HttpError(404, 'no docs directory found (set AWD_DOCS_DIR)')
      const html = (body: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(body)
      }
      if (parts.length === 1) return html(renderIndex(docsDir))
      if (parts[1] === '_asset') {
        const file = resolveDocAsset(docsDir, decodeURIComponent(parts.slice(2).join('/')))
        if (!file) throw new HttpError(404, 'asset not found')
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
        return void fs.createReadStream(file).pipe(res)
      }
      const rendered = renderDoc(docsDir, decodeURIComponent(parts[1]).replace(/\.md$/, ''))
      if (!rendered) throw new HttpError(404, `no doc named ${parts[1]}`)
      return html(rendered)
    }

    // ---- UI ----
    if (method !== 'GET') throw new HttpError(405, 'method not allowed')
    const hasUi = fs.existsSync(path.join(webDist, 'index.html'))
    if (parts[0] === 'b' || parts.length === 0) {
      if (hasUi) return void serveStatic(res, 'index.html')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return void res.end(fallbackPage(store.list()))
    }
    if (hasUi && serveStatic(res, url.pathname)) return
    throw new HttpError(404, 'not found')
  }

  const port = () => {
    const addr = server.address()
    return typeof addr === 'object' && addr ? addr.port : (opts.port ?? 4400)
  }

  let listeningPort = opts.port ?? 4400
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return void res.end()
      if (err instanceof HttpError) return json(res, err.status, { error: err.message })
      if (err instanceof NotFound) return json(res, 404, { error: err.message })
      console.error(err)
      json(res, 500, { error: (err as Error).message ?? 'internal error' })
    })
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const m = url.pathname.match(/^\/ws\/([^/]+)$/)
    const board = m && store.get(m[1])
    if (!board) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (isLocalRequest(req)) localSockets.add(ws)
      const send = (msg: WsMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg))
      send({ type: 'hello', board: store.get(board.id)! })
      // Tell the person whether an agent is currently waiting on this board.
      send({ type: 'presence', author: 'agent', at: new Date().toISOString(), watching: store.watchers(board.id) > 0 })
      const offChange = store.subscribe(board.id, (change) => send({ type: 'change', change }))
      const offPresence = store.onPresence((id, n) => {
        if (id === board.id) send({ type: 'presence', author: 'agent', at: new Date().toISOString(), watching: n > 0 })
      })
      // Saving this board failed or recovered: the page shows "changes are not being saved" (unprose#1).
      const offStorage = store.onStorage((e) => {
        if (e.boardId === board.id) send({ type: 'storage', ok: e.ok, message: e.message, at: e.at })
      })
      const offFocus = onFocus(board.id, (m) => send(m))
      const off = () => {
        offChange()
        offPresence()
        offStorage()
        offFocus()
      }
      ws.on('close', off)
      ws.on('error', off)
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 4400, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 4400)
      listeningPort = port
      // a plugin canvas follows `claude plugin update`, run from anywhere: restart on the newly installed version
      const followMs = Number(process.env.UNPROSE_FOLLOW_INSTALLED_MS ?? 10_000) // 0 turns following off
      const stopFollowing = (followMs > 0 && opts.update?.followInstalled(handoff, followMs)) || (() => undefined)
      resolve({
        server,
        store,
        port,
        url: `http://localhost:${port}`,
        close: () =>
          new Promise<void>((r) => {
            stopFollowing()
            opts.studio?.supervisor.stopAll()
            for (const c of wss.clients) c.terminate()
            wss.close()
            server.close(() => r())
          }),
      })
    })
  })
}

/** A kanban column by name (case-insensitive) or lane id. */
function findColumn(board: Board, nameOrId: string | undefined): Board['items'][string] | undefined {
  if (!nameOrId) return undefined
  const cols = columnsOf(board)
  return cols.find((c) => c.id === nameOrId) ?? cols.find((c) => (c.text ?? '').toLowerCase() === nameOrId.toLowerCase())
}

function summary(b: Board) {
  return { id: b.id, title: b.title, kind: b.kind, seq: b.seq, items: Object.keys(b.items).length, createdAt: b.createdAt, updatedAt: b.updatedAt, meta: b.meta }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
