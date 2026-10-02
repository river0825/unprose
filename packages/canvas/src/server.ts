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
import { isLocalRequest, moveRoute, ProjectHttpError, projectsRoute, resolveProject, unregisterRoute } from './projectsApi.js'
import { pickBoardByTitle } from './boardLookup.js'
import type { Handoff, UpdateService } from './updater.js'
import { redactPaths } from './updatePolicy.js'
import { agentSeenOps, cardMoves, summarize } from './diff.js'
import { contentSchemas, diagramKinds, render, cardHeight, columnsOf, bottomOf, cardId as kanbanCardId, CARD_W, CARD_SIZES, frameOrigin, placeInFrame, resolveTraces, type FrameRequest } from './templates/index.js'
import { DIAGRAM_KEY } from './diagrams/ids.js'
import { findDocsDir, renderDoc, renderIndex, resolveDocAsset } from './docs.js'
import { findRelease, type Release } from './release.js'
import { renderThumb } from './thumb.js'
import { autoPlaceComments } from './place.js'
import { boardFiles, buildProposal, ProposalError, stampAttribution, type ProposalInput } from './proposals.js'
import { applyOps, diagramFrameId, isBookkeeping, isLayoutOnly, newId, WAIT_MAX_SEC, type Author, type Board, type Change, type DiagramKind, type Op, type Wake, type WsMessage } from './model.js'
import { addressedTo, asksMe, mentionsMe, CONTEXT_MAX, contextOf, DEFAULT_AGENT_TURNS, diagramRoots, displayName, handleOf, holdersOf, LOCAL_AGENT, mergeBoardMeta, parseResponder, redactHolders, renameInMeta, responderLabel, responderName, responderOf, responderValue, sameAgent, soleHolder, stampHolders, stampRouting, suggestionOf } from './routing.js'
import type { FeedbackRecord, FeedbackStore } from './ports/feedbackStore.js'
import { MemoryFeedbackStore } from './adapters/feedback/index.js'
import { AccessService } from './access.js'
import { MemoryAccessStore } from './adapters/access/index.js'
import { canSeeBoard, canSeeProject, canWrite, cleanName, projectForNewBoard, type Grant } from './accessPolicy.js'
import { accessRoute, localPage, sameOrigin } from './accessRoutes.js'
import { handleMcp } from './remoteMcp.js'
// agent-scale reading, snapshots, layout check, local approval (docs/canvas.md "Reading big boards")
import { CHANGE_KINDS, diffSummary, filterChanges, pageLines, type ChangeFilter, type ChangeKind } from './diff.js'
import { readBoard, ReadError, type ReadFormat, type ReadOptions } from './read.js'
import { renderSnapshot, SnapshotError } from './snapshot.js'
import { checkLayout, layoutLines, LayoutError } from './layoutCheck.js'
import { svgToPng } from './raster.js'

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
  /**
   * Remote agents (docs/canvas.md "Remote agents"): tokens, OAuth clients, connect requests. Default: kept in
   * memory, remote auth on (`awd-canvas serve` keeps them in ~/.awd/agents.json).
   */
  access?: AccessService
  /** The address agents and people use from elsewhere (OAuth issuer, board links): UNPROSE_PUBLIC_URL; default from the request. */
  publicUrl?: string
  /** What agents tell the owner about Unprose (`unprose_feedback`); default memory (`awd-canvas serve`: ~/.awd/feedback.ndjson). */
  feedback?: FeedbackStore
  /** The loop guard: agent messages in a row in one thread before agents pause there (default UNPROSE_AGENT_TURNS, else 6; a board's `agentTurns` wins). */
  agentTurns?: number
  /** Agent-to-agent @mentions one agent may post per window (default UNPROSE_AGENT_MENTIONS, else 20 per 10 minutes). */
  agentMentions?: { max: number; windowMs: number }
  /**
   * A long GET /wait sends a space every this many ms (default 20 000) so proxies and HTTP clients (Node's fetch
   * gives up after 300 s without a byte) keep the connection; the JSON answer follows. Tests shorten it.
   */
  waitKeepAliveMs?: number
}

/** Board settings kept in `meta`, changed only through /settings (logged), never by a PUT of the whole meta. */
const SETTINGS_KEYS = ['responder', 'responderSuggestion', 'context', 'agentTurns'] as const

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
  // the board-level root (the default for a board drawn from one machine), the workflow file, then each diagram's own root
  const claims = [(board.meta?.project as { root?: unknown } | undefined)?.root, (board.meta?.workflow as { file?: unknown } | undefined)?.file, ...diagramRoots(board.meta)]
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

/** A request whose User-Agent Cloudflare (in front of most tunnels) blocks: none, or a script's default one. */
export function blockedUserAgent(ua: string | undefined): boolean {
  return !ua || !ua.trim() || /^(python-urllib|python-requests|curl|wget|go-http-client|java\/|libwww-perl)/i.test(ua.trim())
}

/** One sentence for a 401 / 403 when the caller's User-Agent would be blocked behind Cloudflare (docs/agents-setup.md). */
function userAgentHint(req: http.IncomingMessage): string {
  const ua = req.headers['user-agent']
  return blockedUserAgent(typeof ua === 'string' ? ua : undefined)
    ? ` Your request has ${ua ? `the User-Agent "${String(ua).slice(0, 40)}"` : 'no User-Agent'}: behind Cloudflare (most tunnels) such requests get a 403 before they reach the canvas — send your own, e.g. "User-Agent: my-agent/1.0".`
    : ''
}

