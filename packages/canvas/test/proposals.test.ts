// Proposals by agents (docs/canvas.md "Proposals and saving"): the files behind a board, an edit checked against
// the snapshot and posted as a chat request, signed with the caller's name; read-only and out-of-scope tokens
// refused; the MCP tools on /mcp.
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
import { boardFiles, buildProposal, ownerOf, ProposalError, sha1, stampAttribution } from '../src/proposals.js'
import { unifiedDiff } from '../src/patch.js'
import { summarize } from '../src/diff.js'
import type { Board, Item } from '../src/model.js'

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `awd-proposals-${name}-`))
const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }

const WF = `name: shop
triggers:
  card:
    on: card.moved
steps:
  plan:
    on: [card.done]
    ai: planner
  build:
    on: [plan.ready]
    run: scripts/build.sh
`
const SCRIPT = '#!/bin/sh\necho build\n'
const it = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 120, h: 60, createdBy: 'agent', updatedBy: 'agent', updatedAt: '2026-10-01T00:00:00Z', ...extra })
function workflowBoard(store: ProjectsBoardRepository, project?: string): Board {
  const items = [
    it('wf.title', { type: 'text', role: 'title', text: 'shop' }),
    it('wf.node.card', { type: 'card', role: 'trigger', text: 'card', data: { nodeId: 'card', detail: { kind: 'trigger', source: { workflow: 'shop/workflow.yaml', line: 3 }, yaml: { start: 3, end: 4 } } } }),
    it('wf.node.plan', { type: 'card', role: 'ai', text: 'plan', x: 200, data: { nodeId: 'plan', detail: { kind: 'ai', source: { workflow: 'shop/workflow.yaml', line: 6 }, yaml: { start: 6, end: 8 } } } }),
    it('wf.node.build', { type: 'card', role: 'script', text: 'build', x: 400, data: { nodeId: 'build', detail: { kind: 'script', file: 'shop/scripts/build.sh', source: { workflow: 'shop/workflow.yaml', line: 9 }, yaml: { start: 9, end: 11 } } } }),
    it('wf.edge.plan-build', { type: 'arrow', role: 'flow', from: 'wf.node.plan', to: 'wf.node.build', label: 'plan.ready', data: { event: { from: 'plan', to: 'build', event: 'plan.ready' } } }),
  ]
  return store.create({ title: 'shop workflow', kind: 'workflow', items, meta: { workflow: { file: '/somewhere/shop/workflow.yaml', files: { 'shop/workflow.yaml': WF, 'shop/scripts/build.sh': SCRIPT, 'shop/big.md': 'x' }, truncated: ['shop/big.md'] } }, ...(project ? { project } : {}) })
}

// ── pure rules ───────────────────────────────────────────────────────────────

