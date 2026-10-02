// HTTP routes for remote agents (docs/canvas.md "Remote agents"):
//   OAuth 2.1 for MCP clients — /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server,
//   /register (dynamic client registration), /authorize (approve-on-connect page, PKCE S256), /token
//   (authorization_code, refresh_token, device_code), /revoke, /device_authorization (agents without a browser);
//   signing a browser in from elsewhere — /api/access/me, /api/access/signin, /api/access/session, /api/access/signout;
//   the Connected agents page — /api/access/agents, /api/access/requests, /api/access/approve.
import type http from 'node:http'
import crypto from 'node:crypto'
import { clientIp, cookieOf, SESSION_COOKIE, type AccessService, type AuthResult, type Decision } from './access.js'
import type { Grant } from './accessPolicy.js'
import { isLocalRequest } from './projectsApi.js'

export interface AccessRouteContext {
  access: AccessService
  /** The address agents use: UNPROSE_PUBLIC_URL, else what the request says (tunnel headers first). */
  publicOrigin(req: http.IncomingMessage): string
  /** Projects a local approver can limit a grant to. */
  projects(): Array<{ id: string; name: string }>
  /** An agent was renamed: boards that name it (responder, file holders) follow (docs/canvas.md "Several agents on one board"). */
  onRename?(from: string, to: string): void
  /** What agents said about Unprose (`unprose_feedback`), for the agents page. */
  feedback?(): unknown[]
}

type Res = http.ServerResponse

