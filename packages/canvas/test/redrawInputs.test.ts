// What a redraw reads from the change log (docs/diagrams.md "What a redraw keeps"), folded: the fold gives what
// redrawInputs gives for the whole log however the log is cut, survives JSON, and the canvas serves it per board
// (GET /api/boards/:id/redraw-inputs) folded on from where it was — with the access rules of GET …/changes.
// A client of a canvas without the route reads the whole log, as before.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { MemoryBoardRepository } from '../src/adapters/boards/index.js'
import { drawDesignContent } from '../src/designTools.js'
import { emptyRedrawInputs, foldRedrawInputs, redrawInputs, redrawInputsFromJson, redrawInputsToJson, type LoggedChange, type RedrawInputs } from '../src/diagrams/index.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const design = (name: string) => fs.readFileSync(path.join(repo, 'design', name), 'utf8')
const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }

/** Comparable: sets and maps as sorted entries. */
const plain = (r: Required<RedrawInputs>) => ({
  placed: [...r.placed].sort(),
  origins: [...r.origins].sort(([a], [b]) => a.localeCompare(b)),
  removed: [...r.removed].sort(([a], [b]) => a.localeCompare(b)),
})

let srv: RunningServer
let access: AccessService
let claude: CanvasClient
const store = new MemoryBoardRepository()
before(async () => {
  access = new AccessService({ store: new MemoryAccessStore() })
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access })
  claude = new CanvasClient(srv.url, { agentName: 'claude-a' })
})
after(() => srv.close())

/** A board with a log like a real one: two diagrams drawn and redrawn by two agents, the person moving, editing, deleting and re-adding, comments, receipts, a settings change, a handoff. */
let boards = 0
async function realisticBoard(): Promise<string> {
  const codex = new CanvasClient(srv.url, { agentName: 'codex-b' })
  const r = await drawDesignContent(claude, 'studio.es.yaml', design('studio.es.yaml'), `title:Realistic ${++boards}`)
  const id = r.boardId
  await drawDesignContent(codex, 'studio.kanban.yaml', design('studio.kanban.yaml'), id)
  const b = store.get(id)!
  const stickies = Object.values(b.items).filter((i) => i.type === 'sticky').slice(0, 6)
  const [a, c, d, e, f] = stickies
  store.apply(id, [{ kind: 'update', id: a.id, patch: { x: a.x + 50, y: a.y + 10 } }], 'user')
  store.apply(id, [{ kind: 'update', id: c.id, patch: { text: 'reworded by the person' } }], 'user') // content only: not placed
  store.apply(id, [{ kind: 'update', id: d.id, patch: { w: d.w + 40 } }, { kind: 'remove', id: e.id }], 'user')
  store.apply(id, [{ kind: 'remove', id: f.id }], 'user')
  store.apply(id, [{ kind: 'add', item: { ...f, x: f.x + 1 } }], 'agent', 'put it back', 'codex-b') // re-added: no longer "removed"
  store.apply(id, [{ kind: 'update', id: c.id, patch: { x: c.x - 5 } }], 'agent', 'nudge') // an agent's move: not the person's
  store.apply(id, [{ kind: 'add', item: { id: 'mine', type: 'sticky', x: 0, y: 0, w: 100, h: 60, text: 'mine', createdBy: 'user', updatedBy: 'user', updatedAt: '' } }], 'user')
  store.apply(id, [{ kind: 'add', item: { id: 'c1', type: 'comment', x: 0, y: 100, w: 100, h: 60, text: 'why?', target: a.id, createdBy: 'user', updatedBy: 'user', updatedAt: '' } }], 'user')
  store.apply(id, [{ kind: 'update', id: 'c1', patch: { data: { seenBy: ['agent'] } } }], 'agent', 'seen')
  store.setMeta(id, { context: { text: 'what this board is for' } }, 'user', 'updated the board context')
  store.apply(id, [], 'user', 'handoff')
  store.apply(id, [{ kind: 'remove', id: 'mine' }], 'user')
  const card = Object.values(store.get(id)!.items).find((i) => i.type === 'card')!
  store.apply(id, [{ kind: 'remove', id: card.id }], 'user') // from codex's kanban, which nobody redraws here
  await drawDesignContent(claude, 'studio.es.yaml', design('studio.es.yaml'), id)
  return id
}

