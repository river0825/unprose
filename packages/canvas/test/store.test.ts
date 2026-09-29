import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BoardStore, HANDOFF_NOTE } from '../src/store.js'
import { render } from '../src/templates/index.js'
import { demoBoards } from '../src/demo.js'
import type { Item } from '../src/model.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'awd-canvas-'))

const sticky = (id: string, text: string, x = 0, y = 0, by: 'agent' | 'user' = 'agent'): Item => ({ id, type: 'sticky', x, y, w: 160, h: 110, text, createdBy: by, updatedBy: by, updatedAt: 'x' })

test('create → apply → changes → persisted → reloaded', () => {
  const dir = tmp()
  const store = new BoardStore(dir)
  const b = store.create({ title: 'T', kind: 'freeform', items: [sticky('a', 'A')] })
  assert.equal(b.seq, 1)
  assert.equal(Object.keys(b.items).length, 1)

  const ch = store.apply(b.id, [{ kind: 'add', item: sticky('b', 'B', 200, 0, 'user') }, { kind: 'update', id: 'a', patch: { text: 'A2' } }], 'user', 'edit')
  assert.equal(ch.seq, 2)
  assert.equal(ch.author, 'user')
  assert.equal(ch.before.a?.text, 'A')
  assert.equal(ch.before.b, null)
  assert.equal(store.get(b.id)!.items.a.text, 'A2')
  assert.equal(store.get(b.id)!.items.a.updatedBy, 'user')
  assert.equal(store.get(b.id)!.items.b.createdBy, 'user')

  assert.equal(store.changes(b.id).length, 2)
  assert.equal(store.changes(b.id, { since: 1 }).length, 1)
  assert.equal(store.changes(b.id, { author: 'user' }).length, 1)
  assert.equal(store.changes(b.id, { author: 'agent' }).length, 1)

  store.apply(b.id, [{ kind: 'remove', id: 'a' }], 'user')
  assert.equal(store.get(b.id)!.items.a, undefined)

  assert.ok(fs.existsSync(path.join(dir, `${b.id}.json`)))
  assert.equal(fs.readFileSync(path.join(dir, `${b.id}.changes.ndjson`), 'utf8').trim().split('\n').length, 3)

  const again = new BoardStore(dir)
  assert.equal(again.get(b.id)!.seq, 3)
  assert.equal(again.get(b.id)!.items.b.text, 'B')
  assert.equal(again.list().length, 1)
})

test('snapshot missing → rebuilt from the change log', () => {
  const dir = tmp()
  const store = new BoardStore(dir)
  const b = store.create({ title: 'R', kind: 'freeform', items: [sticky('a', 'A')] })
  store.apply(b.id, [{ kind: 'update', id: 'a', patch: { x: 50 } }], 'user')
  fs.unlinkSync(path.join(dir, `${b.id}.json`))
  const again = new BoardStore(dir)
  const rb = again.get(b.id)!
  assert.equal(rb.seq, 2)
  assert.equal(rb.items.a.x, 50)
})

test('subscribe + waitFor resolve on the next change and time out otherwise', async () => {
  const store = new BoardStore(tmp())
  const b = store.create({ title: 'W', kind: 'freeform' })
  const seen: number[] = []
  const off = store.subscribe(b.id, (c) => seen.push(c.seq))

  const none = await store.waitFor(b.id, 0, 30)
  assert.deepEqual(none, [])

  const p = store.waitFor(b.id, 0, 5000, 'user', { quietMs: 40 })
  assert.equal(store.watchers(b.id), 1)
  setTimeout(() => store.apply(b.id, [{ kind: 'add', item: sticky('z', 'Z') }], 'agent'), 5) // ignored: wrong author
  setTimeout(() => store.apply(b.id, [{ kind: 'add', item: sticky('y', 'Y') }], 'user'), 15)
  const got = await p
  assert.equal(got.length, 1)
  assert.equal(got[0].author, 'user')
  assert.deepEqual(seen, [1, 2])
  assert.equal(store.watchers(b.id), 0)
  off()

  // Already-available changes resolve after the quiet window (or the deadline, whichever first).
  const immediate = await store.waitFor(b.id, 0, 10, undefined, { quietMs: 5 })
  assert.equal(immediate.length, 2)
})