const json = (res: Res, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

/** CORS for the endpoints MCP clients call from a browser (metadata, register, token). */
const cors = (res: Res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type, authorization, mcp-protocol-version')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
}

async function readRaw(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) {
    n += (c as Buffer).length
    if (n > limit) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** A form (application/x-www-form-urlencoded, what OAuth uses) or JSON body as a plain object. */
async function readForm(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(req)
  if (!raw.trim()) return {}
  if (/application\/json/i.test(req.headers['content-type'] ?? '')) {
    try {
      const j = JSON.parse(raw)
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

/** The request came from a page of this canvas (or from no browser at all) — not a cross-site form or fetch. */
export function sameOrigin(req: http.IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** The Host a page on this machine uses — not a DNS-rebinding name pointed at 127.0.0.1. */
export function loopbackHost(req: http.IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
}

/** A page on this machine, opened as localhost, asking from one of its own pages: the one-click approver. */
export function localPage(req: http.IncomingMessage, grant: Grant | undefined): boolean {
  return grant?.kind === 'local' && loopbackHost(req) && sameOrigin(req)
}

/** May this caller approve connect requests? (a page on this machine; a signed-in browser — with the code) */
const mayApprove = (req: http.IncomingMessage, g: Grant | undefined) => localPage(req, g) || (g?.as === 'browser' && sameOrigin(req))
/** May this caller create and revoke tokens? */
const mayManage = (req: http.IncomingMessage, g: Grant | undefined) => localPage(req, g) || (g?.as === 'browser' && g.manage && sameOrigin(req))

function sessionCookie(req: http.IncomingMessage, origin: string, value: string, maxAge: number): string {
  const secure = origin.startsWith('https:') || req.headers['x-forwarded-proto'] === 'https'
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function grantView(g: Grant | undefined) {
  return g ? { kind: g.kind, name: g.name, scope: g.scope, manage: g.manage, ...(g.as ? { as: g.as } : {}), ...(g.projects ? { projects: g.projects } : {}), ...(g.boards ? { boards: g.boards } : {}) } : null
}

/** The setup lines for a new token (shown once on the agents page). */
export function setupFor(origin: string, token: string, name: string) {
  const mcp = `${origin}/mcp`
  const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unprose'
  return {
    mcpUrl: mcp,
    claudeCode: `claude mcp add --transport http unprose ${mcp} --header "Authorization: Bearer ${token}"`,
    codex: `[mcp_servers.unprose]\nurl = "${mcp}"\nbearer_token_env_var = "UNPROSE_TOKEN"\n# and in your shell: export UNPROSE_TOKEN=${token}`,
    claudeAi: `${mcp}  (claude.ai → Settings → Connectors → Add custom connector; it connects with OAuth — no token needed, you approve it on the canvas)`,
    stdio: `AWD_CANVAS_URL=${origin} UNPROSE_TOKEN=${token} UNPROSE_AGENT_NAME=${id} node <unprose>/scripts/mcp.mjs`,
    json: JSON.stringify({ mcpServers: { unprose: { type: 'http', url: mcp, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  }
}

/**
 * Handle a remote-agents route; false when the path is not one of them. `auth` authenticates lazily (most of
 * these routes are public: they are how an agent or a browser gets credentials in the first place).
 */
export async function accessRoute(req: http.IncomingMessage, res: Res, url: URL, method: string, ctx: AccessRouteContext, auth: () => Promise<AuthResult>): Promise<boolean> {
  const p = url.pathname
  const { access } = ctx
  const origin = () => ctx.publicOrigin(req)

  // ── discovery (RFC 9728, RFC 8414) ──
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') {
    cors(res)
    if (method === 'OPTIONS') return void res.writeHead(204).end(), true
    json(res, 200, { resource: `${origin()}/mcp`, authorization_servers: [origin()], scopes_supported: ['read', 'write'], bearer_methods_supported: ['header'], resource_name: 'Unprose canvas', resource_documentation: `${origin()}/docs/canvas` })
    return true
  }
  if (p.startsWith('/.well-known/oauth-authorization-server') || p === '/.well-known/openid-configuration') {
    cors(res)
    if (method === 'OPTIONS') return void res.writeHead(204).end(), true
    const o = origin()
    json(res, 200, {
      issuer: o,
      authorization_endpoint: `${o}/authorize`,
      token_endpoint: `${o}/token`,
      registration_endpoint: `${o}/register`,
      revocation_endpoint: `${o}/revoke`,
      device_authorization_endpoint: `${o}/device_authorization`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'write'],
      service_documentation: `${o}/docs/canvas`,
    })
    return true
  }

  // ── dynamic client registration (RFC 7591) ──
  if (p === '/register') {
    cors(res)
    if (method === 'OPTIONS') return void res.writeHead(204).end(), true
    if (method !== 'POST') return json(res, 405, { error: 'method not allowed' }), true
    const body = await readForm(req)
    const r = access.registerClient(body, clientIp(req))
    if (!r.client) return json(res, r.status ?? 400, { error: r.status === 429 ? 'slow_down' : 'invalid_client_metadata', error_description: r.error }), true
    const c = r.client
    json(res, 201, { client_id: c.clientId, client_id_issued_at: Math.floor(Date.parse(c.createdAt) / 1000), client_name: c.name, redirect_uris: c.redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
    return true
  }

  // ── the approve-on-connect page ──
  if (p === '/authorize' && method === 'GET') {
    const q = url.searchParams
    const client = access.client(q.get('client_id'))
    const redirectUri = q.get('redirect_uri') ?? client?.redirectUris[0]
    // errors before the redirect URI is known to be the client's own are shown, never redirected (RFC 6749 §4.1.2.1)
    if (!client) return page(res, 400, errorPage('Unknown client', 'This connect link names a client the canvas does not know. Remove the connector in your agent and add it again.')), true
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) return page(res, 400, errorPage('Wrong return address', 'The redirect_uri is not one this client registered.')), true
    const back = (error: string, description: string) => {
      const u = new URL(redirectUri)
      u.searchParams.set('error', error)
      u.searchParams.set('error_description', description)
      if (q.get('state')) u.searchParams.set('state', q.get('state')!)
      res.writeHead(302, { location: u.toString() }).end()
      return true
    }
    if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'only response_type=code')
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.get('code_challenge') ?? '')) return back('invalid_request', 'PKCE with code_challenge_method=S256 is required')
    const r = access.startAuthorization({ client, redirectUri, state: q.get('state') ?? undefined, challenge: q.get('code_challenge')!, scope: q.get('scope'), ip: clientIp(req), userAgent: req.headers['user-agent'] })
    if (!r.pending) return page(res, 429, errorPage('Too many requests', r.error ?? 'try again later')), true
    const { grant } = await auth()
    const view = access.view(r.pending)
    const local = grant?.kind === 'local' && loopbackHost(req)
    page(res, 200, authorizePage({ id: r.pending.id, ref: r.pending.ref, code: r.pending.code, client: client.name, redirectHost: view.redirectHost ?? '', scope: view.scope, canvas: origin(), local, projects: local ? ctx.projects() : [] }))
    return true
  }
  if (p === '/authorize/status' && method === 'GET') {
    const r = access.poll(url.searchParams.get('id') ?? '')
    json(res, 200, { status: r.status, ...(r.redirect ? { redirect: r.redirect } : {}), ...(r.locked ? { locked: true } : {}) })
    return true
  }

  // ── tokens ──
  if (p === '/token') {
    cors(res)
    if (method === 'OPTIONS') return void res.writeHead(204).end(), true
    if (method !== 'POST') return json(res, 405, { error: 'invalid_request', error_description: 'POST only' }), true
    const b = await readForm(req)
    const r =
      b.grant_type === 'authorization_code'
        ? access.exchangeCode(b)
        : b.grant_type === 'refresh_token'
          ? access.refresh(b)
          : b.grant_type === 'urn:ietf:params:oauth:grant-type:device_code'
            ? access.pollDevice(b)
            : { error: 'unsupported_grant_type', description: 'authorization_code, refresh_token or device_code' }
    if (r.tokens) return json(res, 200, r.tokens, { pragma: 'no-cache' }), true
    json(res, 400, { error: r.error, ...(r.description ? { error_description: r.description } : {}) })
    return true
  }
  if (p === '/revoke') {
    cors(res)
    if (method === 'OPTIONS') return void res.writeHead(204).end(), true
    if (method !== 'POST') return json(res, 405, { error: 'invalid_request' }), true
    access.revokeToken((await readForm(req)).token)
    json(res, 200, {})
    return true
  }
  if (p === '/device_authorization') {
    cors(res)
    if (method === 'OPTIONS') return void res.writeHead(204).end(), true
    if (method !== 'POST') return json(res, 405, { error: 'invalid_request' }), true
    const b = await readForm(req)
    const r = access.startDevice({ name: b.client_name ?? b.name, scope: b.scope, ip: clientIp(req), userAgent: req.headers['user-agent'], clientId: typeof b.client_id === 'string' ? b.client_id : undefined })
    if (!r.pending) return json(res, 429, { error: 'slow_down', error_description: r.error }), true
    const o = origin()
    json(res, 200, {
      device_code: r.deviceCode,
      user_code: r.pending.code,
      verification_uri: `${o}/agents`,
      expires_in: 600,
      interval: 5,
      message: `Ask the person to open ${o}/agents (or any page of the canvas) and type the code ${r.pending.code}.`,
    })
    return true
  }

  // ── signing a browser in from elsewhere ──
  if (p === '/api/access/me' && method === 'GET') {
    const { grant } = await auth()
    const configured = process.env.UNPROSE_PUBLIC_URL?.replace(/\/+$/, '')
    json(res, 200, {
      grant: grantView(grant),
      signedIn: !!grant,
      local: isLocalRequest(req),
      remoteAuth: access.remoteAuth,
      canApprove: mayApprove(req, grant),
      canManage: mayManage(req, grant),
      oneClick: localPage(req, grant),
      publicUrl: configured || origin(),
    })
    return true
  }
  if (p === '/api/access/signin' && method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross-site request refused' }), true
    const r = access.startBrowser(clientIp(req), req.headers['user-agent'])
    if (!r.pending) return json(res, 429, { error: r.error }), true
    json(res, 200, { id: r.pending.id, code: r.pending.code, expiresAt: new Date(r.pending.expiresAt).toISOString() })
    return true
  }
  const signinPoll = /^\/api\/access\/signin\/([A-Za-z0-9_-]+)$/.exec(p)
  if (signinPoll && method === 'GET') {
    const r = access.poll(signinPoll[1])
    if (r.session) return json(res, 200, { status: 'approved' }, { 'set-cookie': sessionCookie(req, origin(), r.session, 365 * 86400) }), true
    json(res, 200, { status: r.status, ...(r.locked ? { locked: true } : {}) })
    return true
  }
  if (p === '/api/access/session' && method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross-site request refused' }), true
    const b = await readForm(req)
    const token = typeof b.token === 'string' ? b.token.trim() : ''
    const session = token ? access.sessionFromToken(token, clientIp(req), req.headers['user-agent']) : undefined
    if (!session) return json(res, 401, { error: 'this token is not valid (revoked, expired or mistyped)' }), true
    json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req, origin(), session, 365 * 86400) })
    return true
  }
  if (p === '/api/access/signout' && method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross-site request refused' }), true
    const s = cookieOf(req, SESSION_COOKIE)
    if (s) access.revokeSession(s)
    json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req, origin(), '', 0) })
    return true
  }

  // ── the Connected agents page ──
  if (!p.startsWith('/api/access/')) return false
  const { grant, error } = await auth()
  if (error) return json(res, 401, { error }), true
  if (!grant) return json(res, 401, { error: 'sign in first', signIn: true }), true
  if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'cross-site request refused' }), true

  if (p === '/api/access/requests' && method === 'GET') {
    if (!mayApprove(req, grant)) return json(res, 403, { error: 'only a page on the canvas machine or a signed-in page sees connect requests' }), true
    json(res, 200, { requests: access.pendingViews(), oneClick: localPage(req, grant) })
    return true
  }
  const decide = /^\/api\/access\/requests\/([A-Za-z0-9_-]+)$/.exec(p)
  if (decide && method === 'POST') {
    if (!mayApprove(req, grant)) return json(res, 403, { error: 'only a page on the canvas machine (opened as localhost) or a signed-in page can approve' }), true
    const b = (await readForm(req)) as Decision & Record<string, unknown>
    const approver: Grant = localPage(req, grant) ? grant : { ...grant, kind: grant.kind === 'local' ? 'open' : grant.kind }
    const allow = (b as Record<string, unknown>).allow
    const r = access.decide(decide[1], { allow: allow === true || allow === 'true', scope: b.scope, projects: b.projects, boards: b.boards, name: b.name, code: b.code, manage: b.manage === true }, approver)
    if (!r.ok) return json(res, r.http ?? 400, { error: r.error, ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}), ...(r.status ? { status: r.status } : {}) }), true
    json(res, 200, { status: r.status })
    return true
  }
  if (p === '/api/access/approve' && method === 'POST') {
    if (!mayApprove(req, grant)) return json(res, 403, { error: 'only a page on the canvas machine or a signed-in page can approve' }), true
    const b = (await readForm(req)) as Decision & Record<string, unknown>
    const approver: Grant = localPage(req, grant) ? grant : { ...grant, kind: grant.kind === 'local' ? 'open' : grant.kind }
    // the code is required here even on this machine: it is how the request is found
    const r = access.decideByCode(b.code, { scope: b.scope, projects: b.projects, boards: b.boards, name: b.name }, approver, grant.agentId ?? clientIp(req))
    if (!r.ok) return json(res, r.http ?? 400, { error: r.error, ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}) }), true
    json(res, 200, { status: r.status })
    return true
  }
  if (p === '/api/access/agents' && method === 'GET') {
    if (!mayApprove(req, grant)) return json(res, 403, { error: 'agent tokens cannot list the connected agents' }), true
    json(res, 200, { agents: access.list(), requests: access.pendingViews(), canManage: mayManage(req, grant), oneClick: localPage(req, grant), store: localPage(req, grant) ? access.storeWhere : undefined })
    return true
  }
  if (p === '/api/access/agents' && method === 'POST') {
    if (!mayManage(req, grant)) return json(res, 403, { error: 'tokens can only be made on a page opened on the canvas machine (http://localhost…)' }), true
    const b = await readForm(req)
    const r = access.createToken(b, localPage(req, grant) ? 'this machine' : grant.name)
    const o = typeof b.publicUrl === 'string' && /^https?:\/\//.test(b.publicUrl) ? b.publicUrl.replace(/\/+$/, '') : origin()
    json(res, 201, { agent: r.agent, token: r.token, setup: setupFor(o, r.token, r.agent.name) })
    return true
  }
  if (p === '/api/access/feedback' && method === 'GET') {
    if (!mayManage(req, grant)) return json(res, 403, { error: 'feedback is shown on a page opened on the canvas machine (or one allowed to manage agents)' }), true
    json(res, 200, { feedback: ctx.feedback?.() ?? [] })
    return true
  }
  const one = /^\/api\/access\/agents\/([A-Za-z0-9_-]+)$/.exec(p)
  if (one && (method === 'PATCH' || method === 'PUT')) {
    if (!mayManage(req, grant)) return json(res, 403, { error: 'agents can only be renamed on a page opened on the canvas machine (http://localhost…)' }), true
    const b = await readForm(req)
    const r = access.rename(one[1], b.name)
    if (!r) return json(res, 404, { error: 'no such agent (or revoked)' }), true
    if (r.from !== r.to) ctx.onRename?.(r.from, r.to)
    json(res, 200, { ok: true, from: r.from, name: r.to })
    return true
  }
  if (one && method === 'DELETE') {
    if (!mayManage(req, grant)) return json(res, 403, { error: 'tokens can only be revoked on a page opened on the canvas machine (http://localhost…)' }), true
    const ok = url.searchParams.get('forget') === '1' ? access.remove(one[1]) : access.revoke(one[1])
    if (!ok) return json(res, 404, { error: 'no such agent (or already revoked)' }), true
    json(res, 200, { ok: true })
    return true
  }
  json(res, 404, { error: 'not found' })
  return true
}