/** The id the person removed and an agent added back (realisticBoard). */
const removedThenReadded = (log: LoggedChange[]) => log.find((c) => c.note === 'put it back')!.ops[0].item!.id

test('the fold equals redrawInputs of the whole log, however the log is cut', async () => {
  const id = await realisticBoard()
  const log = store.changes(id) as unknown as LoggedChange[]
  const whole = redrawInputs(log)
  assert.ok(whole.placed.size >= 2 && whole.removed.size >= 2 && whole.origins.size > 20, 'the log exercises every part')
  assert.equal(whole.removed.has(removedThenReadded(log)), false)
  assert.deepEqual(plain(foldRedrawInputs(emptyRedrawInputs(), log)), plain(whole))
  for (const size of [1, 2, 3, 7, 50]) {
    const acc = emptyRedrawInputs()
    for (let i = 0; i < log.length; i += size) foldRedrawInputs(acc, log.slice(i, i + size))
    assert.deepEqual(plain(acc), plain(whole), `slices of ${size}`)
  }
})

test('JSON: a round trip keeps everything; each distinct origin is written once; anything malformed reads as empty', () => {
  const log: LoggedChange[] = [
    { author: 'agent', by: 'claude-a', note: 'design_draw: a.ui.yaml', ops: Array.from({ length: 200 }, (_, i) => ({ kind: 'add', item: { id: `k.${i}`, type: 'ui' } })) },
    { author: 'user', ts: '2026-10-15T10:00:00.000Z', ops: [{ kind: 'update', id: 'k.1', patch: { x: 1 } }, { kind: 'remove', id: 'k.2' }] },
    { author: 'user', ops: [{ kind: 'remove', id: 'k.3' }, { kind: 'add', item: { id: 'n', type: 'sticky' } }] },
  ]
  const r = redrawInputs(log)
  const j = redrawInputsToJson(r)
  assert.equal(j.origins.length, 2, 'one draw, one person')
  assert.deepEqual(j.removed.sort(), [['k.2', '2026-10-15T10:00:00.000Z'], ['k.3']])
  assert.deepEqual(plain(redrawInputsFromJson(JSON.parse(JSON.stringify(j)))), plain(r))
  assert.deepEqual(plain(redrawInputsFromJson(undefined)), plain(emptyRedrawInputs()))
  assert.deepEqual(plain(redrawInputsFromJson({ placed: 'x', origins: [{}], originOf: { a: 0, b: 9 }, removed: [[1], 'y'] } as never)), plain(emptyRedrawInputs()))
})

test('GET …/redraw-inputs: what redrawInputs makes of GET …/changes, folded on as the board changes', async () => {
  const id = await realisticBoard()
  const read = async () => (await fetch(`${srv.url}/api/boards/${id}/redraw-inputs`)).json() as Promise<Record<string, unknown> & { seq: number }>
  const full = async () => redrawInputs(((await (await fetch(`${srv.url}/api/boards/${id}/changes?since=0`)).json()) as { changes: LoggedChange[] }).changes)
  const first = await read()
  assert.equal(first.seq, store.get(id)!.seq)
  assert.deepEqual(plain(redrawInputsFromJson(first)), plain(await full()))
  // more changes: the canvas reads only what came after its last read
  const seen: number[] = []
  const changes = store.changes.bind(store)
  store.changes = (bid, q) => (bid === id && seen.push(q?.since ?? 0), changes(bid, q))
  try {
    const it = Object.values(store.get(id)!.items).find((i) => i.type === 'lane')!
    store.apply(id, [{ kind: 'update', id: it.id, patch: { y: it.y + 30 } }], 'user')
    store.apply(id, [{ kind: 'remove', id: it.id }], 'user')
    const next = await read()
    assert.deepEqual(seen, [first.seq], 'folded on from the seq of the last read')
    assert.equal(next.seq, first.seq + 2)
    assert.deepEqual(plain(redrawInputsFromJson(next)), plain(await full()))
  } finally {
    store.changes = changes
  }
  // the client reads the same
  assert.deepEqual(plain(await claude.redrawInputs(id)), plain(await full()))
})

