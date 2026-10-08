// Handing over the files (docs/canvas.md "Handing over the files"): the person moves the files behind some diagrams
// from the agent holding them to another agent — the holder marks them ready, the new holder accepts — and nobody else
// can take a diagram over by redrawing it (the guard on PUT / PATCH of the meta and the pre-check of every draw path).
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer, type RunningServer } from '../src/server.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { MemoryBoardRepository } from '../src/adapters/boards/index.js'
import { applyOps, type Board, type Change, type Item } from '../src/model.js'
import {
  asksMe,
  diagramRefusal,
  handoverOf,
  heldRefusal,
  keepHandoverMarks,
  keepHeldEntries,
  mentionsMe,
  mergeBoardMeta,
  openProposals,
  routeOf,
  settingsLines,
  stampHolders,
  stampRouting,
  workflowRefusal,
  type Handover,
} from '../src/routing.js'
import { sha1 } from '../src/proposals.js'
import { unifiedDiff } from '../src/patch.js'

const T0 = '2026-10-08T10:00:00.000Z'
const T1 = '2026-10-08T11:00:00.000Z'
const ES = 'events:\n  - text: Order placed\n'
const KB = 'columns:\n  - name: Todo\ncards: []\n'
const it = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 120, h: 60, createdBy: 'agent', updatedBy: 'agent', updatedAt: T0, ...extra })
const REFUSED_SHOP = 'the files of "shop-es" (design/shop.es.yaml) are held by agent-a: you cannot redraw them. Propose instead (canvas_files → canvas_propose_edit), or ask the person to hand them over to you (board panel → Hand over files).'

/** A board with two diagram frames, both drawn from their files by `holder`. */
function twoDiagrams(holder = 'agent-a', meta: Record<string, unknown> = {}): Board {
  const items: Record<string, Item> = {
    'diagram.shop-es': it('diagram.shop-es', { type: 'frame', text: 'Shop flow', w: 800, h: 400, data: { diagram: { kind: 'event-storming', key: 'shop-es', source: 'design/shop.es.yaml' } } }),
    'shop-es.event.order': it('shop-es.event.order', { text: 'Order placed', parent: 'diagram.shop-es', x: 20, y: 20 }),
    'diagram.work-kanban': it('diagram.work-kanban', { type: 'frame', text: 'Work', y: 600, w: 800, h: 400, data: { diagram: { kind: 'kanban', key: 'work-kanban', source: 'design/work.kanban.yaml' } } }),
  }
  return {
    id: 'b1',
    title: 'Two',
    kind: 'freeform',
    seq: 1,
    createdAt: T0,
    updatedAt: T0,
    items,
    meta: {
      diagrams: {
        'shop-es': { kind: 'event-storming', source: 'design/shop.es.yaml', files: { 'design/shop.es.yaml': ES }, holder: { agent: holder, at: T0, repo: 'notes' } },
        'work-kanban': { kind: 'kanban', source: 'design/work.kanban.yaml', files: { 'design/work.kanban.yaml': KB }, holder: { agent: holder, at: T0 } },
      },
      ...meta,
    },
  }
}

/** Add comments one by one, stamped like the server does. */
function post(board: Board, items: Item[], known: string[] = ['agent-a', 'agent-b', 'agent-c']): Board {
  let b = board
  let n = 0
  for (const c of items) {
    const now = new Date(Date.parse(T0) + 1000 * ++n + b.seq * 60_000).toISOString()
    const ops = stampRouting(b, [{ kind: 'add', item: c }], known, now, (x, o) => applyOps(x, o, c.createdBy).board)
    b = { ...applyOps(b, ops, c.createdBy).board, seq: b.seq + 1 }
  }
  return b
}
const person = (id: string, text: string, target?: string, data?: Record<string, unknown>): Item => it(id, { type: 'comment', text, createdBy: 'user', updatedBy: 'user', ...(target ? { target } : {}), ...(data ? { data } : {}) })
const agentSays = (id: string, by: string, text: string, target?: string, data: Record<string, unknown> = {}): Item => it(id, { type: 'comment', text, ...(target ? { target } : {}), data: { by, ...data } })
const change = (b: Board, id: string, by?: string): Change => ({ seq: b.seq, ts: T0, author: b.items[id].createdBy, ...(by ? { by } : {}), boardId: b.id, ops: [{ kind: 'add', item: b.items[id] }], before: {} })

// ── the pure rules ─────────────────────────────────────────────────────────────

