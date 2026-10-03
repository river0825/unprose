// Reading at agent scale (docs/canvas.md "Reading big boards"): the outline grouped by diagram frame → lane /
// column / screen / group, filters, pages and the size cap on read / diff / wait, the diff summary, the snapshot and
// layout routes, and who may approve a pairing code with canvas_approve.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { demoBoards } from '../src/demo.js'
import { outline, containmentTree } from '../src/outline.js'
import { readBoard, ReadError } from '../src/read.js'
import { diffSummary, filterChanges, pageLines } from '../src/diff.js'
import type { Board, DiagramKind, Item } from '../src/model.js'

let srv: RunningServer
let client: CanvasClient
let access: AccessService
let base: string

before(async () => {
  access = new AccessService({ store: new MemoryAccessStore() })
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-agentread-')), webDist: '/nonexistent', access })
  base = `http://127.0.0.1:${srv.port}`
  client = new CanvasClient(base)
})
after(() => srv.close())

const demo = (kind: DiagramKind) => demoBoards.find((b) => b.kind === kind)!.content

const UI = { device: 'phone', screens: [{ id: 'home', name: 'Home', body: [{ type: 'heading', id: 'title', text: 'Boards', level: 1 }, { type: 'card', id: 'box', text: 'Recent', children: [{ type: 'button', id: 'go', text: 'Open board' }] }] }] }

/** A freeform board with several diagram frames side by side, drawn like `awd design draw` does. */
let boards = 0
async function multiFrameBoard(): Promise<Board> {
  // a new board each time (createBoard finds an existing board by its title)
  const b = await client.createBoard({ title: `Many diagrams ${++boards}`, kind: 'freeform' })
  const frames: Array<[DiagramKind, string, unknown]> = [
    ['event-storming', 'shop-es', demo('event-storming')],
    ['user-story-map', 'shop-map', demo('user-story-map')],
    ['kanban', 'shop-kanban', demo('kanban')],
    ['domain-story', 'shop-ds', demo('domain-story')],
    ['ui-mock', 'shop-ui', UI],
  ]
  for (const [kind, key, content] of frames) {
    const { ops } = await client.template(b.id, kind, content, undefined, undefined, { key, title: `${key} title`, source: `design/${key}.yaml` })
    await client.apply(b.id, ops, 'agent')
  }
  return client.getBoard(b.id)
}

