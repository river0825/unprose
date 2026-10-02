// Remote agents (docs/canvas.md "Remote agents"): who is calling, the tokens the person made in the page,
// OAuth 2.1 for MCP clients (dynamic registration, approve-on-connect, PKCE, refresh), the device flow for
// agents without a browser (RFC 8628), and browsers let in from elsewhere. The rules are in accessPolicy.ts;
// this keeps the state: the AccessStore (hashes only) and, in memory, pending requests and codes — both
// expire after 10 minutes.
//
// Approving a request: a page on this machine approves with one click. Any other page must be signed in
// (a browser session) AND type the one-time pairing code the requester shows — knowing it proves the person
// is looking at the agent. Five wrong codes lock the request.
import type http from 'node:http'
import crypto from 'node:crypto'
import type { AccessRequestView } from './model.js'
import type { AccessData, AccessStore, AgentRecord, OAuthClientRecord } from './ports/accessStore.js'
import { cleanName, hashSecret, LOCAL_GRANT, newSecret, normalizeCode, OPEN_GRANT, pairingCode, pkceMatches, redirectUriOk, sameCode, sameHash, scopeFrom, type Grant, type Scope } from './accessPolicy.js'
import { isLocalRequest } from './projectsApi.js'

export const SESSION_COOKIE = 'unprose_session'
const TEN_MIN = 10 * 60_000
const ACCESS_TTL_S = 3600
const MAX_PENDING_PER_IP = 3
const MAX_PENDING = 20
const MAX_REGISTER_PER_IP_HOUR = 20
const MAX_CLIENTS = 500
/** Wrong pairing codes for one request before it is locked. */
export const MAX_CODE_ATTEMPTS = 5
/** Wrong codes typed without picking a request, per approver, per 10 minutes. */
const MAX_LOOSE_ATTEMPTS = 10
const DEVICE_INTERVAL_S = 5

/** What a page may see of an agent record: never a hash. */
export interface AgentView {
  id: string
  name: string
  via: AgentRecord['via']
  scope: Scope
  projects?: string[]
  boards?: string[]
  manage?: boolean
  createdAt: string
  createdBy: string
  lastUsedAt?: string
  lastIp?: string
  lastUserAgent?: string
  revokedAt?: string
  clientId?: string
  /** OAuth: the client's own name. */
  clientName?: string
}

export interface Decision {
  allow: boolean
  scope?: Scope
  projects?: string[]
  boards?: string[]
  /** The name the agent will carry (default: the client's name). */
  name?: string
  /** The pairing code the requester shows (required unless the approver is on this machine). */
  code?: string
  /** A browser session may also create / revoke tokens (only a page on this machine can grant it). */
  manage?: boolean
}

type Status = 'pending' | 'approved' | 'denied' | 'expired'

interface Pending {
  /** Secret: only the requester has it (its page polls with it). */
  id: string
  /** What approving pages use to name the request — never the secret id. */
  ref: string
  via: 'oauth' | 'device' | 'browser'
  name: string
  /** The pairing code, shown only to the requester. */
  code: string
  attempts: number
  locked?: boolean
  scope: Scope
  ip: string
  userAgent?: string
  createdAt: number
  expiresAt: number
  status: Status
  // OAuth
  clientId?: string
  redirectUri?: string
  state?: string
  challenge?: string
  // device flow
  deviceHash?: string
  lastPoll?: number
  // set on approval
  decision?: { scope: Scope; projects?: string[]; boards?: string[]; name: string; by: string; manage: boolean }
  /** OAuth: the authorization code (hash), single use, 10 minutes. */
  codeHash?: string
  codeExpiresAt?: number
  /** browser / device: the session or token was handed out (once). */
  claimed?: boolean
}

export type AccessEvent =
  | { type: 'access-request'; request: AccessRequestView }
  | { type: 'access-resolved'; id: string; status: 'approved' | 'denied' | 'expired' }
  | { type: 'access-changed'; at: string }

