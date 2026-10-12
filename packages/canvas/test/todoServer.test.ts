// TODOs and draft annotations through the canvas (docs/canvas.md "TODOs", "Annotations"): canvas_todo over the remote
// /mcp — open, list, check off with an answer, reopen; a read-only token lists but cannot write — the answer reaching
// the board's responder while the TODO itself wakes nobody, the counts canvas_context shows, and a draft annotation
// posted by the person going to the holder of the files.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, type RunningServer } from '../src/server.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { MemoryBoardRepository } from '../src/adapters/boards/index.js'
import type { Board, Item } from '../src/model.js'
import { calloutOf, annotationOf } from '../src/annotations.js'
import { addAnnotationToFile } from '../src/annotationFile.js'
import { unifiedDiff } from '../src/patch.js'
import { sha1 } from '../src/proposals.js'

const T0 = '2026-10-12T10:00:00.000Z'
const ES = 'events:\n  - id: paid\n    text: Order paid\nannotations:\n  - on: paid\n    text: Only after the bank says yes\n'
const it = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 160, h: 110, createdBy: 'agent', updatedBy: 'agent', updatedAt: T0, ...extra })

let srv: RunningServer
let base: string
const store = new MemoryBoardRepository()
const access = new AccessService({ store: new MemoryAccessStore() })
let A = ''
let R = ''
let RO = ''
before(async () => {
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access })
  base = `http://127.0.0.1:${srv.port}`
  A = access.createToken({ name: 'agent-a' }, 't').token
  R = access.createToken({ name: 'agent-r' }, 't').token
  RO = access.createToken({ name: 'reader', scope: 'read' }, 't').token
})
after(() => srv.close())

const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }
const as = (token?: string) => (token ? { ...REMOTE, authorization: `Bearer ${token}` } : {})
const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> })
async function mcp(token: string) {
  const c = new Client({ name: 't', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: as(token) } }))
  return c
}
const call = async (c: Client, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> }

/** A board with the shop flow drawn from its file by agent-a, answered by agent-r. */
async function shopBoard(): Promise<Board> {
  const b = store.create({ title: `todo-${Math.random().toString(36).slice(2, 7)}`, kind: 'freeform', items: [], meta: { responder: { mode: 'agent', agent: 'agent-r', by: 'user', at: T0 } } })
  const ta = await mcp(A)
  const drawn = await call(ta, 'design_draw', { name: 'design/shop.es.yaml', content: ES, board: b.id })
  assert.equal(drawn.isError, undefined, drawn.content[0].text)
  await ta.close()
  return store.get(b.id)!
}

