// Remote agents (docs/canvas.md "Remote agents"): tokens, scopes, "local" vs a tunnel, OAuth 2.1 with
// approve-on-connect and pairing codes, the device flow, the /mcp endpoint, attribution.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type http from 'node:http'
import WebSocket from 'ws'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, type RunningServer } from '../src/server.js'
import { AccessService } from '../src/access.js'
import { FileAccessStore, MemoryAccessStore } from '../src/adapters/access/index.js'
import { ProjectsBoardRepository } from '../src/adapters/boards/index.js'
import { canSeeBoard, hashSecret, normalizeCode, pkceMatches, projectForNewBoard, redirectUriOk, type Grant } from '../src/accessPolicy.js'
import { isLocalRequest } from '../src/projectsApi.js'
import { loopbackHost, sameOrigin } from '../src/accessRoutes.js'
import type { WsMessage } from '../src/model.js'

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `awd-access-${name}-`))
const fakeReq = (addr: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress: addr }, headers }) as unknown as http.IncomingMessage
const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url')
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }
}

// ── pure rules ───────────────────────────────────────────────────────────────

test('local means loopback, no forwarding headers and no token; a tunnel is never local', () => {
  assert.equal(isLocalRequest(fakeReq('127.0.0.1')), true)
  assert.equal(isLocalRequest(fakeReq('::1')), true)
  assert.equal(isLocalRequest(fakeReq('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' })), false, 'cloudflared connects from loopback but adds its headers')
  assert.equal(isLocalRequest(fakeReq('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' })), false)
  assert.equal(isLocalRequest(fakeReq('192.168.1.20')), false, 'the LAN is not local')
  assert.equal(isLocalRequest(fakeReq('127.0.0.1', { authorization: 'Bearer x' })), false, 'a request with a token is judged by its token')
  assert.equal(loopbackHost(fakeReq('127.0.0.1', { host: 'localhost:4400' })), true)
  assert.equal(loopbackHost(fakeReq('127.0.0.1', { host: 'evil.example:4400' })), false, 'DNS rebinding: a foreign name pointed at 127.0.0.1')
  assert.equal(sameOrigin(fakeReq('127.0.0.1', { host: 'localhost:4400', origin: 'http://localhost:4400' })), true)
  assert.equal(sameOrigin(fakeReq('127.0.0.1', { host: 'localhost:4400', origin: 'https://evil.example' })), false)
  assert.equal(sameOrigin(fakeReq('127.0.0.1', { host: 'localhost:4400', 'sec-fetch-site': 'cross-site' })), false)
})

test('scope rules: projects, boards, where a limited token creates boards', () => {
  const all: Grant = { kind: 'agent', name: 'a', scope: 'write', manage: false }
  const shop: Grant = { ...all, projects: ['shop'] }
  const one: Grant = { ...all, boards: ['b_1'] }
  assert.ok(canSeeBoard(all, 'b_9', 'x'))
  assert.ok(canSeeBoard(shop, 'b_9', 'shop'))
  assert.ok(!canSeeBoard(shop, 'b_9', 'personal'))
  assert.ok(canSeeBoard(one, 'b_1', 'anything'))
  assert.ok(!canSeeBoard(one, 'b_2', 'anything'))
  assert.deepEqual(projectForNewBoard(shop, undefined), { project: 'shop' })
  assert.ok(projectForNewBoard(shop, 'other').error)
  assert.ok(projectForNewBoard(one, undefined).error, 'a board-only token cannot create boards')
  assert.deepEqual(projectForNewBoard(all, 'x'), { project: 'x' })
})

test('secrets: PKCE S256, pairing codes, redirect URIs', () => {
  const { verifier, challenge } = pkce()
  assert.ok(pkceMatches(verifier, challenge))
  assert.ok(!pkceMatches(verifier + 'x', challenge))
  assert.equal(normalizeCode('abcd efgh'), 'ABCD-EFGH')
  assert.equal(normalizeCode('ab-cd-ef-gh'), 'ABCD-EFGH')
  assert.equal(normalizeCode('ABCD-EFG'), undefined)
  assert.equal(normalizeCode('ABCD-EFG0'), undefined, '0 is not in the alphabet')
  assert.ok(redirectUriOk('https://claude.ai/api/mcp/auth_callback'))
  assert.ok(redirectUriOk('http://localhost:33418/callback'))
  assert.ok(!redirectUriOk('http://evil.example/cb'))
  assert.ok(!redirectUriOk('javascript:alert(1)'))
})

