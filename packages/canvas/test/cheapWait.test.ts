// Waiting cheaply (docs/canvas.md "Watching cheaply"): long waits, a one-line idle answer without the board context
// after the first wait, untilMention, keep-alives on a long GET /wait, and a client that goes away freeing the watcher.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { startServer, type RunningServer } from '../src/server.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { ProjectsBoardRepository } from '../src/adapters/boards/index.js'
import { CanvasClient } from '../src/client.js'
import { createMcpServer, idleLine } from '../src/mcp.js'
import { WAIT_DEFAULT_SEC, WAIT_MAX_SEC } from '../src/model.js'

const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }
const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `awd-cheapwait-${name}-`))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let srv: RunningServer
let base: string
let access: AccessService
let store: ProjectsBoardRepository

before(async () => {
  store = new ProjectsBoardRepository(tmp('srv'))
  access = new AccessService({ store: new MemoryAccessStore() })
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access, waitKeepAliveMs: 40 })
  base = `http://127.0.0.1:${srv.port}`
})
after(() => srv.close())

const local = (name?: string) => (name ? { 'x-unprose-agent': name } : {})
const remote = (token: string) => ({ ...REMOTE, authorization: `Bearer ${token}` })
const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const comment = (id: string, text: string) => ({ kind: 'add', item: { id, type: 'comment', x: 0, y: 0, w: 160, h: 80, text } })
const say = (boardId: string, id: string, text: string) => send('POST', `/api/boards/${boardId}/ops`, { author: 'user', ops: [comment(id, text)] })
const newBoard = () => store.create({ title: `t-${Math.random().toString(36).slice(2, 7)}`, kind: 'freeform' })
const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await sleep(10)
  return cond()
}

/** An MCP client on the stdio tools (in memory), over a canvas client whose `wait` can be swapped. */
async function stdio(client: CanvasClient) {
  const server = createMcpServer(client, { openBrowser: false })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const c = new Client({ name: 't', version: '1' })
  await c.connect(b)
  return c
}
const textOf = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text

test('canvas_wait: timeoutSec defaults to 300 and accepts up to 1800 (30 min); more is refused', async () => {
  assert.equal(WAIT_DEFAULT_SEC, 300)
  assert.equal(WAIT_MAX_SEC, 1800)
  const asked: number[] = []
  const fake = new CanvasClient(base, { token: '' })
  fake.wait = (async (_id: string, since: number, timeoutMs: number) => {
    asked.push(timeoutMs)
    return { since, seq: since, timedOut: true, changes: [], lines: [], notForYou: 0 }
  }) as CanvasClient['wait']
  const c = await stdio(fake)
  await c.callTool({ name: 'canvas_wait', arguments: { id: 'b_x', since: 4 } })
  await c.callTool({ name: 'canvas_wait', arguments: { id: 'b_x', since: 4, timeoutSec: 1800 } })
  const over = (await c.callTool({ name: 'canvas_wait', arguments: { id: 'b_x', since: 4, timeoutSec: 1801 } })) as { isError?: boolean }
  assert.deepEqual(asked, [300_000, 1_800_000])
  assert.equal(over.isError, true)
  await c.close()
})