test('routing: a handover thread goes to both sides, before any @mention and whoever answers the board; it addresses them personally', () => {
  const root = person('handover.x1', 'Handing over the files of «Shop flow» from @agent-a to @agent-b.\n@agent-a: …\n@agent-b: …', 'diagram.shop-es', { handover: { id: 'ho_x1', state: 'open', to: 'agent-b', from: ['agent-a'] } })
  const b = post(twoDiagrams('agent-a', { responder: { mode: 'agent', agent: 'agent-c' } }), [
    root,
    agentSays('r1', 'agent-a', 'Ready: «Shop flow»', 'handover.x1'),
    agentSays('r2', 'agent-b', 'Accepted — @agent-b holds the files… @agent-a: propose from now on', 'handover.x1'),
    person('r3', '@agent-c what do you think of this?', 'handover.x1'),
  ])
  assert.deepEqual(b.items['handover.x1'].data?.to, ['agent-a', 'agent-b'])
  assert.equal(b.items['handover.x1'].data?.route, 'handover')
  assert.deepEqual(b.items.r1.data?.to, ['agent-b'], "the holder's message goes to the receiver")
  assert.deepEqual(b.items.r2.data?.to, ['agent-a'], "the receiver's goes back to the holder")
  assert.deepEqual(b.items.r3.data?.to, ['agent-a', 'agent-b'], 'a mention in the thread does not take it over')
  assert.equal(b.items.r3.data?.route, 'handover')
  // personal: canvas_wait({ untilMention: true }) wakes both sides (and asksMe: even while they wait for the person)
  assert.equal(mentionsMe(b, change(b, 'handover.x1'), 'agent-a'), true)
  assert.equal(mentionsMe(b, change(b, 'handover.x1'), 'agent-b'), true)
  assert.equal(mentionsMe(b, change(b, 'handover.x1'), 'agent-c'), false, 'the responder is not part of it')
  assert.equal(asksMe(b, change(b, 'r1', 'agent-a'), 'agent-b'), true)
  assert.equal(asksMe(b, change(b, 'r1', 'agent-a'), 'agent-a'), false, 'never your own')
  // without parties on the root, the open handover of that thread names them
  const ho: Handover = { id: 'ho_x2', to: 'agent-b', answeredBy: true, thread: 'handover.x2', by: 'user', at: T0, keys: [{ key: 'shop-es', from: 'agent-a' }] }
  const b2 = post(twoDiagrams('agent-a', { handover: ho }), [person('handover.x2', 'over to you', 'diagram.shop-es', { handover: { id: 'ho_x2', state: 'open' } })])
  assert.deepEqual(routeOf(b2, b2.items['handover.x2']), { to: ['agent-a', 'agent-b'], route: 'handover' })
})

test('stampHolders carries a handover (from, thread) across the new holder\'s own redraws — never from what a caller sends', () => {
  const cur = { diagrams: { k: { kind: 'kanban', holder: { agent: 'agent-b', at: T0, from: 'agent-a', handover: 'handover.x1' } } } }
  const own = stampHolders(cur, { diagrams: { k: { kind: 'kanban', holder: { repo: 'team' } } } }, 'agent-b', T1).diagrams as Record<string, { holder: Record<string, string> }>
  assert.deepEqual(own.k.holder, { agent: 'agent-b', at: T1, repo: 'team', from: 'agent-a', handover: 'handover.x1' })
  // a redraw from file text (remote design_draw: holder {}) keeps where the holder said it keeps the files
  const kept = { diagrams: { k: { holder: { agent: 'agent-b', at: T0, repo: 'team-notes', remote: 'https://github.com/b/t.git', from: 'agent-a', handover: 'handover.x1' } } } }
  const bare = stampHolders(kept, { diagrams: { k: { holder: {} } } }, 'agent-b', T1).diagrams as Record<string, { holder: Record<string, string> }>
  assert.deepEqual(bare.k.holder, { agent: 'agent-b', at: T1, repo: 'team-notes', remote: 'https://github.com/b/t.git', from: 'agent-a', handover: 'handover.x1' })
  const forged = stampHolders({}, { diagrams: { k: { holder: { from: 'agent-z', handover: 'handover.fake' } } } }, 'agent-c', T1).diagrams as Record<string, { holder: Record<string, string> }>
  assert.deepEqual(forged.k.holder, { agent: 'agent-c', at: T1 }, 'a caller cannot claim a handover')
  const other = stampHolders(cur, { diagrams: { k: { holder: {} } } }, 'agent-c', T1).diagrams as Record<string, { holder: Record<string, string> }>
  assert.equal(other.k.holder.from, undefined)
})

