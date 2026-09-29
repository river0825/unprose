import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { render, renderKanban, cardsIn, columnsOf, cardHeight } from '../src/templates/index.js'
import { cardMoves, summarize } from '../src/diff.js'
import { BoardStore } from '../src/store.js'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { demoBoards } from '../src/demo.js'
import type { Item } from '../src/model.js'

const NOW = '2026-09-22T00:00:00.000Z'
const overlaps = (a: Item, b: Item) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const kanbanDemo = demoBoards.find((b) => b.kind === 'kanban')!

test('kanban template: deterministic ids, columns contain their cards, no card overlaps another', () => {
  const a = renderKanban(kanbanDemo.content as never, { now: NOW })
  const b = renderKanban(kanbanDemo.content as never, { now: NOW })
  assert.deepEqual(a, b)
  const cols = a.filter((i) => i.type === 'lane' && i.role === 'column')
  assert.equal(cols.length, 9)
  assert.ok(cols.every((c) => c.h === cols[0].h), 'columns share one height')
  const cards = a.filter((i) => i.type === 'card')
  assert.equal(cards.length, 9)
  for (const c of cards) {
    const col = cols.find((l) => l.id === c.parent)
    assert.ok(col, `card "${c.text}" has no column`)
    assert.ok(c.x >= col!.x && c.x + c.w <= col!.x + col!.w && c.y >= col!.y && c.y + c.h <= col!.y + col!.h, `card "${c.text}" outside its column`)
  }
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) assert.ok(!overlaps(cards[i], cards[j]), `"${cards[i].text}" overlaps "${cards[j].text}"`)
  // an explicit id makes a stable card id; the WIP limit rides on the column
  assert.ok(cards.some((c) => c.id === 'kb.card.c-happy'))
  assert.equal(cols.find((c) => c.text === 'In Progress')!.data?.wip, 3)
  // a taller title makes a taller card
  assert.ok(cardHeight({ title: 'x'.repeat(80), size: 'M' }) > cardHeight({ title: 'short' }))
})

test('kanban: a card naming an unknown column lands in the first one', () => {
  const items = render('kanban', { columns: [{ name: 'Todo' }, { name: 'Done' }], cards: [{ title: 'lost', column: 'Nope' }] }, { now: NOW })
  const card = items.find((i) => i.type === 'card')!
  assert.equal(items.find((i) => i.id === card.parent)!.text, 'Todo')
})

test('kanban: a user drag into another column reads as `card "…" [id]: moved from A → B` and as a structured cardMoves entry', () => {
  const store = new BoardStore(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-kanban-')))
  const board = store.create({ title: 'KB', kind: 'kanban', items: renderKanban(kanbanDemo.content as never, { now: NOW }) })
  const ready = columnsOf(board).find((c) => c.text === 'Ready')!
  const inProgress = columnsOf(board).find((c) => c.text === 'In Progress')!
  const card = cardsIn(board, ready)[0]
  // the web UI's drag-stop op: new x/y plus the new parent
  const ch = store.apply(board.id, [{ kind: 'update', id: card.id, patch: { x: inProgress.x + 20, y: inProgress.y + 300, parent: inProgress.id } }], 'user', "moved 'Upload contacts CSV'")
  const after = store.get(board.id)!
  const lines = summarize(after, [ch])
  assert.equal(lines.length, 1)
  assert.equal(lines[0], `[2 user] card "${card.text}" [${card.id}]: moved from Ready → In Progress`)
  const moves = cardMoves(after, [ch])
  assert.deepEqual(moves.map((m) => ({ cardId: m.cardId, title: m.title, from: m.from, to: m.to, seq: m.seq, author: m.author })), [
    { cardId: card.id, title: card.text, from: 'Ready', to: 'In Progress', seq: 2, author: 'user' },
  ])
  // a drag without `parent` (geometry only) is still a column move
  const other = cardsIn(after, ready)[0]
  const ch2 = store.apply(board.id, [{ kind: 'update', id: other.id, patch: { x: inProgress.x + 20, y: inProgress.y + 400, parent: undefined } }], 'user')
  const after2 = store.get(board.id)!
  assert.equal(cardMoves(after2, [ch2])[0]?.to, 'In Progress')
  // a same-column nudge is not a move
  const ch3 = store.apply(board.id, [{ kind: 'update', id: card.id, patch: { y: inProgress.y + 320 } }], 'user')
  assert.deepEqual(cardMoves(store.get(board.id)!, [ch3]), [])
})

let srv: RunningServer
let client: CanvasClient
test.before(async () => {
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-kanban-srv-')), webDist: '/nonexistent' })
  client = new CanvasClient(srv.url)
})
after(() => srv.close())

test('kanban API: add a card, move it, read the moves; a user-style ops move is reported too', async () => {
  const board = await client.createBoard({ title: 'KB API', kind: 'kanban', content: kanbanDemo.content })
  const since = board.seq
  const added = await client.addCard(board.id, { title: 'Import from Google Contacts', column: 'backlog', size: 'M', labels: ['T:Feature'] })
  assert.equal(added.card.role, 'card')
  assert.equal(added.card.data?.size, 'M')
  const backlog = columnsOf(await client.getBoard(board.id)).find((c) => c.text === 'Backlog')!
  assert.equal(added.card.parent, backlog.id)
  // it sits under the existing Backlog card, not on it
  const stack = cardsIn(await client.getBoard(board.id), backlog)
  assert.equal(stack[stack.length - 1].id, added.card.id)
  assert.ok(stack[1].y >= stack[0].y + stack[0].h)

  const moved = await client.moveCard(board.id, added.card.id, 'Ready', 'agent', 'planned → ready')
  assert.equal(moved.from, 'Backlog')
  assert.equal(moved.to, 'Ready')
  const b2 = await client.getBoard(board.id)
  const ready = columnsOf(b2).find((c) => c.text === 'Ready')!
  assert.equal(b2.items[added.card.id].parent, ready.id)
  const readyStack = cardsIn(b2, ready)
  assert.equal(readyStack[readyStack.length - 1].id, added.card.id)
  for (let i = 1; i < readyStack.length; i++) assert.ok(readyStack[i].y >= readyStack[i - 1].y + readyStack[i - 1].h, 'cards stack without overlapping')

  const r = await client.cardMoves(board.id, since)
  assert.equal(r.moves.length, 1)
  assert.equal(r.moves[0].cardId, added.card.id)
  assert.equal(r.moves[0].from, 'Backlog')
  assert.equal(r.moves[0].to, 'Ready')
  assert.equal(r.moves[0].author, 'agent')

  // the browser's drag: raw ops as the user
  const inProgress = columnsOf(b2).find((c) => c.text === 'In Progress')!
  await client.apply(board.id, [{ kind: 'update', id: added.card.id, patch: { x: inProgress.x + 20, y: inProgress.y + 500, parent: inProgress.id } }], 'user', "moved 'Import from Google Contacts'")
  const r2 = await client.cardMoves(board.id, r.seq)
  assert.deepEqual(r2.moves.map((m) => [m.from, m.to, m.author]), [['Ready', 'In Progress', 'user']])
  const diff = await client.diff(board.id, r.seq, 'user')
  assert.match(diff.lines[0], /^\[\d+ user\] card "Import from Google Contacts" \[kb\.card\.[^\]]+\]: moved from Ready → In Progress$/)

  // unknown column / card → 400 / 404
  await assert.rejects(client.moveCard(board.id, added.card.id, 'Nowhere'), /column required/)
  await assert.rejects(client.moveCard(board.id, 'kb.card.nope', 'Ready'), /not found/)
})