// ── pages ───────────────────────────────────────────────────────────────────────

function page(res: Res, status: number, html: { body: string; nonce: string }) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${html.nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  })
  res.end(html.body)
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const STYLE = `:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1f;--muted:#5f5f66;--line:#dedcd6;--accent:#1f56d6;--accent-ink:#fff;--ok:#12733a;--bad:#b42318;--code-bg:#efede8}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1e1e22;--ink:#ececef;--muted:#a3a3ad;--line:#33333a;--accent:#6b97ff;--accent-ink:#0b0b0d;--ok:#5cc98a;--bad:#ff8a80;--code-bg:#2a2a30}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:var(--card);border:1px solid var(--line);border-radius:12px;max-width:480px;width:100%;padding:28px}
h1{font-size:20px;margin:0 0 6px}p{margin:8px 0}.muted{color:var(--muted);font-size:13px}
.code{font:600 30px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;background:var(--code-bg);border-radius:8px;padding:14px;text-align:center;margin:16px 0;user-select:all}
.row{display:flex;gap:8px;margin-top:18px}button{font:inherit;border-radius:8px;padding:9px 16px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
fieldset{border:1px solid var(--line);border-radius:8px;margin:14px 0 0;padding:8px 12px}legend{font-size:13px;color:var(--muted);padding:0 4px}label{display:block;margin:4px 0}
.status{margin-top:14px;font-weight:600}.status.ok{color:var(--ok)}.status.bad{color:var(--bad)}code{background:var(--code-bg);padding:0 .3em;border-radius:4px}`

