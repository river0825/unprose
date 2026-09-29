import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { demoBoards } from '../src/demo.js'

let srv: RunningServer
let client: CanvasClient

test.before(async () => {
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-canvas-srv-')), webDist: '/nonexistent' })
  client = new CanvasClient(srv.url)
})
after(() => srv.close())

test('create board from content, read, apply as user, diff, outline', async () => {
  const board = await client.createBoard({ title: 'API ES', kind: 'event-storming', content: demoBoards[0].content })
  assert.ok(board.id)
  assert.equal(board.seq, 1)
  const n = Object.keys(board.items).length
  assert.ok(n > 20)

  const got = await client.getBoard(board.id)
  assert.equal(Object.keys(got.items).length, n)

  const ev = Object.values(got.items).find((i) => i.text === 'Build claimed')!
  const r = await client.apply(board.id, [{ kind: 'update', id: ev.id, patch: { text: 'Build claimed (lease)' } }], 'user', 'rename')
  assert.equal(r.seq, 2)

  const diff = await client.diff(board.id, 1, 'user')
  assert.equal(diff.count, 1)
  assert.match(diff.lines[0], /renamed "Build claimed" → "Build claimed \(lease\)"/)
  const agentOnly = await client.diff(board.id, 1, 'agent')
  assert.equal(agentOnly.count, 0)

  const text = await client.outline(board.id)
  assert.match(text, /Build claimed \(lease\)/)

  const list = await client.listBoards()
  assert.ok(list.some((b) => b.id === board.id && b.items === n))
})

test('template endpoint re-renders into update ops; add_items path', async () => {
  const board = await client.createBoard({ title: 'WF', kind: 'workflow', content: demoBoards[5].content })
  const { ops } = await client.template(board.id, undefined, demoBoards[5].content)
  assert.ok(ops.length > 0)
  assert.ok(ops.every((o) => o.kind === 'update'))
  const extra = await client.template(board.id, 'freeform', { items: [{ type: 'comment', text: 'hi', target: ops[0].kind === 'update' ? ops[0].id : '' }] }, { x: 500, y: 500 })
  assert.equal(extra.ops.length, 1)
  assert.equal(extra.ops[0].kind, 'add')
  const r = await client.apply(board.id, extra.ops, 'agent', 'reply')
  assert.equal(r.seq, 2)
})

test('wait long-polls until a user change arrives; websocket broadcasts hello + change', async () => {
  const board = await client.createBoard({ title: 'Wait', kind: 'freeform', content: { items: [{ text: 'a' }] } })
  const ws = new WebSocket(`${srv.url.replace('http', 'ws')}/ws/${board.id}`)
  const messages: any[] = []
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
  await new Promise((r) => ws.once('open', r))

  const waiting = client.wait(board.id, board.seq, 5000, 'user')
  await new Promise((r) => setTimeout(r, 30))
  await client.apply(board.id, [{ kind: 'add', item: { id: 'u1', type: 'comment', x: 0, y: 0, w: 200, h: 60, text: 'why?', createdBy: 'user', updatedBy: 'user', updatedAt: 'x' } }], 'user')
  const res = await waiting
  assert.equal(res.timedOut, false)
  assert.equal(res.seq, 3, 'seq includes the read receipt the wait recorded on the comment')
  assert.match(res.lines[0], /added comment: "why\?"/)

  const timedOut = await client.wait(board.id, 2, 50, 'user')
  assert.equal(timedOut.timedOut, true)

  await new Promise((r) => setTimeout(r, 20))
  assert.equal(messages[0].type, 'hello')
  assert.equal(messages[0].board.id, board.id)
  // presence frames (agent watching / not watching) interleave with changes
  const presence = messages.filter((m: { type: string }) => m.type === 'presence')
  assert.ok(presence.length >= 1)
  assert.ok(presence.some((m: { watching: boolean }) => m.watching === true), 'a watching=true frame while the wait was pending')
  const change = messages.find((m: { type: string }) => m.type === 'change')
  assert.equal(change.change.seq, 2)
  ws.close()
})

