// Several agents on one board (docs/canvas.md "Several agents on one board"): who answers the board, @mentions and
// thread stickiness, agents asking each other (and the loop guard / rate limit), the board context, the holder of
// the files and proposals routed to it, renaming an agent, feedback about Unprose — and who may change what.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, type RunningServer } from '../src/server.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { MemoryFeedbackStore, FileFeedbackStore } from '../src/adapters/feedback/index.js'
import { ProjectsBoardRepository } from '../src/adapters/boards/index.js'
import { applyOps, type Board, type Change, type Item, type Op } from '../src/model.js'
import { addressedTo, asksMe, mentionIn, recipientsOf, redactHolders, routeOf, stampHolders, stampRouting, withoutCredentials, holderOfFile, soleHolder, renameInMeta } from '../src/routing.js'
import { outline } from '../src/diff.js'
import { sha1 } from '../src/proposals.js'
import { unifiedDiff } from '../src/patch.js'

// a sample repo root on machine B, built at run time (the public export rejects literal home paths)
const ROOT_B = ['', 'Users', 'b', 'team-notes'].join('/')

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `awd-agents-${name}-`))
const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }
const T0 = '2026-10-02T10:00:00.000Z'
const it = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 120, h: 60, createdBy: 'agent', updatedBy: 'agent', updatedAt: T0, ...extra })
const ES = 'events:\n  - text: Order placed\n'

/** A board with one diagram frame drawn from design/shop.es.yaml, held by `holder`. */
function heldBoard(meta: Record<string, unknown> = {}, holder = 'codex-b'): Board {
  const items: Record<string, Item> = {
    'diagram.shop-es': it('diagram.shop-es', { type: 'frame', text: 'Shop', w: 800, h: 400, data: { diagram: { kind: 'event-storming', key: 'shop-es', source: 'design/shop.es.yaml' } } }),
    'shop-es.event.order': it('shop-es.event.order', { text: 'Order placed', parent: 'diagram.shop-es', x: 20, y: 20 }),
  }
  return { id: 'b1', title: 'Shop', kind: 'freeform', seq: 1, createdAt: T0, updatedAt: T0, items, meta: { diagrams: { 'shop-es': { kind: 'event-storming', source: 'design/shop.es.yaml', files: { 'design/shop.es.yaml': ES }, holder: { agent: holder, machine: 'mbp-b', root: ROOT_B, repo: 'team-notes', at: T0 } } }, ...meta } }
}

/** Add comments one by one, stamped like the server does (each a little later than the one before). */
function post(board: Board, items: Item[], known: string[] = ['codex-b', 'claude-a'], maxTurns?: number): Board {
  let b = board
  let n = 0
  for (const c of items) {
    const now = new Date(Date.parse(T0) + 1000 * ++n + b.seq * 60_000).toISOString()
    const ops = stampRouting(b, [{ kind: 'add', item: c }], known, now, (x, o) => applyOps(x, o, c.createdBy).board, maxTurns)
    b = { ...applyOps(b, ops, c.createdBy).board, seq: b.seq + 1 }
  }
  return b
}
const person = (id: string, text: string, target?: string): Item => it(id, { type: 'comment', text, createdBy: 'user', updatedBy: 'user', ...(target ? { target } : {}) })
const agentSays = (id: string, by: string, text: string, target?: string): Item => it(id, { type: 'comment', text, ...(target ? { target } : {}), data: by === 'agent' ? {} : { by } })

// ── the pure rules ─────────────────────────────────────────────────────────────

test('mentions: @name of a known agent (longest that fits, word boundary), @studio is the default local agent', () => {
  const known = ['codex-b', 'codex', 'agent on mbp', 'claude-a']
  assert.equal(mentionIn('@codex-b can you look?', known), 'codex-b')
  assert.equal(mentionIn('ask @codex please', known), 'codex')
  assert.equal(mentionIn('@Agent on MBP: hi', known), 'agent on mbp')
  assert.equal(mentionIn('hey @studio', known), 'agent')
  assert.equal(mentionIn('mail me at river@codex-b.dev', known), undefined, 'an e-mail address is not a mention')
  assert.equal(mentionIn('@codexy', known), undefined)
  assert.equal(mentionIn('no mention', known), undefined)
})