/** Requests from elsewhere that bring no credentials (docs/canvas.md "Remote agents"). */
function needsTokenText(origin: string): string {
  return `This canvas answers requests from elsewhere only with credentials. Agents: connect your MCP client to ${origin}/mcp — it signs in with OAuth and the person approves it on the canvas by typing the code your browser shows; an agent without a browser: POST ${origin}/device_authorization (client_name=<your name>) and tell the person the user_code to type on the canvas; or send "Authorization: Bearer <token>" with a token from the canvas page Connected agents (AWD_CANVAS_URL + UNPROSE_TOKEN for the stdio MCP server). People: open ${origin} and sign in.`
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
  const access = opts.access ?? new AccessService({ store: new MemoryAccessStore(), remoteAuth: process.env.UNPROSE_REMOTE_AUTH !== 'off' })
  /** The address agents and people use: configured, else what the request says (a tunnel's forwarding headers first). */
  const publicOrigin = (req: http.IncomingMessage): string => {
    const configured = opts.publicUrl ?? process.env.UNPROSE_PUBLIC_URL
    if (configured) return configured.replace(/\/+$/, '')
    const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim()
    const proto = first(req.headers['x-forwarded-proto']) || ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http')
    const host = first(req.headers['x-forwarded-host']) || req.headers.host || `localhost:${listeningPort}`
    return `${proto}://${host}`
  }
  const projectOf = (id: string) => (hasProjects(store) ? store.projectOf(id) : 'personal')
  const visible = (g: Grant, id: string) => canSeeBoard(g, id, projectOf(id))
  const needWrite = (g: Grant) => {
    if (!canWrite(g)) throw new HttpError(403, `${g.name} has read-only access`)
  }
  /** The local agent may name itself (UNPROSE_AGENT_NAME → x-unprose-agent); a token's name is its own. */
  const agentName = (req: http.IncomingMessage, g: Grant): string | undefined => {
    if (g.as === 'agent') return g.name
    if (g.kind !== 'local') return undefined
    const h = req.headers['x-unprose-agent']
    return typeof h === 'string' && h.trim() ? cleanName(h) : undefined
  }
  /** Who a write is from: an agent token always writes as its agent; a person's page and this machine say who they are. */
  const actor = (req: http.IncomingMessage, g: Grant, asked: unknown, fallback: Author): { author: Author; by?: string } => {
    if (g.as === 'agent') return { author: 'agent', by: g.name }
    // a signed-in browser (a pairing code or a pasted token let it in) is the person — wherever it is: its changes
    // are the person's ('user', unnamed), so they wake agents waiting for the person and count as the person's word
    if (g.as === 'browser') return { author: 'user' }
    const author = isAuthor(asked) ? asked : fallback
    if (author === 'agent') {
      const by = agentName(req, g)
      return by ? { author, by } : { author }
    }
    return { author }
  }
  /** `author` query → the changes filter: 'user' / 'agent', or 'others' = everyone but this agent. */
  const authorFilter = (req: http.IncomingMessage, g: Grant, raw: string | null): { author?: Author; match?: (c: Change) => boolean } => {
    if (raw === 'others') {
      const me = agentName(req, g) ?? 'agent'
      return { match: (c) => !(c.author === 'agent' && (c.by ?? 'agent') === me) }
    }
    return { author: isAuthor(raw) ? raw : undefined }
  }
  // ---- Several agents on one board (docs/canvas.md "Several agents on one board") ----
  const feedback = opts.feedback ?? new MemoryFeedbackStore()
  /** Agent names this server has seen sign a change or wait (local named agents are not in the access list). */
  const seenNames = new Set<string>()
  const remember = (n: string | undefined) => {
    if (n && seenNames.size < 500) seenNames.add(n)
  }
  /** Names an @mention can resolve to on this board: tokens / OAuth clients, agents seen here, holders, the responder, studio. */
  const knownAgents = (id: string, g?: Grant): string[] => {
    const b = store.get(id)
    const onBoard = new Set<string>([LOCAL_AGENT])
    if (b) {
      for (const n of [...store.watcherNames(id), ...Object.keys(store.watcherSeen(id))]) onBoard.add(n)
      for (const h of holdersOf(b.meta)) onBoard.add(h.holder.agent)
      const r = responderName(responderOf(b.meta))
      if (r) onBoard.add(r)
      for (const it of Object.values(b.items)) if (it.type === 'comment' && it.createdBy === 'agent' && typeof it.data?.by === 'string') onBoard.add(it.data.by)
    }
    // an agent token learns only the names active on this board; the person (and this machine) every connected agent
    if (g && g.as === 'agent') return [...onBoard]
    for (const n of seenNames) onBoard.add(n)
    for (const a of access.list()) if (!a.revokedAt && a.via !== 'browser') onBoard.add(a.name)
    return [...onBoard]
  }
  const maxTurns = (b: Board): number => {
    const v = Number(b.meta?.agentTurns)
    if (Number.isInteger(v) && v >= 1 && v <= 100) return v
    return opts.agentTurns ?? (Number(process.env.UNPROSE_AGENT_TURNS) || DEFAULT_AGENT_TURNS)
  }
  /** Stamp who each comment is for (data.to, data.route, mentions, the loop guard). */
  const routed = (board: Board, ops: Op[], author: Author): Op[] => stampRouting(board, ops, knownAgents(board.id), new Date().toISOString(), (b, o) => applyOps(b, o, author).board, maxTurns(board))
  /**
   * `GET /wait?context=changed` (the stateless remote /mcp): the board context comes back only the first time an
   * agent waits on a board, or after it changed. Remembered per agent × board until CONTEXT_SEEN_TTL_MS after its
   * last wait — a new conversation after a pause sees it again.
   */
  /** Remote /mcp requests in flight (so a cancel can end a canvas_wait — remoteMcp.ts). */
  const mcpInflight = new Map<string, Set<() => void>>()
  const contextSeen = new Map<string, { key: string; at: number }>()
  const CONTEXT_SEEN_TTL_MS = 15 * 60_000
  const contextOnce = (agent: string, boardId: string, ctx: ReturnType<typeof contextOf>): ReturnType<typeof contextOf> | undefined => {
    const now = Date.now()
    if (contextSeen.size > 1000) for (const [k, v] of contextSeen) if (now - v.at > CONTEXT_SEEN_TTL_MS) contextSeen.delete(k)
    const k = `${agent}\u0000${boardId}`
    const was = contextSeen.get(k)
    const key = ctx ? (ctx.at ?? ctx.text) : ''
    contextSeen.set(k, { key, at: now })
    return was && now - was.at <= CONTEXT_SEEN_TTL_MS && was.key === key ? undefined : ctx
  }
  const mentionLimit = opts.agentMentions ??{ max: Number(process.env.UNPROSE_AGENT_MENTIONS) || 20, windowMs: 10 * 60_000 }
  const mentionLog = new Map<string, number[]>()
  /** The rate limit on agent-to-agent @mentions (per agent): 429 past it. */
  const checkMentionRate = (ops: Op[], author: Author, by: string | undefined) => {
    if (author !== 'agent') return
    const me = by ?? LOCAL_AGENT
    const asks = ops.filter((op) => op.kind === 'add' && op.item.type === 'comment' && typeof op.item.data?.mention === 'string' && !sameAgent(op.item.data.mention as string, me)).length
    if (!asks) return
    const now = Date.now()
    const key = me.toLowerCase()
    const recent = (mentionLog.get(key) ?? []).filter((t) => now - t < mentionLimit.windowMs)
    if (recent.length + asks > mentionLimit.max) {
      const wait = Math.ceil((mentionLimit.windowMs - (now - (recent[0] ?? now))) / 1000)
      throw new HttpError(429, `${displayName(me)} has asked other agents ${recent.length} times in the last ${Math.round(mentionLimit.windowMs / 60000)} minutes (the limit is ${mentionLimit.max}); wait ${wait}s, or ask the person to step in`)
    }
    mentionLog.set(key, [...recent, ...Array.from({ length: asks }, () => now)])
  }
  /** A board as this caller may see it: holders without this machine's name and paths for anyone not on this machine. */
  const viewOf = (g: Grant, b: Board): Board => (g.kind === 'local' ? b : { ...b, meta: redactHolders(b.meta) })
  /** The board's settings as /settings returns them. */
  const settingsOf = (g: Grant, b: Board, req: http.IncomingMessage) => {
    const meta = viewOf(g, b).meta
    const r = responderOf(b.meta)
    const watching = new Set(store.watcherNames(b.id))
    const seen = store.watcherSeen(b.id)
    const holders = holdersOf(meta)
    // a suggestion only while nobody answers yet: one an agent asked for, else the agent holding every diagram's files
    const asked = r ? undefined : suggestionOf(b.meta)
    const sole = soleHolder(b.meta)
    const suggestion = r ? undefined : asked ? responderValue(asked) : sole && !sameAgent(sole, LOCAL_AGENT) ? sole : undefined
    return {
      responder: r ?? null,
      answeredBy: responderLabel(r),
      context: contextOf(b.meta) ?? null,
      agentTurns: maxTurns(b),
      holders,
      suggestion,
      ...(suggestion ? { suggestionBy: asked?.by ?? null, suggestionWhy: asked ? 'asked' : 'holder' } : {}),
      agents: knownAgents(b.id, g)
        .sort((a, z) => (a === LOCAL_AGENT ? -1 : z === LOCAL_AGENT ? 1 : a.localeCompare(z)))
        .map((name) => ({ name, label: displayName(name), handle: handleOf(name), watching: [...watching].some((w) => sameAgent(w, name)), ...(seen[name] ? { seen: seen[name] } : {}), holder: holders.some((h) => sameAgent(h.holder.agent, name)) })),
      you: agentName(req, g) ?? (g.as === 'browser' ? g.name : undefined),
    }
  }
  /** After a rename on the agents page: the boards naming that agent (responder, holders) follow. */
  const renameOnBoards = (from: string, to: string) => {
    for (const b of store.list()) {
      const m = renameInMeta(b.meta, from, to)
      if (!m) continue
      const patch = Object.fromEntries(['responder', 'responderSuggestion', 'diagrams', 'workflow'].filter((k) => JSON.stringify(m[k]) !== JSON.stringify(b.meta?.[k])).map((k) => [k, m[k]]))
      if (Object.keys(patch).length) store.setMeta(b.id, patch, 'user', `renamed agent ${from} → ${to}`)
    }
  }
  const feedbackLog = new Map<string, number[]>()

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

  /** The agent has now read these changes: record receipts on the user's comments (per named agent), return the board after. */
  const readByAgent = (id: string, changes: Change[], author: Author | undefined, name?: string): Board => {
    const ops = author === 'agent' ? [] : agentSeenOps(store.get(id)!, changes, name)
    if (ops.length) store.apply(id, ops, 'agent', 'seen', name)
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
    // a page reached from elsewhere (a tunnel), even signed in, must not learn where things live on this machine
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
      if (!local) throw new HttpError(403, 'upgrading is only possible from a page opened on this machine')
      if (!up) throw new HttpError(400, 'update checks are not set up on this server')
      const r = await up.start(handoff())
      return reply(res, r.started ? 202 : 409, r)
    }
    throw new HttpError(405, 'method not allowed')
  }

  /** 401 with the way in: the OAuth metadata for MCP clients, the options in words for everyone else. */
  const unauthorized = (req: http.IncomingMessage, res: http.ServerResponse, mcp: boolean, invalid?: string) => {
    const o = publicOrigin(req)
    res.writeHead(401, {
      'content-type': 'application/json; charset=utf-8',
      'www-authenticate': `Bearer realm="unprose", resource_metadata="${o}/.well-known/oauth-protected-resource${mcp ? '/mcp' : ''}"${invalid ? ', error="invalid_token"' : ''}`,
      'access-control-expose-headers': 'www-authenticate',
    })
    const why = (invalid ?? needsTokenText(o)) + userAgentHint(req)
    res.end(JSON.stringify(mcp ? { jsonrpc: '2.0', error: { code: -32001, message: why }, id: null } : { error: why, signIn: true }))
  }

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'
    // remote-agents routes set their own headers (OAuth endpoints are CORS-open, the page API is same-origin only)
    let authResult: Awaited<ReturnType<AccessService['authenticate']>> | undefined
    const auth = async () => (authResult ??= await access.authenticate(req))
    if (await accessRoute(req, res, url, method, { access, publicOrigin, projects: () => (hasProjects(store) ? store.projects().map((p) => ({ id: p.id, name: p.name })) : []), onRename: renameOnBoards, feedback: () => feedback.list() }, auth)) return

    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'content-type, authorization, mcp-protocol-version, mcp-session-id, x-unprose-agent')
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('access-control-expose-headers', 'www-authenticate, mcp-session-id')
    if (method === 'OPTIONS') return void res.writeHead(204).end()

    const parts = url.pathname.split('/').filter(Boolean)

    // ---- Remote MCP (Streamable HTTP) ----
    if (url.pathname === '/mcp') {
      const { grant, error } = await auth()
      if (error || !grant) return unauthorized(req, res, true, error)
      const body = method === 'POST' ? await readBody(req) : undefined
      return handleMcp(req, res, grant, { access, loopback: `http://127.0.0.1:${listeningPort}`, publicUrl: publicOrigin(req), inflight: mcpInflight }, body)
    }

    // ---- API ----
    if (parts[0] === 'api') {
      if (parts[1] === 'kinds' && method === 'GET') return json(res, 200, { kinds: diagramKinds })
      // pid: lets the plugin tell a canvas it started (and may restart after an update) from one the person runs
      if (parts[1] === 'version' && method === 'GET') return json(res, 200, { ...release(), pid: process.pid })
      const { grant, error } = await auth()
      if (error || !grant) return unauthorized(req, res, false, error)
      if (parts[1] === 'projects' && !parts[2]) {
        return projectReply(res, async () => {
          const r = await projectsRoute(store, req, method, () => readBody(req))
          const body = r.body as { projects?: Array<{ id: string }> }
          if (method !== 'GET' || !body.projects) return r
          const boardProjects = new Set(store.list().filter((b) => visible(grant, b.id)).map((b) => projectOf(b.id)))
          return { ...r, body: { projects: body.projects.filter((p) => canSeeProject(grant, p.id) && (!grant.boards?.length || boardProjects.has(p.id))) } }
        })
      }
      if (parts[1] === 'projects' && parts[2] && !parts[3] && method === 'DELETE') {
        const force = ['1', 'true', 'yes'].includes(url.searchParams.get('force') ?? '')
        return projectReply(res, () => unregisterRoute(store, req, decodeURIComponent(parts[2]), force))
      }
      if (parts[1] === 'update') return updateRoute(req, res, method, parts[2], url)
      // ---- Feedback about Unprose itself (docs/canvas.md "Feedback") ----
      if (parts[1] === 'feedback' && !parts[2]) {
        if (method === 'POST') {
          const body = (await readBody(req)) as { text?: unknown; board?: unknown; about?: unknown }
          const text = typeof body.text === 'string' ? body.text.trim() : ''
          if (!text) throw new HttpError(400, 'text is required: what was hard, what should change, what you missed')
          if (text.length > 4000) throw new HttpError(400, 'text is longer than 4000 characters')
          const board = typeof body.board === 'string' && body.board ? body.board : undefined
          if (board && (!store.get(board) || !visible(grant, board))) throw new HttpError(404, `board ${board} not found`)
          const about = Array.isArray(body.about) ? body.about.filter((a): a is string => typeof a === 'string').slice(0, 20) : undefined
          const by = grant.as ? grant.name : (agentName(req, grant) ?? LOCAL_AGENT)
          const now = Date.now()
          const recent = (feedbackLog.get(by) ?? []).filter((t) => now - t < 10 * 60_000)
          if (recent.length >= 30) throw new HttpError(429, 'thanks — that is a lot of feedback for ten minutes; send the rest later')
          feedbackLog.set(by, [...recent, now])
          const rec: FeedbackRecord = { id: newId('fb'), at: new Date(now).toISOString(), by, via: grant.kind, text, ...(board ? { board } : {}), ...(about?.length ? { about } : {}) }
          feedback.append(rec)
          return json(res, 201, { ok: true, id: rec.id })
        }
        if (method === 'GET') {
          if (grant.kind !== 'local' && !grant.manage) throw new HttpError(403, 'feedback is read on the canvas machine (a local agent or page) or by a page allowed to manage agents')
          return json(res, 200, { feedback: feedback.list() })
        }
        throw new HttpError(405, 'method not allowed')
      }
      // ---- A pairing code approved by the local agent (canvas_approve; docs/canvas.md "Who may approve and manage") ----
      if (parts[1] === 'approve' && !parts[2]) {
        if (method !== 'POST') throw new HttpError(405, 'method not allowed')
        // only an agent process on this machine: loopback, no forwarding headers, no token or session, and no browser
        // (a browser always sends Origin / Sec-Fetch-Site on a POST, so no web page — not even this canvas's — can use it)
        const browser = req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined || req.headers.cookie !== undefined
        if (grant.kind !== 'local' || grant.as || !isLocalRequest(req) || browser) throw new HttpError(403, 'pairing codes are approved here only by an agent running on the canvas machine (the local stdio MCP server); people approve on the canvas page, agents elsewhere never can')
        const body = (await readBody(req)) as { code?: unknown; scope?: unknown; name?: unknown; board?: unknown }
        if (body.scope !== undefined && body.scope !== 'read' && body.scope !== 'write') throw new HttpError(400, "scope must be 'read' or 'write'")
        const boardId = typeof body.board === 'string' && body.board ? body.board : undefined
        if (boardId && !store.get(boardId)) throw new HttpError(404, `board ${boardId} not found`)
        const me = agentName(req, grant) ?? LOCAL_AGENT
        const before = access.pendingViews()
        // the same path as the page's "Enter a code": unknown codes count against the ten-per-ten-minutes limit
        // `read` grants less than asked; never more than the request asked for (`write` = as asked)
        const scope = body.scope === 'read' ? ('read' as const) : undefined
        const r = access.decideByCode(body.code, { scope, name: typeof body.name === 'string' ? body.name : undefined }, grant, `local-agent:${me}`)
        if (!r.ok) throw new HttpError(r.http ?? 400, r.error ?? 'not approved')
        const left = new Set(access.pendingViews().map((p) => p.id))
        const approved = before.find((p) => !left.has(p.id))
        const what = approved ? `${approved.name} (${approved.via}${approved.ip ? ` from ${approved.ip}` : ''}, ${scope ?? approved.scope})` : 'a connect request'
        const note = `approved ${what} with its pairing code — by the local agent ${displayName(me)}`
        console.log(`unprose: ${note}`)
        let seq: number | undefined
        if (boardId) seq = store.setMeta(boardId, {}, 'agent', note, me === LOCAL_AGENT ? undefined : me).seq
        return json(res, 200, { status: r.status, approved: approved ? { name: approved.name, via: approved.via, scope: scope ?? approved.scope, ip: approved.ip } : undefined, audit: note, ...(seq !== undefined ? { seq } : {}) })
      }
      if (parts[1] !== 'boards') throw new HttpError(404, 'not found')
      const id = parts[2]
      const sub = parts[3]

      if (!id) {
        if (method === 'GET') {
          const only = projectOrError(res, () => resolveProject(store, req, url.searchParams.get('project') ?? undefined))
          if (only === null) return
          return json(res, 200, { boards: store.list().filter((b) => (!only || projectOf(b.id) === only) && visible(grant, b.id)).map((b) => ({ ...summary(viewOf(grant, b)), project: projectOf(b.id) })) })
        }
        if (method === 'POST') {
          needWrite(grant)
          const body = (await readBody(req)) as { title?: string; kind?: DiagramKind; meta?: Record<string, unknown>; items?: Board['items'][string][]; author?: Author; content?: unknown; project?: string; projectRoot?: string; answeredBy?: unknown; reuse?: unknown }
          const placed = projectForNewBoard(grant, body.project)
          if (placed.error) throw new HttpError(403, placed.error)
          const project = projectOrError(res, () => resolveProject(store, req, placed.project, body.projectRoot))
          if (project === null) return
          if (!body.title || typeof body.title !== 'string') throw new HttpError(400, 'title required')
          if (!body.kind || !diagramKinds.includes(body.kind)) throw new HttpError(400, `kind must be one of ${diagramKinds.join(', ')}`)
          // find-or-create by title in one step (docs/canvas.md "Projects"): the same project first, then the personal
          // space, then any board this caller sees — so two draws at once, or from two machines, share one board
          if (body.reuse === 'title' || body.reuse === 'title+kind') {
            const seen = store.list().filter((b) => visible(grant, b.id)).map((b) => ({ id: b.id, title: b.title, kind: b.kind, project: projectOf(b.id), updatedAt: b.updatedAt }))
            const found = pickBoardByTitle(seen, body.title, project ?? undefined, body.reuse === 'title+kind' ? (b) => b.kind === body.kind : undefined)
            if (found.board) {
              const b = store.get(found.board.id)!
              return json(res, 200, { board: viewOf(grant, b), project: found.board.project, reused: true, where: found.where, ...(found.ambiguous.length ? { ambiguous: found.ambiguous.map((x) => ({ id: x.id, project: x.project, updatedAt: x.updatedAt })) } : {}) })
            }
          }
          let items = body.items
          if (!items && body.content !== undefined) {
            const parsed = contentSchemas[body.kind].safeParse(body.content)
            if (!parsed.success) throw new HttpError(400, `invalid content: ${parsed.error.message}`)
            items = render(body.kind, parsed.data)
          }
          const who = actor(req, grant, body.author, 'agent')
          // A board an agent draws from its files SUGGESTS that agent as "Answered by"; the person confirms it
          // (docs/canvas.md "Several agents on one board"). An agent never sets the settings keys itself.
          const answeredBy = body.answeredBy === 'me' && who.author === 'agent' && who.by ? { responderSuggestion: { mode: 'agent', agent: who.by, by: who.by, at: new Date().toISOString() } } : {}
          const given = { ...(body.meta ?? {}) }
          if (who.author === 'agent') for (const k of SETTINGS_KEYS) if (k !== 'context') delete given[k]
          const meta = body.meta || Object.keys(answeredBy).length ? { ...given, ...answeredBy } : undefined
          const board = store.create({ title: body.title, kind: body.kind, meta, items, ...(project ? { project } : {}), ...(who.by ? { by: who.by } : {}) }, who.author)
          remember(who.author === 'agent' ? who.by : undefined)
          return json(res, 201, { board: viewOf(grant, board), project: hasProjects(store) ? store.projectOf(board.id) : 'personal' })
        }
        throw new HttpError(405, 'method not allowed')
      }

      const board = store.get(id)
      if (!board) throw new HttpError(404, `board ${id} not found`)
      if (!visible(grant, id)) throw new HttpError(403, `${grant.name} may not use board ${id}`)
      // everything that changes the board, or reaches the person's page, needs write access
      if (method !== 'GET' && sub !== 'template') needWrite(grant)

      if (!sub) {
        if (method === 'GET') return json(res, 200, { board: viewOf(grant, board) })
        if (method === 'PUT' || method === 'PATCH') {
          const body = (await readBody(req)) as { title?: string; meta?: Record<string, unknown> }
          const patch: { title?: string; meta?: Record<string, unknown> } = {}
          if (typeof body.title === 'string') patch.title = body.title
          if (body.meta && typeof body.meta === 'object') {
            // PUT replaces meta whole (kept for older clients); PATCH merges the keys given, `diagrams` per diagram key,
            // so two machines drawing in turn never overwrite each other's entries (docs/canvas.md "HTTP API")
            const sent = method === 'PATCH' ? mergeBoardMeta(board.meta, body.meta) : body.meta
            // the file holders are stamped from the caller; the board settings change only through /settings
            const w = actor(req, grant, 'agent', 'agent')
            const meta = stampHolders(board.meta, sent, w.by ?? (w.author === 'user' ? 'user' : LOCAL_AGENT), new Date().toISOString())
            for (const k of SETTINGS_KEYS) {
              if (board.meta?.[k] !== undefined) meta[k] = board.meta[k]
              else delete meta[k]
            }
            patch.meta = meta
            remember(w.by)
          }
          return json(res, 200, { board: viewOf(grant, store.updateBoard(id, patch)) })
        }
        if (method === 'DELETE') return json(res, 200, { deleted: store.delete(id) })
        throw new HttpError(405, 'method not allowed')
      }

      if (sub === 'move' && method === 'POST') return projectReply(res, () => moveRoute(store, req, id, () => readBody(req)))

      if (sub === 'ops' && method === 'POST') {
        const body = (await readBody(req)) as { author?: unknown; ops?: unknown; note?: string }
        // a token is always its agent and a signed-in browser always the person: only this machine must say who it is
        if (!isAuthor(body.author) && !grant.as) throw new HttpError(400, "author must be 'agent' or 'user'")
        const who = actor(req, grant, body.author, 'agent')
        // a comment is signed with the caller's name as the server knows it (docs/canvas.md "Identity")
        const ops = routed(board, stampAttribution(board, assertOps(body.ops), who.by), who.author)
        checkMentionRate(ops, who.author, who.by)
        if (who.author === 'agent') remember(who.by)
        const change = store.apply(id, ops, who.author, body.note, who.by)
        return json(res, 200, { seq: change.seq, change })
      }
      // ---- Proposals: the files behind a board, and edits to them as chat requests (docs/canvas.md "Proposals and saving") ----
      if (sub === 'files' && method === 'GET') {
        const files = boardFiles(board)
        const want = url.searchParams.get('path')
        if (want !== null) {
          const f = files.find((x) => x.path === want)
          if (!f) throw new HttpError(404, `"${want}" is not among the files behind this board (${files.map((x) => x.path).join(', ') || 'none'})`)
          return json(res, 200, { file: f })
        }
        return json(res, 200, { files: files.map(({ text, ...f }) => ({ ...f, size: text.length, lines: text === '' ? 0 : text.replace(/\n$/, '').split('\n').length })) })
      }
      if (sub === 'proposals' && method === 'POST') {
        const body = (await readBody(req)) as ProposalInput & { author?: unknown }
        if (body.author !== undefined && !isAuthor(body.author)) throw new HttpError(400, "author must be 'agent' or 'user'")
        const who = actor(req, grant, body.author, 'agent')
        let p: ReturnType<typeof buildProposal>
        try {
          p = buildProposal(store.get(id)!, body, who, new Date().toISOString(), () => newId('prop'))
        } catch (e) {
          if (e instanceof ProposalError) throw new HttpError(e.status, e.message)
          throw e
        }
        const change = store.apply(id, routed(store.get(id)!, p.ops, who.author), who.author, `proposed an edit to ${p.file} (+${p.added} −${p.removed})`, who.by)
        return json(res, 201, { seq: change.seq, comment: p.commentId, file: p.file, diff: p.diff, about: p.about, added: p.added, removed: p.removed, offsets: p.offsets })
      }
      if (sub === 'focus' && method === 'POST') {
        const body = (await readBody(req)) as { ids?: unknown; frame?: unknown; note?: unknown; author?: unknown }
        if (body.author !== undefined && !isAuthor(body.author)) throw new HttpError(400, "author must be 'agent' or 'user'")
        const who = actor(req, grant, body.author, 'agent')
        const author = who.author
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
        const msg: FocusMessage = { type: 'focus', ids, ...(frame ? { frame } : {}), ...(note ? { note } : {}), author, ...(who.by ? { by: who.by } : {}), at: new Date().toISOString() }
        return json(res, 200, { ok: true, viewers: emitFocus(id, msg), focus: msg })
      }
      if (sub === 'changes' && method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0)
        const f = authorFilter(req, grant, url.searchParams.get('author'))
        const cf = changeFilterOf(url)
        const changes = agentScale(() => (cf ? filterChanges(store.get(id)!, store.changes(id, { since, ...f }), cf) : store.changes(id, { since, ...f })))
        return json(res, 200, { changes, seq: store.get(id)!.seq })
      }
      if (sub === 'diff' && method === 'GET') {
        // ?frame= &from= &kinds= &summary=1 &last= &limit= &cursor= &maxChars= (docs/canvas.md "Reading big boards")
        const since = Number(url.searchParams.get('since') ?? 0)
        const f = authorFilter(req, grant, url.searchParams.get('author'))
        const cf = changeFilterOf(url)
        const now = store.get(id)!
        const all = store.changes(id, { since, ...f }).filter((c) => !isBookkeeping(c))
        const changes = agentScale(() => (cf ? filterChanges(now, all, cf) : all))
        const lines = summarize(now, changes, { collapseMoves: url.searchParams.get('moves') !== 'each' })
        const page = agentScale(() => pageLines(lines, { cursor: url.searchParams.get('cursor') ?? undefined, limit: numParam(url, 'limit'), maxChars: numParam(url, 'maxChars'), seq: now.seq }))
        const summaryText = boolParam(url, 'summary') ? diffSummary(now, changes, lines, { since, last: numParam(url, 'last') }) : undefined
        const cur = readByAgent(id, changes, f.author, agentName(req, grant))
        const more = page.left ? `${page.left} more line(s) of ${lines.length} not shown (size cap) — next page: cursor "${page.nextCursor}"; or summary=1, frame=, from=, kinds= to narrow` : undefined
        return json(res, 200, { since, seq: cur.seq, lines: summaryText ? [] : page.lines, count: changes.length, total: lines.length, from: page.from, ...(page.nextCursor && !summaryText ? { nextCursor: page.nextCursor, more } : {}), ...(summaryText ? { summary: summaryText } : {}) })
      }
      if (sub === 'wait' && method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? board.seq)
        const timeout = Math.max(0, Math.min(Number(url.searchParams.get('timeout') ?? 30000) || 0, WAIT_MAX_SEC * 1000))
        // ?until=mention: only a change addressing this agent personally (an @mention, a proposal to its files) wakes it
        const untilMention = url.searchParams.get('until') === 'mention'
        const quietRaw = url.searchParams.get('quiet')
        const quietMs = quietRaw === null ? undefined : Math.max(0, Math.min(Number(quietRaw) || 0, 30000))
        const wakeRaw = url.searchParams.get('wake') ?? 'meaningful'
        if (!WAKES.includes(wakeRaw as Wake)) throw new HttpError(400, `wake must be one of ${WAKES.join(', ')}`)
        const wake = wakeRaw as Wake
        const f = authorFilter(req, grant, url.searchParams.get('author'))
        const name = agentName(req, grant)
        remember(name)
        // only what is for this agent wakes it and comes back (docs/canvas.md "Several agents on one board"):
        // the board's responder, @mentions, proposals to the files it holds; `to=all` listens to everything
        const me = name ?? LOCAL_AGENT
        const all = url.searchParams.get('to') === 'all'
        const fromAuthor = (c: Change) => (!f.author || c.author === f.author) && (!f.match || f.match(c))
        const now = () => store.get(id)!
        const forMe = (c: Change) => all || addressedTo(now(), c, me)
        // ?frame= &from= &kinds=: only changes with an op that passes wake you and come back (docs/canvas.md "Reading big boards")
        const cf = changeFilterOf(url)
        if (cf?.frame) agentScale(() => filterChanges(board, [], cf))
        const passes = (c: Change) => !cf || filterChanges(now(), [c], cf).length > 0
        const personal = (c: Change) => !untilMention || mentionsMe(now(), c, me)
        const match = (c: Change) => (fromAuthor(c) || asksMe(now(), c, me)) && forMe(c) && passes(c) && personal(c)
        // the client went away (an MCP client timed out, the agent was stopped): end the wait and free the watcher
        // slot at once, so the page stops saying "agent is watching"
        const gone = new AbortController()
        const onClose = () => {
          if (!res.writableEnded) gone.abort()
        }
        res.on('close', onClose)
        // a long wait keeps the connection alive with a space now and then (JSON allows leading whitespace)
        const keepAliveMs = opts.waitKeepAliveMs ?? 20_000
        const keepAlive =
          timeout > keepAliveMs
            ? setInterval(() => {
                if (res.writableEnded || gone.signal.aborted) return
                if (!res.headersSent) res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
                res.write(' ')
              }, keepAliveMs)
            : undefined
        const reply = (status: number, body: unknown) => {
          if (!res.headersSent) return json(res, status, body)
          res.end(JSON.stringify(body))
        }
        let woke: Change[]
        try {
          woke = await store.waitFor(id, since, timeout, undefined, { quietMs, wake, match, who: name, signal: gone.signal })
        } finally {
          if (keepAlive) clearInterval(keepAlive)
          res.off('close', onClose)
        }
        if (gone.signal.aborted) return void (res.writableEnded || res.end())
        try {
          if (!store.get(id)) throw new NotFound(`board ${id} not found`)
          const changes = cf ? filterChanges(store.get(id)!, woke, cf) : woke
          const allLines = summarize(store.get(id)!, changes, { collapseMoves: wake !== 'any' })
          const page = pageLines(allLines, { maxChars: numParam(url, 'maxChars'), seq: store.get(id)!.seq })
          const lines = boolParam(url, 'summary') && allLines.length > 1 ? [diffSummary(store.get(id)!, changes, allLines, { since, last: numParam(url, 'last') ?? 10 })] : page.left ? [...page.lines, `… ${page.left} more line(s) not shown (size cap) — canvas_diff({ since: ${since}, cursor: "${page.nextCursor}" }) or summary: true`] : page.lines
          const cur = readByAgent(id, changes, f.author, name)
          const last = changes.length ? changes[changes.length - 1].seq : cur.seq
          const between = store.changes(id, { since }).filter((c) => c.seq <= last && !isBookkeeping(c) && fromAuthor(c))
          const notForYou = all ? 0 : between.filter((c) => !forMe(c)).length
          // untilMention: changes that were for this agent but did not address it personally (they did not wake it)
          const notMentioned = untilMention ? between.filter((c) => forMe(c) && passes(c) && !mentionsMe(cur, c, me) && c.ops.some((op) => !isLayoutOnly(op, c.before[op.kind === 'add' ? op.item.id : op.id]))).length : 0
          const r = responderOf(cur.meta)
          const ctx = contextOf(cur.meta)
          const context = url.searchParams.get('context') === 'changed' ? contextOnce(me, id, ctx) : ctx
          return reply(200, { since, seq: cur.seq, timedOut: changes.length === 0, changes, lines, notForYou, ...(untilMention ? { notMentioned } : {}), answeredBy: responderLabel(r), responder: r ?? null, context: context ?? null })
        } catch (e) {
          if (!res.headersSent) throw e
          return reply(500, { error: (e as Error).message ?? 'internal error' })
        }
      }
      // ---- Board settings: who answers, the context note, the loop guard (docs/canvas.md "Several agents on one board") ----
      if (sub === 'settings') {
        if (method === 'GET') return json(res, 200, settingsOf(grant, board, req))
        if (method !== 'PUT' && method !== 'PATCH' && method !== 'POST') throw new HttpError(405, 'method not allowed')
        const body = (await readBody(req)) as { responder?: unknown; answeredBy?: unknown; context?: unknown; agentTurns?: unknown; author?: unknown }
        if (body.author !== undefined && !isAuthor(body.author)) throw new HttpError(400, "author must be 'agent' or 'user'")
        const w = actor(req, grant, body.author, 'user')
        const at = new Date().toISOString()
        const by = w.by ?? (w.author === 'agent' ? LOCAL_AGENT : undefined)
        const patch: Record<string, unknown> = {}
        const notes: string[] = []
        const asked = 'responder' in body ? body.responder : 'answeredBy' in body ? body.answeredBy : undefined
        if (asked !== undefined) {
          const r = parseResponder(asked, w.author === 'agent' ? (w.by ?? LOCAL_AGENT) : undefined, by, at)
          if (r === undefined) throw new HttpError(400, "answeredBy must be 'any', 'studio', 'me' (an agent) or an agent's name")
          const cur = responderOf(board.meta)
          const clean = (x: object) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined))
          if (w.author === 'agent') {
            // an agent only suggests who answers; the person confirms (watching ≠ answering — docs/canvas.md)
            const was = suggestionOf(board.meta)
            if (!r) {
              if (was) {
                patch.responderSuggestion = null
                notes.push('withdrew the "Answered by" suggestion')
              }
            } else if (!was || was.mode !== r.mode || (was.agent ?? '') !== (r.agent ?? '')) {
              patch.responderSuggestion = clean(r)
              notes.push(`suggested "Answered by": ${responderLabel(r)} — the person confirms it`)
            }
          } else if ((r?.mode ?? 'default') !== (cur?.mode ?? 'default') || (r?.agent ?? '') !== (cur?.agent ?? '')) {
            patch.responder = r ? clean(r) : null
            if (suggestionOf(board.meta)) patch.responderSuggestion = null
            notes.push(r ? `set "Answered by" to ${responderLabel(r)}` : 'set "Answered by" back to the default (studio and any agent)')
          } else if (!r && suggestionOf(board.meta)) {
            // the person keeps the default: the suggestion is dismissed
            patch.responderSuggestion = null
            notes.push('dismissed the "Answered by" suggestion')
          }
        }
        if ('context' in body) {
          const raw = body.context && typeof body.context === 'object' ? (body.context as { text?: unknown }).text : body.context
          if (raw !== null && raw !== undefined && typeof raw !== 'string') throw new HttpError(400, 'context must be a text (markdown), or null to clear it')
          const text = (raw ?? '').replace(/\r\n/g, '\n').trim()
          if (text.length > CONTEXT_MAX) throw new HttpError(400, `the context is longer than ${CONTEXT_MAX} characters — keep it short and link to the notes (docs/meetings/…md)`)
          if (text !== (contextOf(board.meta)?.text ?? '')) {
            patch.context = text ? { text, ...(by ? { by } : {}), at } : null
            notes.push(text ? 'updated the board context' : 'cleared the board context')
          }
        }
        if ('agentTurns' in body) {
          const v = body.agentTurns === null ? null : Number(body.agentTurns)
          if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 100)) throw new HttpError(400, 'agentTurns must be a whole number from 1 to 100, or null for the default')
          if (v !== (typeof board.meta?.agentTurns === 'number' ? board.meta.agentTurns : null)) {
            patch.agentTurns = v
            notes.push(v ? `agents may now post ${v} messages in a row in a thread` : 'the loop guard is back to its default')
          }
        }
        if (!Object.keys(patch).length) return json(res, 200, { seq: board.seq, ...settingsOf(grant, board, req) })
        const change = store.setMeta(id, patch, w.author, notes.join('; '), w.by)
        return json(res, 200, { seq: change.seq, ...settingsOf(grant, store.get(id)!, req) })
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
          const who = actor(req, grant, body.author, 'agent')
          const author = who.author
          const now = new Date().toISOString()
          const newId = body.id ? kanbanCardId('kb', body.id) : kanbanCardId('kb', `${body.title}-${Date.now().toString(36)}`)
          if (board.items[newId]) throw new HttpError(409, `card ${newId} already exists`)
          const item: Board['items'][string] = { id: newId, type: 'card', x: spot.x, y: spot.y, w: CARD_W, h, text: body.title, color: 'white', role: 'card', parent: column.id, order: 1e6, data, createdBy: author, updatedBy: author, updatedAt: now }
          const ops: Op[] = [{ kind: 'add', item }]
          if (spot.laneH > column.h) ops.push({ kind: 'update', id: column.id, patch: { h: spot.laneH } })
          const change = store.apply(id, ops, author, body.note ?? `added card "${body.title}" to ${column.text}`, who.by)
          return json(res, 201, { card: store.get(id)!.items[newId], seq: change.seq })
        }
        if (cardIdParam && parts[5] === 'move' && method === 'POST') {
          const card = board.items[cardIdParam]
          if (!card || card.type !== 'card') throw new HttpError(404, `card ${cardIdParam} not found`)
          const body = (await readBody(req)) as { column?: string; author?: unknown; note?: string }
          const column = findColumn(board, body.column)
          if (!column) throw new HttpError(400, `column required; one of ${columnsOf(board).map((c) => c.text).join(', ')}`)
          const who = actor(req, grant, body.author, 'agent')
          const author = who.author
          const fromName = board.items[card.parent ?? '']?.text ?? 'nowhere'
          const without: Board = { ...board, items: { ...board.items, [card.id]: { ...card, parent: '__moving__' } } }
          const spot = bottomOf(without, column, card.h)
          const ops: Op[] = [{ kind: 'update', id: card.id, patch: { x: spot.x, y: spot.y, parent: column.id, order: 1e6 } }]
          if (spot.laneH > column.h) ops.push({ kind: 'update', id: column.id, patch: { h: spot.laneH } })
          const change = store.apply(id, ops, author, body.note ?? `moved "${card.text}" ${fromName} → ${column.text}`, who.by)
          return json(res, 200, { card: store.get(id)!.items[card.id], from: fromName, to: column.text, seq: change.seq })
        }
        throw new HttpError(404, 'not found')
      }
      // ---- Agent-scale reading, seeing the board, the layout check (docs/canvas.md "Reading big boards", "Seeing the board") ----
      if (sub === 'outline' && method === 'GET') {
        // the same filters as /read; without any, the whole outline — capped (a "more" line says how to page on)
        const r = agentScale(() => readBoard(board, { ...readOptionsOf(url), format: 'outline' }))
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', ...(r.nextCursor ? { 'x-unprose-next-cursor': r.nextCursor, 'access-control-expose-headers': 'www-authenticate, mcp-session-id, x-unprose-next-cursor' } : {}) })
        return void res.end(r.text)
      }
      if (sub === 'read' && method === 'GET') {
        // json: the items as text lines in `text`; `items=1` also returns them as an array (not both by default — size)
        const { items, ...r } = agentScale(() => readBoard(board, readOptionsOf(url)))
        return json(res, 200, boolParam(url, 'items') && items ? { ...r, items } : r)
      }
      if (sub === 'layout' && method === 'GET') {
        const report = agentScale(() => checkLayout(board, { frame: url.searchParams.get('frame') || undefined, limit: numParam(url, 'limit') }))
        return json(res, 200, { ...report, lines: layoutLines(report, board, numParam(url, 'limit') ?? 60) })
      }
      if (sub === 'snapshot' && method === 'GET') {
        const format = url.searchParams.get('format') ?? 'png'
        if (format !== 'png' && format !== 'svg') throw new HttpError(400, 'format must be png or svg')
        const theme = url.searchParams.get('theme') ?? 'light'
        if (theme !== 'light' && theme !== 'dark') throw new HttpError(400, 'theme must be light or dark')
        const snap = agentScale(() => renderSnapshot(board, { frame: url.searchParams.get('frame') || undefined, ids: listParam(url, 'ids'), scale: numParam(url, 'scale'), maxPx: numParam(url, 'maxPx'), theme }))
        const info = { width: snap.width, height: snap.height, scale: snap.scale, items: snap.items, region: snap.region, notes: snap.notes }
        const head = { 'cache-control': 'no-store', 'x-unprose-snapshot': JSON.stringify(info), 'access-control-expose-headers': 'www-authenticate, mcp-session-id, x-unprose-snapshot' }
        if (format === 'png') {
          const r = await svgToPng(snap.svg)
          if (r.png) {
            res.writeHead(200, { 'content-type': 'image/png', ...head })
            return void res.end(r.png)
          }
          res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', ...head, 'x-unprose-snapshot': JSON.stringify({ ...info, notes: [...snap.notes, r.why] }) })
          return void res.end(snap.svg)
        }
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', ...head })
        return void res.end(snap.svg)
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
          // studio starts processes on this machine: never for an agent token
          if (grant.as === 'agent') throw new HttpError(403, 'agents cannot start or stop studio; the person does that on the canvas')
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
    if (parts[0] === 'b' || parts.length === 0 || (parts[0] === 'agents' && parts.length === 1)) {
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
  const refuse = (socket: import('node:stream').Duplex, status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`)
    socket.destroy()
  }
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const { grant } = await access.authenticate(req)
      if (!grant) return refuse(socket, '401 Unauthorized')
      // the server socket: connect requests for pages that may approve them (docs/canvas.md "Remote agents")
      if (url.pathname === '/ws') {
        const approver = localPage(req, grant) || (grant.as === 'browser' && sameOrigin(req))
        return wss.handleUpgrade(req, socket, head, (ws) => {
          if (grant.kind === 'local') localSockets.add(ws)
          serverSockets.add(ws)
          if (approver) {
            approvers.add(ws)
            for (const request of access.pendingViews()) ws.send(JSON.stringify({ type: 'access-request', request } satisfies WsMessage))
          }
          const off = () => {
            serverSockets.delete(ws)
            approvers.delete(ws)
          }
          ws.on('close', off)
          ws.on('error', off)
        })
      }
      const m = url.pathname.match(/^\/ws\/([^/]+)$/)
      const board = m && store.get(m[1])
      if (!board) return refuse(socket, '404 Not Found')
      if (!visible(grant, board.id)) return refuse(socket, '403 Forbidden')
      wss.handleUpgrade(req, socket, head, (ws) => onBoardSocket(ws, grant, board.id))
    })().catch(() => refuse(socket, '500 Internal Server Error'))
  })
  /** Pages on the server socket, and those of them that may approve connect requests. */
  const serverSockets = new Set<WebSocket>()
  const approvers = new Set<WebSocket>()
  const offAccess = access.onEvent((e) => {
    const msg = JSON.stringify(e satisfies WsMessage)
    for (const ws of e.type === 'access-changed' ? serverSockets : approvers) if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  })
  const presence = (id: string): WsMessage => ({ type: 'presence', author: 'agent', at: new Date().toISOString(), watching: store.watchers(id) > 0, agents: store.watcherNames(id), seen: store.watcherSeen(id) })
  const onBoardSocket = (ws: WebSocket, grant: Grant, boardId: string) => {
    const board = { id: boardId }
    {
      if (grant.kind === 'local') localSockets.add(ws)
      const send = (msg: WsMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg))
      send({ type: 'hello', board: viewOf(grant, store.get(board.id)!) })
      // Tell the person whether an agent (which ones) is currently waiting on this board.
      send(presence(board.id))
      const offChange = store.subscribe(board.id, (change) => send({ type: 'change', change: change.meta && grant.kind !== 'local' ? { ...change, meta: redactHolders(change.meta) } : change }))
      const offPresence = store.onPresence((id) => {
        if (id === board.id) send(presence(board.id))
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
    }
  }

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
            offAccess()
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

// ---- Query parameters of the agent-scale routes (docs/canvas.md "Reading big boards") ----

/** A repeatable or comma-separated list: `?types=event,hotspot` or `?types=event&types=hotspot`. */
function listParam(url: URL, k: string): string[] | undefined {
  const v = url.searchParams.getAll(k).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)
  return v.length ? v : undefined
}
function numParam(url: URL, k: string): number | undefined {
  const raw = url.searchParams.get(k)
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new HttpError(400, `${k} must be a number`)
  return n
}
const boolParam = (url: URL, k: string) => ['1', 'true', 'yes'].includes(url.searchParams.get(k) ?? '')

function readOptionsOf(url: URL): ReadOptions {
  const format = url.searchParams.get('format') ?? undefined
  if (format !== undefined && !['outline', 'json', 'summary'].includes(format)) throw new HttpError(400, 'format must be outline, json or summary')
  return {
    format: format as ReadFormat | undefined,
    frame: url.searchParams.get('frame') || undefined,
    types: listParam(url, 'types'),
    ids: listParam(url, 'ids'),
    text: url.searchParams.get('text') || undefined,
    fields: listParam(url, 'fields'),
    limit: numParam(url, 'limit'),
    cursor: url.searchParams.get('cursor') || undefined,
    maxChars: numParam(url, 'maxChars'),
  }
}

/** `?frame= &from= &kinds=` on changes / diff / wait; undefined when none is given. */
function changeFilterOf(url: URL): ChangeFilter | undefined {
  const frame = url.searchParams.get('frame') || undefined
  // who: agent names, person, studio (`by` is accepted as another spelling)
  const from = listParam(url, 'from') ?? listParam(url, 'by')
  const kinds = listParam(url, 'kinds')
  const bad = kinds?.filter((k) => !CHANGE_KINDS.includes(k as ChangeKind))
  if (bad?.length) throw new HttpError(400, `kinds must be among ${CHANGE_KINDS.join(', ')} (not ${bad.join(', ')})`)
  if (!frame && !from && !kinds) return undefined
  return { frame, from, kinds: kinds as ChangeKind[] | undefined }
}

/** The pure readers throw their own errors with a status; answer them as HTTP errors. */
function agentScale<T>(run: () => T): T {
  try {
    return run()
  } catch (e) {
    if (e instanceof ReadError || e instanceof SnapshotError || e instanceof LayoutError) throw new HttpError(e.status, e.message)
    const status = (e as { status?: unknown }).status
    if (typeof status === 'number') throw new HttpError(status, (e as Error).message)
    throw e
  }
}