test('validation: bad kind, bad ops, unknown board, bad json', async () => {
  await assert.rejects(client.createBoard({ title: 'x', kind: 'nope' as never }), /kind must be one of/)
  await assert.rejects(client.getBoard('missing'), /not found/)
  const board = await client.createBoard({ title: 'V', kind: 'freeform' })
  await assert.rejects(client.apply(board.id, [{ kind: 'bogus' } as never], 'user'), /unknown op kind/)
  await assert.rejects(client.apply(board.id, [], 'nobody' as never), /author must be/)
  const res = await fetch(`${srv.url}/api/boards/${board.id}/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
  assert.equal(res.status, 400)
  const ws404 = new WebSocket(`${srv.url.replace('http', 'ws')}/ws/missing`)
  await new Promise<void>((r) => ws404.once('error', () => r()))
})

test('UI fallback page when web/dist is absent; kinds endpoint', async () => {
  const html = await (await fetch(`${srv.url}/`)).text()
  assert.match(html, /web UI is not built/)
  const b = await (await fetch(`${srv.url}/b/whatever`)).text()
  assert.match(b, /awd-canvas/)
  const kinds = (await (await fetch(`${srv.url}/api/kinds`)).json()) as { kinds: string[] }
  assert.ok(kinds.kinds.includes('event-storming'))
})

test('diff/wait record that the agent has seen user comments; read receipts never wake a wait or show in a diff', async () => {
  const board = await client.createBoard({ title: 'Seen', kind: 'freeform', content: { items: [{ text: 'a' }] } })
  const comment = { id: 'q1', type: 'comment' as const, x: 0, y: 0, w: 160, h: 64, text: 'ok?', createdBy: 'user' as const, updatedBy: 'user' as const, updatedAt: 'x' }
  await client.apply(board.id, [{ kind: 'add', item: comment }], 'user')
  const d = await client.diff(board.id, board.seq, 'user')
  assert.equal(d.lines.length, 1)
  const seen = (await client.getBoard(board.id)).items.q1
  assert.deepEqual(seen.data?.seenBy, ['agent'])
  assert.equal(d.seq, 3)
  const again = await client.diff(board.id, board.seq, 'user')
  assert.equal(again.lines.length, 1)
  assert.equal((await client.getBoard(board.id)).seq, 3)

  const reply = { ...comment, id: 'r1', text: 'yes', createdBy: 'agent' as const, updatedBy: 'agent' as const }
  await client.apply(board.id, [{ kind: 'add', item: reply }], 'agent')
  const waiting = client.wait(board.id, 4, 300, 'user', 50)
  await new Promise((r) => setTimeout(r, 30))
  const cur = (await client.getBoard(board.id)).items.r1
  await client.apply(board.id, [{ kind: 'update', id: 'r1', patch: { data: { seenBy: ['user'] } } }], 'user', 'read')
  const res = await waiting
  assert.equal(res.timedOut, true)
  assert.equal(cur.updatedBy, 'agent')
  assert.equal((await client.getBoard(board.id)).items.r1.updatedBy, 'agent')
  assert.equal((await client.diff(board.id, 4, 'user')).count, 0)
})

test('wait: wake is validated; the default ignores moves and returns them folded', async () => {
  const board = await client.createBoard({ title: 'Wake', kind: 'freeform', content: { items: [{ text: 'a' }, { text: 'b' }] } })
  const [a, b] = Object.values(board.items)
  const bad = await fetch(`${srv.url}/api/boards/${board.id}/wait?since=0&timeout=10&wake=never`)
  assert.equal(bad.status, 400)
  const waiting = client.wait(board.id, board.seq, 3000, 'user', 40)
  await client.apply(board.id, [{ kind: 'update', id: a.id, patch: { x: a.x + 30 } }], 'user')
  await client.apply(board.id, [{ kind: 'update', id: b.id, patch: { x: b.x + 30 } }], 'user')
  await new Promise((r) => setTimeout(r, 80))
  await client.apply(board.id, [{ kind: 'update', id: b.id, patch: { color: 'red' } }], 'user')
  const res = await waiting
  assert.equal(res.lines.length, 2)
  assert.match(res.lines[0], /recoloured/)
  assert.match(res.lines[1], /moved 2 items: a, b$/)
})

test('a multi-select gesture is one change: a group move folds into one line, a group delete is one batch', async () => {
  const board = await client.createBoard({ title: 'Group', kind: 'freeform', content: { items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] } })
  const items = Object.values(board.items)
  const waiting = client.wait(board.id, board.seq, 3000, 'user', 40)
  const moved = await client.apply(board.id, items.map((i) => ({ kind: 'update', id: i.id, patch: { x: i.x + 100, y: i.y + 50 } })), 'user', 'moved 3 items')
  assert.equal(moved.seq, board.seq + 1)
  await client.apply(board.id, [{ kind: 'update', id: items[0].id, patch: { text: 'a!' } }], 'user')
  const res = await waiting
  assert.deepEqual(res.changes.map((c) => c.ops.length), [3, 1])
  assert.equal(res.lines.length, 2)
  assert.match(res.lines[1], /^\[2 user\] moved 3 items: a!, b, c$/)

  const del = await client.apply(board.id, items.map((i) => ({ kind: 'remove', id: i.id })), 'user', 'deleted 3 items')
  assert.equal(del.change.ops.length, 3)
  assert.equal(Object.keys((await client.getBoard(board.id)).items).length, 0)
})