test('no responder, no mention, no holder: a comment is for anyone (as before)', () => {
  const b = post(heldBoard(), [person('c1', 'hello', 'shop-es.event.order')])
  assert.equal(b.items.c1.data?.to, undefined)
  assert.equal(addressedTo(b, { seq: 2, ts: T0, author: 'user', boardId: 'b1', ops: [{ kind: 'add', item: b.items.c1 }], before: {} }, 'claude-a'), true)
})

test('responder: the person\'s comments go to the agent that answers the board; a thread an agent started comes back to it', () => {
  const b0 = heldBoard({ responder: { mode: 'agent', agent: 'codex-b' } })
  const b = post(b0, [person('c1', 'why is this here?', 'shop-es.event.order'), agentSays('q1', 'claude-a', 'I have a question for you', 'shop-es.event.order'), person('q2', 'yes?', 'q1')])
  assert.deepEqual(b.items.c1.data?.to, ['codex-b'])
  assert.equal(b.items.c1.data?.route, 'responder')
  assert.deepEqual(b.items.q2.data?.to, ['codex-b', 'claude-a'], 'claude-a started the thread, so the answer reaches it too')
  const studio = post(heldBoard({ responder: { mode: 'studio' } }), [person('c1', 'hi', 'shop-es.event.order')])
  assert.deepEqual(studio.items.c1.data?.to, ['agent'])
  assert.equal(addressedTo(studio, change(studio, 'c1'), 'agent'), true)
  assert.equal(addressedTo(studio, change(studio, 'c1'), 'codex-b'), false)
})

test('@mention overrides the responder for its thread, and replies in the thread keep going to it', () => {
  const b0 = heldBoard({ responder: { mode: 'agent', agent: 'codex-b' } })
  const b = post(b0, [person('m1', '@claude-a what do you think?', 'shop-es.event.order'), person('m2', 'and the other one?', 'm1'), agentSays('m3', 'claude-a', 'I think…', 'm1'), person('m4', 'thanks', 'm1')])
  assert.deepEqual(b.items.m1.data?.to, ['claude-a'])
  assert.equal(b.items.m1.data?.mention, 'claude-a')
  assert.deepEqual(b.items.m2.data?.to, ['claude-a'], 'sticky: a plain reply in the thread goes to the mentioned agent')
  assert.deepEqual(b.items.m3.data?.to, [], 'the mentioned agent answering the person wakes no other agent')
  assert.deepEqual(b.items.m4.data?.to, ['claude-a'])
  // a later mention in the thread takes it over
  const b2 = post(b, [person('m5', '@codex-b over to you', 'm1'), person('m6', 'well?', 'm1')])
  assert.deepEqual(b2.items.m6.data?.to, ['codex-b'])
})

test('agent → agent: a mention wakes the other agent, its answer goes back to the asker (even while it waits for the person)', () => {
  const b = post(heldBoard(), [agentSays('a1', 'codex-b', '@claude-a what was hard?', 'shop-es.event.order'), agentSays('a2', 'claude-a', 'the redraw', 'a1'), agentSays('a3', 'codex-b', 'why?', 'a1')])
  assert.deepEqual(b.items.a1.data?.to, ['claude-a'])
  assert.deepEqual(b.items.a2.data?.to, ['codex-b'])
  assert.deepEqual(b.items.a3.data?.to, ['claude-a'])
  const ch = (id: string, by: string): Change => ({ seq: 9, ts: T0, author: 'agent', by, boardId: 'b1', ops: [{ kind: 'add', item: b.items[id] }], before: {} })
  assert.equal(asksMe(b, ch('a1', 'codex-b'), 'claude-a'), true)
  assert.equal(asksMe(b, ch('a2', 'claude-a'), 'codex-b'), true)
  assert.equal(asksMe(b, ch('a1', 'codex-b'), 'codex-b'), false, 'never your own')
  // an agent's comment routed only by the responder does not wake while the responder waits for the person
  const r = post(heldBoard({ responder: { mode: 'agent', agent: 'codex-b' } }), [agentSays('x1', 'claude-a', 'just a note', 'shop-es.event.order')])
  assert.equal(asksMe(r, { seq: 9, ts: T0, author: 'agent', by: 'claude-a', boardId: 'b1', ops: [{ kind: 'add', item: r.items.x1 }], before: {} }, 'codex-b'), false)
})

