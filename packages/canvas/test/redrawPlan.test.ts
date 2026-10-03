// What a redraw keeps (docs/diagrams.md "What a redraw keeps"): the dry-run plan, the layout lock and its
// precedence (locked > moved by the person > the file), and items in a frame that the file did not draw.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { explainRedraw, planLines, planSummary, redrawInputs, type BoardItem, type LoggedChange } from '../src/diagrams/redraw.js'
import { layoutLock } from '../src/model.js'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { drawDesignContent, previewDesignContent } from '../src/designTools.js'
import { lockOps } from '../src/mcp.js'

const frame = (extra: Partial<BoardItem> = {}): BoardItem => ({ id: 'diagram.k', type: 'frame', x: 0, y: 0, w: 600, h: 300, text: 'K', data: { diagram: { kind: 'event-storming', key: 'k' } }, ...extra })
const sticky = (id: string, extra: Partial<BoardItem> = {}): BoardItem => ({ id, type: 'sticky', x: 20, y: 20, w: 120, h: 60, parent: 'diagram.k', text: id, createdBy: 'agent', ...extra })
const scope = { prefix: 'k.', keep: new Set(['diagram.k']), frame: 'diagram.k' }
const drawLog = (ids: string[], by?: string): LoggedChange => ({ author: 'agent', ...(by ? { by } : {}), note: 'design_draw: k.es.yaml', ops: ids.map((id) => ({ kind: 'add', item: { id, type: 'sticky' } })) })

test('the plan names every fate: added, updated, removed, kept where moved, kept locked, held, foreign — and its ops match', () => {
  const board: Record<string, BoardItem> = {
    'diagram.k': frame(),
    'k.moved': sticky('k.moved', { x: 400 }),
    'k.locked': sticky('k.locked', { x: 300, data: { lock: 'layout', lockedBy: 'person' } }),
    'k.same': sticky('k.same'),
    'k.renamed': sticky('k.renamed', { text: 'old words' }),
    'k.gone': sticky('k.gone'),
    'k.hand': sticky('k.hand', { createdBy: 'user' }),
    'k.proposed': sticky('k.proposed', { data: { pending: { kind: 'add', trace: { from: 'es/x', rel: 'derived-from' } } } }),
    'note.codex': sticky('note.codex', { text: 'codex-b was here' }),
    'elsewhere': sticky('elsewhere', { parent: undefined }),
    c1: { id: 'c1', type: 'comment', target: 'k.gone' },
  }
  const changes: LoggedChange[] = [
    drawLog(['diagram.k', 'k.moved', 'k.locked', 'k.same', 'k.renamed', 'k.gone'], 'claude-a'),
    { author: 'user', ops: [{ kind: 'update', id: 'k.moved', patch: { x: 400 } }] },
    { author: 'user', ops: [{ kind: 'add', item: { id: 'k.hand', type: 'sticky' } }] },
    { author: 'agent', by: 'codex-b', note: 'a note for the person', ops: [{ kind: 'add', item: { id: 'note.codex', type: 'sticky' } }] },
  ]
  const drawn = [frame(), sticky('k.moved'), sticky('k.locked'), sticky('k.same'), sticky('k.renamed', { text: 'new words' }), sticky('k.new')]
  const { ops, plan } = explainRedraw(board, drawn, redrawInputs(changes), scope)
  const ids = (l: Array<{ id: string }>) => l.map((x) => x.id).sort()
  assert.deepEqual(ids(plan.added), ['k.new'])
  assert.deepEqual(ids(plan.updated), ['k.renamed'])
  assert.match(plan.updated[0].why!, /text/)
  assert.deepEqual(ids(plan.removed), ['k.gone'])
  assert.deepEqual(ids(plan.keptMoved), ['k.moved'])
  assert.match(plan.keptMoved[0].why!, /you moved it: keeps x/)
  assert.deepEqual(ids(plan.keptLocked), ['k.locked'])
  assert.deepEqual(ids(plan.held), ['k.proposed'])
  // foreign: another agent's note in the frame, and the person's item with this file's prefix — both kept; not the
  // item outside the frame, not the comment
  assert.deepEqual(ids(plan.foreign), ['k.hand', 'note.codex'])
  assert.match(plan.foreign.find((l) => l.id === 'note.codex')!.why!, /added by codex-b, not from this file: kept/)
  assert.match(plan.foreign.find((l) => l.id === 'k.hand')!.why!, /the person/)
  // the ops agree with the plan
  const removed = ops.filter((o) => o.kind === 'remove').map((o) => o.id)
  assert.deepEqual(removed, ['k.gone'])
  const patch = (id: string) => ops.find((o) => o.kind === 'update' && o.id === id)!.patch!
  assert.equal('x' in patch('k.moved'), false, 'moved by the person: geometry kept')
  assert.equal('x' in patch('k.locked'), false, 'locked: geometry kept')
  assert.deepEqual(patch('k.locked').data, { lock: 'layout', lockedBy: 'person' }, 'the lock survives the redraw')
  assert.equal(patch('k.same').x, 20, 'neither moved nor locked: the file decides')
  // the text
  const lines = planLines(plan, { limit: 1 })
  assert.match(lines[0], /dry run: nothing written/)
  assert.equal(lines[1].trim(), planSummary(plan))
  assert.match(planSummary(plan), /1 added · 1 updated · 4 unchanged · 1 removed · 1 kept where the person moved it · 1 kept: locked · 1 proposals held · 2 not from this file \(kept\)/)
  assert.ok(lines.includes('    … and 1 more'), 'limit cuts each section')
})