test('token store: only the hash is kept, in a 0600 file; revoked tokens stop working', async () => {
  const file = path.join(tmp('store'), 'nested', 'agents.json')
  const access = new AccessService({ store: new FileAccessStore(file) })
  const { token, agent } = access.createToken({ name: 'codex-laptop', scope: 'read', projects: ['shop'] }, 'this machine')
  assert.match(token, /^unp_/)
  const raw = fs.readFileSync(file, 'utf8')
  assert.ok(!raw.includes(token), 'the secret is never written')
  assert.ok(raw.includes(hashSecret(token)))
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal(agent.scope, 'read')
  assert.deepEqual(agent.projects, ['shop'])
  assert.ok(!('tokenHash' in agent), 'pages never see hashes')
  const req = fakeReq('203.0.113.9', { authorization: `Bearer ${token}`, ...REMOTE })
  const ok = await access.authenticate(req)
  assert.equal(ok.grant?.name, 'codex-laptop')
  assert.equal(ok.grant?.scope, 'read')
  // a second service reads the same file (a restart)
  const again = new AccessService({ store: new FileAccessStore(file) })
  assert.equal((await again.authenticate(req)).grant?.name, 'codex-laptop')
  assert.ok(access.revoke(agent.id))
  assert.match((await access.authenticate(req)).error ?? '', /not valid/)
  // names are unique among live records, and 'agent' / 'user' are taken by the roles
  assert.equal(access.createToken({ name: 'agent' }, 't').agent.name, 'agent-2')
})

// ── the server ───────────────────────────────────────────────────────────────

let srv: RunningServer
let access: AccessService
let base: string
const store = new ProjectsBoardRepository(tmp('boards'))
const shopRoot = (() => {
  const r = path.join(tmp('shop'), 'shop')
  fs.mkdirSync(path.join(r, '.git'), { recursive: true })
  return fs.realpathSync(r)
})()

before(async () => {
  access = new AccessService({ store: new MemoryAccessStore() })
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access })
  base = `http://127.0.0.1:${srv.port}`
  store.registerProject(shopRoot)
})
after(() => srv.close())

const call = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) => fetch(base + p, init)
const remote = (token?: string, extra: Record<string, string> = {}) => ({ ...REMOTE, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra })
const post = (p: string, body: unknown, headers: Record<string, string> = {}) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const form = (p: string, body: Record<string, string>, headers: Record<string, string> = {}) => call(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) })
/** A page of this canvas opened on this machine (the one-click approver): same origin, a loopback Host. */
const localPage = () => ({ origin: base })

test('this machine needs no token; a tunnel without one gets 401 with the way in', async () => {
  assert.equal((await call('/api/boards')).status, 200)
  const r = await call('/api/boards', { headers: remote() })
  assert.equal(r.status, 401)
  assert.match(r.headers.get('www-authenticate') ?? '', /resource_metadata="http:\/\/[^"]+\/\.well-known\/oauth-protected-resource"/)
  const j = await r.json()
  assert.equal(j.signIn, true)
  assert.match(j.error, /\/mcp/)
  assert.match(j.error, /device_authorization/)
  // public: version, the UI, discovery
  assert.equal((await call('/api/version', { headers: remote() })).status, 200)
  assert.equal((await call('/.well-known/oauth-authorization-server', { headers: remote() })).status, 200)
  // a bad token is refused even from this machine
  assert.equal((await call('/api/boards', { headers: { authorization: 'Bearer nope' } })).status, 401)
})