test('loop guard: past N agent messages in a row a thread pauses (wakes nobody) until the person replies', () => {
  const msgs: Item[] = [agentSays('l0', 'codex-b', '@claude-a let us talk', 'shop-es.event.order')]
  for (let i = 1; i <= 4; i++) msgs.push(agentSays(`l${i}`, i % 2 ? 'claude-a' : 'codex-b', `turn ${i}`, 'l0'))
  const b = post(heldBoard(), msgs, undefined, 3)
  assert.deepEqual(b.items.l2.data?.to, ['claude-a'], 'three agent messages are fine')
  assert.equal(b.items.l3.data?.paused, true, 'the fourth pauses')
  assert.deepEqual(b.items.l3.data?.to, [])
  assert.equal(b.items.l4.data?.route, 'paused')
  const resumed = post(b, [person('p1', 'go on', 'l0'), agentSays('l5', 'claude-a', 'ok', 'l0')], undefined, 3)
  assert.equal(resumed.items.l5.data?.paused, undefined, "the person's reply resets the count")
  assert.deepEqual(resumed.items.l5.data?.to, ['codex-b'])
})

test('proposals go to the holder of the files (and back to the proposer), whoever answers the board', () => {
  const b0 = heldBoard({ responder: { mode: 'studio' } }, 'claude-a')
  const prop = it('p1', { type: 'comment', text: 'rename the event', target: 'diagram.shop-es', data: { by: 'codex-b', discuss: { about: ['diagram.shop-es'], edit: { file: 'design/shop.es.yaml', base: sha1(ES), diff: '@@', by: 'codex-b' } } } })
  const b = post(b0, [prop, person('p2', 'ok, apply it', 'p1')])
  assert.deepEqual(b.items.p1.data?.to, ['claude-a'])
  assert.equal(b.items.p1.data?.route, 'proposal')
  assert.deepEqual(b.items.p2.data?.to, ['claude-a', 'codex-b'])
  assert.equal(holderOfFile(b.meta, 'design/shop.es.yaml')?.agent, 'claude-a')
  // a UI proposal on an item (data.pending) goes to the holder of its diagram
  const pending: Change = { seq: 5, ts: T0, author: 'user', boardId: 'b1', ops: [{ kind: 'update', id: 'shop-es.event.order', patch: { data: { pending: { kind: 'text' } } } }], before: { 'shop-es.event.order': b.items['shop-es.event.order'] } }
  assert.equal(addressedTo(b, pending, 'claude-a'), true)
  assert.equal(addressedTo(b, pending, 'agent'), false)
})

test('a caller cannot route a comment by writing data.to; receipts keep the stamps (they stay bookkeeping)', () => {
  const b0 = heldBoard({ responder: { mode: 'agent', agent: 'codex-b' } })
  const forged = person('f1', 'hi', 'shop-es.event.order')
  forged.data = { to: ['claude-a'], route: 'mention', paused: true }
  const b = post(b0, [forged])
  assert.deepEqual(b.items.f1.data?.to, ['codex-b'])
  assert.equal(b.items.f1.data?.paused, undefined)
  const receipt: Op = { kind: 'update', id: 'f1', patch: { data: { ...b.items.f1.data, seenBy: ['agent'], to: ['nobody'] } } }
  const [out] = stampRouting(b, [receipt], [], T0, (x, o) => applyOps(x, o, 'agent').board)
  assert.deepEqual((out as Extract<Op, { kind: 'update' }>).patch.data?.to, ['codex-b'])
})