test('precedence: locked beats moved; a locked frame locks everything in it and does not grow', () => {
  const board: Record<string, BoardItem> = { 'diagram.k': frame({ data: { diagram: { kind: 'event-storming', key: 'k' }, lock: 'layout' } }), 'k.a': sticky('k.a', { x: 50 }) }
  const drawn = [frame({ w: 100 }), sticky('k.a', { x: 900 }), sticky('k.far', { x: 2000 })]
  const { ops, plan } = explainRedraw(board, drawn, { placed: new Set(['k.a']) }, scope)
  assert.equal(layoutLock(board as never, 'k.a'), 'frame')
  assert.deepEqual(plan.keptLocked.map((l) => [l.id, l.why]), [['diagram.k', 'locked: keeps w'], ['k.a', 'its frame is locked: keeps x']], 'locked wins over moved')
  assert.deepEqual(plan.keptMoved, [])
  assert.equal(ops.some((o) => o.id === 'diagram.k' && o.patch && ('w' in o.patch || 'h' in o.patch)), false, 'a locked frame keeps its size and does not grow')
  assert.equal(ops.find((o) => o.id === 'k.a')!.patch!.x, undefined)
})

test('items another agent added by hand with this file\'s prefix are kept; a first redraw still clears stale template items', () => {
  const board = { 'diagram.k': frame(), 'k.extra': sticky('k.extra'), 'k.old': sticky('k.old') }
  const byCodex: LoggedChange = { author: 'agent', by: 'codex-b', note: 'added a card', ops: [{ kind: 'add', item: { id: 'k.extra', type: 'sticky' } }] }
  const withDrawer = explainRedraw(board, [frame()], redrawInputs([drawLog(['k.old'], 'claude-a'), byCodex]), scope)
  assert.deepEqual(withDrawer.plan.removed.map((l) => l.id), ['k.old'])
  assert.deepEqual(withDrawer.plan.foreign.map((l) => l.id), ['k.extra'])
  // no redraw in the log yet (the board was made with canvas_create_board): agents' items are the drawing's
  const first = explainRedraw(board, [frame()], redrawInputs([{ author: 'agent', note: 'created', ops: [{ kind: 'add', item: { id: 'k.old', type: 'sticky' } }, { kind: 'add', item: { id: 'k.extra', type: 'sticky' } }] }]), scope)
  assert.deepEqual(first.plan.removed.map((l) => l.id).sort(), ['k.extra', 'k.old'])
})

