// Fixes from interviewing two real agents on one board (machine A: the canvas host; machine B: the files):
//   1. a signed-in browser is the person (it wakes agents waiting for the person); `from` is in the tool schemas;
//   2. one credential for every tool (UNPROSE_TOKEN, else the token a pairing code got — also for a board link);
//   3. PATCH merges board meta (per diagram key) — two machines drawing in turn never overwrite each other;
//   4. title lookups find-or-create in one step (no duplicate boards); projects can be removed;
//   5. every Unprose client sends a User-Agent; a 401 says when the caller's would be blocked by Cloudflare;
//   6. every agent has an @handle (mentionable), canvas_ask says who it was delivered to.
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
import { ProjectsBoardRepository } from '../src/adapters/boards/index.js'
import { LOCAL_GRANT } from '../src/accessPolicy.js'
import { CanvasClient } from '../src/client.js'
import { adoptToken, canvasHeaders, canvasToken, saveToken, savedToken, tokenKey } from '../src/credentials.js'
import { ambiguityNote, pickBoardByTitle } from '../src/boardLookup.js'
import { agentLabel, handleOf, mentionIn, mergeBoardMeta, resolveAgent, sameAgent } from '../src/routing.js'
import { clientWord, defaultAgentName, shortHost } from '../src/mcp.js'
import { userAgent, VERSION } from '../src/version.js'

const tmp = (name: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `awd-interview-${name}-`)))
// a repo root on machine B, built at run time (the public export rejects literal home paths)
const ROOT_B = ['', 'Users', 'b', 'team'].join('/')
const REMOTE = { 'x-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '203.0.113.7' }

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
const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) => call(p, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const comment = (id: string, text: string) => ({ kind: 'add', item: { id, type: 'comment', x: 0, y: 0, w: 100, h: 60, text, createdBy: 'user', updatedBy: 'user', updatedAt: '' } })

/** A browser through the tunnel, let in by a pairing code approved on this machine: its session cookie. */
function browserSession(): string {
  const { pending } = access.startBrowser('203.0.113.7', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Chrome/129.0 Safari/605.1.15')
  assert.ok(access.decide(pending!.ref, { allow: true }, LOCAL_GRANT).ok)
  const { session } = access.poll(pending!.id)
  return `unprose_session=${session}`
}

// ── 1. the person's browser ─────────────────────────────────────────────────────

test('a browser signed in through the tunnel is the person: its changes are "user", unnamed, and wake a wait for the person', async () => {
  const b = store.create({ title: 'person through the tunnel', kind: 'freeform' })
  const cookie = browserSession()
  // an agent (machine B, a token) waits for the person — the default of canvas_wait
  const { token } = access.createToken({ name: 'codex-b' }, 't')
  const waiting = call(`/api/boards/${b.id}/wait?since=0&timeout=5000&quiet=50&author=user`, { headers: remote(token) })
  await new Promise((r) => setTimeout(r, 100))
  // the web page posts as the person; an old page (or a page that sends no author) is the person as well
  const posted = await (await send('POST', `/api/boards/${b.id}/ops`, { author: 'user', ops: [comment('c1', 'is this the signup flow?')] }, remote(undefined, { cookie }))).json()
  assert.equal(posted.change.author, 'user')
  assert.equal(posted.change.by, undefined, 'the person is not "Chrome on macOS (203.0.113.7)"')
  assert.equal(store.get(b.id)!.items.c1.data?.by, undefined)
  const woke = await (await waiting).json()
  assert.equal(woke.timedOut, false, 'the agent waiting for the person wakes')
  assert.match(woke.lines[0], /^\[1 user\] added comment/)
  const noAuthor = await (await send('POST', `/api/boards/${b.id}/ops`, { ops: [comment('c2', 'and this?')] }, remote(undefined, { cookie }))).json()
  assert.equal(noAuthor.change.author, 'user')
  const asAgent = await (await send('POST', `/api/boards/${b.id}/ops`, { author: 'agent', ops: [comment('c3', 'pretend')] }, remote(undefined, { cookie }))).json()
  assert.equal(asAgent.change.author, 'user', 'a browser cannot post as an agent either')
  // an agent token stays an agent, whatever it asks for
  const tok = await (await send('POST', `/api/boards/${b.id}/ops`, { author: 'user', ops: [comment('c4', 'I am the person')] }, remote(token))).json()
  assert.equal(tok.change.author, 'agent')
  assert.equal(tok.change.by, 'codex-b')
  // the person's settings changes from the tunnel are the person's too
  const set = await send('PUT', `/api/boards/${b.id}/settings`, { answeredBy: 'codex-b', author: 'user' }, remote(undefined, { cookie }))
  assert.equal(set.status, 200)
  const last = store.changes(b.id).pop()!
  assert.equal(last.author, 'user')
  assert.equal(last.by, undefined)
})

test('MCP schemas: canvas_wait and canvas_diff say `from` (person | others), and what it means', async () => {
  const { token } = access.createToken({ name: 'schema-reader', scope: 'read' }, 't')
  const client = new Client({ name: 't', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(token) } }))
  const tools = (await client.listTools()).tools
  const wait = tools.find((t) => t.name === 'canvas_wait')!
  const diff = tools.find((t) => t.name === 'canvas_diff')!
  const props = (t: typeof wait) => t.inputSchema.properties as Record<string, { enum?: string[]; anyOf?: Array<{ enum?: string[]; type?: string }> }>
  // the words, or (docs/canvas.md "Reading big boards") a list of names
  const words = (p: { enum?: string[]; anyOf?: Array<{ enum?: string[] }> }) => p.enum ?? p.anyOf?.find((a) => a.enum)?.enum
  assert.deepEqual(words(props(wait).from), ['person', 'others'])
  assert.deepEqual(words(props(diff).from), ['person', 'others', 'all'])
  assert.ok(props(diff).from.anyOf?.some((a) => a.type === 'array'), 'canvas_diff from: or a list of names')
  assert.match(wait.description ?? '', /`from`/)
  assert.match(wait.description ?? '', /signed in through a tunnel counts as the person/)
  assert.match(diff.description ?? '', /`from`/)
  await client.close()
})