test('holders: stamped from the caller (never forged), copies kept, machine and paths hidden from viewers elsewhere', () => {
  const cur = heldBoard().meta
  // a remote viewer read the meta without paths and writes it back with another diagram: the holder stays whole
  const copied = stampHolders(cur, { ...redactHolders(cur), diagrams: { ...(redactHolders(cur)!.diagrams as object), other: { kind: 'kanban', source: 'k.yaml', holder: { agent: 'codex-b' } } } }, 'sneaky', '2026-10-02T11:00:00Z')
  const d = copied.diagrams as Record<string, { holder: Record<string, string> }>
  assert.equal(d['shop-es'].holder.root, ROOT_B, 'an unchanged copy keeps the stored holder')
  assert.equal(d.other.holder.agent, 'sneaky', 'a new holder is always the caller')
  const redacted = redactHolders(cur) as { diagrams: Record<string, { holder: Record<string, string> }> }
  assert.equal(redacted.diagrams['shop-es'].holder.machine, undefined)
  assert.equal(redacted.diagrams['shop-es'].holder.root, undefined)
  assert.equal(redacted.diagrams['shop-es'].holder.repo, 'team-notes')
  assert.equal(withoutCredentials('https://river:ghp_x@github.com/r/w.git'), 'https://github.com/r/w.git')
  assert.equal(soleHolder(cur), 'codex-b')
  assert.equal((renameInMeta({ ...cur, responder: { mode: 'agent', agent: 'codex-b' } }, 'codex-b', 'codex-mbp')!.responder as { agent: string }).agent, 'codex-mbp')
  assert.ok(outline({ ...heldBoard({ context: { text: 'Meeting 2026-10-02: shop flow' }, responder: { mode: 'agent', agent: 'codex-b' } }) }).includes('Board context'))
  assert.ok(!outline(heldBoard()).includes(['', 'Users', 'b'].join('/')), 'the outline never prints paths')
})

function change(b: Board, id: string): Change {
  return { seq: b.seq, ts: T0, author: b.items[id].createdBy, boardId: b.id, ops: [{ kind: 'add', item: b.items[id] }], before: {} }
}

// ── the server ─────────────────────────────────────────────────────────────────

let srv: RunningServer
let base: string
let access: AccessService
let store: ProjectsBoardRepository
const feedback = new MemoryFeedbackStore()

before(async () => {
  store = new ProjectsBoardRepository(tmp('srv'))
  access = new AccessService({ store: new MemoryAccessStore() })
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access, feedback, agentMentions: { max: 3, windowMs: 60_000 } })
  base = `http://127.0.0.1:${srv.port}`
})
after(() => srv.close())

