import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWorkflow, lint } from '@awd/core'
import { createRuntime, loadWorkflow, MemoryEventStore, createWebhookServer } from '../src/index.js'
import { canvasSource, movesFromChanges, cursorFor, kanbanScope } from '../src/adapters/triggers/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const example = path.join(here, '..', '..', '..', 'examples', 'card-pipeline', 'workflow.yaml')

function readFrames(res: http.IncomingMessage, want: number): Promise<Array<{ event: string; data: unknown }>> {
  return new Promise((resolve) => {
    const frames: Array<{ event: string; data: unknown }> = []
    let buf = ''
    res.on('data', (c) => {
      buf += String(c)
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2)
        const ev = /^event: (.+)$/m.exec(raw)?.[1]
        const data = /^data: (.+)$/m.exec(raw)?.[1]
        if (ev && data) frames.push({ event: ev, data: JSON.parse(data) })
        if (frames.length >= want) { res.destroy(); resolve(frames) }
      }
    })
  })
}

test('/api/stream sends a snapshot, then each event with the run state it produced', async () => {
  const wf = loadWorkflow(example)
  const rt = createRuntime({ workflow: wf, store: 'memory', worker: 'fake', port: false, cron: false })
  await rt.start()
  const server = createWebhookServer({ def: wf.def, store: rt.store, engine: rt.engine, env: {} })
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port

  const res = await new Promise<http.IncomingMessage>((r) => http.get(`http://localhost:${port}/api/stream`, r))
  assert.equal(res.headers['content-type'], 'text/event-stream')
  assert.equal(res.headers['access-control-allow-origin'], '*')
  const framesP = readFrames(res, 3)
  await new Promise((r) => setTimeout(r, 50))
  rt.store.append({ type: 'card.moved', key: 'c-sse', data: { card: 'c-sse', from: 'Backlog', to: 'Ready' } })
  const frames = await framesP
  assert.equal(frames[0].event, 'snapshot')
  assert.deepEqual((frames[0].data as { runs: unknown[] }).runs, [])
  assert.equal(frames[1].event, 'event')
  assert.equal((frames[1].data as { type: string }).type, 'card.moved')
  assert.equal(frames[2].event, 'state')
  assert.equal((frames[2].data as { key: string }).key, 'c-sse')

  // per-run detail
  const detail = await fetch(`http://localhost:${port}/api/runs/c-sse`).then((r) => r.json() as Promise<{ key: string; events: unknown[] }>)
  assert.equal(detail.key, 'c-sse')
  assert.ok(detail.events.length >= 1)
  const missing = await fetch(`http://localhost:${port}/api/runs/nope`)
  assert.equal(missing.status, 404)
  const pre = await fetch(`http://localhost:${port}/api/status`, { method: 'OPTIONS' })
  assert.equal(pre.status, 204)

  await new Promise<void>((r) => server.close(() => r()))
  await rt.stop()
})

const boardYaml = `
name: board-trigger
key: "{{ event.data.card.id }}"
triggers:
  kanban:
    on: board
    board: "title:Dev board"
    emit: card.moved
    if: "to == 'Ready'"
    data:
      card: "{{ card }}"
      from: "{{ from }}"
      to: "{{ to }}"
steps:
  qualify:
    on: card.moved
    run: "echo '{\\"outcome\\":\\"done\\"}'"
    terminal: [done]
`

test('lint: board trigger needs `board`; its templates see card/from/to/author/seq', () => {
  const ok = lint(parseWorkflow(boardYaml))
  assert.equal(ok.errors.length, 0, JSON.stringify(ok.errors))
  const bad = lint(parseWorkflow(boardYaml.replace('    board: "title:Dev board"\n', '').replace("{{ card }}", '{{ body.card }}')))
  assert.ok(bad.errors.some((e) => /needs `board`/.test(e.message)))
  assert.ok(bad.errors.some((e) => /body/.test(e.message)))
})

