// awd studio, the pane pool: one herdr tab per project shared by all its boards, a few
// panes, a queue, idle panes closed and their Claude conversations resumed on the next
// message (docs/studio.md §8a, docs/diagrams.md §8).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Studio, FakeCanvas, FakeCanvasBoard, FakeAgentChannel, MemoryStudioStore, boardScope, boardSessionName } from '../src/index.js'
import { evictable, idleExpired, paneNumber } from '../src/application/pool.js'

const ROOT = '/repo'

function board(id: string) {
  return new FakeCanvasBoard({
    id,
    title: `board ${id}`,
    kind: 'freeform',
    seq: 1,
    meta: { project: { root: ROOT } },
    items: { note: { id: 'note', type: 'sticky', text: `a note on ${id}` } },
  })
}

const session = (id: string) => boardSessionName(boardScope({ id, title: `board ${id}` }))

function setup(opts: { maxSessions?: number; idleCloseMs?: number } = {}) {
  const boards = { b1: board('b1'), b2: board('b2'), b3: board('b3') }
  const canvas = new FakeCanvas(boards.b1, boards.b2, boards.b3)
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'working' })
  const store = new MemoryStudioStore()
  const clock = { t: 1_000_000 }
  let n = 0
  const make = () => new Studio({
    canvas, channel, store, project: ROOT, projectName: 'awd', canvasUrl: 'http://x',
    sleep: async () => {}, now: () => clock.t, newSessionId: () => `sid-${++n}`, ...opts,
  })
  const studio = make()
  const later = (ms = 60_000) => { clock.t += ms }
  const calls = (kind: string) => channel.calls.filter((c) => c[0] === kind)
  const state = (b: FakeCanvasBoard, id: string) => b.snapshot.items[id].data?.agentState as { state: string; pane?: number; position?: number } | undefined
  return { boards, canvas, channel, store, studio, make, later, calls, state }
}

const ask = (b: FakeCanvasBoard, text = 'look at this') => b.userComment('note', text, { discuss: { model: 'sonnet' } })

test('boards share one tab: the first session opens it, the next ones split it', async () => {
  const { boards, studio, calls, state } = setup()
  await studio.tick()
  ask(boards.b1)
  const r = ask(boards.b2)
  await studio.tick()
  assert.deepEqual(calls('openTab'), [['openTab', ROOT, 'studio: awd']])
  assert.deepEqual(calls('splitPane'), [['splitPane', 'fake:p1', ROOT]])
  assert.equal(state(boards.b2, r)!.pane, 2)
})

test('a full tab gives the least recently used idle pane to the new session; its chat is parked, not lost', async () => {
  const { boards, channel, studio, later, calls, state } = setup({ maxSessions: 2 })
  await studio.tick()
  const a = ask(boards.b1)
  await studio.tick()
  later()
  ask(boards.b2)
  await studio.tick()
  channel.setState(session('b1'), 'idle')
  channel.setState(session('b2'), 'idle')
  later()
  await studio.tick() // mirror: both idle now
  ask(boards.b3)
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  assert.deepEqual(calls('closePane'), [['closePane', 'fake:p1']], 'board one was used least recently')
  assert.equal(state(boards.b1, a)!.state, 'parked')
})

test('a working or blocked pane is never closed: the request queues, shows its place, and starts when a pane frees', async () => {
  const { boards, channel, studio, later, calls, state } = setup({ maxSessions: 1 })
  await studio.tick()
  ask(boards.b1)
  await studio.tick()
  channel.setState(session('b1'), 'blocked')
  const w2 = ask(boards.b2)
  const w3 = ask(boards.b3)
  assert.deepEqual((await studio.tick()).map((d) => d.action), ['queued', 'queued'])
  assert.equal(calls('closePane').length, 0)
  assert.deepEqual([state(boards.b2, w2)!.position, state(boards.b3, w3)!.position], [1, 2])
  channel.setState(session('b1'), 'idle')
  later()
  const done = await studio.tick()
  assert.deepEqual(done.map((d) => [d.board, d.action]), [['b2', 'opened']], 'first in line first; the third still waits')
  assert.equal(state(boards.b3, w3)!.position, 1)
})