test('the server draws a file\'s annotations as cards naming the file; a draft annotation by the person goes to the holder', async () => {
  const b = await shopBoard()
  const card = Object.values(b.items).find((i) => calloutOf(i) !== undefined)!
  assert.equal(card.text, 'Only after the bank says yes')
  assert.equal(card.target, 'shop-es.event.paid')
  assert.deepEqual(annotationOf(card), { on: 'paid', file: 'design/shop.es.yaml' })
  assert.equal(card.parent, 'diagram.shop-es')
  // the person's draft: the edit the web makes, and one without it (the file not on the board)
  const file = (b.meta!.diagrams as Record<string, { files: Record<string, string> }>)['shop-es'].files['design/shop.es.yaml']
  const edit = { file: 'design/shop.es.yaml', base: sha1(file), diff: unifiedDiff(file, addAnnotationToFile(file, { on: 'paid', text: 'Refunds start here' }), 'design/shop.es.yaml') }
  const drafts = [
    { id: 'draft1', type: 'comment', x: 0, y: 0, w: 260, h: 90, text: 'Refunds start here', target: 'shop-es.event.paid', data: { annotation: { draft: true, on: 'paid', file: 'design/shop.es.yaml' }, discuss: { about: ['shop-es.event.paid'], edit } } },
    { id: 'draft2', type: 'comment', x: 0, y: 0, w: 260, h: 90, text: 'The bank decides', target: 'shop-es.event.paid', data: { annotation: { draft: true, on: 'paid', file: 'design/shop.es.yaml' }, discuss: { about: ['shop-es.event.paid'] } } },
  ]
  const r = await send('POST', `/api/boards/${b.id}/ops`, { author: 'user', ops: drafts.map((item) => ({ kind: 'add', item })) })
  assert.equal(r.status, 200)
  for (const id of ['draft1', 'draft2']) assert.deepEqual(store.get(b.id)!.items[id].data?.to, ['agent-a'], `${id} goes to the holder, not to agent-r who answers the board`)
  const settings = await json(await fetch(`${base}/api/boards/${b.id}/settings`, { headers: as(A) }))
  assert.equal(settings.body.drafts, 2)
  const ctx = await call(await mcp(A), 'canvas_context', { id: b.id })
  assert.match(ctx.content[0].text, /Draft annotations waiting for the holder of the files: 2 — the person's own words/)
})

test('canvas_todo: open (nobody wakes), list, check off with an answer (it reaches "Answered by"), reopen; read-only lists only', async () => {
  const b = await shopBoard()
  const ta = await mcp(A)
  const tr = await mcp(R)
  const tro = await mcp(RO)
  assert.match((await call(ta, 'canvas_todo', { board: b.id })).content[0].text, /^No TODOs on board/)
  // agent-r waits for what is for it: a TODO wakes nobody
  const since = store.get(b.id)!.seq
  const waiting = fetch(`${base}/api/boards/${b.id}/wait?since=${since}&timeout=1200&quiet=50&author=others`, { headers: as(R) }).then((r) => r.json() as Promise<{ timedOut: boolean }>)
  await new Promise((r) => setTimeout(r, 50))
  const opened = await call(ta, 'canvas_todo', { board: b.id, text: 'Confirm the refund limit', on: 'shop-es.event.paid', ask: 'finance' })
  assert.equal(opened.isError, undefined, opened.content[0].text)
  const id = /Opened TODO (todo\.[a-z0-9]+) on event "Order paid": "Confirm the refund limit" — ask finance \(board seq \d+\)\. It wakes nobody/.exec(opened.content[0].text)?.[1]
  assert.ok(id, opened.content[0].text)
  assert.equal((await waiting).timedOut, true, 'the responder is not woken by a TODO')
  const todo = store.get(b.id)!.items[id!]
  assert.deepEqual(todo.data?.todo, { state: 'open', ask: 'finance' })
  assert.deepEqual([todo.target, todo.data?.to, todo.data?.route, todo.data?.by], ['shop-es.event.paid', [], 'todo', 'agent-a'])
  const loose = await call(ta, 'canvas_todo', { board: b.id, text: 'Ask legal about card numbers' })
  const looseId = /Opened TODO (todo\.[a-z0-9]+): /.exec(loose.content[0].text)![1]
  assert.equal(store.get(b.id)!.items[looseId].target, undefined)
  assert.equal((await call(ta, 'canvas_todo', { board: b.id, text: 'x', on: 'nope' })).isError, true)
  assert.equal((await call(ta, 'canvas_todo', { board: b.id, text: 'x', done: id })).isError, true, 'one thing at a time')
  // listing: also with a read-only token, which cannot write
  const list = await call(tro, 'canvas_todo', { board: b.id })
  assert.match(list.content[0].text, new RegExp(`☐ Confirm the refund limit \\[ask finance · on event "Order paid" · opened by agent-a\\]  #${id!.replace('.', '\\.')}`))
  assert.match(list.content[0].text, /☐ Ask legal about card numbers/)
  const refused = await call(tro, 'canvas_todo', { board: b.id, text: 'not allowed' })
  assert.equal(refused.isError, true)
  assert.equal(Object.values(store.get(b.id)!.items).filter((i) => i.text === 'not allowed').length, 0)
  // the context counts them
  assert.match((await call(tr, 'canvas_context', { id: b.id })).content[0].text, /TODOs: 2 open, 0 done/)
  // agent-a checks it off with an answer: agent-r (Answered by) wakes for the answer, not for the state change
  const since2 = store.get(b.id)!.seq
  const waiting2 = fetch(`${base}/api/boards/${b.id}/wait?since=${since2}&timeout=3000&quiet=50&author=others`, { headers: as(R) }).then((r) => r.json() as Promise<{ timedOut: boolean; lines: string[] }>)
  await new Promise((r) => setTimeout(r, 50))
  const done = await call(ta, 'canvas_todo', { board: b.id, done: id, answer: 'Up to 3 refunds a month' })
  assert.match(done.content[0].text, /^Checked off TODO todo\.[a-z0-9]+ "Confirm the refund limit" with the answer "Up to 3 refunds a month" — posted in its thread; it goes to agent-r, which decides whether the design changes/)
  const woke = await waiting2
  assert.equal(woke.timedOut, false)
  assert.ok(woke.lines.some((l) => /answered the TODO "Confirm the refund limit": "Confirmed: Up to 3 refunds a month"/.test(l)), woke.lines.join('\n'))
  assert.ok(woke.lines.some((l) => /TODO "Confirm the refund limit" \[todo\.[a-z0-9]+\]: checked off by agent-a — answer: "Up to 3 refunds a month"/.test(l)), woke.lines.join('\n'))
  const after = store.get(b.id)!.items[id!].data?.todo as Record<string, string>
  assert.deepEqual([after.state, after.answer, after.doneBy, after.ask], ['done', 'Up to 3 refunds a month', 'agent-a', 'finance'])
  const answer = Object.values(store.get(b.id)!.items).find((i) => i.target === id && i.data?.todoAnswer)!
  assert.equal(answer.text, 'Confirmed: Up to 3 refunds a month')
  assert.deepEqual(answer.data?.to, ['agent-r'])
  // without an answer: nobody is told
  const quiet = await call(tr, 'canvas_todo', { board: b.id, done: looseId })
  assert.match(quiet.content[0].text, /without an answer: nobody is notified/)
  assert.equal((store.get(b.id)!.items[looseId].data?.todo as { doneBy: string }).doneBy, 'agent-r')
  // reopen, and the list
  const re = await call(tr, 'canvas_todo', { board: b.id, reopen: id })
  assert.match(re.content[0].text, /^Reopened TODO todo\.[a-z0-9]+ "Confirm the refund limit"/)
  assert.deepEqual(store.get(b.id)!.items[id!].data?.todo, { state: 'open', ask: 'finance' })
  const listed = (await call(tr, 'canvas_todo', { board: b.id })).content[0].text
  assert.match(listed, /## TODOs — 1 open, 1 done/)
  assert.match(listed, /☑ Ask legal about card numbers — checked off without an answer by agent-r/)
  assert.match((await call(tr, 'canvas_todo', { board: b.id, done: 'shop-es.event.paid' })).content[0].text, /is not a TODO/)
  // the person checks one off through the page (ops): the canvas signs it as the person
  await send('POST', `/api/boards/${b.id}/ops`, { author: 'user', ops: [{ kind: 'update', id, patch: { data: { ...store.get(b.id)!.items[id!].data, todo: { state: 'done', doneBy: 'agent-a' } } } }] })
  assert.equal((store.get(b.id)!.items[id!].data?.todo as { doneBy: string }).doneBy, 'person')
  for (const c of [ta, tr, tro]) await c.close()
})
