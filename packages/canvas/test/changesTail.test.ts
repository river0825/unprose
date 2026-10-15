// What the page reads on load (web/src/store.ts, inspector/useFreshMeta.ts), cheap on a board with a long log:
// GET …/changes?last=N — the latest N that are not bookkeeping, read from the log's tail — and &brief=1, each change
// trimmed for the Changes tab; GET …/meta — the board's meta as GET …/:id shows it, without the items.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, type RunningServer } from '../src/server.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { MemoryBoardRepository } from '../src/adapters/boards/index.js'
import { isBookkeeping, type BriefChange, type Change, type Item } from '../src/model.js'

const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }
const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 60, createdBy: 'agent', updatedBy: 'agent', updatedAt: '', ...extra })

let srv: RunningServer
let access: AccessService
const store = new MemoryBoardRepository()
before(async () => {
  access = new AccessService({ store: new MemoryAccessStore() })
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access })
})
after(() => srv.close())

const get = async <T>(p: string, headers: Record<string, string> = {}): Promise<T> => {
  const r = await fetch(srv.url + p, { headers })
  assert.equal(r.status, 200, `${p}: ${r.status}`)
  return (await r.json()) as T
}
const seqs = (cs: Array<{ seq: number }>) => cs.map((c) => c.seq)

/** 200 changes, the person's and the agent's in turn; every third one only a read receipt; the last ten too. */
function longLog(): string {
  const b = store.create({ title: 'long log', kind: 'freeform' })
  store.apply(b.id, [{ kind: 'add', item: item('c', { type: 'comment', text: 'why?', createdBy: 'user' }) }], 'user')
  let seen = 0
  const receipt = () => store.apply(b.id, [{ kind: 'update', id: 'c', patch: { data: { ...store.get(b.id)!.items.c.data, seenBy: ++seen % 2 ? ['agent'] : ['agent', 'user'] } } }], 'agent', 'seen')
  for (let i = 1; i < 190; i++) {
    if (i % 3 === 0) receipt()
    else store.apply(b.id, [{ kind: 'add', item: item(`s${i}`) }], i % 2 ? 'user' : 'agent')
  }
  for (let i = 0; i < 10; i++) receipt()
  return b.id
}

test('?last=N: the latest N that are not bookkeeping — with author and since — read from the log tail only', async () => {
  const id = longLog()
  const all = store.changes(id)
  assert.equal(all.length, 200)
  const real = all.filter((c) => !isBookkeeping(c))
  const reads: number[] = []
  const changes = store.changes.bind(store)
  store.changes = (bid, q) => (bid === id && reads.push(q?.since ?? 0), changes(bid, q))
  try {
    const r = await get<{ changes: Change[]; seq: number }>(`/api/boards/${id}/changes?last=5`)
    assert.deepEqual(seqs(r.changes), seqs(real.slice(-5)), 'past the ten receipts at the end')
    assert.equal(r.seq, 200)
    assert.ok(Math.min(...reads) > 150, `only the tail was read (since ${reads.join(', ')})`)
  } finally {
    store.changes = changes
  }
  const byUser = await get<{ changes: Change[] }>(`/api/boards/${id}/changes?last=4&author=user`)
  assert.deepEqual(seqs(byUser.changes), seqs(real.filter((c) => c.author === 'user').slice(-4)))
  const since = await get<{ changes: Change[] }>(`/api/boards/${id}/changes?since=190&last=50`)
  assert.deepEqual(seqs(since.changes), seqs(real.filter((c) => c.seq > 190)))
  const more = await get<{ changes: Change[] }>(`/api/boards/${id}/changes?last=1000`)
  assert.deepEqual(seqs(more.changes), seqs(real), 'fewer than asked: all of them, oldest first')
  assert.equal((await fetch(`${srv.url}/api/boards/${id}/changes?last=0`)).status, 400)
  // without last: as before, bookkeeping included
  assert.equal((await get<{ changes: Change[] }>(`/api/boards/${id}/changes?since=0`)).changes.length, 200)
})

