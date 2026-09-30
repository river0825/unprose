import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { gotoTargets, rankTargets } from '../src/diagrams/goto.js'
import type { Board, Item } from '../src/model.js'

let srv: RunningServer
let client: CanvasClient
test.before(async () => {
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-canvas-focus-')), webDist: '/nonexistent' })
  client = new CanvasClient(srv.url)
})
after(() => srv.close())

const post = async (id: string, body: unknown) => {
  const r = await fetch(`${srv.url}/api/boards/${id}/focus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as any }
}

test('POST /focus broadcasts a focus message to open pages and records no board change', async () => {
  const board = await client.createBoard({ title: 'Focus', kind: 'freeform', content: { items: [{ id: 'q1', text: 'Q1 — which store?' }, { id: 'q2', text: 'Q2' }] } })
  const ws = new WebSocket(`${srv.url.replace('http', 'ws')}/ws/${board.id}`)
  const got: any[] = []
  ws.on('message', (d) => got.push(JSON.parse(d.toString())))
  await new Promise((r) => ws.once('open', r))
  await new Promise((r) => setTimeout(r, 30))

  const r = await post(board.id, { ids: ['q1', 'q2'], note: 'decide these' })
  assert.equal(r.status, 200)
  assert.equal(r.body.viewers, 1)
  await new Promise((r2) => setTimeout(r2, 30))
  const focus = got.find((m) => m.type === 'focus')
  assert.deepEqual({ ids: focus.ids, note: focus.note, author: focus.author }, { ids: ['q1', 'q2'], note: 'decide these', author: 'agent' })
  assert.ok(focus.at)
  assert.equal((await client.getBoard(board.id)).seq, board.seq, 'no change recorded')
  assert.equal(got.filter((m) => m.type === 'change').length, 0)
  ws.close()
})

test('POST /focus resolves a frame key, and validates its input', async () => {
  const board = await client.createBoard({ title: 'Frames', kind: 'freeform' })
  await fetch(`${srv.url}/api/boards/${board.id}/template`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'kanban', content: { columns: [{ name: '要你決定' }], cards: [{ id: 'q1', title: 'Q1', column: '要你決定' }] }, frame: { key: 'k635' } }) })
    .then((r) => r.json())
    .then((t: any) => client.apply(board.id, t.ops, 'agent'))
  const ok = await post(board.id, { frame: 'k635' })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body.focus.ids, ['diagram.k635'])
  assert.equal(ok.body.viewers, 0)
  assert.equal((await post(board.id, {})).status, 400, 'nothing to show')
  assert.equal((await post(board.id, { ids: 'q1' })).status, 400)
  assert.equal((await post(board.id, { ids: ['nope'] })).status, 404)
  assert.equal((await post(board.id, { frame: 'missing' })).status, 404)
  assert.equal((await post(board.id, { frame: 'Bad Key' })).status, 400)
  assert.equal((await post(board.id, { ids: ['k635.card.q1'], author: 'robot' })).status, 400)
  // a legacy board's own kind is its (frameless) diagram
  const legacy = await client.createBoard({ title: 'Legacy', kind: 'kanban', content: { columns: [{ name: 'A' }], cards: [] } })
  assert.equal((await post(legacy.id, { frame: 'kanban' })).status, 200)
})

test('client.boardUrl carries ?frame= / ?focus=', () => {
  assert.match(client.boardUrl('b1', { frame: 'studio-es' }), /\/b\/b1\?frame=studio-es$/)
  assert.match(client.boardUrl('b1'), /\/b\/b1$/)
})

test('go-to targets: frames first; ranking by prefix, word start, substring and letters in order', () => {
  const item = (o: Partial<Item> & { id: string }): Item => ({ type: 'sticky', x: 0, y: 0, w: 10, h: 10, createdBy: 'agent', updatedBy: 'agent', updatedAt: 't', ...o })
  const board: Pick<Board, 'kind' | 'items'> = {
    kind: 'freeform',
    items: {
      'diagram.k635': item({ id: 'diagram.k635', type: 'frame', text: '#635 kanban', data: { diagram: { kind: 'kanban', key: 'k635' } } }),
      'diagram.studio-es': item({ id: 'diagram.studio-es', type: 'frame', text: 'Studio · Ask AI', data: { diagram: { kind: 'event-storming', key: 'studio-es' } } }),
      q1: item({ id: 'q1', text: 'Q1 要你決定：store', parent: 'diagram.k635', role: 'card' }),
      col: item({ id: 'col', type: 'lane', text: '要你決定', parent: 'diagram.k635', role: 'column' }),
      c: item({ id: 'c', type: 'comment', text: 'ignored' }),
      blank: item({ id: 'blank', text: '' }),
    },
  }
  const all = gotoTargets(board)
  assert.deepEqual(all.slice(0, 2).map((t) => t.kind), ['frame', 'frame'], 'frames first')
  assert.deepEqual(all.slice(2).map((t) => t.id).sort(), ['col', 'q1'])
  assert.equal(all.find((t) => t.id === 'q1')!.detail, '#635 kanban')
  assert.ok(!all.some((t) => t.id === 'c' || t.id === 'blank'))
  assert.equal(rankTargets(all, '635')[0].id, 'diagram.k635')
  assert.equal(rankTargets(all, 'stes')[0].id, 'diagram.studio-es', 'letters in order match the key')
  assert.deepEqual(rankTargets(all, '要你決定').map((t) => t.id).sort(), ['col', 'q1'])
  assert.deepEqual(rankTargets(all, 'q1 store').map((t) => t.id), ['q1'], 'every word must match')
  assert.equal(rankTargets(all, 'zzz').length, 0)
})