test('waitFor waits for the person to stop, and a handoff resolves at once', async () => {
  const store = new BoardStore(tmp())
  const b = store.create({ title: 'Q', kind: 'freeform' })
  const presence: number[] = []
  store.onPresence((_id, n) => presence.push(n))

  // Three quick edits 10 ms apart with a 60 ms quiet window → one resolution carrying all three.
  const p = store.waitFor(b.id, 0, 2000, 'user', { quietMs: 60 })
  const t0 = Date.now()
  for (const [i, x] of [10, 20, 30].entries()) setTimeout(() => store.apply(b.id, [{ kind: 'add', item: sticky(`s${i}`, `S${i}`) }], 'user'), x)
  const got = await p
  assert.equal(got.length, 3)
  assert.ok(Date.now() - t0 >= 80, 'resolved before the quiet window elapsed')
  assert.deepEqual(presence, [1, 0])

  // A handoff change short-circuits the quiet window.
  const p2 = store.waitFor(b.id, 3, 2000, 'user', { quietMs: 5000 })
  setTimeout(() => store.apply(b.id, [], 'user', HANDOFF_NOTE), 5)
  const t1 = Date.now()
  const got2 = await p2
  assert.equal(got2.length, 1)
  assert.ok(Date.now() - t1 < 1000)
})

test('unknown board throws; template items round-trip through the store', () => {
  const store = new BoardStore(tmp())
  assert.throws(() => store.apply('nope', [], 'user'), /not found/)
  const items = render('workflow', demoBoards[5].content)
  const b = store.create({ title: 'wf', kind: 'workflow', items })
  assert.equal(Object.keys(b.items).length, items.length)
  // Re-rendering the same content produces the same ids → updates, not duplicates.
  const again = render('workflow', demoBoards[5].content)
  const ops = again.map((item) => (b.items[item.id] ? ({ kind: 'update', id: item.id, patch: item } as const) : ({ kind: 'add', item } as const)))
  assert.ok(ops.every((o) => o.kind === 'update'))
  store.apply(b.id, ops, 'agent')
  assert.equal(Object.keys(store.get(b.id)!.items).length, items.length)
})

test("waitFor wake: 'meaningful' ignores pure moves, 'any' wakes on them, 'handoff' only on the button", async () => {
  const store = new BoardStore(tmp())
  const b = store.create({ title: 'Wake', kind: 'freeform', items: [sticky('a', 'A'), sticky('b', 'B')] }, 'agent')
  const move = (id: string, x: number) => store.apply(b.id, [{ kind: 'update', id, patch: { x, y: 5 } }], 'user')

  const quiet = store.waitFor(b.id, b.seq, 150, 'user', { quietMs: 20 })
  setTimeout(() => move('a', 40), 5)
  setTimeout(() => move('b', 80), 10)
  assert.deepEqual(await quiet, [], 'moves alone never wake a meaningful wait')

  const t0 = Date.now()
  const woke = store.waitFor(b.id, b.seq, 2000, 'user', { quietMs: 60 })
  setTimeout(() => store.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'A!' } }], 'user'), 5)
  setTimeout(() => move('b', 120), 40)
  const got = await woke
  assert.equal(got.length, 4, 'the rename wakes; earlier and later moves ride along')
  assert.ok(Date.now() - t0 < 100 + 60, 'a move after the rename does not restart the quiet window')

  const any = store.waitFor(b.id, store.get(b.id)!.seq, 2000, 'user', { quietMs: 10, wake: 'any' })
  setTimeout(() => move('a', 160), 5)
  assert.equal((await any).length, 1)

  const seq = store.get(b.id)!.seq
  const handoff = store.waitFor(b.id, seq, 2000, 'user', { quietMs: 10, wake: 'handoff' })
  setTimeout(() => store.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'A!!' } }], 'user'), 5)
  setTimeout(() => store.apply(b.id, [], 'user', HANDOFF_NOTE), 60)
  const h = await handoff
  assert.equal(h.length, 2)
  assert.equal(h[1].note, HANDOFF_NOTE)
})

test("waitFor 'meaningful': re-attaching a wire to another side of the same nodes is layout", async () => {
  const store = new BoardStore(tmp())
  const wire: Item = { id: 'w', type: 'arrow', x: 0, y: 0, w: 0, h: 0, from: 'a', to: 'b', createdBy: 'agent', updatedBy: 'agent', updatedAt: 'x' }
  const b = store.create({ title: 'Sides', kind: 'freeform', items: [sticky('a', 'A'), sticky('b', 'B'), wire] }, 'agent')
  const quiet = store.waitFor(b.id, b.seq, 150, 'user', { quietMs: 20 })
  setTimeout(() => store.apply(b.id, [{ kind: 'update', id: 'w', patch: { from: 'a', to: 'b', data: { fromSide: 'bottom', toSide: 'top' } } }], 'user'), 5)
  assert.deepEqual(await quiet, [])

  const woke = store.waitFor(b.id, store.get(b.id)!.seq, 2000, 'user', { quietMs: 20 })
  setTimeout(() => store.apply(b.id, [{ kind: 'update', id: 'w', patch: { from: 'b', to: 'a' } }], 'user'), 5)
  assert.equal((await woke).length, 1, 'changing an endpoint still wakes')
})
