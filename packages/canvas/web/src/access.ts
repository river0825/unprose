// Remote agents in the page (docs/canvas.md "Remote agents"): who this page is, signing a browser in from
// elsewhere, connect requests, and the Connected agents list. The server's rules are in src/accessRoutes.ts.
import { createContext, useContext } from 'react'
import type { AccessRequestView, WsMessage } from '../../src/model'

export interface AccessMe {
  grant: { kind: 'local' | 'agent' | 'person' | 'open'; name: string; scope: 'read' | 'write'; manage: boolean; as?: 'agent' | 'browser'; projects?: string[]; boards?: string[] } | null
  signedIn: boolean
  local: boolean
  remoteAuth: boolean
  canApprove: boolean
  canManage: boolean
  /** A page on this machine, opened as localhost: approves with one click, no code. */
  oneClick: boolean
  publicUrl: string
  /** Why this page may not manage agents (absent when it may) — shown next to the disabled buttons. */
  whyNotManage?: WhyNotManage
}

/** Why a page may not manage agents: reached from elsewhere with a session (it can ask), without one, a non-localhost name on this machine, or an agent. */
export interface WhyNotManage {
  reason: 'remote' | 'not-signed-in' | 'host' | 'agent'
  text: string
  canRequest: boolean
  /** the port the canvas listens on (for `ssh -L`) */
  port?: number
}

export interface AuditEntry {
  at: string
  by: string
  what: string
  agentId?: string
}

export interface AgentView {
  id: string
  name: string
  /** What people @mention it by (absent on older canvases). */
  handle?: string
  via: 'token' | 'oauth' | 'device' | 'browser'
  scope: 'read' | 'write'
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
  clientName?: string
}

export interface Setup {
  mcpUrl: string
  claudeCode: string
  codex: string
  claudeAi: string
  stdio: string
  json: string
}

export type { AccessRequestView }

/** Fired by api.ts on any 401: the page lost (or never had) its sign-in. */
export const SIGNIN_EVENT = 'unprose:signin'
/** Fired when the server says the agents list changed. */
export const ACCESS_CHANGED_EVENT = 'unprose:access-changed'

/** A page that cannot tell (older server, offline) behaves as before: signed in, nothing to approve. */
export const FALLBACK_ME: AccessMe = { grant: null, signedIn: true, local: true, remoteAuth: false, canApprove: false, canManage: false, oneClick: false, publicUrl: location.origin }

export const AccessContext = createContext<AccessMe>(FALLBACK_ME)
export const useAccess = () => useContext(AccessContext)

async function body<T>(r: Response): Promise<T> {
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; attemptsLeft?: number }
  if (!r.ok) throw Object.assign(new Error(j.error ?? `${r.status} ${r.statusText}`), { status: r.status, attemptsLeft: j.attemptsLeft })
  return j
}
const post = (url: string, data?: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data ?? {}) })

export const accessApi = {
  me: () => fetch('/api/access/me').then((r) => (r.ok ? (r.json() as Promise<AccessMe>) : FALLBACK_ME)).catch(() => FALLBACK_ME),
  startSignIn: () => post('/api/access/signin').then((r) => body<{ id: string; code: string; expiresAt: string }>(r)),
  pollSignIn: (id: string) => fetch(`/api/access/signin/${encodeURIComponent(id)}`).then((r) => body<{ status: 'pending' | 'approved' | 'denied' | 'expired' | 'unknown'; locked?: boolean }>(r)),
  session: (token: string) => post('/api/access/session', { token }).then((r) => body<{ ok: true }>(r)),
  signOut: () => post('/api/access/signout').then((r) => body<{ ok: true }>(r)),
  agents: () => fetch('/api/access/agents').then((r) => body<{ agents: AgentView[]; requests: AccessRequestView[]; canManage: boolean; whyNotManage?: WhyNotManage; oneClick: boolean; store?: string; audit?: AuditEntry[] }>(r)),
  /** Change an agent's access (read ↔ read and draw) and its project / board limits (an empty list = no limit); logged. */
  updateAccess: (id: string, patch: { scope?: 'read' | 'write'; projects?: string[]; boards?: string[] }) =>
    fetch(`/api/access/agents/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then((r) => body<{ ok: true; agent: AgentView; changed: string[] }>(r)),
  /** Ask for the right to manage agents for this browser: a pairing code that a managing page (or the canvas machine) approves. */
  requestManage: () => post('/api/access/manage-request').then((r) => body<{ id: string; code: string; expiresAt: string }>(r)),
  pollManage: (id: string) => fetch(`/api/access/manage-request/${encodeURIComponent(id)}`).then((r) => body<{ status: 'pending' | 'approved' | 'denied' | 'expired' | 'unknown'; locked?: boolean }>(r)),
  create: (input: { name: string; scope: 'read' | 'write'; projects?: string[]; boards?: string[]; publicUrl?: string }) =>
    post('/api/access/agents', input).then((r) => body<{ agent: AgentView; token: string; setup: Setup }>(r)),
  /** Rename an agent: the name its changes are signed with from now on, and the one people @mention. */
  rename: (id: string, name: string) =>
    fetch(`/api/access/agents/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((r) => body<{ ok: true; from: string; name: string }>(r)),
  /** What agents said about Unprose (unprose_feedback) — on this machine or a page that manages agents. */
  feedback: () => fetch('/api/access/feedback').then((r) => body<{ feedback: Array<{ id: string; at: string; by: string; via: string; text: string; kind?: 'bug' | 'idea'; title?: string; board?: string; about?: string[] }> }>(r)),
  revoke: (id: string, forget = false) => fetch(`/api/access/agents/${encodeURIComponent(id)}${forget ? '?forget=1' : ''}`, { method: 'DELETE' }).then((r) => body<{ ok: true }>(r)),
  decide: (id: string, d: { allow: boolean; scope?: 'read' | 'write'; code?: string; manage?: boolean }) => post(`/api/access/requests/${encodeURIComponent(id)}`, d).then((r) => body<{ status: string }>(r)),
  approveCode: (code: string, scope: 'read' | 'write') => post('/api/access/approve', { code, scope }).then((r) => body<{ status: string }>(r)),
}

/** "Chrome on macOS" from a user agent string. */
export function shortUa(ua?: string): string {
  if (!ua) return ''
  if (!/Mozilla\//.test(ua)) return ua.split(/[\s/]/)[0] || ua.slice(0, 30)
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return `${b}${os ? ` on ${os}` : ''}`
}

export const VIA_TEXT: Record<AccessRequestView['via'], string> = {
  oauth: 'MCP client (OAuth)',
  device: 'agent without a browser',
  browser: 'browser sign-in',
  manage: 'manage rights for a signed-in browser',
}

/** Reconnecting server socket (`/ws`): connect requests and agents-list changes. */
export function connectServer(onMessage: (m: WsMessage) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retry = 500
  let timer: ReturnType<typeof setTimeout> | undefined
  const open = () => {
    if (closed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onopen = () => {
      retry = 500
    }
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(String(ev.data)) as WsMessage)
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      if (closed) return
      timer = setTimeout(open, retry)
      retry = Math.min(retry * 2, 8000)
    }
    ws.onerror = () => ws?.close()
  }
  open()
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    ws?.close()
  }
}