test('scopes: a read-only token reads but cannot write; a project token sees only its project', async () => {
  const mine = store.create({ title: 'personal board', kind: 'freeform' })
  const shopBoard = store.create({ title: 'shop board', kind: 'freeform', project: 'shop' })
  const ro = access.createToken({ name: 'reader', scope: 'read' }, 't').token
  assert.equal((await call(`/api/boards/${mine.id}`, { headers: remote(ro) })).status, 200)
  const denied = await post(`/api/boards/${mine.id}/ops`, { author: 'agent', ops: [] }, remote(ro))
  assert.equal(denied.status, 403)
  assert.match((await denied.json()).error, /read-only/)
  assert.equal((await post('/api/boards', { title: 'x', kind: 'freeform' }, remote(ro))).status, 403)

  const shop = access.createToken({ name: 'shop-agent', scope: 'write', projects: ['shop'] }, 't').token
  const list = (await (await call('/api/boards', { headers: remote(shop) })).json()).boards as Array<{ id: string; project: string }>
  assert.ok(list.some((b) => b.id === shopBoard.id))
  assert.ok(list.every((b) => b.project === 'shop'), 'only the project it was given')
  assert.equal((await call(`/api/boards/${mine.id}`, { headers: remote(shop) })).status, 403)
  const ws = await new Promise<number>((resolve) => {
    const s = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/${mine.id}`, { headers: remote(shop) })
    s.on('unexpected-response', (_q, res) => resolve(res.statusCode ?? 0))
    s.on('open', () => resolve(101))
  })
  assert.equal(ws, 403, 'the board socket is scoped too')
  const projects = (await (await call('/api/projects', { headers: remote(shop) })).json()).projects as Array<{ id: string }>
  assert.deepEqual(projects.map((p) => p.id), ['shop'])
  const created = await post('/api/boards', { title: 'made remotely', kind: 'freeform' }, remote(shop))
  assert.equal(created.status, 201)
  assert.equal((await created.json()).project, 'shop', 'a project token creates boards in its project')
  assert.equal((await post('/api/boards', { title: 'x', kind: 'freeform', project: 'personal' }, remote(shop))).status, 403)
})

test('attribution: an agent token writes as its agent, by name; presence and receipts are per agent', async () => {
  const b = store.create({ title: 'two agents', kind: 'freeform' })
  const codex = access.createToken({ name: 'codex-laptop' }, 't').token
  const r = await post(`/api/boards/${b.id}/ops`, { author: 'user', ops: [{ kind: 'add', item: { id: 's1', type: 'sticky', x: 0, y: 0, w: 100, h: 60, text: 'hi' } }] }, remote(codex))
  assert.equal(r.status, 200)
  const { change } = await r.json()
  assert.equal(change.author, 'agent', 'a token cannot pretend to be the person')
  assert.equal(change.by, 'codex-laptop')
  // the person comments; the change feed signs lines with the name
  store.apply(b.id, [{ kind: 'add', item: { id: 'c1', type: 'comment', x: 0, y: 100, w: 100, h: 60, text: 'why?', target: 's1', createdBy: 'user', updatedBy: 'user', updatedAt: '' } }], 'user')
  const diff = await (await call(`/api/boards/${b.id}/diff?since=0&author=agent`)).json()
  assert.match(diff.lines[0], /^\[1 codex-laptop\]/)
  // codex reads the comment: its own receipt
  await call(`/api/boards/${b.id}/diff?since=1&author=user`, { headers: remote(codex) })
  assert.deepEqual(store.get(b.id)!.items.c1.data?.seenByAgents, ['codex-laptop'])
  // a local agent named by UNPROSE_AGENT_NAME (x-unprose-agent) signs its changes too
  const local = await post(`/api/boards/${b.id}/ops`, { author: 'agent', ops: [{ kind: 'update', id: 's1', patch: { text: 'hello' } }] }, { 'x-unprose-agent': 'claude-desk' })
  assert.equal((await local.json()).change.by, 'claude-desk')
  // 'others': codex sees the person and claude-desk, never itself
  const others = await (await call(`/api/boards/${b.id}/changes?since=0&author=others`, { headers: remote(codex) })).json()
  assert.deepEqual(others.changes.map((c: { by?: string; author: string }) => c.by ?? c.author), ['user', 'claude-desk'])
  // presence names who waits
  const presence: WsMessage[] = []
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/${b.id}`)
  ws.on('message', (d) => presence.push(JSON.parse(String(d))))
  await new Promise((r2) => ws.once('open', r2))
  const waiting = call(`/api/boards/${b.id}/wait?since=99&timeout=400`, { headers: remote(codex) })
  await new Promise((r2) => setTimeout(r2, 150))
  assert.ok(presence.some((m) => m.type === 'presence' && m.agents?.includes('codex-laptop')))
  await waiting
  ws.close()
})

test('OAuth 2.1: register → authorize (pending, code shown remotely) → one-click approve on this machine → token → refresh → revoke', async () => {
  const meta = await (await call('/.well-known/oauth-protected-resource/mcp', { headers: remote() })).json()
  assert.match(meta.resource, /\/mcp$/)
  const as = await (await call('/.well-known/oauth-authorization-server')).json()
  assert.deepEqual(as.code_challenge_methods_supported, ['S256'])
  assert.ok(as.registration_endpoint && as.device_authorization_endpoint)
  const reg = await post('/register', { client_name: 'claude.ai', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }, remote())
  assert.equal(reg.status, 201)
  const { client_id } = await reg.json()
  assert.equal((await post('/register', { client_name: 'x', redirect_uris: ['http://evil.example/cb'] })).status, 400)

  const { verifier, challenge } = pkce()
  const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'write' })
  // every approving page hears about it
  const heard: WsMessage[] = []
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { host: 'localhost', origin: 'http://localhost' } })
  ws.on('message', (d) => heard.push(JSON.parse(String(d))))
  await new Promise((r) => ws.once('open', r))
  const page = await call(`/authorize?${q}`, { headers: remote() })
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('x-frame-options'), 'DENY')
  const html = await page.text()
  const shown = /aria-label="Pairing code">([A-Z0-9]{4}-[A-Z0-9]{4})</.exec(html)?.[1]
  assert.ok(shown, 'a remote viewer sees the pairing code')
  const id = /const id="([^"]+)"/.exec(html)![1]
  await new Promise((r) => setTimeout(r, 50))
  const note = heard.find((m) => m.type === 'access-request')
  assert.ok(note && note.type === 'access-request')
  const ref = note.request.id
  assert.notEqual(ref, id, 'approving pages know the request by a ref, never by the secret the requester polls with')
  assert.equal(note.request.name, 'claude.ai')
  assert.equal(note.request.redirectHost, 'claude.ai')
  assert.ok(!JSON.stringify(note).includes(shown!), 'approving pages never get the code')
  assert.equal((await (await call(`/authorize/status?id=${id}`)).json()).status, 'pending')
  // a cross-site page on this machine cannot approve (CSRF)
  assert.equal((await post(`/api/access/requests/${ref}`, { allow: true }, { origin: 'https://evil.example' })).status, 403)
  // a remote caller with an agent token cannot approve
  const tok = access.createToken({ name: 'sneaky' }, 't').token
  assert.equal((await post(`/api/access/requests/${ref}`, { allow: true, code: shown }, remote(tok))).status, 403)
  assert.equal((await post(`/api/access/requests/${id}`, { allow: true }, localPage())).status, 404, 'the secret id does not name a request for approvers')
  // the page on this machine: one click
  const ok = await post(`/api/access/requests/${ref}`, { allow: true, scope: 'write' }, localPage())
  assert.equal(ok.status, 200)
  const st = await (await call(`/authorize/status?id=${id}`)).json()
  const redirect = new URL(st.redirect)
  assert.equal(redirect.origin + redirect.pathname, 'https://claude.ai/api/mcp/auth_callback')
  assert.equal(redirect.searchParams.get('state'), 'st8')
  const code = redirect.searchParams.get('code')!
  assert.equal((await (await call(`/authorize/status?id=${id}`)).json()).redirect, undefined, 'the code is handed out once')
  // wrong verifier → refused, and the code is spent
  const bad = await form('/token', { grant_type: 'authorization_code', code, code_verifier: pkce().verifier, client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' })
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error, 'invalid_grant')
  // again, properly
  const { verifier: v2, challenge: c2 } = pkce()
  const q2 = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: c2, code_challenge_method: 'S256', state: 's2' })
  const id2 = /const id="([^"]+)"/.exec(await (await call(`/authorize?${q2}`, { headers: remote() })).text())![1]
  const ref2 = access.pendingViews().find((p) => p.via === 'oauth')!.id
  await post(`/api/access/requests/${ref2}`, { allow: true, scope: 'read' }, localPage())
  const code2 = new URL((await (await call(`/authorize/status?id=${id2}`)).json()).redirect).searchParams.get('code')!
  const tr = await form('/token', { grant_type: 'authorization_code', code: code2, code_verifier: v2, client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' })
  assert.equal(tr.status, 200)
  const t1 = await tr.json()
  assert.equal(t1.token_type, 'Bearer')
  assert.equal(t1.scope, 'read')
  assert.ok(t1.refresh_token && t1.expires_in === 3600)
  assert.equal((await call('/api/boards', { headers: remote(t1.access_token) })).status, 200)
  // it is in the agents list, revocable
  const listed = access.list().find((a) => a.clientName === 'claude.ai')
  assert.ok(listed && listed.via === 'oauth' && listed.scope === 'read')
  // refresh rotates both
  const rr = await form('/token', { grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id })
  const t2 = await rr.json()
  assert.ok(t2.access_token && t2.access_token !== t1.access_token)
  assert.equal((await call('/api/boards', { headers: remote(t1.access_token) })).status, 401, 'the old access token is gone')
  assert.equal((await form('/token', { grant_type: 'refresh_token', refresh_token: t1.refresh_token })).status, 400, 'the old refresh token is gone')
  // revoke (RFC 7009) — or from the page
  assert.equal((await form('/revoke', { token: t2.refresh_token })).status, 200)
  assert.equal((await call('/api/boards', { headers: remote(t2.access_token) })).status, 401)
  ws.close()
})