test('the guard: nobody takes over, changes or drops a diagram another agent holds; the holder redraws its own; a new diagram is free', () => {
  const meta = twoDiagrams().meta
  const draw = (caller: string, patch: Record<string, unknown>) => heldRefusal(meta, stampHolders(meta, mergeBoardMeta(meta, patch), caller, T1), caller)
  const redraw = { diagrams: { 'shop-es': { kind: 'event-storming', source: 'design/shop.es.yaml', files: { 'design/shop.es.yaml': ES }, holder: {} } } }
  assert.equal(draw('agent-b', redraw), REFUSED_SHOP)
  assert.equal(draw('agent-a', redraw), undefined, 'the holder may')
  assert.equal(draw('agent-b', { diagrams: { 'shop-es': null } }), REFUSED_SHOP, 'nor drop it')
  const copied = (meta.diagrams as Record<string, Record<string, unknown>>)['shop-es']
  assert.equal(draw('agent-b', { diagrams: { 'shop-es': { ...copied, files: { 'design/shop.es.yaml': 'x' } } } }), REFUSED_SHOP, 'nor change its files with a copied holder')
  assert.equal(draw('agent-b', { diagrams: { other: { kind: 'kanban', holder: {} } } }), undefined, 'a diagram nobody holds yet is free for the first drawer')
  assert.equal(draw('agent-b', { title: 'x', context: 'y' }), undefined, 'other keys do not touch the diagrams')
  // PUT: what the caller left out of the whole meta is kept when another agent holds it
  assert.deepEqual(Object.keys(keepHeldEntries(meta, { diagrams: {} }, 'agent-b').diagrams as object), ['shop-es', 'work-kanban'])
  assert.deepEqual(keepHeldEntries(meta, { diagrams: {} }, 'agent-a').diagrams, {}, 'its own may go')
  assert.equal(heldRefusal(meta, keepHeldEntries(meta, {}, 'agent-b'), 'agent-b'), undefined)
  // the pre-checks of the draw paths, and the workflow
  assert.equal(diagramRefusal(meta, 'shop-es', 'agent-b'), REFUSED_SHOP)
  assert.equal(diagramRefusal(meta, 'shop-es', 'agent-a'), undefined)
  assert.equal(diagramRefusal(meta, 'nope', 'agent-b'), undefined)
  const wf = { workflow: { file: 'examples/x/workflow.yaml', holder: { agent: 'agent', at: T0 } } }
  assert.equal(workflowRefusal(wf, 'agent-b'), 'the files of "workflow" (examples/x/workflow.yaml) are held by studio: you cannot redraw them. Propose instead (canvas_files → canvas_propose_edit), or ask the person to hand them over to you (board panel → Hand over files).')
  assert.equal(workflowRefusal(wf, 'agent'), undefined)
  assert.equal(heldRefusal(wf, { workflow: null }, 'agent-b')?.startsWith('the files of "workflow"'), true)
  assert.equal(heldRefusal(wf, keepHeldEntries(wf, {}, 'agent-b'), 'agent-b'), undefined, 'a PUT without the workflow keeps it')
})

test('handoverOf validates; the status lines say who must do what next; open proposals are those not applied or declined', () => {
  assert.equal(handoverOf({ handover: { id: 'x' } }), undefined)
  assert.equal(handoverOf({ handover: { id: 'ho_1', to: 'b', answeredBy: true, thread: 't', by: 'user', at: T0, keys: [] } }), undefined)
  const ho: Handover = { id: 'ho_1', to: 'agent-b', answeredBy: true, thread: 'handover.1', by: 'user', at: T0, keys: [{ key: 'shop-es', from: 'agent-a', title: 'Shop flow', source: 'design/shop.es.yaml' }, { key: 'work-kanban', from: 'agent-a', title: 'Work', ready: { by: 'agent-a', at: T0, files: { 'design/work.kanban.yaml': sha1(KB) } } }] }
  assert.deepEqual(handoverOf({ handover: { ...ho, junk: 1 } }), ho)
  const lines = settingsLines(twoDiagrams('agent-a', { handover: ho }).meta).join('\n')
  assert.match(lines, /Handover open \(thread handover\.1, started by the person\): the files of «Shop flow» \(design\/shop\.es\.yaml\), «Work» \[ready\] go from agent-a to agent-b; "Answered by" becomes it on accept/)
  assert.match(lines, /waiting for agent-a: settle the open proposals on «Shop flow», redraw any whose file changed, then canvas_handover\(\{ ready: true \}\)/)
  assert.match(lines, /then agent-b accepts: canvas_handover\(\{ accept: true \}\)/)
  // proposals: open until "Applied to …" or the person's Decline
  const edit = (file: string) => ({ discuss: { about: [], edit: { file, base: 'x', diff: '@@', by: 'agent-c' } } })
  const b = post(twoDiagrams(), [
    agentSays('p1', 'agent-c', 'rename', 'diagram.shop-es', edit('design/shop.es.yaml')),
    agentSays('p2', 'agent-c', 'a column', 'diagram.work-kanban', edit('design/work.kanban.yaml')),
    agentSays('p3', 'agent-c', 'again', 'diagram.shop-es', edit('design/shop.es.yaml')),
    agentSays('applied.1', 'agent-a', 'Applied to design/shop.es.yaml. Redrawn from the file.', 'p3'),
    agentSays('p4', 'agent-c', 'and this', 'diagram.shop-es', edit('design/shop.es.yaml')),
    person('d4', 'No, leave the file as it is.', 'p4'),
  ])
  assert.deepEqual(openProposals(b, ['shop-es']), ['p1'])
  assert.deepEqual(openProposals(b, ['shop-es', 'work-kanban']), ['p1', 'p2'])
  // nobody writes data.handover on a comment by hand
  const [add] = keepHandoverMarks(b, [{ kind: 'add', item: person('f1', 'hi', undefined, { handover: { id: 'ho_fake', to: 'agent-c', from: ['agent-c'] } }) }])
  assert.equal((add as { item: Item }).item.data?.handover, undefined)
})