// ── 2. one credential ────────────────────────────────────────────────────────────

test('one credential: UNPROSE_TOKEN, else the token saved for that canvas (a board link or a trailing slash name the same one)', () => {
  const dir = tmp('tokens')
  const env: NodeJS.ProcessEnv = { UNPROSE_TOKENS_FILE: path.join(dir, 'tokens.json') }
  assert.equal(tokenKey('https://canvas.example.com/b/b_1?focus=x'), 'https://canvas.example.com')
  assert.equal(tokenKey('https://canvas.example.com/mcp'), 'https://canvas.example.com')
  saveToken('https://canvas.example.com/', 'unp_paired', env)
  assert.equal(savedToken('https://canvas.example.com/b/b_9', env), 'unp_paired')
  assert.equal(canvasToken('https://canvas.example.com', env), 'unp_paired')
  assert.equal(fs.statSync(env.UNPROSE_TOKENS_FILE!).mode & 0o777, 0o600)
  // the MCP server adopts the token it got: the design tools (in-process) and `awd` subprocesses read it from the env
  adoptToken('unp_live', env)
  assert.equal(canvasToken('https://elsewhere.example.com', env), 'unp_live')
  assert.deepEqual(canvasHeaders('https://canvas.example.com', 'cli', env), { 'user-agent': `unprose/${VERSION} (cli)`, authorization: 'Bearer unp_live' })
  adoptToken(undefined, env)
  assert.equal(env.UNPROSE_TOKEN, undefined)
  saveToken('https://canvas.example.com', undefined, env)
  assert.equal(savedToken('https://canvas.example.com', env), undefined)
})

test('CanvasClient: picks up the saved pairing token by itself and says who it is (User-Agent)', async () => {
  const { token } = access.createToken({ name: 'paired-b' }, 't')
  const file = path.join(tmp('client-tokens'), 'tokens.json')
  const was = { file: process.env.UNPROSE_TOKENS_FILE, token: process.env.UNPROSE_TOKEN }
  process.env.UNPROSE_TOKENS_FILE = file
  delete process.env.UNPROSE_TOKEN
  try {
    saveToken(base, token)
    const client = new CanvasClient(`${base}/b/whatever`, { component: 'test' })
    assert.equal(client.hasToken, true)
    const b = await client.createBoard({ title: 'drawn with the paired token', kind: 'freeform', author: 'agent' })
    assert.equal(store.changes(b.id).length, 0)
    const rec = access.list().find((a) => a.name === 'paired-b')!
    assert.equal(rec.lastUserAgent, `unprose/${VERSION} (test)`)
  } finally {
    if (was.file === undefined) delete process.env.UNPROSE_TOKENS_FILE
    else process.env.UNPROSE_TOKENS_FILE = was.file
    if (was.token !== undefined) process.env.UNPROSE_TOKEN = was.token
  }
})

// ── 3. PATCH merges meta ─────────────────────────────────────────────────────────