const remote = (token?: string) => ({ ...REMOTE, ...(token ? { authorization: `Bearer ${token}` } : {}) })
const local = (name?: string) => (name ? { 'x-unprose-agent': name } : {})
const call = (p: string, init: RequestInit = {}) => fetch(base + p, init)
const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) => call(p, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const comment = (id: string, text: string, target?: string, data?: Record<string, unknown>) => ({ kind: 'add', item: { id, type: 'comment', x: 0, y: 0, w: 160, h: 80, text, ...(target ? { target } : {}), ...(data ? { data } : {}) } })
const wait = async (id: string, since: number, headers: Record<string, string>, q = '') => (await call(`/api/boards/${id}/wait?since=${since}&timeout=700&quiet=50${q}`, { headers })).json()
function newBoard(meta?: Record<string, unknown>): Board {
  const b = heldBoard(meta)
  return store.create({ title: `t-${Math.random().toString(36).slice(2, 7)}`, kind: 'freeform', items: Object.values(b.items), meta: b.meta })
}

test('settings: the person sets "Answered by" and the context (logged, on the page and in the diff); read-only tokens cannot', async () => {
  const b = newBoard()
  const r = await send('PUT', `/api/boards/${b.id}/settings`, { answeredBy: 'codex-b', context: 'Meeting 2026-10-02: the shop flow — see docs/meetings/2026-10-02.md' })
  assert.equal(r.status, 200)
  const s = await r.json()
  assert.equal(s.answeredBy, 'codex-b')
  assert.match(s.context.text, /Meeting 2026-10-02/)
  const last = store.changes(b.id).at(-1)!
  assert.deepEqual(last.ops, [])
  assert.match(last.note!, /Answered by.*codex-b.*updated the board context/)
  assert.equal((store.get(b.id)!.meta!.responder as { agent: string }).agent, 'codex-b')
  const diff = await (await call(`/api/boards/${b.id}/diff?since=${b.seq}&author=user`)).json()
  assert.match(diff.lines.join('\n'), /set "Answered by" to codex-b/)
  const ro = access.createToken({ name: 'reader', scope: 'read' }, 't').token
  assert.equal((await send('PUT', `/api/boards/${b.id}/settings`, { context: 'nope' }, remote(ro))).status, 403)
  assert.equal((await call(`/api/boards/${b.id}/settings`, { headers: remote(ro) })).status, 200, 'but it can read them')
  // a PUT of the whole meta (a redraw) never changes them
  await send('PUT', `/api/boards/${b.id}`, { meta: { ...store.get(b.id)!.meta, responder: { mode: 'any' }, context: { text: 'overwritten' } } })
  assert.equal((store.get(b.id)!.meta!.responder as { agent: string }).agent, 'codex-b')
  assert.match((store.get(b.id)!.meta!.context as { text: string }).text, /Meeting/)
  assert.equal((await send('PUT', `/api/boards/${b.id}/settings`, { context: 'x'.repeat(5000) })).status, 400)
})

test('canvas_wait: only what is for you wakes you — the responder, then an @mention overriding it; others hear "not for you"', async () => {
  const b = newBoard()
  const codex = access.createToken({ name: 'codex-b' }, 't').token
  await send('PUT', `/api/boards/${b.id}/settings`, { answeredBy: 'codex-b' })
  const since = store.get(b.id)!.seq
  const forCodex = wait(b.id, since, remote(codex), '&author=user')
  const forClaude = wait(b.id, since, local('claude-a'), '&author=user')
  await new Promise((r) => setTimeout(r, 50))
  await send('POST', `/api/boards/${b.id}/ops`, { author: 'user', ops: [comment('w1', 'why this event?', 'shop-es.event.order')] })
  const [c, a] = await Promise.all([forCodex, forClaude])
  assert.equal(c.timedOut, false)
  assert.match(c.lines.join('\n'), /why this event/)
  assert.equal(a.timedOut, true, 'claude-a is not the responder')
  assert.equal(a.notForYou, 1)
  assert.equal(a.answeredBy, 'codex-b')
  // @claude-a overrides it for that thread
  const s2 = store.get(b.id)!.seq
  const claude2 = wait(b.id, s2, local('claude-a'), '&author=user')
  const codex2 = wait(b.id, s2, remote(codex), '&author=user')
  await new Promise((r) => setTimeout(r, 50))
  await send('POST', `/api/boards/${b.id}/ops`, { author: 'user', ops: [comment('w2', '@claude-a you drew the other one — thoughts?', 'shop-es.event.order')] })
  const [a2, c2] = await Promise.all([claude2, codex2])
  assert.equal(a2.timedOut, false)
  assert.equal(c2.timedOut, true)
  // listen to everything
  const all = await (await call(`/api/boards/${b.id}/wait?since=${since}&timeout=200&quiet=0&author=user&to=all`, { headers: local('claude-a') })).json()
  assert.equal(all.lines.length >= 2, true)
})

test('the board context and "Answered by" come with the wait answer, the outline and the settings', async () => {
  const b = newBoard()
  await send('PUT', `/api/boards/${b.id}/settings`, { context: 'Meeting 2026-10-02: decided on the shop flow' })
  const w = await (await call(`/api/boards/${b.id}/wait?since=0&timeout=100&quiet=0`)).json()
  assert.match(w.context.text, /decided on the shop flow/)
  const o = await (await call(`/api/boards/${b.id}/outline`)).text()
  assert.match(o, /Board context:\n {2}Meeting 2026-10-02/)
  assert.match(o, /Files of shop-es \(design\/shop\.es\.yaml\): held by codex-b in team-notes/)
})

test('holders: recorded on a redraw with the caller\'s name; machine and repo root hidden from remote viewers', async () => {
  const b = store.create({ title: 'held', kind: 'freeform' })
  const codex = access.createToken({ name: 'codex-mac' }, 't').token
  const meta = { diagrams: { k: { kind: 'kanban', source: 'design/k.kanban.yaml', files: { 'design/k.kanban.yaml': 'columns: []\n' }, holder: { agent: 'someone-else', machine: 'mac-b', root: ROOT_B, repo: 'team-notes', remote: 'https://u:p@github.com/b/team-notes.git' } } } }
  await send('PUT', `/api/boards/${b.id}`, { meta }, remote(codex))
  const h = (store.get(b.id)!.meta!.diagrams as Record<string, { holder: Record<string, string> }>).k.holder
  assert.equal(h.agent, 'codex-mac', 'the holder is whoever drew it, not what it says')
  assert.equal(h.remote, 'https://github.com/b/team-notes.git')
  assert.ok(h.at)
  const seenRemote = (await (await call(`/api/boards/${b.id}`, { headers: remote(codex) })).json()).board.meta.diagrams.k.holder
  assert.equal(seenRemote.machine, undefined)
  assert.equal(seenRemote.root, undefined)
  assert.equal(seenRemote.repo, 'team-notes')
  const seenLocal = (await (await call(`/api/boards/${b.id}`)).json()).board.meta.diagrams.k.holder
  assert.equal(seenLocal.root, ROOT_B)
  const listed = (await (await call('/api/boards', { headers: remote(codex) })).json()).boards.find((x: { id: string }) => x.id === b.id)
  assert.equal(listed.meta.diagrams.k.holder.root, undefined)
  const settings = await (await call(`/api/boards/${b.id}/settings`)).json()
  assert.equal(settings.suggestion, 'codex-mac', 'a board whose files one agent holds suggests it as the responder')
})

test('a board an agent draws from its files is answered by it; a proposal goes to the holder, who wakes for it', async () => {
  const codex = access.createToken({ name: 'codex-new' }, 't').token
  const created = await (await send('POST', '/api/boards', { title: 'new from files', kind: 'freeform', answeredBy: 'me' }, remote(codex))).json()
  assert.equal(created.board.meta.responder.agent, 'codex-new')
  const plain = await (await send('POST', '/api/boards', { title: 'by hand', kind: 'freeform', answeredBy: 'me' })).json()
  assert.equal(plain.board.meta?.responder, undefined, 'the default local agent leaves the default')
  // claude-a (a local named agent) holds the file; codex proposes; claude-a waits for the person and still wakes
  const b = newBoard()
  await send('PUT', `/api/boards/${b.id}`, { meta: { ...store.get(b.id)!.meta, diagrams: { 'shop-es': { ...(store.get(b.id)!.meta!.diagrams as Record<string, object>)['shop-es'], holder: { repo: 'shop' } } } } }, local('claude-a'))
  const since = store.get(b.id)!.seq
  const claude = wait(b.id, since, local('claude-a'), '&author=user')
  const other = wait(b.id, since, local('gemini'), '&author=others')
  await new Promise((r) => setTimeout(r, 50))
  const diff = unifiedDiff(ES, ES.replace('Order placed', 'Order submitted'), 'design/shop.es.yaml')
  const r = await send('POST', `/api/boards/${b.id}/proposals`, { file: 'design/shop.es.yaml', base: sha1(ES), diff, note: 'clearer name' }, remote(codex))
  assert.equal(r.status, 201)
  const [c, g] = await Promise.all([claude, other])
  assert.equal(c.timedOut, false, 'the holder wakes for a proposal to its files')
  assert.match(c.lines.join('\n'), /proposed an edit to design\/shop\.es\.yaml/)
  assert.equal(g.timedOut, true, 'another agent does not')
})

test('renaming an agent on the Connected agents page: its name on boards (responder, holders) follows', async () => {
  const { agent } = access.createToken({ name: 'agent on mbp' }, 't')
  const b = newBoard({ responder: { mode: 'agent', agent: 'agent on mbp' } })
  const r = await send('PATCH', `/api/access/agents/${agent.id}`, { name: 'codex-b2' }, { origin: base })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).name, 'codex-b2')
  assert.equal((store.get(b.id)!.meta!.responder as { agent: string }).agent, 'codex-b2')
  const tok = access.createToken({ name: 'other' }, 't').token
  assert.equal((await send('PATCH', `/api/access/agents/${agent.id}`, { name: 'x' }, remote(tok))).status, 403, 'an agent token cannot rename')
  assert.equal(access.createToken({ name: 'studio' }, 't').agent.name, 'studio-2', '"studio" means the local agent')
})