test('outline: every item sits under its diagram frame → lane / column / screen / group — nothing "(unplaced)"', async () => {
  const board = await multiFrameBoard()
  const text = outline(board)
  assert.doesNotMatch(text, /unplaced/)
  // one header per frame, with its key, file and size
  for (const key of ['shop-es', 'shop-map', 'shop-kanban', 'shop-ds', 'shop-ui']) assert.match(text, new RegExp(`^## .+ — key ${key} · design/${key}\\.yaml`, 'm'))
  // every non-comment, non-wire item is printed inside a frame section (indented), not at the top level
  const tree = containmentTree(board)
  for (const it of Object.values(board.items)) {
    if (it.type === 'arrow' || it.type === 'comment' || it.role === 'pivotal') continue
    if (it.id.startsWith('diagram.')) continue
    assert.ok(tree.parent.has(it.id), `${it.id} has a container`)
  }
  // kanban: columns with their card counts, cards under their column in stacking order
  const kb = text.slice(text.indexOf('— key shop-kanban'))
  assert.match(kb, /\n {2}## column: [^\n]+\[\d+ cards/)
  assert.match(kb, /\n {4}- card: /)
  // domain story: groups and the sentences in order
  const ds = text.slice(text.indexOf('— key shop-ds'))
  assert.match(ds, /sentences:\n\s+①/)
  // ui mock: the screen holds its elements (card → button nested)
  const ui = text.slice(text.indexOf('— key shop-ui'))
  assert.match(ui, /## screen: Home/)
  assert.match(ui, /## card: Recent[^\n]*\n\s+- button: Open board/)
  // the story map's releases hold their stories
  const map = text.slice(text.indexOf('— key shop-map'), text.indexOf('— key shop-kanban') > text.indexOf('— key shop-map') ? text.indexOf('— key shop-kanban') : undefined)
  assert.match(map, /## release: [^\n]+\n\s+- story: /)
})

test('outline: a frame with no parent is never swallowed by its own lane (the old "(unplaced)" bug)', () => {
  const now = 'x'
  const it = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 100, h: 100, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...p }) as Item
  // a big frame A, and frame B inside A's box whose release lane B.rel sits where B's centre is
  const board = {
    id: 'b', title: 't', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now,
    items: Object.fromEntries([
      it({ id: 'diagram.a', type: 'frame', role: 'diagram', x: 0, y: 0, w: 4000, h: 4000, text: 'A', data: { diagram: { kind: 'event-storming', key: 'a' } } }),
      it({ id: 'diagram.b', type: 'frame', role: 'diagram', x: 100, y: 100, w: 800, h: 800, text: 'B', data: { diagram: { kind: 'user-story-map', key: 'b' } } }),
      it({ id: 'b.rel', type: 'lane', role: 'release', x: 120, y: 300, w: 760, h: 300, text: 'Release 1', parent: 'diagram.b' }),
      it({ id: 'b.story', type: 'card', role: 'story', x: 140, y: 350, w: 150, h: 90, text: 'A story', parent: 'b.rel' }),
    ].map((i) => [i.id, i])),
  } as Board
  const text = outline(board)
  assert.match(text, /## story map "B" — key b[^\n]*\n {2}## release: Release 1[^\n]*\n {4}- story: A story/)
  assert.doesNotMatch(text, /unplaced|outside any frame/)
})

test('outline marks proposals and comment threads waiting for the person', async () => {
  const board = await multiFrameBoard()
  const story = Object.values(board.items).find((i) => i.role === 'story')!
  await client.apply(board.id, [
    { kind: 'update', id: story.id, patch: { data: { ...story.data, pending: { kind: 'add', by: 'codex-b' } } } },
    { kind: 'add', item: { id: 'c1', type: 'comment', x: 0, y: 0, w: 200, h: 60, text: 'is this in scope?', target: story.id, createdBy: 'user', updatedBy: 'user', updatedAt: 'x' } },
  ], 'user')
  const text = outline(await client.getBoard(board.id))
  assert.match(text, new RegExp(`- story: [^\\n]*\\[[^\\]]*proposed add by codex-b[^\\]]*\\]  #${story.id.replace(/\./g, '\\.')}`))
  assert.match(text, /💬 \(user\) is this in scope\? \[waiting for an answer\]  #c1/)
  // only the comments: each thread under the item (and frame) it is about
  const comments = readBoard(await client.getBoard(board.id), { types: ['comment'] }).text
  assert.match(comments, /## story map "shop-map title"[\s\S]*- story: [^\n]*\n\s+💬 \(user\) is this in scope\?/)
  assert.doesNotMatch(comments, /comments \(general\)/)
})

test('read: filters by frame, types, ids, text; json fields; an unknown frame names the keys', async () => {
  const board = await multiFrameBoard()
  const frame = readBoard(board, { frame: 'shop-kanban' })
  assert.match(frame.text, /— key shop-kanban/)
  assert.doesNotMatch(frame.text, /key shop-es/)
  const cards = readBoard(board, { format: 'json', types: ['card'], frame: 'shop-kanban', fields: ['id', 'text', 'parent'] })
  const rows = cards.text.split('\n').slice(1).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>)
  assert.ok(rows.length >= 3)
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['id', 'parent', 'text'].filter((k) => k in r).sort())
  const byText = readBoard(board, { text: 'open board' })
  assert.match(byText.text, /button: Open board/)
  assert.equal(byText.matched, 1)
  const one = readBoard(board, { ids: ['diagram.shop-ui'] })
  assert.match(one.text, /button: Open board/, 'a container brings what it holds')
  assert.throws(() => readBoard(board, { frame: 'nope' }), (e: unknown) => e instanceof ReadError && e.status === 404 && /shop-es/.test(e.message))
  const summary = readBoard(board, { format: 'summary' })
  assert.match(summary.text, /frame: "shop-kanban"/)
  assert.match(summary.text, /columns: /)
  assert.ok(summary.text.length < 4000)
})

test('read: pages and the size cap say what was left out and how to get it', async () => {
  const board = await multiFrameBoard()
  const first = readBoard(board, { maxChars: 2000 })
  assert.ok(first.text.length < 2600, `capped: ${first.text.length}`)
  assert.ok(first.nextCursor, 'a next cursor')
  assert.match(first.more!, /more line\(s\) of \d+ not shown .*cursor: "\d+:\d+"/)
  // following the cursors walks the whole outline exactly once
  const lines: string[] = []
  let cursor: string | undefined
  for (let i = 0; i < 100; i++) {
    const r = readBoard(board, { maxChars: 2000, cursor })
    lines.push(...r.text.split('\n').filter((l) => !l.startsWith('… ')))
    cursor = r.nextCursor
    if (!cursor) break
  }
  assert.deepEqual(lines, outline(board).split('\n'))
  // json pages by items
  const j1 = readBoard(board, { format: 'json', limit: 10 })
  assert.equal(j1.items!.length, 10)
  const j2 = readBoard(board, { format: 'json', limit: 10, cursor: j1.nextCursor })
  assert.notEqual(j2.items![0].id, j1.items![0].id)
  assert.throws(() => readBoard(board, { cursor: 'garbage' }), (e: unknown) => e instanceof ReadError && e.status === 400)
  // the default cap holds for a big board
  const big = structuredClone(board)
  for (let i = 0; i < 3000; i++) big.items[`n${i}`] = { id: `n${i}`, type: 'sticky', x: i * 10, y: 9000, w: 160, h: 110, text: `note number ${i} with some words in it`, createdBy: 'agent', updatedBy: 'agent', updatedAt: 'x' }
  const capped = readBoard(big, {})
  assert.ok(capped.text.length <= 41_000, `default cap: ${capped.text.length}`)
  assert.ok(readBoard(big, { format: 'json' }).text.length <= 41_000)
})

test('HTTP: /read and /outline take the same query; /diff filters, pages and summarises', async () => {
  const board = await multiFrameBoard()
  const r = await (await fetch(`${base}/api/boards/${board.id}/read?format=summary`)).json()
  assert.equal(r.format, 'summary')
  const o = await (await fetch(`${base}/api/boards/${board.id}/outline?frame=shop-ui&maxChars=2000`)).text()
  assert.match(o, /key shop-ui/)
  assert.doesNotMatch(o, /key shop-es/)
  assert.equal((await fetch(`${base}/api/boards/${board.id}/read?frame=nope`)).status, 404)
  assert.equal((await fetch(`${base}/api/boards/${board.id}/read?format=xml`)).status, 400)

  // history: the person moves a card and comments in the kanban, an agent renames something in the ES frame
  const now = await client.getBoard(board.id)
  const card = Object.values(now.items).find((i) => i.type === 'card' && i.role === 'card')!
  const ev = Object.values(now.items).find((i) => i.role === 'event')!
  const since = now.seq
  await client.apply(board.id, [{ kind: 'update', id: card.id, patch: { x: card.x + 5, y: card.y + 3 } }], 'user')
  await client.apply(board.id, [{ kind: 'add', item: { id: 'kc', type: 'comment', x: 0, y: 0, w: 100, h: 50, text: 'why here?', target: card.id, createdBy: 'user', updatedBy: 'user', updatedAt: 'x' } }], 'user')
  await new CanvasClient(base, { agentName: 'codex-b' }).apply(board.id, [{ kind: 'update', id: ev.id, patch: { text: 'Renamed event' } }], 'agent')

  const all = await client.diff(board.id, since)
  const kanban = await client.diff(board.id, since, undefined, { frame: 'shop-kanban' })
  assert.ok(kanban.lines.every((l) => !/Renamed event/.test(l)))
  assert.ok(kanban.lines.some((l) => /why here/.test(l)))
  const byCodex = await client.diff(board.id, since, undefined, { from: ['codex-b'] })
  assert.equal(byCodex.count, 1)
  assert.match(byCodex.lines[0], /\[\d+ codex-b\] .*renamed .*→ "Renamed event"/)
  const comments = await client.diff(board.id, since, undefined, { kinds: ['comment'] })
  assert.equal(comments.count, 1)
  const moves = await client.diff(board.id, since, 'user', { kinds: ['move'] })
  assert.equal(moves.count, 1)
  const sum = await client.diff(board.id, since, undefined, { summary: true })
  assert.match(sum.summary!, /by who × kind:\n {2}person: 1 move, 1 comment\n {2}codex-b: 1 update/)
  assert.match(sum.summary!, /by frame \(ops\):[\s\S]*shop-kanban: 2[\s\S]*shop-es: 1/)
  assert.match(sum.summary!, /last 3 line\(s\):/)
  assert.ok(all.count >= 2)
  assert.equal((await fetch(`${base}/api/boards/${board.id}/diff?since=0&kinds=bogus`)).status, 400)
  assert.equal((await fetch(`${base}/api/boards/${board.id}/diff?since=0&frame=nope`)).status, 404)

  // the size cap on the diff: a page and a cursor
  const capped = await (await fetch(`${base}/api/boards/${board.id}/diff?since=0&author=&maxChars=2000`)).json()
  assert.ok(capped.lines.join('\n').length <= 2100)
  assert.ok(capped.nextCursor && capped.total > capped.lines.length)
  const next = await (await fetch(`${base}/api/boards/${board.id}/diff?since=0&author=&maxChars=2000&cursor=${capped.nextCursor}`)).json()
  assert.equal(next.from, capped.lines.length)

  // wait with a frame filter: a change elsewhere does not wake it, one in the frame does
  const seq = (await client.getBoard(board.id)).seq
  const waiting = client.wait(board.id, seq, 3000, 'user', 0, 'meaningful', 'all', { frame: 'shop-kanban' })
  await new Promise((r) => setTimeout(r, 100))
  await client.apply(board.id, [{ kind: 'update', id: ev.id, patch: { text: 'Renamed by the person' } }], 'user')
  await new Promise((r) => setTimeout(r, 100))
  await client.apply(board.id, [{ kind: 'update', id: card.id, patch: { text: 'Card renamed' } }], 'user')
  const w = await waiting
  assert.equal(w.timedOut, false)
  assert.ok(w.lines.some((l) => /Card renamed/.test(l)))
  assert.ok(!w.lines.some((l) => /Renamed by the person/.test(l)))
})

test('pure: filterChanges / diffSummary / pageLines', () => {
  const t = 'x'
  const it = (id: string, p: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 10, h: 10, createdBy: 'user', updatedBy: 'user', updatedAt: t, ...p }) as Item
  const board = { id: 'b', title: 't', kind: 'event-storming', seq: 3, createdAt: t, updatedAt: t, items: { a: it('a', { text: 'A2' }) } } as Board
  const changes = [
    { seq: 2, ts: t, author: 'user' as const, boardId: 'b', ops: [{ kind: 'update' as const, id: 'a', patch: { x: 50 } }], before: { a: it('a') } },
    { seq: 3, ts: t, author: 'agent' as const, by: 'claude-a', boardId: 'b', ops: [{ kind: 'update' as const, id: 'a', patch: { text: 'A2' } }], before: { a: it('a') } },
  ]
  assert.equal(filterChanges(board, changes, { kinds: ['move'] }).length, 1)
  assert.equal(filterChanges(board, changes, { from: ['person'] })[0].seq, 2)
  assert.equal(filterChanges(board, changes, { from: ['claude-a'] })[0].seq, 3)
  assert.equal(filterChanges(board, changes, { frame: 'event-storming' }).length, 2, 'a legacy board is one diagram')
  assert.match(diffSummary(board, changes, ['l1', 'l2'], { since: 1 }), /person: 1 move\n {2}claude-a: 1 update/)
  const p = pageLines(Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(50)}`), { maxChars: 2000, seq: 3 })
  assert.ok(p.left > 0 && p.nextCursor === `3:${p.lines.length}`)
})

test('snapshot and layout routes: an SVG (or PNG) of a frame with info, findings as JSON and lines', async () => {
  const board = await multiFrameBoard()
  const res = await fetch(`${base}/api/boards/${board.id}/snapshot?frame=shop-kanban`)
  assert.equal(res.status, 200)
  const info = JSON.parse(res.headers.get('x-unprose-snapshot') ?? '{}')
  assert.ok(info.width > 0 && info.items > 0)
  const type = res.headers.get('content-type') ?? ''
  if (type.startsWith('image/svg')) {
    assert.match(await res.text(), /^<svg /)
    assert.ok(info.notes.some((n: string) => /rasterizer/.test(n)), 'says why it is not a PNG')
    assert.equal(info.renderer, 'svg')
  } else {
    assert.equal(type, 'image/png')
    assert.match(info.renderer, /^resvg /, 'says which renderer drew it')
  }
  const svg = await client.snapshot(board.id, { frame: 'shop-ui', format: 'svg' })
  assert.match(svg.svg!, /Open board/)
  assert.equal((await fetch(`${base}/api/boards/${board.id}/snapshot?frame=nope`)).status, 404)
  assert.equal((await fetch(`${base}/api/boards/${board.id}/snapshot?theme=pink`)).status, 400)
  // a sticky with too much text and an oversized one: the layout check says so
  await client.apply(board.id, [
    { kind: 'add', item: { id: 'tight', type: 'sticky', x: 20000, y: 0, w: 120, h: 60, text: 'a long sentence that will never fit in such a small sticky note at all', createdBy: 'agent', updatedBy: 'agent', updatedAt: 'x' } },
  ], 'agent')
  const lay = await client.layout(board.id)
  assert.ok(lay.findings.some((f) => f.id === 'tight' && f.kind === 'clipped'))
  assert.ok(((lay as { lines?: string[] }).lines ?? []).some((l) => /\[clipped\].*#tight/.test(l)))
  assert.equal((await fetch(`${base}/api/boards/${board.id}/layout?frame=nope`)).status, 404)
})

test('canvas_approve: only the local agent (loopback, no token, no browser) approves, by code, logged on the board', async () => {
  const board = await client.createBoard({ title: 'approvals', kind: 'freeform' })
  const dev = await (await fetch(`${base}/device_authorization`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.9' }, body: new URLSearchParams({ client_name: 'codex-b' }) })).json()
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/approve`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  // never a token, a page (Origin / Sec-Fetch-Site / a cookie), or a caller through a tunnel
  const tok = access.createToken({ name: 'sneaky' }, 't').token
  assert.equal((await post({ code: dev.user_code }, { authorization: `Bearer ${tok}` })).status, 403)
  assert.equal((await post({ code: dev.user_code }, { origin: base })).status, 403)
  assert.equal((await post({ code: dev.user_code }, { 'sec-fetch-site': 'same-origin' })).status, 403)
  assert.equal((await post({ code: dev.user_code }, { 'x-forwarded-for': '203.0.113.9', authorization: `Bearer ${tok}` })).status, 403)
  // a wrong code is refused (and counts against the limit)
  assert.equal((await post({ code: 'ZZZZ-ZZZZ' })).status, 404)
  // the right one, as a named local agent, logged on the board
  const ok = await new CanvasClient(base, { agentName: 'claude-a' }).approve(dev.user_code, { scope: 'read', board: board.id })
  assert.equal(ok.status, 'approved')
  assert.equal(ok.approved?.name, 'codex-b')
  assert.equal(ok.approved?.scope, 'read')
  assert.match(ok.audit, /approved codex-b \(device.*read\) with its pairing code — by the local agent claude-a/)
  const d = await client.diff(board.id, 0, 'agent')
  assert.ok(d.lines.some((l) => /\[\d+ claude-a\] approved codex-b/.test(l)))
  // ten wrong codes in ten minutes lock this approver out, like the page's "Enter a code"
  for (let i = 0; i < 10; i++) await post({ code: `AAAA-AAA${i}` })
  assert.equal((await post({ code: 'AAAA-AAAZ' })).status, 429)
})

test('canvas_approve is not offered over the remote /mcp; the read tools are', async () => {
  const tok = access.createToken({ name: 'remote-reader', scope: 'read' }, 't').token
  const mcp = new Client({ name: 't', version: '1' })
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': '203.0.113.9' } } }))
  const tools = (await mcp.listTools()).tools.map((t) => t.name)
  for (const n of ['canvas_read_board', 'canvas_diff', 'canvas_snapshot', 'canvas_check_layout']) assert.ok(tools.includes(n), n)
  assert.ok(!tools.includes('canvas_approve'))
  const board = await multiFrameBoard()
  const r = (await mcp.callTool({ name: 'canvas_read_board', arguments: { id: board.id, format: 'summary' } })) as { content: Array<{ type: string; text?: string }> }
  assert.match(r.content[0].text!, /frame: "shop-es"/)
  const s = (await mcp.callTool({ name: 'canvas_snapshot', arguments: { id: board.id, frame: 'shop-kanban' } })) as { content: Array<{ type: string; text?: string; mimeType?: string }> }
  assert.ok(s.content.some((c) => c.type === 'image' && c.mimeType === 'image/png') || /<svg /.test(s.content[0].text ?? ''))
  await mcp.close()
})

test('the layout lock: a locked kanban is drawn as stored by the snapshot and never reported as "drawn elsewhere"', async () => {
  const { checkLayout } = await import('../src/layoutCheck.js')
  const { shownBoard } = await import('../src/shown.js')
  const { renderSnapshot } = await import('../src/snapshot.js')
  const t = 'x'
  const it = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 100, h: 100, createdBy: 'agent', updatedBy: 'agent', updatedAt: t, ...p }) as Item
  const items = [
    it({ id: 'diagram.kb', type: 'frame', role: 'diagram', x: 0, y: 0, w: 900, h: 700, text: 'KB', data: { diagram: { kind: 'kanban', key: 'kb' } } }),
    it({ id: 'kb.col', type: 'lane', role: 'column', x: 40, y: 40, w: 280, h: 600, text: 'Todo', parent: 'diagram.kb' }),
    it({ id: 'kb.card', type: 'card', role: 'card', x: 90, y: 400, w: 240, h: 90, text: 'Stored low', parent: 'kb.col' }),
  ]
  const board = { id: 'b', title: 't', kind: 'freeform', seq: 1, createdAt: t, updatedAt: t, items: Object.fromEntries(items.map((i) => [i.id, i])) } as Board
  // unlocked: the card stacks under the header, and the check explains it
  assert.notEqual(shownBoard(board).items['kb.card'].y, 400)
  assert.ok(checkLayout(board).findings.some((f) => f.kind === 'moved-by-layout' && f.id === 'kb.card'))
  // the frame locked: shown as stored, nothing "drawn elsewhere"
  const locked = structuredClone(board)
  locked.items['diagram.kb'].data = { ...locked.items['diagram.kb'].data, lock: 'layout' }
  assert.equal(shownBoard(locked).items['kb.card'].y, 400)
  assert.ok(!checkLayout(locked).findings.some((f) => f.kind === 'moved-by-layout'))
  assert.match(renderSnapshot(locked, { frame: 'kb', format: 'svg' } as never).svg, /Stored low/)
  // only the card locked: it keeps its place, still no finding for it
  const card = structuredClone(board)
  card.items['kb.card'].data = { lock: 'layout' }
  assert.equal(shownBoard(card).items['kb.card'].y, 400)
  assert.ok(!checkLayout(card).findings.some((f) => f.kind === 'moved-by-layout' && f.id === 'kb.card'))
})
