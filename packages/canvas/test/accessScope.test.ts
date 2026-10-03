// Connected agents page (docs/canvas.md "Remote agents" → "Changing an agent's access", "Manage rights for a
// browser elsewhere"): change a token's access and scope in place (logged, only a page that may manage), why a
// page elsewhere cannot manage, and asking for manage rights with a pairing code.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import type { WsMessage } from '../src/model.js'
import { startServer, type RunningServer } from '../src/server.js'
import { AccessService, MAX_CODE_ATTEMPTS } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { ProjectsBoardRepository } from '../src/adapters/boards/index.js'

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `awd-scope-${name}-`))
const REMOTE = { 'x-forwarded-for': '203.0.113.20', 'cf-connecting-ip': '203.0.113.20' }

let srv: RunningServer
let access: AccessService
let base: string
const store = new ProjectsBoardRepository(tmp('boards'))

before(async () => {
  access = new AccessService({ store: new MemoryAccessStore() })
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access })
  base = `http://127.0.0.1:${srv.port}`
})
after(() => srv.close())

const call = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) => fetch(base + p, init)
const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) => call(p, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const localPage = () => ({ origin: base })
const remote = (extra: Record<string, string> = {}) => ({ ...REMOTE, ...extra })

/** A browser through the tunnel, let in by this machine (optionally with manage rights): its cookie. */
async function remoteBrowser(ip: string, manage = false): Promise<string> {
  const h = { 'x-forwarded-for': ip, 'cf-connecting-ip': ip }
  const sign = await (await send('POST', '/api/access/signin', {}, h)).json()
  const ref = access.pendingViews().find((p) => p.via === 'browser' && p.ip === ip)!.id
  assert.equal((await send('POST', `/api/access/requests/${ref}`, { allow: true, manage }, localPage())).status, 200)
  const claimed = await call(`/api/access/signin/${sign.id}`, { headers: h })
  return claimed.headers.get('set-cookie')!.split(';')[0]
}

test('change a token\'s access and scope in place: logged, takes effect at once, only a page that may manage', async () => {
  const shop = store.create({ title: 'shop', kind: 'freeform' })
  const { token, agent } = access.createToken({ name: 'codex-b', scope: 'read' }, 'this machine')
  const bearer = { ...REMOTE, authorization: `Bearer ${token}` }
  assert.equal((await send('POST', `/api/boards/${shop.id}/ops`, { author: 'agent', ops: [] }, bearer)).status, 403, 'read only at first')

  // a browser elsewhere without manage rights: refused, with why and how
  const cookie = await remoteBrowser('198.51.100.30')
  const refused = await send('PATCH', `/api/access/agents/${agent.id}`, { scope: 'write' }, remote({ cookie }))
  assert.equal(refused.status, 403)
  assert.match((await refused.json()).error, /may manage agents.*ssh -L|manage rights/)
  const list = await (await call('/api/access/agents', { headers: remote({ cookie }) })).json()
  assert.equal(list.canManage, false)
  assert.equal(list.whyNotManage.reason, 'remote')
  assert.equal(list.whyNotManage.canRequest, true)
  assert.equal(list.audit, undefined, 'the access log is for pages that manage')
  const me = await (await call('/api/access/me', { headers: remote({ cookie }) })).json()
  assert.equal(me.whyNotManage.reason, 'remote')
  // an agent token never changes access
  assert.equal((await send('PATCH', `/api/access/agents/${agent.id}`, { scope: 'write' }, bearer)).status, 403)

  // the page on this machine: read → read and draw, limited to one board
  const ok = await send('PATCH', `/api/access/agents/${agent.id}`, { scope: 'write', boards: [shop.id] }, localPage())
  assert.equal(ok.status, 200)
  const j = await ok.json()
  assert.equal(j.agent.scope, 'write')
  assert.deepEqual(j.agent.boards, [shop.id])
  assert.deepEqual(j.changed, ['access read only → read and draw', `boards all → ${shop.id}`])
  assert.equal((await send('POST', `/api/boards/${shop.id}/ops`, { author: 'agent', ops: [] }, bearer)).status, 200, 'the same token draws now')
  const other = store.create({ title: 'other', kind: 'freeform' })
  assert.equal((await call(`/api/boards/${other.id}`, { headers: bearer })).status, 403, 'and sees only its board')
  // clearing the limit: null (or an empty list) = all boards
  const cleared = await (await send('PATCH', `/api/access/agents/${agent.id}`, { boards: null }, localPage())).json()
  assert.equal(cleared.agent.boards, undefined)
  assert.equal((await call(`/api/boards/${other.id}`, { headers: bearer })).status, 200)
  // nothing changed → nothing logged
  const same = await (await send('PATCH', `/api/access/agents/${agent.id}`, { scope: 'write' }, localPage())).json()
  assert.deepEqual(same.changed, [])
  assert.equal((await send('PATCH', `/api/access/agents/${agent.id}`, { scope: 'admin' }, localPage())).status, 400)

  const log = (await (await call('/api/access/agents', { headers: localPage() })).json()).audit as Array<{ by: string; what: string }>
  const lines = log.filter((l) => l.what.includes('codex-b')).map((l) => `${l.by}: ${l.what}`)
  assert.deepEqual(lines.slice(0, 3), [
    `this machine: changed codex-b: boards ${shop.id} → all`,
    `this machine: changed codex-b: access read only → read and draw; boards all → ${shop.id}`,
    'this machine: made a token for codex-b: read only, all projects',
  ])
})

test('manage rights for a browser elsewhere: request → a managing page types the code → this browser manages', async () => {
  const cookie = await remoteBrowser('198.51.100.40')
  const h = remote({ cookie })
  const { agent } = access.createToken({ name: 'target' }, 'this machine')
  assert.equal((await send('DELETE', `/api/access/agents/${agent.id}`, {}, h)).status, 403)

  const ask = await send('POST', '/api/access/manage-request', {}, h)
  assert.equal(ask.status, 200)
  const { id, code } = await ask.json()
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.equal((await (await send('POST', '/api/access/manage-request', {}, h)).json()).id, id, 'asking again reuses the request')
  assert.equal((await (await call(`/api/access/manage-request/${id}`, { headers: h })).json()).status, 'pending')

  // a page that may not manage does not see it, and cannot approve it — not even the requester with its own code
  const plain = await remoteBrowser('198.51.100.41')
  const seen = await (await call('/api/access/requests', { headers: remote({ cookie: plain }) })).json()
  assert.ok(!seen.requests.some((r: { via: string }) => r.via === 'manage'))
  const ref = access.pendingViews().find((p) => p.via === 'manage')!.id
  assert.equal((await send('POST', `/api/access/requests/${ref}`, { allow: true, code }, remote({ cookie: plain }))).status, 403)
  assert.equal((await send('POST', `/api/access/requests/${ref}`, { allow: true, code }, h)).status, 403, 'not its own request')
  assert.equal((await send('POST', '/api/access/approve', { code }, h)).status, 403)
  assert.ok((await (await call('/api/access/requests', { headers: localPage() })).json()).requests.some((r: { via: string }) => r.via === 'manage'), 'this machine sees it')

  // a browser that already manages approves it — with the code
  const manager = await remoteBrowser('198.51.100.42', true)
  const m = remote({ cookie: manager })
  const wrong = await send('POST', `/api/access/requests/${ref}`, { allow: true, code: 'AAAA-AAAA' }, m)
  assert.equal(wrong.status, 403)
  assert.equal((await wrong.json()).attemptsLeft, MAX_CODE_ATTEMPTS - 1)
  assert.equal((await send('POST', '/api/access/approve', { code: code.toLowerCase() }, m)).status, 200)
  assert.equal((await (await call(`/api/access/manage-request/${id}`, { headers: h })).json()).status, 'approved')

  // now this browser manages: it changes and revokes tokens, and sees the log
  const me = await (await call('/api/access/me', { headers: h })).json()
  assert.equal(me.canManage, true)
  assert.equal((await send('PATCH', `/api/access/agents/${agent.id}`, { scope: 'read' }, h)).status, 200)
  assert.equal((await send('DELETE', `/api/access/agents/${agent.id}`, {}, h)).status, 200)
  const log = (await (await call('/api/access/agents', { headers: h })).json()).audit as Array<{ by: string; what: string }>
  const byMe = me.grant.name
  assert.ok(log.some((l) => l.by === byMe && l.what === 'revoked target'))
  assert.ok(log.some((l) => l.by === byMe && l.what === 'changed target: access read and draw → read only'))
  assert.ok(log.some((l) => /gave .* the right to manage agents/.test(l.what)))
  assert.ok(log.some((l) => l.by === byMe && /asked for the right to manage agents/.test(l.what)))
  assert.equal((await send('POST', '/api/access/manage-request', {}, h)).status, 409, 'it already manages')
})

test('manage-rights requests: five wrong codes lock them; the same per-address limits; agents cannot ask', async () => {
  const cookie = await remoteBrowser('198.51.100.50')
  const h = remote({ cookie })
  const { code } = await (await send('POST', '/api/access/manage-request', {}, h)).json()
  const ref = access.pendingViews().find((p) => p.via === 'manage' && p.ip === '203.0.113.20')!.id
  const manager = remote({ cookie: await remoteBrowser('198.51.100.51', true) })
  let last: { attemptsLeft?: number; error?: string } = {}
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) last = await (await send('POST', `/api/access/requests/${ref}`, { allow: true, code: 'AAAA-AAAA' }, manager)).json()
  assert.equal(last.attemptsLeft, 0)
  assert.match(last.error ?? '', /locked/)
  assert.equal((await send('POST', `/api/access/requests/${ref}`, { allow: true, code }, manager)).status, 409, 'even the right code, once locked')
  // an agent token cannot ask for manage rights
  const { token } = access.createToken({ name: 'asker' }, 'this machine')
  assert.equal((await send('POST', '/api/access/manage-request', {}, { ...REMOTE, authorization: `Bearer ${token}` })).status, 403)
  // the per-address limit of pending requests applies (3 per address)
  const ip = '192.0.2.88'
  const statuses: number[] = []
  for (let i = 0; i < 3; i++) await send('POST', '/device_authorization', { client_name: `filler${i}` }, { 'x-forwarded-for': ip, 'cf-connecting-ip': ip })
  const c2 = await remoteBrowser('198.51.100.52')
  statuses.push((await send('POST', '/api/access/manage-request', {}, { 'x-forwarded-for': ip, 'cf-connecting-ip': ip, cookie: c2 })).status)
  assert.deepEqual(statuses, [429])
})