// ── the server ─────────────────────────────────────────────────────────────────

let srv: RunningServer
let base: string
const store = new MemoryBoardRepository()
const access = new AccessService({ store: new MemoryAccessStore() })
let A = ''
let B = ''
let C = ''
before(async () => {
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access })
  base = `http://127.0.0.1:${srv.port}`
  A = access.createToken({ name: 'agent-a' }, 't').token
  B = access.createToken({ name: 'agent-b' }, 't').token
  C = access.createToken({ name: 'agent-c' }, 't').token
})
after(() => srv.close())

const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }
const as = (token?: string) => (token ? { ...REMOTE, authorization: `Bearer ${token}` } : {})
const call = (p: string, init: RequestInit = {}) => fetch(base + p, init)
const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) => call(p, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> })
function newBoard(holder = 'agent-a', meta: Record<string, unknown> = {}): Board {
  const b = twoDiagrams(holder, meta)
  return store.create({ title: `h-${Math.random().toString(36).slice(2, 7)}`, kind: 'freeform', items: Object.values(b.items), meta: b.meta })
}
const holderOf = (id: string, key: string) => (store.get(id)!.meta!.diagrams as Record<string, { holder: Record<string, string> }>)[key].holder
const start = (id: string, body: Record<string, unknown> = { to: 'agent-b' }) => send('POST', `/api/boards/${id}/handover`, body)
const repatch = (id: string, token: string, key = 'shop-es') => send('PATCH', `/api/boards/${id}`, { meta: { diagrams: { [key]: { kind: 'event-storming', source: 'design/shop.es.yaml', files: { 'design/shop.es.yaml': ES }, holder: { repo: 'mine' } } } } }, as(token))

test('the guard over HTTP: another agent\'s redraw is refused (409, nothing changes); the holder redraws; the first drawer is free; a PUT keeps what it left out', async () => {
  const b = newBoard()
  const before = JSON.stringify(store.get(b.id)!.meta)
  const r = await json(await repatch(b.id, B))
  assert.equal(r.status, 409)
  assert.equal(r.body.error, REFUSED_SHOP)
  assert.equal(JSON.stringify(store.get(b.id)!.meta), before)
  assert.equal((await repatch(b.id, A)).status, 200)
  assert.equal(holderOf(b.id, 'shop-es').agent, 'agent-a')
  assert.equal((await send('PATCH', `/api/boards/${b.id}`, { meta: { diagrams: { fresh: { kind: 'kanban', holder: {} } } } }, as(B))).status, 200)
  assert.equal(holderOf(b.id, 'fresh').agent, 'agent-b')
  assert.equal((await send('PUT', `/api/boards/${b.id}`, { meta: { diagrams: {} } }, as(B))).status, 200)
  assert.deepEqual(Object.keys(store.get(b.id)!.meta!.diagrams as object).sort(), ['shop-es', 'work-kanban'], "B dropped its own diagram, not A's")
  // meta.handover is a board setting: no PATCH writes it
  await send('PATCH', `/api/boards/${b.id}`, { meta: { handover: { id: 'ho_x', to: 'agent-c' } } }, as(C))
  assert.equal(store.get(b.id)!.meta!.handover, undefined)
})