test('a board deleted and made again under its id starts from its new log', async () => {
  const b = store.create({ id: 'again', title: 'again', kind: 'freeform' })
  store.apply(b.id, [{ kind: 'add', item: { id: 'old', type: 'sticky', x: 0, y: 0, w: 1, h: 1, createdBy: 'user', updatedBy: 'user', updatedAt: '' } }], 'user')
  store.apply(b.id, [{ kind: 'update', id: 'old', patch: { x: 9 } }], 'user')
  assert.deepEqual([...(await claude.redrawInputs('again')).placed], ['old'])
  // deleted behind the server's back (not through DELETE), made again a moment later, with a longer log than before
  store.delete('again')
  await new Promise((r) => setTimeout(r, 5))
  store.create({ id: 'again', title: 'again', kind: 'freeform' })
  for (let i = 0; i < 4; i++) store.apply('again', [{ kind: 'add', item: { id: `new${i}`, type: 'sticky', x: 0, y: 0, w: 1, h: 1, createdBy: 'agent', updatedBy: 'agent', updatedAt: '' } }], 'agent')
  const now = await claude.redrawInputs('again')
  assert.deepEqual([...now.placed], [], 'the old board moved "old"; this one has no such item')
  assert.deepEqual(plain(now), plain(redrawInputs(store.changes('again') as unknown as LoggedChange[])))
})

test('the access rules of GET …/changes: credentials from elsewhere, and a token for another board gets 403', async () => {
  const id = await realisticBoard()
  const other = store.create({ title: 'other', kind: 'freeform' })
  assert.equal((await fetch(`${srv.url}/api/boards/${id}/redraw-inputs`, { headers: REMOTE })).status, 401)
  const scoped = access.createToken({ name: 'scoped', scope: 'read', boards: [other.id] }, 't').token
  const as = { ...REMOTE, authorization: `Bearer ${scoped}` }
  for (const sub of ['changes?since=0', 'redraw-inputs']) {
    assert.equal((await fetch(`${srv.url}/api/boards/${id}/${sub}`, { headers: as })).status, 403, sub)
    assert.equal((await fetch(`${srv.url}/api/boards/${other.id}/${sub}`, { headers: as })).status, 200, `${sub}, its own board (read-only is enough)`)
  }
  assert.equal((await fetch(`${srv.url}/api/boards/nope/redraw-inputs`)).status, 404)
})

test('a canvas without the route: the client reads the whole log and folds it itself', async () => {
  const log: LoggedChange[] = [
    { author: 'agent', note: 'design_draw: k.es.yaml', ops: [{ kind: 'add', item: { id: 'k.a', type: 'sticky' } }, { kind: 'add', item: { id: 'k.b', type: 'sticky' } }] },
    { author: 'user', ts: '2026-10-15T00:00:00.000Z', ops: [{ kind: 'update', id: 'k.a', patch: { x: 3 } }, { kind: 'remove', id: 'k.b' }] },
  ]
  const asked: string[] = []
  // answers like a canvas before the route: 404 { error: 'not found' } for an unknown board sub-route
  const old = http.createServer((req, res) => {
    asked.push(req.url ?? '')
    res.writeHead(req.url?.includes('/changes?since=0') ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify(req.url?.includes('/changes?since=0') ? { changes: log, seq: 2 } : { error: 'not found' }))
  })
  await new Promise<void>((r) => old.listen(0, r))
  try {
    const url = `http://127.0.0.1:${(old.address() as { port: number }).port}`
    assert.deepEqual(plain(await new CanvasClient(url).redrawInputs('b1')), plain(redrawInputs(log)))
    assert.deepEqual(asked, ['/api/boards/b1/redraw-inputs', '/api/boards/b1/changes?since=0'])
    // a missing board (404 too): the whole-log read fails the same way, with the canvas's own words
    await assert.rejects(claude.redrawInputs('nope'), /board nope not found/)
  } finally {
    await new Promise((r) => old.close(r))
  }
})