test('the server socket: connect requests reach every page that may approve, manage-rights requests only pages that may manage', async () => {
  const at = (ip: string, extra: Record<string, string> = {}) => ({ 'x-forwarded-for': ip, 'cf-connecting-ip': ip, ...extra })
  const listen = async (headers: Record<string, string>) => {
    const heard: WsMessage[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers })
    ws.on('message', (d) => heard.push(JSON.parse(String(d))))
    await new Promise((r) => ws.once('open', r))
    return { ws, heard }
  }
  const requests = (heard: WsMessage[]) => heard.flatMap((m) => (m.type === 'access-request' ? [m.request] : []))
  const plain = await listen(at('198.51.100.70', { cookie: await remoteBrowser('198.51.100.70') }))
  const manager = await listen(at('198.51.100.71', { cookie: await remoteBrowser('198.51.100.71', true) }))
  const local = await listen({ host: 'localhost', origin: 'http://localhost' })

  // a browser asks for manage rights; another browser asks to connect
  const asker = await remoteBrowser('198.51.100.76') // signed in from one address, asks from another
  assert.equal((await send('POST', '/api/access/manage-request', {}, at('198.51.100.72', { cookie: asker }))).status, 200)
  assert.equal((await send('POST', '/api/access/signin', {}, at('198.51.100.73'))).status, 200)
  await new Promise((r) => setTimeout(r, 80))

  // the two requests of this test (the sign-ins above, and earlier tests, are requests too)
  const vias = (heard: WsMessage[]) => [...new Set(requests(heard).filter((r) => r.ip === '198.51.100.72' || r.ip === '198.51.100.73').map((r) => `${r.via} ${r.ip}`))].sort()
  assert.deepEqual(vias(plain.heard), ['browser 198.51.100.73'], 'a signed-in browser without manage rights: the connect request only')
  assert.ok(!requests(plain.heard).some((r) => r.via === 'manage'), 'nothing about who asked for manage rights, or from where')
  assert.deepEqual(vias(manager.heard), ['browser 198.51.100.73', 'manage 198.51.100.72'], 'a browser with manage rights: both')
  assert.deepEqual(vias(local.heard), ['browser 198.51.100.73', 'manage 198.51.100.72'], 'this machine: both')

  // a page that opens later gets the pending requests it may see, by the same rule
  const late = await listen(at('198.51.100.70', { cookie: await remoteBrowser('198.51.100.74') }))
  const lateManager = await listen(at('198.51.100.71', { cookie: await remoteBrowser('198.51.100.75', true) }))
  await new Promise((r) => setTimeout(r, 80))
  assert.ok(requests(late.heard).some((r) => r.via === 'browser' && r.ip === '198.51.100.73'))
  assert.ok(!requests(late.heard).some((r) => r.via === 'manage'), 'no manage-rights requests in the backlog of a page that may not manage')
  assert.ok(requests(lateManager.heard).some((r) => r.via === 'manage' && r.ip === '198.51.100.72'))

  const ref = access.pendingViews().find((p) => p.via === 'manage' && p.ip === '198.51.100.72')!.id
  assert.equal((await send('POST', `/api/access/requests/${ref}`, { allow: false }, localPage())).status, 200)
  for (const s of [plain, manager, local, late, lateManager]) s.ws.close()
})