/** A fake canvas server: one kanban board, changes fed in by the test. */
function fakeCanvas() {
  const board = {
    id: 'b1', title: 'Dev board', seq: 3,
    items: {
      colA: { id: 'colA', type: 'lane', role: 'column', text: 'Backlog' },
      colB: { id: 'colB', type: 'lane', role: 'column', text: 'Ready' },
      c1: { id: 'c1', type: 'card', role: 'card', text: 'Upload contacts', parent: 'colA', data: { size: 'S', labels: ['api'] } },
    } as Record<string, { id: string; type: string; role?: string; text?: string; parent?: string; data?: Record<string, unknown> }>,
  }
  const changes: Array<{ seq: number; author: 'agent' | 'user'; ops: unknown[]; before: Record<string, unknown> }> = []
  const waiters: Array<() => void> = []
  const move = (author: 'agent' | 'user', to: string) => {
    const before = { c1: { ...board.items.c1 } }
    board.items.c1 = { ...board.items.c1, parent: to }
    board.seq += 1
    changes.push({ seq: board.seq, author, ops: [{ kind: 'update', id: 'c1', patch: { parent: to, x: 10, y: 10 } }], before })
    for (const w of waiters.splice(0)) w()
  }
  const f: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    if (url.pathname === '/api/boards') return json({ boards: [{ id: 'b1', title: 'Dev board', kind: 'kanban', seq: board.seq }] })
    if (url.pathname === '/api/boards/b1') return json({ board })
    if (url.pathname === '/api/boards/b1/cards') return json({ error: 'not found' }, 404)
    if (url.pathname === '/api/boards/b1/changes') {
      const since = Number(url.searchParams.get('since') ?? 0)
      return json({ changes: changes.filter((c) => c.seq > since), seq: board.seq })
    }
    if (url.pathname === '/api/boards/b1/wait') {
      const since = Number(url.searchParams.get('since') ?? 0)
      if (changes.some((c) => c.seq > since)) return json({ seq: board.seq })
      await new Promise<void>((resolve, reject) => {
        waiters.push(resolve)
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
      return json({ seq: board.seq })
    }
    return json({ error: 'not found' }, 404)
  }
  return { board, move, fetch: f }
}

test('board trigger: a user drag into Ready becomes card.moved; agent moves and other columns are ignored; restarts resume', async () => {
  const def = parseWorkflow(boardYaml)
  const store = new MemoryEventStore()
  const canvas = fakeCanvas()
  const log: string[] = []
  const src = canvasSource({ def, store, env: {}, fetch: canvas.fetch, log: (l) => log.push(l), pollMs: 10, waitMs: 500 })
  src.start()
  await new Promise((r) => setTimeout(r, 30))
  assert.match(log[0], /watching "Dev board"/)

  canvas.move('agent', 'colB') // an agent's move: ignored (author defaults to user)
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(store.size(), 0)

  canvas.move('user', 'colA') // user moves it back to Backlog: `if: to == 'Ready'` drops it
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(store.size(), 0)

  canvas.move('user', 'colB') // the real thing
  await new Promise((r) => setTimeout(r, 60))
  const evs = store.all()
  assert.equal(evs.length, 1)
  assert.equal(evs[0].type, 'card.moved')
  assert.equal(evs[0].key, 'c1')
  assert.deepEqual((evs[0].data as { from: string; to: string }).from, 'Backlog')
  assert.deepEqual((evs[0].data as { card: { size: string } }).card.size, 'S')
  assert.equal((evs[0].meta as { boardSeq: number }).boardSeq, canvas.board.seq)
  await src.stop()

  // A second source over the same store resumes after the last emitted move — nothing replays.
  assert.equal(cursorFor(store, 'kanban'), canvas.board.seq)
  const again = canvasSource({ def, store, env: {}, fetch: canvas.fetch, pollMs: 10, waitMs: 500 })
  again.start()
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(store.size(), 1)
  await again.stop()
})

test('movesFromChanges: only cards whose parent changed, resolved to column names', () => {
  const canvas = fakeCanvas()
  canvas.move('user', 'colB')
  const moves = movesFromChanges(canvas.board as never, [
    ...(JSON.parse(JSON.stringify([])) as never[]),
    { seq: 4, author: 'user', ops: [{ kind: 'update', id: 'c1', patch: { parent: 'colB' } }], before: { c1: { id: 'c1', type: 'card', text: 'Upload contacts', parent: 'colA' } } },
    { seq: 5, author: 'user', ops: [{ kind: 'update', id: 'c1', patch: { x: 5 } }], before: { c1: { id: 'c1', type: 'card', parent: 'colB' } } },
    { seq: 6, author: 'user', ops: [{ kind: 'update', id: 'colA', patch: { parent: undefined } }], before: { colA: { id: 'colA', type: 'lane', role: 'column' } } },
  ] as never)
  assert.equal(moves.length, 1)
  assert.equal(moves[0].from, 'Backlog')
  assert.equal(moves[0].to, 'Ready')
  assert.equal(moves[0].title, 'Upload contacts')
})

// ── docs/diagrams.md §7: a board trigger watches one kanban diagram frame ─────

const framed = () => ({
  id: 'b2', title: 'Design', kind: 'freeform', seq: 1,
  items: {
    fDev: { id: 'fDev', type: 'frame', text: 'Dev', data: { diagram: { kind: 'kanban', key: 'dev-kanban' } } },
    fOps: { id: 'fOps', type: 'frame', text: 'Ops', data: { diagram: { kind: 'kanban', key: 'ops-kanban' } } },
    fEs: { id: 'fEs', type: 'frame', text: 'ES', data: { diagram: { kind: 'event-storming', key: 'studio-es' } } },
    devA: { id: 'devA', type: 'lane', role: 'column', text: 'Backlog', parent: 'fDev' },
    devB: { id: 'devB', type: 'lane', role: 'column', text: 'Ready', parent: 'fDev' },
    opsA: { id: 'opsA', type: 'lane', role: 'column', text: 'Backlog', parent: 'fOps' },
    opsB: { id: 'opsB', type: 'lane', role: 'column', text: 'Ready', parent: 'fOps' },
    d1: { id: 'd1', type: 'card', role: 'card', text: 'dev card', parent: 'devB' },
    o1: { id: 'o1', type: 'card', role: 'card', text: 'ops card', parent: 'opsB' },
  } as Record<string, { id: string; type: string; role?: string; text?: string; parent?: string; data?: Record<string, unknown> }>,
})

test('kanbanScope: the keyed kanban frame, the only one, or the whole legacy board; ambiguity and typos are errors', () => {
  const b = framed()
  const dev = kanbanScope(b as never, 'dev-kanban')
  assert.equal(dev('devB'), true)
  assert.equal(dev('d1'), true)
  assert.equal(dev('opsB'), false)
  assert.throws(() => kanbanScope(b as never), /2 kanban frames .*name one with `frame:`/)
  assert.throws(() => kanbanScope(b as never, 'nope'), /no kanban frame keyed "nope" \(it has: dev-kanban, ops-kanban\)/)
  const one = framed()
  delete (one.items as Record<string, unknown>).fOps
  assert.equal(kanbanScope(one as never)('devA'), true)
  assert.equal(kanbanScope(fakeCanvas().board as never)('colB'), true) // legacy kanban board: everything
})

test('movesFromChanges with a scope: moves between columns of another kanban frame are not ours', () => {
  const b = framed()
  const ops = (id: string, to: string, from: string) => ({ seq: 2, author: 'user' as const, ops: [{ kind: 'update', id, patch: { parent: to } }], before: { [id]: { id, type: 'card', text: id, parent: from } } })
  const moves = movesFromChanges(b as never, [ops('d1', 'devB', 'devA'), ops('o1', 'opsB', 'opsA')] as never, kanbanScope(b as never, 'dev-kanban'))
  assert.deepEqual(moves.map((m) => [m.cardId, m.from, m.to]), [['d1', 'Backlog', 'Ready']])
})