test('pairing code: a signed-in browser elsewhere approves by typing the code; five wrong codes lock the request', async () => {
  // a browser through the tunnel asks to be let in; the page on this machine allows it with one click
  const sign = await (await post('/api/access/signin', {}, remote())).json()
  assert.match(sign.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  await post(`/api/access/requests/${access.pendingViews().find((p) => p.via === 'browser')!.id}`, { allow: true }, localPage())
  const claimed = await call(`/api/access/signin/${sign.id}`, { headers: remote() })
  const cookie = claimed.headers.get('set-cookie')!
  assert.match(cookie, /^unprose_session=unps_[^;]+; Path=\/; HttpOnly; SameSite=Strict/)
  const session = cookie.split(';')[0]
  assert.equal((await call('/api/boards', { headers: remote(undefined, { cookie: session }) })).status, 200, 'the browser is in')
  const me = await (await call('/api/access/me', { headers: remote(undefined, { cookie: session }) })).json()
  assert.equal(me.canApprove, true)
  assert.equal(me.canManage, false, 'a browser session does not make tokens unless this machine said so')
  // a pasted token signs a browser in as a person (its own session), with the token's scope
  const ro = access.createToken({ name: 'phone-token', scope: 'read' }, 't').token
  const pasted = await post('/api/access/session', { token: ro }, remote())
  const pastedCookie = pasted.headers.get('set-cookie')!.split(';')[0]
  assert.ok(!pastedCookie.includes(ro), 'the token itself is not put in the cookie')
  const pmeta = await (await call('/api/access/me', { headers: remote(undefined, { cookie: pastedCookie }) })).json()
  assert.equal(pmeta.grant.as, 'browser')
  assert.equal(pmeta.grant.scope, 'read')
  assert.equal((await post('/api/access/agents', { name: 'x' }, remote(undefined, { cookie: session }))).status, 403)

  // an agent without a browser asks (device flow); the remote browser types the code it shows
  const dev = await (await form('/device_authorization', { client_name: 'cloud-codex' }, remote())).json()
  assert.match(dev.user_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.equal((await (await form('/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dev.device_code })).json()).error, 'authorization_pending')
  const req = access.pendingViews().find((p) => p.name === 'cloud-codex')!
  const s = remote(undefined, { cookie: session })
  const noCode = await post(`/api/access/requests/${req.id}`, { allow: true }, s)
  assert.equal(noCode.status, 403)
  assert.equal((await noCode.json()).attemptsLeft, 4)
  const byCode = await post('/api/access/approve', { code: dev.user_code.toLowerCase().replace('-', ' ') }, s)
  assert.equal(byCode.status, 200)
  await new Promise((r) => setTimeout(r, 4100)) // the device flow's interval
  const t = await (await form('/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dev.device_code })).json()
  assert.match(t.access_token, /^unp_/)
  const rec = access.list().find((a) => a.name === 'cloud-codex')!
  assert.equal(rec.via, 'device')
  assert.equal(rec.createdBy, me.grant.name, 'who approved it is recorded')

  // brute force: five wrong codes lock the request
  const dev2 = await (await form('/device_authorization', { client_name: 'guesser' }, remote({ 'x-forwarded-for': '198.51.100.1' }))).json()
  const req2 = access.pendingViews().find((p) => p.name === 'guesser')!
  let last: { attemptsLeft?: number; error?: string } = {}
  for (let i = 0; i < 5; i++) last = await (await post(`/api/access/requests/${req2.id}`, { allow: true, code: 'AAAA-AAAA' }, s)).json()
  assert.equal(last.attemptsLeft, 0)
  assert.match(last.error ?? '', /locked/)
  const right = await post(`/api/access/requests/${req2.id}`, { allow: true, code: dev2.user_code }, s)
  assert.equal(right.status, 409, 'even the right code is refused once locked')
  assert.equal((await (await form('/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dev2.device_code })).json()).error, 'access_denied')
})

test('pending requests are rate-limited per address', async () => {
  const ip = { 'x-forwarded-for': '192.0.2.77', 'cf-connecting-ip': '192.0.2.77' }
  const codes = []
  for (let i = 0; i < 4; i++) codes.push((await form('/device_authorization', { client_name: `n${i}` }, ip)).status)
  assert.deepEqual(codes, [200, 200, 200, 429])
})

test('/mcp: 401 with the metadata pointer without a token; with one, the tools act as that agent', async () => {
  const anon = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, remote({ accept: 'application/json, text/event-stream' }))
  assert.equal(anon.status, 401)
  assert.match(anon.headers.get('www-authenticate') ?? '', /oauth-protected-resource\/mcp/)

  const { token } = access.createToken({ name: 'cloud-claude', projects: ['shop'] }, 't')
  const client = new Client({ name: 't', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(token) } }))
  const tools = (await client.listTools()).tools.map((t) => t.name)
  for (const n of ['canvas_create_board', 'canvas_wait', 'design_lint', 'design_draw', 'unprose_help']) assert.ok(tools.includes(n), n)
  assert.ok(!tools.includes('design_egon'), 'no file-writing tool remotely')
  assert.ok((await client.listPrompts()).prompts.some((p) => p.name === 'eventstorm'))
  const made = await client.callTool({ name: 'canvas_create_board', arguments: { title: 'from the cloud', kind: 'freeform', content: { items: [{ text: 'hello' }] } } })
  const out = (made.content as Array<{ text: string }>)[0].text
  const id = /created board (b_\w+)/.exec(out)![1]
  assert.match(out, /give the person this link/, 'no browser is opened on the canvas machine')
  assert.equal(store.projectOf(id), 'shop', 'scoped: created in its project')
  assert.equal(store.changes(id)[0].author, 'agent')
  // design files as text
  const es = 'level: big-picture\nevents:\n  - { id: placed, text: Order placed }\n  - { id: paid, text: Order paid }\n'
  const lint = await client.callTool({ name: 'design_lint', arguments: { name: 'shop.es.yaml', content: es } })
  assert.match((lint.content as Array<{ text: string }>)[0].text, /shop\.es\.yaml \(event-storming, key shop-es\): 0 error/)
  const drawn = await client.callTool({ name: 'design_draw', arguments: { name: 'shop.es.yaml', content: es, board: id } })
  assert.match((drawn.content as Array<{ text: string }>)[0].text, /frame shop-es on http:\/\/[^ ]+\/b\/b_\w+\?frame=shop-es/)
  const last = store.changes(id).at(-1)!
  assert.equal(last.by, 'cloud-claude', 'remote MCP changes are signed with the agent name')
  assert.ok(Object.keys(store.get(id)!.items).some((k) => k.startsWith('shop-es.')))
  // outside its project: refused
  const personal = store.create({ title: 'not yours', kind: 'freeform' })
  const refused = await client.callTool({ name: 'canvas_read_board', arguments: { id: personal.id } })
  assert.equal(refused.isError, true)
  await client.close()

  // this machine needs no token for /mcp either
  const localClient = new Client({ name: 't', version: '1' })
  await localClient.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)))
  assert.ok((await localClient.listTools()).tools.length > 5)
  await localClient.close()
})

test('UNPROSE_REMOTE_AUTH=off: the old open canvas (remote requests need nothing), local-only actions stay local', async () => {
  const open = await startServer({ port: 0, store: new ProjectsBoardRepository(tmp('open')), webDist: '/nonexistent', access: new AccessService({ store: new MemoryAccessStore(), remoteAuth: false }) })
  try {
    const u = `http://127.0.0.1:${open.port}`
    assert.equal((await fetch(`${u}/api/boards`, { headers: REMOTE })).status, 200)
    assert.equal((await fetch(`${u}/api/projects`, { method: 'POST', headers: { ...REMOTE, 'content-type': 'application/json' }, body: JSON.stringify({ root: shopRoot }) })).status, 403)
  } finally {
    await open.close()
  }
})