test('the idle answer is one line, with the seq to wait from; the context comes only with the first wait and after it changes', async () => {
  const b = newBoard()
  await send('PUT', `/api/boards/${b.id}/settings`, { context: 'Meeting 2026-10-02: the signup flow' })
  const c = await stdio(new CanvasClient(base, { token: '', agentName: 'claude-a' }))
  const first = textOf(await c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: store.get(b.id)!.seq, timeoutSec: 1, quietSec: 0 } }))
  assert.match(first, /Board context[^\n]*:\nMeeting 2026-10-02/)
  const seq = store.get(b.id)!.seq
  const second = textOf(await c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: seq, timeoutSec: 1, quietSec: 0 } }))
  assert.equal(second, idleLine(b.id, seq))
  assert.equal(second, `nothing new on ${b.id} (seq ${seq}) — wait again with since: ${seq}`)
  assert.equal(second.split('\n').length, 1)
  await send('PUT', `/api/boards/${b.id}/settings`, { context: 'Meeting 2026-10-03: decided on e-mail login' })
  const third = textOf(await c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: store.get(b.id)!.seq, timeoutSec: 1, quietSec: 0 } }))
  assert.match(third, /decided on e-mail login/, 'a changed context comes again')
  assert.equal(third.split('\n').at(-1), idleLine(b.id, store.get(b.id)!.seq))
  // a meaningful result is unchanged: the diff lines
  const s = store.get(b.id)!.seq
  const woke = c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: s, timeoutSec: 5, quietSec: 0 } })
  await sleep(50)
  await say(b.id, 'cw1', 'why this step?')
  const t = textOf(await woke)
  assert.match(t, /^user changed the board \(seq \d+\):\n.*why this step/)
  await c.close()
})

test('changes for another agent are counted on the idle line', async () => {
  const b = newBoard()
  await send('PUT', `/api/boards/${b.id}/settings`, { answeredBy: 'codex-b' })
  const c = await stdio(new CanvasClient(base, { token: '', agentName: 'claude-a' }))
  const seq0 = store.get(b.id)!.seq
  const w = c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: seq0, timeoutSec: 1, quietSec: 0 } })
  await sleep(50)
  await say(b.id, 'o1', 'for codex')
  const t = textOf(await w)
  const seq = store.get(b.id)!.seq
  assert.equal(t, `nothing new on ${b.id} (seq ${seq}; 1 change(s) for others) — wait again with since: ${seq}`)
  await c.close()
})

test('untilMention: as the responder, a plain comment does not wake you; an @mention does', async () => {
  const b = newBoard()
  await send('PUT', `/api/boards/${b.id}/settings`, { answeredBy: 'claude-a' })
  // claude-a must be known for the mention to resolve: it has waited here
  await (await fetch(`${base}/api/boards/${b.id}/wait?timeout=10`, { headers: local('claude-a') })).json()
  const s0 = store.get(b.id)!.seq
  const plain = fetch(`${base}/api/boards/${b.id}/wait?since=${s0}&timeout=400&quiet=0&author=user&until=mention`, { headers: local('claude-a') }).then((r) => r.json())
  await sleep(50)
  await say(b.id, 'm1', 'looks fine to me')
  const p = await plain
  assert.equal(p.timedOut, true, 'a comment for the responder does not wake it with until=mention')
  assert.equal(p.notMentioned, 1)
  // without until=mention the same comment wakes it
  const normal = await (await fetch(`${base}/api/boards/${b.id}/wait?since=${s0}&timeout=200&quiet=0&author=user`, { headers: local('claude-a') })).json()
  assert.equal(normal.timedOut, false)
  const s1 = store.get(b.id)!.seq
  const c = await stdio(new CanvasClient(base, { token: '', agentName: 'claude-a' }))
  const idle = textOf(await c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: s0, timeoutSec: 1, quietSec: 0, untilMention: true } }))
  assert.match(idle, /^nothing new on .* \(seq \d+; 1 not addressed to you\) — wait again with since: \d+$/)
  const w = c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: s1, timeoutSec: 5, quietSec: 0, untilMention: true } })
  await sleep(50)
  await say(b.id, 'm2', '@claude-a can you check this?')
  assert.match(textOf(await w), /can you check this/)
  await c.close()
})