test('a handover: the person starts it, the holder marks it ready, the receiver accepts — holders, "Answered by", the thread and the routing follow', async () => {
  const b = newBoard('agent-a', { responderSuggestion: { mode: 'agent', agent: 'agent-a', by: 'agent-a' } })
  // agent-c proposes an edit to the shop flow before the handover (it goes to agent-a, the holder)
  const diff = unifiedDiff(ES, ES.replace('Order placed', 'Order submitted'), 'design/shop.es.yaml')
  const prop = await json(await send('POST', `/api/boards/${b.id}/proposals`, { file: 'design/shop.es.yaml', base: sha1(ES), diff, note: 'clearer name' }, as(C)))
  assert.equal(prop.status, 201)
  assert.deepEqual(store.get(b.id)!.items[prop.body.comment].data?.to, ['agent-a'])

  const status = await json(await call(`/api/boards/${b.id}/handover`, { headers: as(B) }))
  assert.equal(status.body.handover, null)
  assert.deepEqual(status.body.holders.map((h: { key: string; title: string }) => `${h.key}:${h.title}`), ['shop-es:Shop flow', 'work-kanban:Work'])
  assert.ok(status.body.agents.includes('agent-a'))

  // only the person starts one
  const byAgent = await json(await send('POST', `/api/boards/${b.id}/handover`, { to: 'agent-b' }, as(B)))
  assert.equal(byAgent.status, 403)
  assert.equal(byAgent.body.error, 'only the person hands files over — ask them (board panel → Hand over files)')
  assert.equal((await send('POST', `/api/boards/${b.id}/handover`, { to: 'agent-b', author: 'agent' }, { 'x-unprose-agent': 'claude-local' })).status, 403, 'a local agent neither')
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/cancel`, {})).status, 404, 'nothing open yet')
  const unknown = await json(await start(b.id, { to: 'nobody' }))
  assert.equal(unknown.status, 400)
  assert.match(unknown.body.error, /"nobody" is not an agent this canvas knows — known agents: .*agent-a.*agent-b/)
  assert.equal((await start(b.id, { to: 'agent-b', keys: ['nope'] })).status, 400)
  assert.match((await json(await start(b.id, { to: 'agent-a' }))).body.error, /nothing to hand over: every diagram's files are held by agent-a already/)

  // both sides wake for it, even when they wait only for what addresses them personally
  const since = store.get(b.id)!.seq
  const waitFor = (token: string) => call(`/api/boards/${b.id}/wait?since=${since}&timeout=1500&quiet=50&until=mention`, { headers: as(token) }).then((r) => r.json())
  const [wa, wb, wc] = [waitFor(A), waitFor(B), waitFor(C)]
  await new Promise((r) => setTimeout(r, 50))
  const started = await json(await start(b.id, { to: '@agent-b' }))
  assert.equal(started.status, 201)
  const ho = started.body.handover as Handover
  assert.match(ho.id, /^ho_[a-z0-9]+$/)
  assert.equal(ho.thread, `handover.${ho.id.slice(3)}`)
  assert.equal(ho.to, 'agent-b')
  assert.equal(ho.answeredBy, true)
  assert.equal(ho.by, 'user')
  assert.deepEqual(ho.keys, [{ key: 'shop-es', from: 'agent-a', source: 'design/shop.es.yaml', title: 'Shop flow' }, { key: 'work-kanban', from: 'agent-a', source: 'design/work.kanban.yaml', title: 'Work' }])
  assert.deepEqual(handoverOf(store.get(b.id)!.meta), ho)
  const root = store.get(b.id)!.items[ho.thread]
  assert.equal(root.createdBy, 'user')
  assert.equal(root.target, 'diagram.shop-es')
  assert.deepEqual(root.data?.handover, { id: ho.id, state: 'open', to: 'agent-b', from: ['agent-a'] })
  assert.deepEqual(root.data?.about, ['diagram.shop-es', 'diagram.work-kanban'])
  assert.deepEqual(root.data?.to, ['agent-a', 'agent-b'])
  assert.equal(root.data?.route, 'handover')
  assert.equal(root.text, 'Handing over the files of «Shop flow» (design/shop.es.yaml), «Work» (design/work.kanban.yaml) from @agent-a to @agent-b.\n@agent-a: settle the open proposals on them, redraw any of them whose file changed since your last draw, then canvas_handover({ ready: true }).\n@agent-b: when they are ready, canvas_handover({ accept: true }), keep the files in your repo (canvas_files), and redraw once from your copy. From then on proposals on them go to you.')
  assert.ok(store.changes(b.id).some((c) => c.note === 'asked agent-a to hand over the files of "Shop flow", "Work" to agent-b'))
  const [ra, rb, rc] = await Promise.all([wa, wb, wc])
  assert.equal(ra.timedOut, false, 'the holder wakes')
  assert.equal(rb.timedOut, false, 'the receiver wakes')
  assert.equal(rc.timedOut, true, 'nobody else does')
  assert.equal((await json(await start(b.id))).body.error, 'finish or cancel the open handover first')
  const settings = await json(await call(`/api/boards/${b.id}/settings`, { headers: as(A) }))
  assert.equal(settings.body.handover.id, ho.id)

  // accept before ready; the person cannot accept for the agent; nobody but the receiver accepts
  const early = await json(await send('POST', `/api/boards/${b.id}/handover/accept`, {}, as(B)))
  assert.equal(early.status, 409)
  assert.match(early.body.error, /^not ready yet: «Shop flow» waits for @agent-a, «Work» waits for @agent-a/)
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/accept`, {})).status, 403)
  assert.match((await json(await send('POST', `/api/boards/${b.id}/handover/accept`, {}, as(C)))).body.error, /only agent-b accepts this handover/)

  // the holder may still redraw while the handover is open (that is how it gets ready)
  assert.equal((await repatch(b.id, A, 'work-kanban')).status, 200)
  // ready: only the holder of those keys; the person only with force
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/ready`, {}, as(C))).status, 403)
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/ready`, { force: true }, as(A))).status, 403)
  const personNoForce = await json(await send('POST', `/api/boards/${b.id}/handover/ready`, {}))
  assert.equal(personNoForce.status, 403)
  assert.match(personNoForce.body.error, /marks them ready itself/)
  const ready = await json(await send('POST', `/api/boards/${b.id}/handover/ready`, { keys: ['work-kanban'] }, as(A)))
  assert.equal(ready.status, 200)
  const workFiles = (store.get(b.id)!.meta!.diagrams as Record<string, { files: Record<string, string> }>)['work-kanban'].files
  const kanbanText = Object.values(workFiles)[0]
  assert.deepEqual(ready.body.handover.keys[1].ready.files, Object.fromEntries(Object.entries(workFiles).map(([p, t]) => [p, sha1(t)])))
  assert.equal(ready.body.handover.keys[1].ready.by, 'agent-a')
  assert.equal(ready.body.handover.keys[0].ready, undefined)
  assert.deepEqual(ready.body.open, [], 'no proposal is open on the kanban')
  const replies = () => Object.values(store.get(b.id)!.items).filter((i) => i.type === 'comment' && i.target === ho.thread).sort((x, y) => String(x.data?.postedAt).localeCompare(String(y.data?.postedAt)))
  assert.equal(replies().at(-1)!.text, `Ready: «Work» — the files as of my last draw (${Object.keys(workFiles)[0]} ${sha1(kanbanText).slice(0, 7)})`)
  assert.deepEqual(replies().at(-1)!.data?.to, ['agent-b'], "the holder's reply goes to the receiver")
  // the holder is gone: the person hands the rest over anyway
  const forced = await json(await send('POST', `/api/boards/${b.id}/handover/ready`, { force: true }))
  assert.equal(forced.status, 200)
  assert.equal(forced.body.handover.keys[0].ready.forced, true)
  assert.equal(forced.body.handover.keys[0].ready.by, 'user')
  assert.deepEqual(forced.body.open, [prop.body.comment], 'the open proposal on the shop flow — it goes to agent-b after the handover')
  assert.equal(replies().at(-1)!.text, "Handed over without @agent-a's confirmation: «Shop flow» as of its last draw, 2026-10-08 10:00 UTC\nEvery file is ready — @agent-b: canvas_handover({ accept: true }).")
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/ready`, { force: true })).status, 409, 'nothing left to force')

  // accept: holders, "Answered by", the thread
  const acc = await json(await send('POST', `/api/boards/${b.id}/handover/accept`, { repo: 'team-notes', remote: 'https://river:ghp_x@github.com/b/team-notes.git' }, as(B)))
  assert.equal(acc.status, 200)
  assert.deepEqual(acc.body.keys, ['shop-es', 'work-kanban'])
  assert.deepEqual(acc.body.files.map((f: { path: string }) => f.path), ['design/shop.es.yaml', ...Object.keys(workFiles)])
  assert.deepEqual(acc.body.files[0], { path: 'design/shop.es.yaml', sha: sha1(ES), lines: 2 })
  const h = holderOf(b.id, 'shop-es')
  assert.equal(h.agent, 'agent-b')
  assert.equal(h.from, 'agent-a')
  assert.equal(h.handover, ho.thread)
  assert.equal(h.repo, 'team-notes')
  assert.equal(h.remote, 'https://github.com/b/team-notes.git')
  const meta = store.get(b.id)!.meta!
  assert.equal(meta.handover, undefined)
  assert.deepEqual({ ...(meta.responder as object), at: undefined }, { mode: 'agent', agent: 'agent-b', by: 'user', at: undefined })
  assert.equal(meta.responderSuggestion, undefined)
  assert.match(store.changes(b.id).find((c) => c.note?.startsWith('agent-b took over'))!.note!, /set "Answered by" to agent-b — the person asked for it when handing the files over/)
  assert.equal((store.get(b.id)!.items[ho.thread].data?.handover as { state: string }).state, 'done')
  assert.equal(replies().at(-1)!.text, 'Accepted — @agent-b holds the files of «Shop flow», «Work» now; proposals on them go to @agent-b. @agent-a: propose from now on (canvas_files → canvas_propose_edit).\n"Answered by" is @agent-b now, as the person asked when handing over.')
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/accept`, {}, as(B))).status, 404, 'no open handover any more')

  // after: the old holder is refused, the new one redraws and keeps the handover on its holder
  const refused = await json(await repatch(b.id, A))
  assert.equal(refused.status, 409)
  assert.equal(refused.body.error, 'the files of "shop-es" (design/shop.es.yaml) are held by agent-b: you cannot redraw them. Propose instead (canvas_files → canvas_propose_edit), or ask the person to hand them over to you (board panel → Hand over files).')
  assert.equal((await repatch(b.id, B)).status, 200)
  assert.equal(holderOf(b.id, 'shop-es').from, 'agent-a')
  assert.equal(holderOf(b.id, 'shop-es').handover, ho.thread)
  assert.equal(holderOf(b.id, 'shop-es').repo, 'mine')
  // proposals go to the new holder: the open one (the person's answer in it) and a new one by the old holder
  await send('POST', `/api/boards/${b.id}/ops`, { author: 'user', ops: [{ kind: 'add', item: { id: 'yes1', type: 'comment', x: 0, y: 0, w: 100, h: 60, text: 'ok, apply it', target: prop.body.comment } }] })
  assert.deepEqual(store.get(b.id)!.items.yes1.data?.to, ['agent-b', 'agent-c'])
  const sha = sha1((store.get(b.id)!.meta!.diagrams as Record<string, { files: Record<string, string> }>)['shop-es'].files['design/shop.es.yaml'])
  const byA = await json(await send('POST', `/api/boards/${b.id}/proposals`, { file: 'design/shop.es.yaml', base: sha, newText: 'events:\n  - text: Order paid\n', note: 'from A, now a proposer' }, as(A)))
  assert.equal(byA.status, 201)
  assert.deepEqual(store.get(b.id)!.items[byA.body.comment].data?.to, ['agent-b'])
  assert.equal((await json(await call(`/api/boards/${b.id}/settings`))).body.answeredBy, 'agent-b')
  // the outline (canvas_read_board) says who holds what now
  assert.match(await (await call(`/api/boards/${b.id}/outline`)).text(), /Files of shop-es \(design\/shop\.es\.yaml\): held by agent-b in mine \(handed over from agent-a\)/)
})