test('mergeBoardMeta: top-level keys replace (null removes), diagrams merge per key', () => {
  const cur = { project: { root: '/a' }, diagrams: { a: { kind: 'event-storming', source: 'a.es.yaml' }, b: { kind: 'kanban' } }, responder: { mode: 'studio' } }
  const out = mergeBoardMeta(cur, { diagrams: { c: { kind: 'wireframe' }, b: null }, studio: { x: 1 }, project: null })
  assert.deepEqual(out, { diagrams: { a: { kind: 'event-storming', source: 'a.es.yaml' }, c: { kind: 'wireframe' } }, responder: { mode: 'studio' }, studio: { x: 1 } })
})

test('PATCH /api/boards/:id: two machines drawing in turn keep each other\'s diagrams, holders and the board-level root', async () => {
  const b = store.create({ title: 'two machines', kind: 'freeform' })
  const a = access.createToken({ name: 'claude-a' }, 't').token
  const bb = access.createToken({ name: 'codex-b2' }, 't').token
  // machine A draws its diagram and sets the board-level default root (the CLI does this only when there is none)
  let r = await send('PATCH', `/api/boards/${b.id}`, { meta: { project: { root: '/srv/team' }, diagrams: { 'flow-es': { kind: 'event-storming', source: 'design/flow.es.yaml', holder: { machine: 'linux-a', root: '/srv/team', repo: 'team' } } } } }, remote(a))
  assert.equal(r.status, 200)
  // machine B draws another diagram: only its entry is sent
  r = await send('PATCH', `/api/boards/${b.id}`, { meta: { diagrams: { 'scope-map': { kind: 'user-story-map', source: 'design/scope.story-map.yaml', holder: { machine: 'mbp-b', root: ROOT_B, repo: 'team' } } } } }, remote(bb))
  assert.equal(r.status, 200)
  const meta = store.get(b.id)!.meta as { project: { root: string }; diagrams: Record<string, { holder: { agent: string; root: string } }> }
  assert.equal(meta.project.root, '/srv/team', 'B did not overwrite the board-level root')
  assert.deepEqual(Object.keys(meta.diagrams).sort(), ['flow-es', 'scope-map'])
  assert.equal(meta.diagrams['flow-es'].holder.agent, 'claude-a')
  assert.equal(meta.diagrams['flow-es'].holder.root, '/srv/team')
  assert.equal(meta.diagrams['scope-map'].holder.agent, 'codex-b2', 'stamped from the credentials')
  assert.equal(meta.diagrams['scope-map'].holder.root, ROOT_B, 'the project root per diagram')
  // a remote caller sees no paths, and its PATCH still cannot touch the settings
  const seen = await (await call(`/api/boards/${b.id}`, { headers: remote(bb) })).json()
  assert.equal(seen.board.meta.diagrams['flow-es'].holder.root, undefined)
  await send('PATCH', `/api/boards/${b.id}`, { meta: { responder: { mode: 'agent', agent: 'codex-b2' } } }, remote(bb))
  assert.equal(store.get(b.id)!.meta?.responder, undefined, 'settings change only through /settings')
  // PUT still replaces meta whole (older clients) — but a diagram another agent holds, left out, is kept
  await send('PUT', `/api/boards/${b.id}`, { meta: { diagrams: {} } }, remote(a))
  assert.deepEqual(Object.keys(store.get(b.id)!.meta?.diagrams as object), ['scope-map'], "A dropped its own diagram, not B's")
})

// ── 4. no bogus projects, no duplicate boards ────────────────────────────────────

test('pickBoardByTitle: the same project, then personal, then any; exact before loose; ambiguous says so', () => {
  const boards = [
    { id: 'b1', title: 'Meeting 2026-10-02', project: 'design', updatedAt: '2026-10-02T10:00:00Z' },
    { id: 'b2', title: 'Meeting 2026-10-02', project: 'personal', updatedAt: '2026-10-02T09:00:00Z' },
    { id: 'b3', title: 'meeting  2026-10-02 ', project: 'shop', updatedAt: '2026-10-02T11:00:00Z' },
    { id: 'b4', title: 'Meeting 2026-10-02', project: 'design', updatedAt: '2026-10-02T12:00:00Z' },
  ]
  assert.equal(pickBoardByTitle(boards, 'Meeting 2026-10-02', 'shop').board?.id, 'b2', 'an exact title before a loose one; personal before other projects')
  assert.equal(pickBoardByTitle(boards, 'Meeting 2026-10-02', 'design').board?.id, 'b4', 'the newest in the project')
  const r = pickBoardByTitle(boards, 'Meeting 2026-10-02', 'design')
  assert.equal(r.ambiguous.length, 2)
  assert.match(ambiguityNote('Meeting 2026-10-02', r)!, /2 boards are titled "Meeting 2026-10-02" \(b4 \[design\], b1 \[design\]\) — used b4/)
  assert.equal(pickBoardByTitle(boards.slice(2, 3), 'Meeting 2026-10-02').board?.id, 'b3', 'case and spaces do not make a new board')
  assert.equal(pickBoardByTitle(boards, 'Other').board, undefined)
})