test('agents talking: canvas_ask over /mcp gets the other agent\'s answer; the rate limit stops a flood', async () => {
  const b = newBoard()
  const codex = access.createToken({ name: 'codex-ask' }, 't').token
  const client = new Client({ name: 't', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(codex) } }))
  // claude-a answers whatever it is asked, as soon as it is asked
  const answer = (async () => {
    const w = await (await call(`/api/boards/${b.id}/wait?since=${store.get(b.id)!.seq}&timeout=5000&quiet=0`, { headers: local('claude-a') })).json()
    const q = (w.changes as Change[]).flatMap((c) => c.ops).find((o) => o.kind === 'add' && o.item.type === 'comment') as Extract<Op, { kind: 'add' }>
    await send('POST', `/api/boards/${b.id}/ops`, { author: 'agent', ops: [comment('ans1', 'the redraw was slow', q.item.id)] }, local('claude-a'))
  })()
  const res = (await client.callTool({ name: 'canvas_ask', arguments: { id: b.id, agent: 'claude-a', question: 'what was hard?', about: ['shop-es.event.order'], timeoutSec: 5 } })) as { content: Array<{ text: string }> }
  await answer
  assert.match(res.content[0].text, /claude-a answered in thread ask\..*\nthe redraw was slow/)
  const q = Object.values(store.get(b.id)!.items).find((i) => i.text?.startsWith('@claude-a'))!
  assert.deepEqual(q.data?.to, ['claude-a'])
  assert.deepEqual(store.get(b.id)!.items.ans1.data?.to, ['codex-ask'], 'the answer goes back to the asker')
  // three asks per minute in this server: the fourth is refused
  const ask = (n: number) => send('POST', `/api/boards/${b.id}/ops`, { ops: [comment(`r${n}`, `@claude-a question ${n}`, 'shop-es.event.order')] }, remote(codex))
  assert.equal((await ask(2)).status, 200)
  assert.equal((await ask(3)).status, 200)
  const refused = await ask(4)
  assert.equal(refused.status, 429)
  assert.match((await refused.json()).error, /asked other agents/)
  const ctx = (await client.callTool({ name: 'canvas_context', arguments: { id: b.id, text: 'Interview: what was hard?' } })) as { content: Array<{ text: string }> }
  assert.match(ctx.content[0].text, /Board context \(from codex-ask/)
  await client.close()
})