function errorPage(title: string, text: string) {
  const nonce = crypto.randomBytes(12).toString('base64')
  return { nonce, body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Unprose</title><style>${STYLE}</style><main><h1>${esc(title)}</h1><p>${esc(text)}</p></main>` }
}

/**
 * The page an agent's browser opens. On the canvas machine (opened as localhost) it approves with one click;
 * anywhere else it shows the pairing code to type into the canvas, and waits.
 */
function authorizePage(o: { id: string; ref: string; code: string; client: string; redirectHost: string; scope: string; canvas: string; local: boolean; projects: Array<{ id: string; name: string }> }) {
  const nonce = crypto.randomBytes(12).toString('base64')
  const projectBoxes = o.projects.map((pr) => `<label><input type="checkbox" name="project" value="${esc(pr.id)}"> ${esc(pr.name)}</label>`).join('')
  const localForm = `<fieldset><legend>Access</legend><label><input type="radio" name="scope" value="write"${o.scope === 'write' ? ' checked' : ''}> Read and draw</label><label><input type="radio" name="scope" value="read"${o.scope === 'read' ? ' checked' : ''}> Read only</label></fieldset>
${o.projects.length > 1 ? `<fieldset><legend>Projects (none ticked = all)</legend>${projectBoxes}</fieldset>` : ''}
<div class="row"><button class="primary" id="allow">Allow</button><button id="deny">Deny</button></div>`
  const remote = `<p>Type this code on the canvas to let it in:</p><div class="code" aria-label="Pairing code">${esc(o.code)}</div>
<p class="muted">Open the canvas (<code>${esc(o.canvas)}</code>) — every open page shows <strong>“${esc(o.client)} wants to connect”</strong> with a box for this code; or go to <strong>Connected agents → Enter a code</strong>. A page on the canvas machine can also just click Allow. The code works once and expires in 10 minutes.</p>`
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ${esc(o.client)} — Unprose</title><style>${STYLE}</style>
<main><h1>${esc(o.client)} wants to connect</h1>
<p>to the Unprose canvas at <code>${esc(o.canvas)}</code>${o.redirectHost ? `, and will return to <code>${esc(o.redirectHost)}</code>` : ''}. It asks to <strong>${o.scope === 'read' ? 'read your boards' : 'read and draw on your boards'}</strong>.</p>
${o.local ? localForm : remote}
<p class="status" id="status" role="status" aria-live="polite">${o.local ? '' : 'Waiting for approval…'}</p></main>
<script nonce="${nonce}">
const id=${JSON.stringify(o.id)};const ref=${JSON.stringify(o.local ? o.ref : '')};const st=document.getElementById('status');
const say=(t,c)=>{st.textContent=t;st.className='status '+(c||'')};
async function poll(){try{const r=await fetch('/authorize/status?id='+encodeURIComponent(id));const j=await r.json();
if(j.redirect){say(j.status==='approved'?'Approved — returning to the agent…':(j.locked?'Locked after too many wrong codes.':'Denied.'),j.status==='approved'?'ok':'bad');location.href=j.redirect;return}
if(j.status==='expired'||j.status==='unknown'){say('This request expired. Start connecting again from your agent.','bad');return}
if(j.status==='approved'){say('Approved.','ok');return}}catch(e){}setTimeout(poll,1500)}
poll();
const allow=document.getElementById('allow');
if(allow){const send=async(ok)=>{const scope=(document.querySelector('input[name=scope]:checked')||{}).value||'write';const projects=[...document.querySelectorAll('input[name=project]:checked')].map(i=>i.value);
const r=await fetch('/api/access/requests/'+encodeURIComponent(ref),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({allow:ok,scope,projects})});
if(!r.ok){const j=await r.json().catch(()=>({}));say(j.error||('HTTP '+r.status),'bad')}else say(ok?'Approved — returning to the agent…':'Denied.',ok?'ok':'bad')};
allow.onclick=()=>send(true);document.getElementById('deny').onclick=()=>send(false)}
</script>`
  return { nonce, body }
}