test('a long GET /wait keeps the connection alive with spaces and still answers JSON', async () => {
  const b = newBoard()
  const s = store.get(b.id)!.seq
  const res = fetch(`${base}/api/boards/${b.id}/wait?since=${s}&timeout=${WAIT_MAX_SEC * 1000 + 99_999}&quiet=0`).then(async (r) => ({ status: r.status, text: await r.text() }))
  await sleep(150) // a few keep-alive ticks (40 ms in this server)
  await say(b.id, 'k1', 'hello')
  const r = await res
  assert.equal(r.status, 200)
  assert.match(r.text, /^ +\{/, 'spaces before the JSON')
  const j = JSON.parse(r.text)
  assert.equal(j.timedOut, false)
  assert.match(j.lines.join('\n'), /hello/)
  // and the client reads it like any answer
  const s2 = store.get(b.id)!.seq
  const w = new CanvasClient(base, { token: '' }).wait(b.id, s2, 60_000, 'user', 0)
  await sleep(150)
  await say(b.id, 'k2', 'again')
  assert.match((await w).lines.join('\n'), /again/)
})

test('a client that goes away frees the watcher at once (HTTP and the stdio tool)', async () => {
  const b = newBoard()
  const ac = new AbortController()
  const pending = fetch(`${base}/api/boards/${b.id}/wait?since=${store.get(b.id)!.seq}&timeout=600000`, { headers: local('gone-a'), signal: ac.signal }).catch(() => undefined)
  assert.ok(await until(() => store.watcherNames(b.id).includes('gone-a')), 'watching while the wait is open')
  ac.abort()
  await pending
  assert.ok(await until(() => store.watchers(b.id) === 0), 'the watcher slot is freed when the request closes')
  // the MCP tool: a cancelled call aborts its HTTP wait
  const c = await stdio(new CanvasClient(base, { token: '', agentName: 'gone-b' }))
  const ac2 = new AbortController()
  const call = c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: store.get(b.id)!.seq, timeoutSec: 1800 } }, undefined, { signal: ac2.signal, timeout: 3_600_000 }).catch((e: Error) => e)
  assert.ok(await until(() => store.watcherNames(b.id).includes('gone-b')))
  ac2.abort()
  assert.ok((await call) instanceof Error)
  assert.ok(await until(() => store.watchers(b.id) === 0), 'cancelling canvas_wait frees the watcher')
  await c.close()
})

test('remote /mcp: one-line idle answers, the context once per agent and board (and again after a change), a cancel frees the watcher', async () => {
  const b = newBoard()
  await send('PUT', `/api/boards/${b.id}/settings`, { context: 'Remote meeting notes' })
  const tok = access.createToken({ name: 'codex-cheap' }, 't').token
  const c = new Client({ name: 't', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(tok) } }))
  const first = textOf(await c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: store.get(b.id)!.seq, timeoutSec: 1, quietSec: 0 } }))
  assert.match(first, /Board context[^\n]*:\nRemote meeting notes/)
  const seq = store.get(b.id)!.seq
  const second = textOf(await c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: seq, timeoutSec: 1, quietSec: 0 } }))
  assert.equal(second, idleLine(b.id, seq), 'stateless, yet the context is not repeated')
  await send('PUT', `/api/boards/${b.id}/settings`, { context: 'Remote meeting notes, updated' })
  const third = textOf(await c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: store.get(b.id)!.seq, timeoutSec: 1, quietSec: 0 } }))
  assert.match(third, /Remote meeting notes, updated/)
  // another agent on the same board still gets it the first time
  const tok2 = access.createToken({ name: 'gemini-cheap' }, 't').token
  const c2 = new Client({ name: 't2', version: '1' })
  await c2.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(tok2) } }))
  assert.match(textOf(await c2.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: store.get(b.id)!.seq, timeoutSec: 1, quietSec: 0 } })), /Remote meeting notes, updated/)
  await c2.close()
  // a long wait over /mcp, cancelled by the client: the canvas ends it and frees the watcher
  const ac = new AbortController()
  const call = c.callTool({ name: 'canvas_wait', arguments: { id: b.id, since: store.get(b.id)!.seq, timeoutSec: 1800 } }, undefined, { signal: ac.signal, timeout: 3_600_000 }).catch((e: Error) => e)
  assert.ok(await until(() => store.watcherNames(b.id).includes('codex-cheap')), 'watching over /mcp')
  ac.abort()
  assert.ok((await call) instanceof Error)
  assert.ok(await until(() => store.watchers(b.id) === 0), 'the cancel reaches the stateless endpoint')
  await c.close()
})