test("canvas_apply's lock ops: lock an item or a whole frame; an agent never unlocks the person's lock", () => {
  const items = {
    'diagram.k': frame() as never,
    a: sticky('a') as never,
    mine: sticky('mine', { data: { lock: 'layout', lockedBy: 'agent', x: 1 } }) as never,
    theirs: sticky('theirs', { data: { lock: 'layout', lockedBy: 'person' } }) as never,
    c: { id: 'c', type: 'comment' } as never,
  }
  const r = lockOps({ items }, [{ kind: 'lock', id: 'a' }, { kind: 'lock', frame: 'k' }, { kind: 'unlock', id: 'mine' }, { kind: 'unlock', id: 'theirs' }, { kind: 'lock', id: 'c' }, { kind: 'lock', frame: 'nope' }])
  assert.deepEqual(r.ops.map((o) => [o.kind === 'update' && o.id, o.kind === 'update' && o.patch.data]), [
    ['a', { lock: 'layout', lockedBy: 'agent' }],
    ['diagram.k', { diagram: { kind: 'event-storming', key: 'k' }, lock: 'layout', lockedBy: 'agent' }],
    ['mine', { x: 1 }],
  ])
  assert.deepEqual(r.skipped, ['theirs (the person locked it — ask them to unlock it)', 'c (a comment has no layout to lock)', 'frame nope (no diagram frame with that key)'])
})

// ── over HTTP: design_draw { dryRun } writes nothing; the real draw then does what the preview said ──

let srv: RunningServer
before(async () => {
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-redraw-plan-')), webDist: '/nonexistent' })
})
after(() => srv.close())

const KANBAN = (cards: string[]) => `columns:\n  - { name: Todo }\n  - { name: Done }\ncards:\n${cards.map((c) => `  - { title: ${c}, column: Todo }`).join('\n')}\n`

test('design_draw dryRun: a readable plan, no board created, nothing written; the draw then keeps the lock and the foreign card', async () => {
  const claude = new CanvasClient(srv.url, { agentName: 'claude-a' })
  const codex = new CanvasClient(srv.url, { agentName: 'codex-b' })
  const none = await previewDesignContent(claude, 'plan.kanban.yaml', KANBAN(['Alpha']), 'title:Not yet')
  assert.match(none.lines.join('\n'), /no board title:Not yet yet: a real draw creates it/)
  assert.equal((await claude.listBoards()).some((b) => b.title === 'Not yet'), false, 'a dry run creates no board')

  const r = await drawDesignContent(claude, 'plan.kanban.yaml', KANBAN(['Alpha', 'Beta', 'Gamma', 'Delta']), 'title:Plan')
  const b0 = await claude.getBoard(r.boardId)
  const card = (t: string) => Object.values(b0.items).find((i) => i.type === 'card' && i.text === t)!
  const frameId = Object.values(b0.items).find((i) => i.type === 'frame')!.id
  await claude.apply(r.boardId, [{ kind: 'update', id: card('Alpha').id, patch: { x: card('Alpha').x + 300 } }], 'user')
  await claude.apply(r.boardId, [{ kind: 'update', id: card('Beta').id, patch: { data: { ...card('Beta').data, lock: 'layout', lockedBy: 'person' } } }], 'user')
  await codex.apply(r.boardId, [{ kind: 'add', item: { id: 'codex-note', type: 'sticky', x: card('Delta').x, y: card('Delta').y + 400, w: 120, h: 60, text: 'from codex', parent: frameId, createdBy: 'agent', updatedBy: 'agent', updatedAt: '' } }], 'agent', 'a note')

  const seq = (await claude.getBoard(r.boardId)).seq
  // the file now: Gamma renamed, Delta gone, Epsilon new, Beta first (the file would move it)
  const next = KANBAN(['Beta', 'Alpha', 'Gamma two', 'Epsilon'])
  const p = await previewDesignContent(claude, 'plan.kanban.yaml', next, 'title:Plan', { limit: 20 })
  const text = p.lines.join('\n')
  assert.equal((await claude.getBoard(r.boardId)).seq, seq, 'a dry run writes nothing')
  assert.match(text, /^Redraw preview — plan-kanban from plan\.kanban\.yaml on "Plan"/)
  assert.match(text, /removed \(\d+\):[\s\S]*"Delta" — no longer in the file/)
  assert.match(text, /not from this file \(kept\) \(1\):\n {4}\* codex-note {2}"from codex" — added by codex-b, not from this file: kept/)
  assert.ok(p.plan!.keptLocked.some((l) => l.label === 'Beta'), text)
  assert.ok(p.plan!.added.some((l) => l.label === 'Epsilon' || l.label === 'Gamma two'), text)

  await drawDesignContent(claude, 'plan.kanban.yaml', next, 'title:Plan')
  const b1 = await claude.getBoard(r.boardId)
  const beta = Object.values(b1.items).find((i) => i.type === 'card' && i.text === 'Beta')!
  assert.deepEqual([beta.x, beta.y, beta.data?.lock], [card('Beta').x, card('Beta').y, 'layout'], 'the locked card kept its place and its lock')
  assert.ok(b1.items['codex-note'], "another agent's card in the frame survives the redraw")
  assert.equal(Object.values(b1.items).some((i) => i.text === 'Delta'), false)
})