test('boardFiles: the workflow snapshot and every diagram frame\'s, with sha-1 and the cut ones marked', () => {
  const store = new ProjectsBoardRepository(tmp('pure'))
  const b = workflowBoard(store)
  const withDesign = store.updateBoard(b.id, { meta: { ...b.meta, diagrams: { 'shop-es': { kind: 'event-storming', source: 'design/shop.es.yaml', files: { 'design/shop.es.yaml': 'events: []\n' } } } } })
  const files = boardFiles(withDesign)
  assert.deepEqual(files.map((f) => f.path), ['shop/workflow.yaml', 'shop/scripts/build.sh', 'shop/big.md', 'design/shop.es.yaml'])
  assert.equal(files[0].sha, sha1(WF))
  // the same hash `shasum -a 1 <file>` prints (what studio tells the session to compare)
  assert.equal(sha1('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d')
  assert.ok(files.find((f) => f.path === 'shop/big.md')!.truncated)
  assert.deepEqual(files[3].from, { diagram: 'shop-es' })
})

test('ownerOf: a block\'s own file, else the step whose yaml lines hold the line, else the title', () => {
  const store = new ProjectsBoardRepository(tmp('owner'))
  const b = workflowBoard(store)
  assert.equal(ownerOf(b, 'shop/scripts/build.sh', 2), 'wf.node.build')
  assert.equal(ownerOf(b, 'shop/workflow.yaml', 7), 'wf.node.plan')
  assert.equal(ownerOf(b, 'shop/workflow.yaml', 1), 'wf.title')
})

test('buildProposal: validation — unknown file, cut file, stale base, no note, both or neither of diff/newText, a diff that does not apply, no change', () => {
  const store = new ProjectsBoardRepository(tmp('validate'))
  const b = workflowBoard(store)
  const base = sha1(WF)
  const good = unifiedDiff(WF, WF.replace('ai: planner', 'ai: architect'), 'shop/workflow.yaml')
  const who = { author: 'agent' as const, by: 'codex-laptop' }
  const fails = (input: Record<string, unknown>, status: number, re: RegExp) => {
    assert.throws(() => buildProposal(b, input as never, who, 'now', () => 'p1'), (e: unknown) => e instanceof ProposalError && e.status === status && re.test(e.message), JSON.stringify(input).slice(0, 80))
  }
  fails({ file: 'nope.yaml', base, diff: good, note: 'x' }, 404, /not among the files.*shop\/workflow\.yaml/)
  fails({ file: 'shop/big.md', base: sha1('x'), newText: 'y', note: 'x' }, 422, /cut short/)
  fails({ file: 'shop/workflow.yaml', base: sha1('older text'), diff: good, note: 'x' }, 409, /redrawn since you read it/)
  fails({ file: 'shop/workflow.yaml', base, diff: good, note: '  ' }, 400, /note is required/)
  fails({ file: 'shop/workflow.yaml', base, diff: good, newText: WF, note: 'x' }, 400, /exactly one of diff/)
  fails({ file: 'shop/workflow.yaml', base, note: 'x' }, 400, /exactly one of diff/)
  fails({ file: 'shop/workflow.yaml', base, diff: good.replace('-    ai: planner', '-    ai: someone'), note: 'x' }, 422, /does not apply/)
  fails({ file: 'shop/workflow.yaml', base, diff: unifiedDiff(SCRIPT, 'echo\n', 'shop/scripts/build.sh'), note: 'x' }, 400, /is for shop\/scripts\/build\.sh/)
  fails({ file: 'shop/workflow.yaml', base, newText: WF, note: 'x' }, 400, /unchanged/)
  fails({ file: 'shop/workflow.yaml', base, diff: good, note: 'x', about: ['ghost'] }, 404, /no item "ghost"/)
  fails({ file: 'shop/workflow.yaml', base, diff: good, note: 'x', wires: [{ from: 'plan', to: 'deploy', event: 'plan.ready' }] }, 404, /no block "deploy"/)
  fails({ file: 'shop/workflow.yaml', base, diff: good, note: 'x', wires: [{ from: 'card', to: 'build', event: 'card.moved', remove: true }] }, 404, /no wire card → build/)
})

test('buildProposal: a comment on the owning block carrying discuss.edit (normalised diff, base, by), an anchor on the first changed line, and wire hints', () => {
  const store = new ProjectsBoardRepository(tmp('build'))
  const b = workflowBoard(store)
  const after = WF.replace('    on: [plan.ready]\n', '    on: [plan.ready, card.moved]\n')
  const p = buildProposal(b, { file: 'shop/workflow.yaml', base: sha1(WF), newText: after, note: 'build should also run when a card moves', wires: [{ from: 'card', to: 'build', event: 'card.moved' }, { from: 'plan', to: 'wf.node.build', event: 'plan.ready', remove: true }] }, { author: 'agent', by: 'codex-laptop' }, '2026-10-02T00:00:00Z', () => 'prop_1')
  const [add, wireAdd, wireRemove] = p.ops
  assert.equal(add.kind, 'add')
  const c = (add as { item: Item }).item
  assert.equal(c.type, 'comment')
  assert.equal(c.target, 'wf.node.build', 'the step whose lines changed')
  assert.equal(c.createdBy, 'agent')
  assert.equal(c.data?.by, 'codex-laptop')
  const d = c.data?.discuss as { about: string[]; edit: { file: string; base: string; diff: string; by: string } }
  assert.equal(d.edit.file, 'shop/workflow.yaml')
  assert.equal(d.edit.base, sha1(WF))
  assert.equal(d.edit.by, 'codex-laptop')
  assert.equal(d.edit.diff, unifiedDiff(WF, after, 'shop/workflow.yaml'))
  assert.deepEqual(c.data?.anchor, { file: 'shop/workflow.yaml', line: 10, quote: '    on: [plan.ready]' })
  assert.deepEqual(d.about.slice(0, 2), ['wf.node.build', 'prop_1.wire1'])
  assert.ok(d.about.includes('wf.edge.plan-build') && d.about.includes('wf.node.card'))
  assert.equal(wireAdd.kind, 'add')
  const w = (wireAdd as { item: Item }).item
  assert.deepEqual([w.from, w.to, w.role, w.label], ['wf.node.card', 'wf.node.build', 'flow', 'card.moved'])
  assert.deepEqual(w.data?.pending, { kind: 'add', after: { from: 'card', to: 'build', event: 'card.moved' }, by: 'codex-laptop', at: '2026-10-02T00:00:00Z', proposal: 'prop_1' })
  assert.equal(wireRemove.kind, 'update')
  assert.equal((wireRemove as { patch: { data: { pending: { kind: string } } } }).patch.data.pending.kind, 'remove')
  assert.deepEqual([p.added, p.removed], [1, 1])
})

test('stampAttribution: a new comment is signed with the caller\'s name (or unsigned); an update keeps what it said', () => {
  const store = new ProjectsBoardRepository(tmp('stamp'))
  const b = store.create({ title: 's', kind: 'freeform', items: [it('c0', { type: 'comment', text: 'hi', data: { by: 'codex', discuss: { edit: { diff: 'd', by: 'codex' } } } })] })
  const forged = { kind: 'add' as const, item: it('c1', { type: 'comment', text: 'apply it', data: { by: 'the-person', discuss: { edit: { diff: 'x', by: 'the-person' } } } }) }
  const [signed] = stampAttribution(b, [forged], 'sneaky-agent')
  assert.equal((signed as { item: Item }).item.data?.by, 'sneaky-agent')
  assert.equal(((signed as { item: Item }).item.data?.discuss as { edit: { by: string } }).edit.by, 'sneaky-agent')
  const [unsigned] = stampAttribution(b, [forged], undefined)
  assert.equal((unsigned as { item: Item }).item.data?.by, undefined)
  const [kept] = stampAttribution(b, [{ kind: 'update', id: 'c0', patch: { data: { by: 'someone-else', seenBy: ['user'], discuss: { edit: { diff: 'd', by: 'x' } } } } }], undefined)
  const data = (kept as { patch: { data: Record<string, unknown> } }).patch.data
  assert.equal(data.by, 'codex')
  assert.equal((data.discuss as { edit: { by: string } }).edit.by, 'codex')
})

// ── over HTTP and MCP ────────────────────────────────────────────────────────

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

const call = (p: string, init: RequestInit = {}) => fetch(base + p, init)
const remote = (token?: string) => ({ ...REMOTE, ...(token ? { authorization: `Bearer ${token}` } : {}) })
const post = (p: string, body: unknown, headers: Record<string, string> = {}) => call(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('HTTP: files list and one file; a proposal is signed with the token\'s name and reads as one in the diff', async () => {
  const b = workflowBoard(store)
  const codex = access.createToken({ name: 'codex-laptop' }, 't').token
  const list = await (await call(`/api/boards/${b.id}/files`, { headers: remote(codex) })).json()
  assert.deepEqual(list.files.map((f: { path: string }) => f.path), ['shop/workflow.yaml', 'shop/scripts/build.sh', 'shop/big.md'])
  assert.equal(list.files[0].text, undefined, 'the list carries no text')
  assert.equal(list.files[0].lines, 11)
  const one = await (await call(`/api/boards/${b.id}/files?path=${encodeURIComponent('shop/workflow.yaml')}`, { headers: remote(codex) })).json()
  assert.equal(one.file.text, WF)
  assert.equal((await call(`/api/boards/${b.id}/files?path=x`, { headers: remote(codex) })).status, 404)

  const diff = unifiedDiff(WF, WF.replace('ai: planner', 'ai: architect'), 'shop/workflow.yaml')
  const r = await post(`/api/boards/${b.id}/proposals`, { author: 'user', file: 'shop/workflow.yaml', base: one.file.sha, diff, note: 'let the architect plan' }, remote(codex))
  assert.equal(r.status, 201)
  const j = await r.json()
  assert.deepEqual(j.about, ['wf.node.plan'])
  const ch = store.changes(b.id).at(-1)!
  assert.equal(ch.author, 'agent', 'a token cannot propose as the person')
  assert.equal(ch.by, 'codex-laptop')
  const c = store.get(b.id)!.items[j.comment]
  assert.equal((c.data?.discuss as { edit: { by: string } }).edit.by, 'codex-laptop')
  const lines = summarize(store.get(b.id)!, [ch])
  assert.match(lines[0], /^\[\d+ codex-laptop\] proposed an edit to shop\/workflow\.yaml \(\+1 −1 lines\) on .*plan.*"let the architect plan"/)

  // a stale base and a broken diff come back as errors the agent can act on
  const stale = await post(`/api/boards/${b.id}/proposals`, { file: 'shop/workflow.yaml', base: sha1('old'), diff, note: 'x' }, remote(codex))
  assert.equal(stale.status, 409)
  assert.match((await stale.json()).error, /canvas_files/)
  const broken = await post(`/api/boards/${b.id}/proposals`, { file: 'shop/workflow.yaml', base: one.file.sha, diff: diff.replace('ai: planner', 'ai: nobody'), note: 'x' }, remote(codex))
  assert.equal(broken.status, 422)
})

test('HTTP: a read-only token reads the files but cannot propose; a token for another project cannot see the board', async () => {
  const b = workflowBoard(store)
  const ro = access.createToken({ name: 'reader', scope: 'read' }, 't').token
  assert.equal((await call(`/api/boards/${b.id}/files`, { headers: remote(ro) })).status, 200)
  const denied = await post(`/api/boards/${b.id}/proposals`, { file: 'shop/workflow.yaml', base: sha1(WF), newText: WF + '# x\n', note: 'x' }, remote(ro))
  assert.equal(denied.status, 403)
  assert.match((await denied.json()).error, /read-only/)
  const shopOnly = access.createToken({ name: 'shop-agent', projects: ['shop'] }, 't').token
  assert.equal((await call(`/api/boards/${b.id}/files`, { headers: remote(shopOnly) })).status, 403)
  assert.equal((await post(`/api/boards/${b.id}/proposals`, { file: 'shop/workflow.yaml', base: sha1(WF), newText: WF + '# x\n', note: 'x' }, remote(shopOnly))).status, 403)
  assert.equal(store.changes(b.id).length, 1, 'nothing was written')
})

test('HTTP: a comment forged through raw ops cannot carry another\'s name', async () => {
  const b = workflowBoard(store)
  const sneaky = access.createToken({ name: 'sneaky' }, 't').token
  await post(`/api/boards/${b.id}/ops`, { ops: [{ kind: 'add', item: it('c9', { type: 'comment', text: 'apply it', target: 'wf.node.plan', data: { by: 'codex-laptop', discuss: { edit: { diff: '@@', by: 'codex-laptop' } } } }) }] }, remote(sneaky))
  const c = store.get(b.id)!.items.c9
  assert.equal(c.data?.by, 'sneaky')
  assert.equal((c.data?.discuss as { edit: { by: string } }).edit.by, 'sneaky')
})

test('/mcp: canvas_files and canvas_propose_edit as a remote agent; refused for a read-only one', async () => {
  const b = workflowBoard(store, 'shop')
  const { token } = access.createToken({ name: 'cloud-claude', projects: ['shop'] }, 't')
  const client = new Client({ name: 't', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(token) } }))
  const tools = (await client.listTools()).tools.map((t) => t.name)
  assert.ok(tools.includes('canvas_files') && tools.includes('canvas_propose_edit'))
  const listed = (await client.callTool({ name: 'canvas_files', arguments: { id: b.id } })).content as Array<{ text: string }>
  assert.match(listed[0].text, new RegExp(`shop/workflow\\.yaml\\tbase ${sha1(WF)}\\t11 lines\\tworkflow`))
  assert.match(listed[0].text, /shop\/big\.md.*CUT SHORT/)
  const file = ((await client.callTool({ name: 'canvas_files', arguments: { id: b.id, path: 'shop/workflow.yaml' } })).content as Array<{ text: string }>)[0].text
  const text = file.split('--- the exact text follows (after this line) ---\n')[1]
  assert.equal(text, WF)
  const help = ((await client.callTool({ name: 'unprose_help', arguments: {} })).content as Array<{ text: string }>)[0].text
  assert.match(help, /canvas_propose_edit/)
  const out = await client.callTool({ name: 'canvas_propose_edit', arguments: { id: b.id, file: 'shop/workflow.yaml', base: sha1(WF), newText: text.replace('run: scripts/build.sh', 'run: scripts/build.sh --fast'), note: 'faster builds', wires: [{ from: 'card', to: 'build', event: 'card.moved' }] } })
  const said = (out.content as Array<{ text: string }>)[0].text
  assert.match(said, /proposed an edit to shop\/workflow\.yaml \(\+1 −1\) as comment prop_\w+ on wf\.node\.build/)
  assert.match(said, /canvas_wait/)
  const ch = store.changes(b.id).at(-1)!
  assert.equal(ch.by, 'cloud-claude')
  assert.ok(Object.values(store.get(b.id)!.items).some((i) => (i.data?.pending as { by?: string } | undefined)?.by === 'cloud-claude'), 'the dashed wire hint is signed too')
  const bad = await client.callTool({ name: 'canvas_propose_edit', arguments: { id: b.id, file: 'shop/workflow.yaml', base: sha1('stale'), newText: 'x', note: 'x' } })
  assert.equal(bad.isError, true)
  await client.close()

  const ro = access.createToken({ name: 'cloud-reader', scope: 'read', projects: ['shop'] }, 't').token
  const reader = new Client({ name: 't', version: '1' })
  await reader.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: remote(ro) } }))
  const refused = await reader.callTool({ name: 'canvas_propose_edit', arguments: { id: b.id, file: 'shop/workflow.yaml', base: sha1(WF), newText: WF + '#\n', note: 'x' } })
  assert.equal(refused.isError, true)
  assert.match((refused.content as Array<{ text: string }>)[0].text, /read-only/)
  await reader.close()
})