test('cancel: either side declines, or the person; others cannot; answeredBy: false leaves "Answered by"; keys pick diagrams', async () => {
  const b = newBoard()
  const ho = (await json(await start(b.id, { to: 'agent-b', keys: ['work-kanban'], answeredBy: false }))).body.handover as Handover
  assert.deepEqual(ho.keys.map((k) => k.key), ['work-kanban'])
  assert.equal(ho.answeredBy, false)
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/cancel`, {}, as(C))).status, 403)
  const r = await json(await send('POST', `/api/boards/${b.id}/handover/cancel`, { reason: 'busy right now' }, as(A)))
  assert.equal(r.status, 200)
  assert.equal(store.get(b.id)!.meta!.handover, undefined)
  assert.equal((store.get(b.id)!.items[ho.thread].data?.handover as { state: string }).state, 'cancelled')
  const last = Object.values(store.get(b.id)!.items).filter((i) => i.target === ho.thread).at(-1)!
  assert.equal(last.text, 'Cancelled by @agent-a: busy right now')
  assert.deepEqual(last.data?.to, ['agent-b'])
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/cancel`, {})).status, 404)
  // again, without "Answered by": the receiver declines this time … then once more, accepted
  const ho2 = (await json(await start(b.id, { to: 'agent-b', answeredBy: false }))).body.handover as Handover
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/cancel`, {}, as(B))).status, 200)
  assert.match(Object.values(store.get(b.id)!.items).filter((i) => i.target === ho2.thread).at(-1)!.text!, /^Cancelled by @agent-b$/)
  await start(b.id, { to: 'agent-b', answeredBy: false })
  await send('POST', `/api/boards/${b.id}/handover/ready`, {}, as(A))
  assert.equal((await send('POST', `/api/boards/${b.id}/handover/accept`, {}, as(B))).status, 200)
  assert.equal(store.get(b.id)!.meta!.responder, undefined, '"Answered by" stays as it was')
  // a forged handover mark on a comment is dropped
  await send('POST', `/api/boards/${b.id}/ops`, { ops: [{ kind: 'add', item: { id: 'forge', type: 'comment', x: 0, y: 0, w: 1, h: 1, text: 'hi', data: { handover: { id: 'ho_f', to: 'agent-c', from: ['agent-c'] } } } }] }, as(C))
  assert.equal(store.get(b.id)!.items.forge.data?.handover, undefined)
  assert.notEqual(store.get(b.id)!.items.forge.data?.route, 'handover')
})

test('canvas_handover over /mcp: status, ready, accept (with what to do next); the old holder\'s design_draw is refused before anything is drawn', async () => {
  const b = newBoard()
  const mcp = async (token: string) => {
    const c = new Client({ name: 't', version: '1' })
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: as(token) } }))
    return c
  }
  const ta = await mcp(A)
  const tb = await mcp(B)
  const callTool = async (c: Client, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> }
  const none = await callTool(ta, 'canvas_handover', { board: b.id })
  assert.match(none.content[0].text, /No handover is open on this board\. Only the person starts one/)
  assert.match(none.content[0].text, /- shop-es «Shop flow» \(design\/shop\.es\.yaml\): held by agent-a/)
  await start(b.id, { to: 'agent-b' })
  const open = await callTool(ta, 'canvas_handover', { board: b.id })
  assert.match(open.content[0].text, /Handover open \(thread handover\.[a-z0-9]+, started by the person\)/)
  assert.match(open.content[0].text, /waiting for agent-a: settle the open proposals/)
  const ctx = await callTool(tb, 'canvas_context', { id: b.id })
  assert.match(ctx.content[0].text, /Handover open/)
  const early = await callTool(tb, 'canvas_handover', { board: b.id, accept: true })
  assert.equal(early.isError, true)
  assert.match(early.content[0].text, /not ready yet/)
  const ready = await callTool(ta, 'canvas_handover', { board: b.id, ready: true })
  assert.match(ready.content[0].text, /^Marked ready for agent-b: «Shop flow», «Work» — design\/shop\.es\.yaml [0-9a-f]{7}, design\/work\.kanban\.yaml [0-9a-f]{7}/)
  assert.match(ready.content[0].text, /Every file is ready: agent-b accepts next/)
  const acc = await callTool(tb, 'canvas_handover', { board: b.id, accept: true, repo: 'team-notes' })
  assert.match(acc.content[0].text, /^You hold the files of «Shop flow», «Work» now \(handed over from agent-a\)/)
  assert.match(acc.content[0].text, new RegExp(`read each file below with canvas_files\\(\\{ id: "${b.id}", path \\}\\), write it into your repo at that path`))
  assert.match(acc.content[0].text, /redraw once from your copy: design_draw\(\{ name, content, board/)
  assert.match(acc.content[0].text, /- design\/shop\.es\.yaml\tbase [0-9a-f]{40}\t2 lines/)
  const seq = store.get(b.id)!.seq
  const drawn = await callTool(ta, 'design_draw', { name: 'shop.es.yaml', content: ES, board: b.id })
  assert.equal(drawn.isError, true)
  assert.equal(drawn.content[0].text, 'the files of "shop-es" (design/shop.es.yaml) are held by agent-b: you cannot redraw them. Propose instead (canvas_files → canvas_propose_edit), or ask the person to hand them over to you (board panel → Hand over files).')
  assert.equal(store.get(b.id)!.seq, seq, 'nothing was drawn')
  const preview = await callTool(ta, 'design_draw', { name: 'shop.es.yaml', content: ES, board: b.id, dryRun: true })
  assert.match(preview.content[0].text, /✖ a real draw is refused: the files of "shop-es"/)
  const ok = await callTool(tb, 'design_draw', { name: 'shop.es.yaml', content: ES, board: b.id })
  assert.equal(ok.isError, undefined, ok.content[0].text)
  assert.equal(holderOf(b.id, 'shop-es').agent, 'agent-b')
  assert.equal(holderOf(b.id, 'shop-es').from, 'agent-a')
  assert.equal(holderOf(b.id, 'shop-es').repo, 'team-notes', 'what it said on accept')
  await ta.close()
  await tb.close()
})

test('a workflow board hands over its workflow (key "workflow"): no frame, so the thread is loose on the board', async () => {
  const root = ['', 'srv', 'team'].join('/')
  const b = store.create({ title: 'wf board', kind: 'workflow', meta: { workflow: { name: 'card-pipeline', file: `${root}/examples/wf.yaml`, files: { 'examples/wf.yaml': 'name: card-pipeline\n' }, holder: { agent: 'agent-a', root, at: T0 } } } })
  const ho = (await json(await start(b.id, { to: 'agent-b' }))).body.handover as Handover
  assert.deepEqual(ho.keys, [{ key: 'workflow', from: 'agent-a', source: 'examples/wf.yaml', title: 'card-pipeline' }])
  assert.equal(store.get(b.id)!.items[ho.thread].target, undefined)
  assert.deepEqual(store.get(b.id)!.items[ho.thread].data?.to, ['agent-a', 'agent-b'])
  const ready = await json(await send('POST', `/api/boards/${b.id}/handover/ready`, {}, as(A)))
  assert.deepEqual(ready.body.handover.keys[0].ready.files, { 'examples/wf.yaml': sha1('name: card-pipeline\n') })
  const acc = await json(await send('POST', `/api/boards/${b.id}/handover/accept`, {}, as(B)))
  assert.deepEqual(acc.body, { seq: acc.body.seq, keys: ['workflow'], files: [{ path: 'examples/wf.yaml', sha: sha1('name: card-pipeline\n'), lines: 1 }] })
  const wf = store.get(b.id)!.meta!.workflow as { holder: Record<string, string>; name: string }
  assert.equal(wf.holder.agent, 'agent-b')
  assert.equal(wf.holder.from, 'agent-a')
  assert.equal(wf.name, 'card-pipeline', 'the rest of the workflow entry stays')
  const refused = await json(await send('PATCH', `/api/boards/${b.id}`, { meta: { workflow: { name: 'card-pipeline', holder: {} } } }, as(A)))
  assert.equal(refused.status, 409)
  assert.match(refused.body.error, /^the files of "workflow" \(.*examples\/wf\.yaml\) are held by agent-b: you cannot redraw them\./)
})