test('a redraw of an unchanged kanban changes nothing — not on the first redraw, not with a moved or a locked column', async () => {
  const claude = new CanvasClient(srv.url, { agentName: 'claude-a' })
  const file = `columns:\n  - { name: Todo }\n  - { name: Doing }\n  - { name: Done }\ncards:\n  - { title: One, column: Todo }\n  - { title: Two, column: Doing }\n`
  const nothing = async () => {
    const p = await previewDesignContent(claude, 'still.kanban.yaml', file, 'title:Still')
    assert.deepEqual([p.plan!.added, p.plan!.updated, p.plan!.removed], [[], [], []], p.lines.join('\n'))
    return p
  }
  const geometry = (b: { items: Record<string, { x: number; y: number; w: number; h: number }> }) => Object.fromEntries(Object.entries(b.items).map(([id, i]) => [id, [i.x, i.y, i.w, i.h]]))
  const r = await drawDesignContent(claude, 'still.kanban.yaml', file, 'title:Still')
  const first = await claude.getBoard(r.boardId)
  // the frame sits where the drawing was anchored; the columns start inside its padding (before: the first redraw
  // moved every column and card up and left by that padding)
  const frame = Object.values(first.items).find((i) => i.type === 'frame')!
  const cols = Object.values(first.items).filter((i) => i.type === 'lane').sort((a, b) => a.x - b.x)
  assert.deepEqual([cols[0].x - frame.x, cols[0].y - frame.y], [20, 64])
  assert.match((await nothing()).lines.join('\n'), /^ {2}\d+ unchanged$/m)
  await drawDesignContent(claude, 'still.kanban.yaml', file, 'title:Still')
  assert.deepEqual(geometry(await claude.getBoard(r.boardId)), geometry(first), 'the real redraw moves nothing either')
  await nothing()

  // the person moves a column, then locks another: still nothing to update, and the redraw keeps both
  await claude.apply(r.boardId, [{ kind: 'update', id: cols[2].id, patch: { x: cols[2].x + 200, y: cols[2].y + 30 } }], 'user')
  assert.deepEqual((await nothing()).plan!.keptMoved.map((l) => l.id), [cols[2].id])
  await claude.apply(r.boardId, [{ kind: 'update', id: cols[1].id, patch: { y: cols[1].y + 40, data: { ...cols[1].data, lock: 'layout', lockedBy: 'person' } } }], 'user')
  const p = await nothing()
  assert.ok(p.plan!.keptLocked.some((l) => l.id === cols[1].id), p.lines.join('\n'))
  const before = geometry(await claude.getBoard(r.boardId))
  await drawDesignContent(claude, 'still.kanban.yaml', file, 'title:Still')
  assert.deepEqual(geometry(await claude.getBoard(r.boardId)), before, 'the redraw keeps the moved and the locked column, and moves nothing else')
  await nothing()
})