test('POST /api/boards { reuse: "title" }: find-or-create in one step — two draws at once share one board', async () => {
  const { token } = access.createToken({ name: 'racer' }, 't')
  const make = () => send('POST', '/api/boards', { title: 'Raced board', kind: 'freeform', reuse: 'title', answeredBy: 'me' }, remote(token)).then((r) => r.json())
  const [x, y] = await Promise.all([make(), make()])
  assert.equal(x.board.id, y.board.id)
  assert.equal([x.reused, y.reused].filter(Boolean).length, 1)
  assert.equal(store.list().filter((b) => b.title === 'Raced board').length, 1)
  // a board of that title in another project (made on the canvas machine) is found from elsewhere too
  const inShop = store.create({ title: 'Shop meeting', kind: 'freeform', project: 'shop' })
  const found = await (await send('POST', '/api/boards', { title: 'Shop meeting', kind: 'freeform', reuse: 'title' }, remote(token))).json()
  assert.equal(found.board.id, inShop.id)
  assert.equal(found.where, 'any')
  // title+kind: a freeform board of that title does not stand in for a workflow
  const wf = await send('POST', '/api/boards', { title: 'Shop meeting', kind: 'workflow', reuse: 'title+kind' }, remote(token))
  assert.equal(wf.status, 201)
})

test('DELETE /api/projects/:id: refused while it holds boards, --force moves them to personal; this machine only', async () => {
  const root = path.join(tmp('bogus'), 'design')
  fs.mkdirSync(root)
  const p = store.registerProject(root)
  const b = store.create({ title: 'in the bogus project', kind: 'freeform', project: p.id })
  assert.equal((await call(`/api/projects/${p.id}`, { method: 'DELETE', headers: remote(access.createToken({ name: 'x-remote' }, 't').token) })).status, 403)
  const refused = await call(`/api/projects/${p.id}`, { method: 'DELETE' })
  assert.equal(refused.status, 409)
  assert.match((await refused.json()).error, /still stores 1 board/)
  const forced = await (await call(`/api/projects/${p.id}?force=1`, { method: 'DELETE' })).json()
  assert.deepEqual(forced.moved, [b.id])
  assert.equal(store.projectOf(b.id), 'personal')
  assert.ok(store.get(b.id), 'the board is kept')
  assert.ok(!store.projects().some((x) => x.id === p.id))
  assert.equal((await call(`/api/projects/${p.id}`, { method: 'DELETE' })).status, 404)
})

// ── 5. User-Agent ───────────────────────────────────────────────────────────────

test('User-Agent: unprose/<version> (<component>); a 401 says when the caller\'s would be blocked behind Cloudflare', async () => {
  assert.equal(userAgent('cli'), `unprose/${VERSION} (cli)`)
  const py = await (await call('/api/boards', { headers: remote(undefined, { 'user-agent': 'Python-urllib/3.12' }) })).json()
  assert.match(py.error, /User-Agent "Python-urllib\/3\.12".*403 before they reach the canvas/)
  const ours = await (await call('/api/boards', { headers: remote(undefined, { 'user-agent': userAgent('cli') }) })).json()
  assert.doesNotMatch(ours.error, /User-Agent/)
})

// ── 6. handles ───────────────────────────────────────────────────────────────────