test('feedback: any agent records it; only this machine (or a manage page) reads it; stored outside projects', async () => {
  const tok = access.createToken({ name: 'codex-fb', scope: 'read' }, 't').token
  const r = await send('POST', '/api/feedback', { text: 'canvas_files should say which agent holds the file', about: ['canvas_files'] }, remote(tok))
  assert.equal(r.status, 201)
  assert.equal((await send('POST', '/api/feedback', { text: '' }, remote(tok))).status, 400)
  assert.equal((await call('/api/feedback', { headers: remote(tok) })).status, 403)
  const list = await (await call('/api/feedback')).json()
  assert.equal(list.feedback.at(-1).by, 'codex-fb')
  assert.equal((await (await call('/api/access/feedback')).json()).feedback.length >= 1, true)
  const client = new Client({ name: 't', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(tok) } }))
  const sent = (await client.callTool({ name: 'unprose_feedback', arguments: { text: 'from the tool' } })) as { content: Array<{ text: string }> }
  assert.match(sent.content[0].text, /recorded as fb_/)
  const denied = (await client.callTool({ name: 'unprose_feedback_list', arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> }
  assert.equal(denied.isError, true)
  await client.close()
  const file = path.join(tmp('fb'), 'feedback.ndjson')
  const fs2 = new FileFeedbackStore(file)
  fs2.append({ id: 'fb_1', at: T0, by: 'x', via: 'agent', text: 'hi' })
  assert.equal(new FileFeedbackStore(file).list()[0].text, 'hi')
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600')
})

test('presence says when each agent last watched (the page shows "<name> is away")', async () => {
  const b = newBoard()
  await wait(b.id, store.get(b.id)!.seq, local('claude-a'), '&timeout=50')
  assert.ok(store.watcherSeen(b.id)['claude-a'])
  assert.deepEqual(recipientsOf(store.get(b.id)!, store.get(b.id)!.items['shop-es.event.order']), undefined)
  assert.equal(routeOf(heldBoard(), person('z', 'x')).route, undefined)
})