export interface AccessOptions {
  store: AccessStore
  /** Requests from elsewhere need credentials (default true). false = the old open canvas (UNPROSE_REMOTE_AUTH=off). */
  remoteAuth?: boolean
  now?: () => number
}

export interface AuthResult {
  grant?: Grant
  /** Credentials were presented but are not valid (401 even from this machine). */
  error?: string
}

export interface DecideResult {
  ok: boolean
  status?: Status
  error?: string
  /** HTTP status for a refusal. */
  http?: number
  /** Wrong codes left before the request locks. */
  attemptsLeft?: number
}

/** The caller's address for logs and the agents page: the tunnel's client IP header first. */
export function clientIp(req: http.IncomingMessage): string {
  const h = (n: string) => {
    const v = req.headers[n]
    return (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim()
  }
  return h('cf-connecting-ip') || h('true-client-ip') || h('x-forwarded-for') || h('x-real-ip') || req.socket.remoteAddress || 'unknown'
}

export function cookieOf(req: http.IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

const shortUa = (ua?: string) => {
  if (!ua) return 'A browser'
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return `${b}${os ? ` on ${os}` : ''}`
}

export class AccessService {
  private data: AccessData
  private pending = new Map<string, Pending>()
  private registrations = new Map<string, number[]>()
  private looseFailures = new Map<string, number[]>()
  private internal = new Map<string, Grant>()
  private listeners = new Set<(e: AccessEvent) => void>()
  private lastPersist = new Map<string, number>()
  readonly remoteAuth: boolean
  private now: () => number

  constructor(private opts: AccessOptions) {
    this.data = opts.store.read()
    this.remoteAuth = opts.remoteAuth !== false
    this.now = opts.now ?? Date.now
  }

  get storeWhere() {
    return this.opts.store.where
  }

  onEvent(fn: (e: AccessEvent) => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  private emit(e: AccessEvent) {
    for (const fn of this.listeners) {
      try {
        fn(e)
      } catch {
        // a broken listener never breaks a request
      }
    }
  }
  private save() {
    this.opts.store.write(this.data)
  }
  private iso(t = this.now()) {
    return new Date(t).toISOString()
  }

  // ── who is calling ──────────────────────────────────────────────────────────

  async authenticate(req: http.IncomingMessage): Promise<AuthResult> {
    const authz = req.headers.authorization
    if (authz) {
      const m = /^Bearer\s+(\S+)\s*$/i.exec(authz)
      if (!m) return { error: 'the Authorization header must be "Bearer <token>"' }
      const internal = this.internal.get(m[1])
      if (internal) return { grant: internal }
      const rec = this.byToken(m[1])
      if (!rec) return { error: 'this access token is not valid (revoked, expired or never issued) — make a new one on the canvas: Connected agents' }
      this.touch(rec, req)
      return { grant: this.grantOf(rec) }
    }
    const session = cookieOf(req, SESSION_COOKIE)
    if (session) {
      const rec = this.byToken(session)
      if (rec) {
        this.touch(rec, req)
        return { grant: this.grantOf(rec) }
      }
    }
    if (isLocalRequest(req)) return { grant: LOCAL_GRANT }
    if (!this.remoteAuth) return { grant: OPEN_GRANT }
    return {}
  }

  /** A secret that stands for `grant` while an in-process client calls the API on its behalf (the /mcp endpoint). */
  mintInternal(grant: Grant): { secret: string; release: () => void } {
    const secret = `unpi_${crypto.randomBytes(24).toString('base64url')}`
    this.internal.set(secret, grant)
    return { secret, release: () => void this.internal.delete(secret) }
  }

  private byToken(secret: string): AgentRecord | undefined {
    const h = hashSecret(secret)
    let hit: AgentRecord | undefined
    // every record is compared (constant time per comparison), so the time does not depend on which matched
    for (const r of this.data.agents) if (r.tokenHash && sameHash(r.tokenHash, h)) hit = r
    if (!hit || hit.revokedAt) return undefined
    if (hit.expiresAt && Date.parse(hit.expiresAt) < this.now()) return undefined
    return hit
  }

  private grantOf(r: AgentRecord): Grant {
    const browser = r.via === 'browser'
    return {
      kind: browser ? 'person' : 'agent',
      name: r.name,
      scope: r.scope,
      ...(r.projects?.length ? { projects: r.projects } : {}),
      ...(r.boards?.length ? { boards: r.boards } : {}),
      manage: browser && !!r.manage,
      agentId: r.id,
      as: browser ? 'browser' : 'agent',
    }
  }

  private touch(r: AgentRecord, req: http.IncomingMessage) {
    const first = !r.lastUsedAt
    r.lastUsedAt = this.iso()
    r.lastIp = clientIp(req)
    const ua = req.headers['user-agent']
    if (typeof ua === 'string') r.lastUserAgent = ua.slice(0, 200)
    // last-used is written at most once a minute per record
    const last = this.lastPersist.get(r.id) ?? 0
    if (first || this.now() - last > 60_000) {
      this.lastPersist.set(r.id, this.now())
      this.save()
      if (first) this.emit({ type: 'access-changed', at: this.iso() })
    }
  }

  // ── the agents page ─────────────────────────────────────────────────────────

  list(): AgentView[] {
    const clientName = (id?: string) => this.data.clients.find((c) => c.clientId === id)?.name
    return this.data.agents
      .map((r) => ({
        id: r.id,
        name: r.name,
        via: r.via,
        scope: r.scope,
        ...(r.projects?.length ? { projects: r.projects } : {}),
        ...(r.boards?.length ? { boards: r.boards } : {}),
        ...(r.manage ? { manage: true } : {}),
        createdAt: r.createdAt,
        createdBy: r.createdBy,
        lastUsedAt: r.lastUsedAt,
        lastIp: r.lastIp,
        lastUserAgent: r.lastUserAgent,
        revokedAt: r.revokedAt,
        ...(r.clientId ? { clientId: r.clientId, clientName: clientName(r.clientId) } : {}),
      }))
      .sort((a, b) => (a.revokedAt ? 1 : 0) - (b.revokedAt ? 1 : 0) || b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * A unique name among live records: `name`, else `name-2`, `name-3` … ('agent' and 'user' are taken by the roles;
   * 'studio', 'any' and 'me' mean something in "Answered by" and @mentions).
   */
  private uniqueName(name: string, except?: string): string {
    const taken = new Set(['agent', 'user', 'studio', 'any', 'me', ...this.data.agents.filter((r) => !r.revokedAt && r.id !== except).map((r) => r.name.toLowerCase())])
    if (!taken.has(name.toLowerCase())) return name
    for (let i = 2; ; i++) if (!taken.has(`${name}-${i}`.toLowerCase())) return `${name}-${i}`
  }

  private addRecord(r: Omit<AgentRecord, 'id' | 'createdAt'>): AgentRecord {
    const rec: AgentRecord = { id: `ag_${crypto.randomBytes(9).toString('base64url')}`, createdAt: this.iso(), ...r, name: this.uniqueName(r.name) }
    this.data.agents.push(rec)
    this.save()
    this.emit({ type: 'access-changed', at: this.iso() })
    return rec
  }

  private view_(id: string): AgentView {
    return this.list().find((a) => a.id === id)!
  }

  /** A static access token made in the page; the secret is returned once and never stored. */
  createToken(input: { name?: unknown; scope?: unknown; projects?: unknown; boards?: unknown }, createdBy: string): { agent: AgentView; token: string } {
    const token = newSecret('unp')
    const rec = this.addRecord({ name: cleanName(input.name, 'agent'), via: 'token', scope: input.scope === 'read' ? 'read' : 'write', ...limits(input), tokenHash: hashSecret(token), createdBy })
    return { agent: this.view_(rec.id), token }
  }

  /**
   * Rename an agent (or a browser session): the name its changes are signed with from now on, and the one people
   * @mention. Earlier changes keep the name they were made with. Returns the old and the new (unique) name.
   */
  rename(id: string, raw: unknown): { from: string; to: string } | undefined {
    const r = this.data.agents.find((a) => a.id === id && !a.revokedAt)
    if (!r) return undefined
    const from = r.name
    const to = this.uniqueName(cleanName(raw, r.name), r.id)
    if (to === from) return { from, to }
    r.name = to
    this.save()
    this.emit({ type: 'access-changed', at: this.iso() })
    return { from, to }
  }

  revoke(id: string): boolean {
    const r = this.data.agents.find((a) => a.id === id)
    if (!r || r.revokedAt) return false
    r.revokedAt = this.iso()
    r.refreshHash = undefined
    this.save()
    this.emit({ type: 'access-changed', at: this.iso() })
    return true
  }

  /** Forget a revoked record entirely. */
  remove(id: string): boolean {
    const i = this.data.agents.findIndex((a) => a.id === id && a.revokedAt)
    if (i < 0) return false
    this.data.agents.splice(i, 1)
    this.save()
    this.emit({ type: 'access-changed', at: this.iso() })
    return true
  }

  // ── OAuth 2.1: clients ──────────────────────────────────────────────────────

  registerClient(body: Record<string, unknown>, ip: string): { client?: OAuthClientRecord; error?: string; status?: number } {
    const t = this.now()
    const recent = (this.registrations.get(ip) ?? []).filter((x) => t - x < 3600_000)
    if (recent.length >= MAX_REGISTER_PER_IP_HOUR) return { error: 'too many client registrations from this address; try again later', status: 429 }
    const uris = body.redirect_uris
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(redirectUriOk)) {
      return { error: 'redirect_uris must be 1–10 https URLs (http only for localhost)', status: 400 }
    }
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
      return { error: 'only public clients (token_endpoint_auth_method "none", with PKCE) are supported', status: 400 }
    }
    recent.push(t)
    this.registrations.set(ip, recent)
    const client: OAuthClientRecord = { clientId: `unpc_${crypto.randomBytes(16).toString('base64url')}`, name: cleanName(body.client_name, 'MCP client'), redirectUris: uris as string[], createdAt: this.iso() }
    this.data.clients.push(client)
    // keep the list bounded: drop the oldest clients that never got a token
    if (this.data.clients.length > MAX_CLIENTS) {
      const used = new Set(this.data.agents.map((a) => a.clientId))
      const drop = new Set(this.data.clients.filter((c) => !used.has(c.clientId)).slice(0, this.data.clients.length - MAX_CLIENTS))
      this.data.clients = this.data.clients.filter((c) => !drop.has(c))
    }
    this.save()
    return { client }
  }

  client(id: unknown): OAuthClientRecord | undefined {
    return typeof id === 'string' ? this.data.clients.find((c) => c.clientId === id) : undefined
  }

  // ── pending requests ─────────────────────────────────────────────────────────

  private sweep() {
    const t = this.now()
    for (const p of this.pending.values()) {
      if (p.status === 'pending' && p.expiresAt < t) {
        p.status = 'expired'
        this.emit({ type: 'access-resolved', id: p.ref, status: 'expired' })
      }
      // forget finished requests once neither their code nor their page can still use them
      if (p.status !== 'pending' && Math.max(p.expiresAt, p.codeExpiresAt ?? 0) + TEN_MIN < t) this.pending.delete(p.id)
    }
  }

  private open(p: Omit<Pending, 'id' | 'ref' | 'code' | 'attempts' | 'createdAt' | 'expiresAt' | 'status'>): { pending?: Pending; error?: string } {
    this.sweep()
    const live = [...this.pending.values()].filter((x) => x.status === 'pending')
    if (live.length >= MAX_PENDING) return { error: 'too many connect requests are waiting; try again in a few minutes' }
    if (live.filter((x) => x.ip === p.ip).length >= MAX_PENDING_PER_IP) return { error: 'too many connect requests from this address are waiting; try again in a few minutes' }
    const t = this.now()
    let code = pairingCode()
    while (live.some((x) => x.code === code)) code = pairingCode()
    const pending: Pending = { ...p, id: crypto.randomBytes(18).toString('base64url'), ref: `rq_${crypto.randomBytes(12).toString('base64url')}`, code, attempts: 0, createdAt: t, expiresAt: t + TEN_MIN, status: 'pending' }
    this.pending.set(pending.id, pending)
    this.emit({ type: 'access-request', request: this.view(pending) })
    return { pending }
  }

  view(p: Pending): AccessRequestView {
    let redirectHost: string | undefined
    try {
      redirectHost = p.redirectUri ? new URL(p.redirectUri).host : undefined
    } catch {
      redirectHost = undefined
    }
    return {
      id: p.ref,
      via: p.via,
      name: p.name,
      ...(redirectHost ? { redirectHost } : {}),
      scope: p.scope,
      ip: p.ip,
      ...(p.userAgent ? { userAgent: p.userAgent.slice(0, 200) } : {}),
      createdAt: this.iso(p.createdAt),
      expiresAt: this.iso(p.expiresAt),
    }
  }

  /** Requests waiting for a decision (for a page that may approve). */
  pendingViews(): AccessRequestView[] {
    this.sweep()
    return [...this.pending.values()].filter((p) => p.status === 'pending').map((p) => this.view(p))
  }

  /** A request by its secret id (the requester polling). */
  request(id: string): Pending | undefined {
    this.sweep()
    return this.pending.get(id)
  }

  /** A request by the ref approving pages know it by. */
  byRef(ref: string): Pending | undefined {
    this.sweep()
    for (const p of this.pending.values()) if (p.ref === ref) return p
    return undefined
  }

  /** GET /authorize: an MCP client asks to connect. Reloading the page reuses the request (same client, PKCE challenge and state). */
  startAuthorization(a: { client: OAuthClientRecord; redirectUri: string; state?: string; challenge: string; scope: unknown; ip: string; userAgent?: string }) {
    this.sweep()
    const same = [...this.pending.values()].find((x) => x.status === 'pending' && x.clientId === a.client.clientId && x.challenge === a.challenge && x.state === a.state && x.redirectUri === a.redirectUri)
    if (same) return { pending: same }
    return this.open({ via: 'oauth', name: a.client.name, scope: scopeFrom(a.scope), ip: a.ip, userAgent: a.userAgent, clientId: a.client.clientId, redirectUri: a.redirectUri, state: a.state, challenge: a.challenge })
  }

  /** POST /device_authorization: an agent without a browser asks to connect (RFC 8628). */
  startDevice(a: { name: unknown; scope: unknown; ip: string; userAgent?: string; clientId?: string }): { pending?: Pending; deviceCode?: string; error?: string } {
    const deviceCode = newSecret('unpc')
    const r = this.open({ via: 'device', name: cleanName(a.name, 'agent'), scope: scopeFrom(a.scope), ip: a.ip, userAgent: a.userAgent, clientId: a.clientId, deviceHash: hashSecret(deviceCode) })
    return r.pending ? { pending: r.pending, deviceCode } : { error: r.error }
  }

  /** A browser reached from elsewhere asks to be let in. */
  startBrowser(ip: string, userAgent?: string) {
    return this.open({ via: 'browser', name: `${shortUa(userAgent)} (${ip})`, scope: 'write', ip, userAgent })
  }

  /**
   * Allow or deny a pending request. A page on this machine (`approver.kind === 'local'`) needs no code; a
   * signed-in browser must type the requester's pairing code to allow (denying needs none), and may grant at
   * most its own scope and projects. Five wrong codes lock the request.
   */
  decide(ref: string, d: Decision, approver: Grant): DecideResult {
    const p = this.byRef(ref)
    if (!p) return { ok: false, error: 'no such request (it may have expired)', http: 404 }
    if (p.status !== 'pending') return { ok: false, error: p.locked ? 'this request was locked after too many wrong codes — the agent has to connect again' : `this request was already ${p.status}`, status: p.status, http: 409 }
    const local = approver.kind === 'local'
    if (!local && approver.as !== 'browser') return { ok: false, error: 'only a page on the canvas machine or a signed-in page can approve', http: 403 }
    if (!d.allow) return this.finish(p, 'denied')
    if (!local) {
      const typed = normalizeCode(d.code)
      if (!typed || !sameCode(typed, p.code)) {
        p.attempts++
        if (p.attempts >= MAX_CODE_ATTEMPTS) {
          p.locked = true
          this.finish(p, 'denied')
          return { ok: false, error: `wrong code — the request is now locked after ${MAX_CODE_ATTEMPTS} wrong codes; the agent has to connect again`, status: 'denied', http: 403, attemptsLeft: 0 }
        }
        return { ok: false, error: `wrong code (${MAX_CODE_ATTEMPTS - p.attempts} tries left) — type the code the agent shows`, http: 403, attemptsLeft: MAX_CODE_ATTEMPTS - p.attempts }
      }
    }
    // an approver never hands out more than it has
    let scope: Scope = d.scope === 'read' ? 'read' : d.scope === 'write' ? 'write' : p.scope
    if (approver.scope === 'read') scope = 'read'
    let lim = limits(d)
    if (approver.projects?.length) lim = { ...lim, projects: lim.projects?.filter((x) => approver.projects!.includes(x)) ?? approver.projects }
    if (approver.boards?.length) lim = { ...lim, boards: lim.boards?.filter((x) => approver.boards!.includes(x)) ?? approver.boards }
    if (lim.projects && !lim.projects.length) return { ok: false, error: 'none of those projects are yours to give', http: 403 }
    p.decision = { scope, ...lim, name: cleanName(d.name, p.name), by: local ? 'this machine' : approver.name, manage: local && p.via === 'browser' && !!d.manage }
    return this.finish(p, 'approved')
  }

  /** Approve by the code alone (the agents page's "Enter a code" box): the request whose code it is. */
  decideByCode(typedCode: unknown, d: Omit<Decision, 'code' | 'allow'>, approver: Grant, who: string): DecideResult {
    const t = this.now()
    const recent = (this.looseFailures.get(who) ?? []).filter((x) => t - x < TEN_MIN)
    if (recent.length >= MAX_LOOSE_ATTEMPTS) return { ok: false, error: 'too many wrong codes — wait ten minutes', http: 429 }
    const typed = normalizeCode(typedCode)
    this.sweep()
    const live = [...this.pending.values()].filter((x) => x.status === 'pending')
    const p = typed ? live.find((x) => sameCode(x.code, typed)) : undefined
    if (!p) {
      recent.push(t)
      this.looseFailures.set(who, recent)
      return { ok: false, error: typed ? 'no connect request has this code (it may have expired)' : 'a code has 8 letters and digits, like ABCD-EFGH', http: 404 }
    }
    return this.decide(p.ref, { ...d, allow: true, code: typed }, approver)
  }

  private finish(p: Pending, status: 'approved' | 'denied'): DecideResult {
    p.status = status
    this.emit({ type: 'access-resolved', id: p.ref, status })
    return { ok: true, status }
  }

  /**
   * The requester's view of its request (the authorize page / sign-in page polls it with the request id it
   * was given). An approved OAuth request yields the redirect with a single-use code; an approved browser
   * request yields a session secret once (the server sets it as a cookie).
   */
  poll(id: string): { status: Status | 'unknown'; code?: string; redirect?: string; session?: string; locked?: boolean; expiresAt?: string } {
    const p = this.request(id)
    if (!p || p.via === 'device') return { status: 'unknown' }
    if (p.status === 'denied' && p.via === 'oauth') return { status: 'denied', locked: !!p.locked, redirect: withParams(p.redirectUri!, { error: 'access_denied', error_description: p.locked ? 'too many wrong pairing codes' : 'the person denied the connection', state: p.state }) }
    if (p.status !== 'approved') return { status: p.status, locked: !!p.locked, ...(p.status === 'pending' ? { code: p.code, expiresAt: this.iso(p.expiresAt) } : {}) }
    if (p.via === 'oauth') {
      if (p.codeHash || p.claimed) return { status: 'approved' }
      p.claimed = true
      const code = newSecret('unpc')
      p.codeHash = hashSecret(code)
      p.codeExpiresAt = this.now() + TEN_MIN
      return { status: 'approved', redirect: withParams(p.redirectUri!, { code, state: p.state }) }
    }
    if (p.claimed) return { status: 'approved' }
    p.claimed = true
    const session = newSecret('unps')
    const d = p.decision!
    this.addRecord({ name: d.name, via: 'browser', scope: d.scope, ...limits(d), ...(d.manage ? { manage: true } : {}), tokenHash: hashSecret(session), createdBy: d.by, lastIp: p.ip, lastUserAgent: p.userAgent })
    return { status: 'approved', session }
  }

  // ── OAuth 2.1: tokens ───────────────────────────────────────────────────────

  private issue(rec: AgentRecord) {
    const access = newSecret('unp')
    const refresh = newSecret('unpr')
    rec.tokenHash = hashSecret(access)
    rec.refreshHash = hashSecret(refresh)
    rec.expiresAt = this.iso(this.now() + ACCESS_TTL_S * 1000)
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: rec.scope }
  }

  exchangeCode(b: { code?: unknown; code_verifier?: unknown; client_id?: unknown; redirect_uri?: unknown }): TokenResult {
    if (typeof b.code !== 'string' || typeof b.code_verifier !== 'string') return { error: 'invalid_request', description: 'code and code_verifier are required' }
    const h = hashSecret(b.code)
    let p: Pending | undefined
    for (const x of this.pending.values()) if (x.codeHash && sameHash(x.codeHash, h)) p = x
    if (!p || !p.decision) return { error: 'invalid_grant', description: 'unknown or already used code' }
    // single use, whatever happens next
    p.codeHash = undefined
    if ((p.codeExpiresAt ?? 0) < this.now()) return { error: 'invalid_grant', description: 'the code expired' }
    if (b.client_id !== undefined && b.client_id !== p.clientId) return { error: 'invalid_grant', description: 'the code was issued to another client' }
    if (b.redirect_uri !== undefined && b.redirect_uri !== p.redirectUri) return { error: 'invalid_grant', description: 'redirect_uri does not match' }
    if (!p.challenge || !pkceMatches(b.code_verifier, p.challenge)) return { error: 'invalid_grant', description: 'PKCE verification failed' }
    const d = p.decision
    const rec = this.addRecord({ name: d.name, via: 'oauth', scope: d.scope, ...limits(d), tokenHash: '', clientId: p.clientId, createdBy: d.by, lastIp: p.ip, lastUserAgent: p.userAgent })
    const tokens = this.issue(rec)
    this.save()
    return { tokens }
  }

  refresh(b: { refresh_token?: unknown; client_id?: unknown }): TokenResult {
    if (typeof b.refresh_token !== 'string') return { error: 'invalid_request', description: 'refresh_token is required' }
    const h = hashSecret(b.refresh_token)
    let rec: AgentRecord | undefined
    for (const r of this.data.agents) if (r.refreshHash && sameHash(r.refreshHash, h)) rec = r
    if (!rec || rec.revokedAt) return { error: 'invalid_grant', description: 'unknown or revoked refresh token' }
    if (b.client_id !== undefined && b.client_id !== rec.clientId) return { error: 'invalid_grant', description: 'the token was issued to another client' }
    const tokens = this.issue(rec)
    this.save()
    return { tokens }
  }

  /** RFC 8628 §3.4: the agent polls with its device code. The token (no expiry, revocable) is handed out once. */
  pollDevice(b: { device_code?: unknown }): TokenResult {
    if (typeof b.device_code !== 'string') return { error: 'invalid_request', description: 'device_code is required' }
    const h = hashSecret(b.device_code)
    this.sweep()
    let p: Pending | undefined
    for (const x of this.pending.values()) if (x.deviceHash && sameHash(x.deviceHash, h)) p = x
    if (!p) return { error: 'expired_token', description: 'unknown or expired device code — connect again' }
    const t = this.now()
    const fast = p.lastPoll !== undefined && t - p.lastPoll < (DEVICE_INTERVAL_S - 1) * 1000
    p.lastPoll = t
    if (p.status === 'expired') return { error: 'expired_token', description: 'nobody approved it within 10 minutes — connect again' }
    if (p.status === 'denied') return { error: 'access_denied', description: p.locked ? 'locked after too many wrong pairing codes' : 'the person denied the connection' }
    if (p.status === 'pending') return fast ? { error: 'slow_down' } : { error: 'authorization_pending', description: `waiting for the person to type ${p.code} on the canvas` }
    if (p.claimed) return { error: 'invalid_grant', description: 'the token for this request was already issued' }
    p.claimed = true
    const token = newSecret('unp')
    const d = p.decision!
    this.addRecord({ name: d.name, via: 'device', scope: d.scope, ...limits(d), tokenHash: hashSecret(token), createdBy: d.by, lastIp: p.ip, lastUserAgent: p.userAgent })
    return { tokens: { access_token: token, token_type: 'Bearer', scope: d.scope } }
  }

  /** RFC 7009: revoke the record an access or refresh token belongs to. */
  revokeToken(token: unknown): void {
    if (typeof token !== 'string') return
    const h = hashSecret(token)
    const rec = this.data.agents.find((r) => (r.tokenHash && sameHash(r.tokenHash, h)) || (r.refreshHash ? sameHash(r.refreshHash, h) : false))
    if (rec) this.revoke(rec.id)
  }

  /**
   * Sign a browser in with a pasted token: a new browser session with the token's scope and limits (never
   * `manage`), so the person's page acts as a person — not as the agent the token belongs to.
   */
  sessionFromToken(token: string, ip: string, userAgent?: string): string | undefined {
    const rec = this.byToken(token)
    if (!rec) return undefined
    const session = newSecret('unps')
    this.addRecord({ name: `${shortUa(userAgent)} (with ${rec.name}'s token)`, via: 'browser', scope: rec.scope, ...limits(rec), tokenHash: hashSecret(session), createdBy: rec.name, lastIp: ip, lastUserAgent: userAgent?.slice(0, 200) })
    return session
  }

  /** Sign out: a browser session forgets itself. */
  revokeSession(secret: string): void {
    const rec = this.byToken(secret)
    if (rec?.via === 'browser') this.revoke(rec.id)
  }
}

export interface TokenResult {
  tokens?: { access_token: string; token_type: string; expires_in?: number; refresh_token?: string; scope: Scope }
  error?: string
  description?: string
}

function strings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(x)))]
  return out.length ? out : undefined
}

function limits(x: { projects?: unknown; boards?: unknown }): { projects?: string[]; boards?: string[] } {
  const projects = strings(x.projects)
  const boards = strings(x.boards)
  return { ...(projects ? { projects } : {}), ...(boards ? { boards } : {}) }
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v)
  return u.toString()
}