test('&brief=1: at most 50 ops, each only what names it; opCount, itemCount; before only for what the listed removes took', async () => {
  const b = store.create({ title: 'big redraw', kind: 'freeform' })
  const long = 'A sticky with a lot to say, '.repeat(20)
  store.apply(b.id, Array.from({ length: 120 }, (_, i) => ({ kind: 'add' as const, item: item(`k.${i}`, { text: long, role: 'event', data: { ui: { big: 'x'.repeat(2000) } } }) })), 'agent', 'design_draw: big.ui.yaml', 'claude-a')
  store.apply(b.id, [{ kind: 'update', id: 'k.1', patch: { x: 5, text: 'short', data: { ui: {} } } }, { kind: 'remove', id: 'k.2' }, { kind: 'update', id: 'k.1', patch: { y: 1, updatedBy: 'user', updatedAt: 'now' } }], 'user')
  store.setMeta(b.id, { context: { text: 'what this board is for, at length' } }, 'user', 'updated the board context')
  const brief = (await get<{ changes: BriefChange[] }>(`/api/boards/${b.id}/changes?last=10&brief=1`)).changes
  const full = (await get<{ changes: Change[] }>(`/api/boards/${b.id}/changes?last=10`)).changes
  assert.deepEqual(seqs(brief), seqs(full))
  const [draw, edit, settings] = brief
  assert.deepEqual([draw.ops.length, draw.opCount, draw.itemCount, draw.note, draw.by, draw.author], [50, 120, 120, 'design_draw: big.ui.yaml', 'claude-a', 'agent'])
  assert.deepEqual(draw.ops[0], { kind: 'add', item: { id: 'k.0', type: 'sticky', role: 'event', text: `${long.slice(0, 79)}…` } })
  assert.deepEqual(draw.before, {}, 'nothing removed: no before')
  assert.deepEqual(edit.ops, [{ kind: 'update', id: 'k.1', patch: { x: null, text: null, data: null } }, { kind: 'remove', id: 'k.2' }, { kind: 'update', id: 'k.1', patch: { y: null } }])
  assert.deepEqual([edit.opCount, edit.itemCount], [3, 2])
  assert.deepEqual(edit.before, { 'k.2': { id: 'k.2', type: 'sticky', text: `${long.slice(0, 79)}…` } })
  assert.deepEqual([settings.meta, settings.note, settings.opCount], [{ context: null }, 'updated the board context', 0], 'a settings change: the keys it set')
  const size = (v: unknown) => JSON.stringify(v).length
  assert.ok(size(brief) * 20 < size(full), `brief ${size(brief)} B, full ${size(full)} B`)
})

test('GET …/meta: the meta GET …/:id shows this caller — redacted alike for a caller elsewhere — without the items; scoped alike', async () => {
  const b = store.create({ title: 'held', kind: 'freeform', items: [item('s1')] })
  const meta = { diagrams: { k: { kind: 'kanban', source: 'design/k.kanban.yaml', holder: { machine: 'dev-mac', root: '/home/dev/repo', repo: 'repo' } } }, note: 'kept' }
  const patched = await fetch(`${srv.url}/api/boards/${b.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ meta }) })
  assert.equal(patched.status, 200)
  const reader = access.createToken({ name: 'reader', scope: 'read', boards: [b.id] }, 't').token
  for (const headers of [{}, { ...REMOTE, authorization: `Bearer ${reader}` }]) {
    const { board } = await get<{ board: { seq: number; meta: unknown } }>(`/api/boards/${b.id}`, headers)
    const m = await get<{ id: string; seq: number; meta: unknown; items?: unknown }>(`/api/boards/${b.id}/meta`, headers)
    assert.deepEqual(m, { id: b.id, seq: board.seq, meta: board.meta })
  }
  const local = await get<{ meta: { diagrams: { k: { holder: Record<string, unknown> } } } }>(`/api/boards/${b.id}/meta`)
  const remote = await get<typeof local>(`/api/boards/${b.id}/meta`, { ...REMOTE, authorization: `Bearer ${reader}` })
  assert.equal(local.meta.diagrams.k.holder.root, '/home/dev/repo')
  assert.deepEqual([remote.meta.diagrams.k.holder.machine, remote.meta.diagrams.k.holder.root], [undefined, undefined], "the holder's machine and path only for a caller on this machine")
  const other = store.create({ title: 'not theirs', kind: 'freeform' })
  assert.equal((await fetch(`${srv.url}/api/boards/${other.id}/meta`, { headers: { ...REMOTE, authorization: `Bearer ${reader}` } })).status, 403)
  assert.equal((await fetch(`${srv.url}/api/boards/${other.id}/meta`, { headers: REMOTE })).status, 401)
  assert.deepEqual(await get(`/api/boards/${other.id}/meta`), { id: other.id, seq: other.seq, meta: null }, 'no meta: null')
})