test('an idle pane closes after --idle-close; a follow-up in its thread resumes the same Claude session', async () => {
  const { boards, channel, studio, later, calls, state, store } = setup({ idleCloseMs: 30 * 60_000 })
  await studio.tick()
  const root = ask(boards.b1, 'why opus?')
  await studio.tick()
  channel.setState(session('b1'), 'idle')
  later()
  await studio.tick()
  assert.equal(calls('closePane').length, 0, 'not yet')
  later(31 * 60_000)
  await studio.tick()
  assert.deepEqual(calls('closePane'), [['closePane', 'fake:p1']])
  assert.equal(state(boards.b1, root)!.state, 'parked')
  assert.equal(store.status!.open, 0, 'the last pane went, and with it the tab')

  const follow = boards.b1.userComment(root, 'and sonnet instead?') // a plain reply in the thread
  const done = await studio.tick()
  assert.deepEqual(done.map((d) => d.action), ['resumed'])
  assert.equal(calls('openTab').length, 2, 'a fresh tab: the old one closed with its last pane')
  const starts = calls('start')
  assert.ok(starts[0].includes('--session-id') && starts[0].includes('sid-1'))
  assert.deepEqual(starts[1].slice(-4), ['--resume', 'sid-1', '-n', boardScope({ id: 'b1', title: 'board b1' })], 'the same conversation')
  const prompt = calls('prompt').at(-1)![2]
  assert.ok(!prompt.includes('\n'))
  assert.match(prompt, /resumed/)
  assert.deepEqual(boards.b1.snapshot.items[follow].data?.seenBy, ['agent'])
  assert.equal(state(boards.b1, root)!.state, 'working')
})

test('a follow-up in an open chat is left to the session (it reads its own thread)', async () => {
  const { boards, studio, calls } = setup()
  await studio.tick()
  const root = ask(boards.b1)
  await studio.tick()
  boards.b1.userComment(root, 'one more thing')
  assert.deepEqual(await studio.tick(), [])
  assert.equal(calls('prompt').length, 1)
})

test('a pane the person closed by hand parks its session; the next chat on that board resumes it', async () => {
  const { boards, channel, studio, later, calls, state } = setup()
  await studio.tick()
  const root = ask(boards.b1)
  await studio.tick()
  channel.dropPane('fake:p1')
  later()
  await studio.tick()
  assert.equal(state(boards.b1, root)!.state, 'parked')
  ask(boards.b1, 'again')
  const done = await studio.tick()
  assert.deepEqual(done.map((d) => d.action), ['resumed'])
  assert.deepEqual(calls('start').at(-1)!.slice(-4, -2), ['--resume', 'sid-1'])
})

test('status.json counts the boards, open panes, the limit and the queue', async () => {
  const { boards, studio, store } = setup({ maxSessions: 1 })
  await studio.tick()
  ask(boards.b1)
  ask(boards.b2)
  await studio.tick()
  assert.deepEqual({ ...store.status, updatedAt: 'x' }, { project: ROOT, boards: 3, open: 1, max: 1, queued: 1, updatedAt: 'x' })
})

test('sessions and queue survive a restart', async () => {
  const first = setup({ maxSessions: 1 })
  await first.studio.tick()
  ask(first.boards.b1)
  ask(first.boards.b2)
  await first.studio.tick()
  const again = first.make()
  first.channel.setState(session('b1'), 'idle')
  first.later()
  const done = [...(await again.tick()), ...(await again.tick())]
  assert.deepEqual([...new Set(done.map((d) => d.board))], ['b2'], 'the queued request was not forgotten')
})

test('pool rules: pane numbers follow opening order; only idle panes are evictable or expire', () => {
  const s = {
    a: { pane: 'p1', openedAt: 1, lastUsed: 50, state: 'idle' },
    b: { pane: 'p2', openedAt: 2, lastUsed: 10, state: 'working' },
    c: { pane: 'p3', openedAt: 3, lastUsed: 20, state: 'idle' },
    d: { lastUsed: 0, state: 'parked' },
  }
  assert.deepEqual([paneNumber(s, 'a'), paneNumber(s, 'c'), paneNumber(s, 'd')], [1, 3, undefined])
  assert.equal(evictable(s), 'c', 'least recently used among the idle ones; b is working')
  assert.deepEqual(idleExpired(s, 100, 60), ['c'])
})