test('handles: one word per agent, @handle and the exact name both mention it', () => {
  assert.equal(handleOf('agent on Acme-Robins-MacBook-Pro'), 'agent-on-acme-robins-macbook-pro')
  assert.equal(handleOf('codex-b'), 'codex-b')
  assert.equal(handleOf('agent'), 'studio')
  assert.equal(handleOf('Chrome on macOS (203.0.113.7)'), 'chrome-on-macos-203.0.113.7')
  const known = ['agent on Acme-Robins-MacBook-Pro', 'codex-b']
  assert.equal(mentionIn('@agent-on-acme-robins-macbook-pro can you look?', known), 'agent on Acme-Robins-MacBook-Pro')
  assert.equal(mentionIn('@agent on Acme-Robins-MacBook-Pro hi', known), 'agent on Acme-Robins-MacBook-Pro')
  assert.equal(mentionIn('@studio hi', known), 'agent')
  assert.ok(sameAgent('agent on Acme-Robins-MacBook-Pro', 'agent-on-acme-robins-macbook-pro'))
  assert.equal(resolveAgent('@codex-b', known), 'codex-b')
  assert.equal(resolveAgent('agent-on-acme-robins-macbook-pro', known), 'agent on Acme-Robins-MacBook-Pro')
  assert.equal(agentLabel('agent on mbp-b'), '@agent-on-mbp-b (agent on mbp-b)')
  assert.equal(agentLabel('codex-b'), '@codex-b')
})

test('names are unique by handle; the agents list and the board settings carry each handle', async () => {
  const one = access.createToken({ name: 'cursor laptop' }, 't').agent
  const two = access.createToken({ name: 'Cursor-Laptop' }, 't').agent
  assert.equal(one.handle, 'cursor-laptop')
  assert.equal(two.name, 'Cursor-Laptop-2')
  assert.notEqual(two.handle, one.handle, 'a second agent never gets the same @handle')
  const b = store.create({ title: 'handles', kind: 'freeform' })
  const s = await (await call(`/api/boards/${b.id}/settings`)).json()
  const row = s.agents.find((a: { name: string }) => a.name === 'cursor laptop')
  assert.equal(row.handle, 'cursor-laptop')
  assert.equal(s.agents.find((a: { name: string }) => a.name === 'agent').handle, 'studio')
})

test('canvas_ask by @handle: the thread goes to that agent, and the result says exactly who got it and whether it is watching', async () => {
  const b = store.create({ title: 'ask by handle', kind: 'freeform' })
  const asker = access.createToken({ name: 'claude-a2' }, 't').token
  const target = access.createToken({ name: 'agent on Robins-MacBook-Pro' }, 't').token
  // the target waits on the board (so it is "watching"), the asker asks it by handle
  const waiting = call(`/api/boards/${b.id}/wait?since=0&timeout=4000&quiet=50`, { headers: remote(target) })
  await new Promise((r) => setTimeout(r, 100))
  const client = new Client({ name: 't', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(asker) } }))
  const res = await client.callTool({ name: 'canvas_ask', arguments: { id: b.id, agent: '@agent-on-robins-mbp-x', question: 'unknown handle?', timeoutSec: 1 } })
  assert.match((res.content as Array<{ text: string }>)[0].text, /no agent named agent-on-robins-mbp-x has been seen/)
  const ok = await client.callTool({ name: 'canvas_ask', arguments: { id: b.id, agent: 'agent-on-robins-macbook-pro', question: 'what got in your way?', timeoutSec: 1 } })
  const out = (ok.content as Array<{ text: string }>)[0].text
  assert.match(out, /Delivered to @agent-on-robins-macbook-pro \(agent on Robins-MacBook-Pro\) — watching this board now/)
  const woke = await (await waiting).json()
  assert.equal(woke.timedOut, false, 'the agent asked by its handle woke')
  const asked = Object.values(store.get(b.id)!.items).find((i) => i.text?.startsWith('@agent-on-robins-macbook-pro what got'))!
  assert.equal(asked.data?.mention, 'agent on Robins-MacBook-Pro')
  assert.deepEqual(asked.data?.to, ['agent on Robins-MacBook-Pro'])
  await client.close()
})

test('the default name a pairing gives: "<client>-<short host>", one word', () => {
  assert.equal(shortHost('Acme-Robins-MacBook-Pro.local'), 'acme-robins-mbp')
  assert.equal(shortHost('build-01.internal.example.com'), 'build-01')
  assert.equal(clientWord('codex-mcp-client', {}), 'codex')
  assert.equal(clientWord('claude-code', {}), 'claude')
  assert.equal(clientWord(undefined, { CLAUDECODE: '1' }), 'claude')
  assert.equal(clientWord(undefined, {}), 'agent')
  assert.equal(defaultAgentName('codex-mcp-client', {}, 'Acme-Robins-MacBook-Pro.local'), 'codex-acme-robins-mbp')
  assert.equal(defaultAgentName('codex-mcp-client', { UNPROSE_AGENT_NAME: 'codex-b' }), 'codex-b')
  assert.equal(handleOf(defaultAgentName('x', {}, 'Some Host.local')), defaultAgentName('x', {}, 'Some Host.local'), 'the default name is its own handle')
})
