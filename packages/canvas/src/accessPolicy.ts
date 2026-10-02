// Who may do what on the canvas (docs/canvas.md "Remote agents"). Pure: no IO — secrets are hashed with
// node:crypto (hashing, not IO), everything else is plain data so every rule is testable.
//
// A request is judged by the credentials it presents first, by where it comes from second:
//   a Bearer token / session cookie → that agent or signed-in browser, wherever the request comes from;
//   no credentials and on this machine (loopback, no forwarding headers) → the owner ("local");
//   no credentials from anywhere else → nobody, unless remote auth is turned off ("open", the old behaviour).
import crypto from 'node:crypto'

export type Scope = 'read' | 'write'

/** How a caller got in. */
export type GrantKind = 'local' | 'agent' | 'person' | 'open'

export interface Grant {
  kind: GrantKind
  /** Shown in the change feed and presence: the agent's or browser session's name; 'agent' by default. */
  name: string
  scope: Scope
  /** Only these projects (ids); absent = every project. */
  projects?: string[]
  /** Only these boards (ids); absent = every board (of the allowed projects). */
  boards?: string[]
  /** May create / revoke tokens (a page on this machine, or a browser session granted it there). */
  manage: boolean
  /** The agent record behind a token or session (absent for local / open callers). */
  agentId?: string
  /** 'browser' for a person signed in with a session cookie; 'agent' for an MCP client; absent otherwise. */
  as?: 'agent' | 'browser'
}

export const LOCAL_GRANT: Grant = { kind: 'local', name: 'agent', scope: 'write', manage: true }
export const OPEN_GRANT: Grant = { kind: 'open', name: 'agent', scope: 'write', manage: false }

/** May this caller see a board stored in `project`? */
export function canSeeBoard(g: Grant, boardId: string, project: string): boolean {
  if (g.boards?.length && !g.boards.includes(boardId)) return false
  if (g.projects?.length && !g.projects.includes(project)) {
    // a board named explicitly is visible even when its project is not listed
    return !!g.boards?.length && g.boards.includes(boardId)
  }
  return true
}

/** May this caller see a project in the project list? */
export function canSeeProject(g: Grant, project: string): boolean {
  return !g.projects?.length || g.projects.includes(project)
}

export const canWrite = (g: Grant) => g.scope === 'write'

/** Is the grant limited to some projects or boards? */
export const isLimited = (g: Grant) => !!(g.projects?.length || g.boards?.length)

/** Where a new board goes for this caller: the project it asked for, if allowed; else its first allowed project. */
export function projectForNewBoard(g: Grant, asked: string | undefined): { project?: string; error?: string } {
  if (g.boards?.length && !g.projects?.length) return { error: 'this token may only use the boards it was given; it cannot create boards' }
  if (!g.projects?.length) return { project: asked }
  if (!asked) return { project: g.projects[0] }
  return g.projects.includes(asked) ? { project: asked } : { error: `this token may not create boards in project ${asked}` }
}

// ── secrets ─────────────────────────────────────────────────────────────────

/** A new secret: a short readable prefix (what it is) + 32 random bytes. */
export function newSecret(prefix: 'unp' | 'unpr' | 'unps' | 'unpc'): string {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`
}

/** What is stored instead of a secret. */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** Constant-time comparison of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

/** PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)) === challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  const want = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url')
  const a = Buffer.from(want)
  const b = Buffer.from(challenge)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 letters: no 0/O, 1/I — easy to read aloud and type

/** A one-time pairing code: 8 characters (40 bits), shown as `ABCD-EFGH`. */
export function pairingCode(): string {
  const raw = Array.from(crypto.randomBytes(8), (b) => CODE_ABC[b % CODE_ABC.length]).join('')
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/** What a person typed → the canonical code (`abcd efgh`, `ABCDEFGH`, `ab-cd-ef-gh` → `ABCD-EFGH`); undefined when it cannot be one. */
export function normalizeCode(typed: unknown): string | undefined {
  if (typeof typed !== 'string') return undefined
  const raw = typed.toUpperCase().replace(/[\s-]+/g, '')
  if (raw.length !== 8 || ![...raw].every((c) => CODE_ABC.includes(c))) return undefined
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/** Constant-time comparison of two pairing codes (already normalized). */
export function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** A display name an agent may carry: letters, digits, space, . _ - @ ( ), at most 60 characters. */
export function cleanName(raw: unknown, fallback = 'agent'): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} ._@()-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  return s || fallback
}

/** A redirect URI an OAuth client may register: https anywhere, http only to this machine (native apps, RFC 8252). */
export function redirectUriOk(uri: unknown): boolean {
  if (typeof uri !== 'string' || uri.length > 2000) return false
  try {
    const u = new URL(uri)
    if (u.hash) return false
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    return false
  } catch {
    return false
  }
}

/** The scope string an OAuth client asked for → read or write (anything unknown asks for write, the person decides). */
export function scopeFrom(raw: unknown): Scope {
  const parts = typeof raw === 'string' ? raw.split(/[\s,]+/) : []
  return parts.includes('read') && !parts.includes('write') ? 'read' : 'write'
}
