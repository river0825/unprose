// A domain story's `drawAgain` (docs/diagrams.md §6b "Repeated actors"): a sentence asks for one of its actors to be drawn
// again next to it; on a board the person arranged, a new drawing lands next to where they put its neighbour (the
// template's `near` hint, never stored); a note's id is named after what it is on, so inserting one moves no other — and
// a board drawn with the old numbered ids keeps the person's placement on its first redraw.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkDomainStory, normalizeDomainStory, type DomainStoryContent } from '../src/diagrams/domainStory.js'
import { dsCasting, renderDomainStory } from '../src/templates/domain-story.js'
import { explainRedraw, foldRedrawInputs, emptyRedrawInputs, redrawInputs, type BoardItem, type LoggedChange, type TemplateOp } from '../src/diagrams/redraw.js'
import { designFromObject, lintDesignContent } from '../src/diagrams/designFile.js'
import { applyOps, withoutHints, type Board, type Item, type Op } from '../src/model.js'
import { outline } from '../src/outline.js'
import { toEgon } from '../src/diagrams/egon.js'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { drawDesignContent, previewDesignContent } from '../src/designTools.js'

const now = 'T'
type S = NonNullable<DomainStoryContent['sentences']>[number]

// the owner's report, in small: Lead in ⑤⑥⑧, CL1 dials Lead in ⑪ — the layout finds them next to each other, so it
// draws no copy; on the person's board they are far apart
const calls = (o: { repeat?: boolean; dial?: Partial<S>; more?: S[]; notes?: DomainStoryContent['annotations'] } = {}): DomainStoryContent => ({
  actors: [
    { id: 'mkt', text: 'Marketer' },
    { id: 'crm', text: 'CRM', kind: 'system' },
    { id: 'sup', text: 'Supervisor' },
    { id: 'cl2', text: 'CL2' },
    { id: 'lead', text: 'Lead', ...(o.repeat ? { repeat: true } : {}) },
    { id: 'cl1', text: 'CL1' },
  ],
  workObjects: ['lead list', 'phone call', 'question', 'call note', 'quote', 'follow-up task'],
  sentences: [
    { id: 'import', actor: 'mkt', verb: 'imports', object: 'lead list', to: 'crm', toLabel: 'into' },
    { id: 'assign', actor: 'crm', verb: 'assigns', object: 'lead list', to: 'sup' },
    { id: 'split1', actor: 'sup', verb: 'splits', object: 'lead list', to: 'cl1' },
    { id: 'split2', actor: 'sup', verb: 'splits', object: 'lead list', to: 'cl2' },
    { id: 'call', actor: 'cl2', verb: 'calls', object: 'phone call', to: 'lead' },
    { id: 'ask', actor: 'lead', verb: 'asks', object: 'question', to: 'cl2' },
    { id: 'log', actor: 'cl2', verb: 'logs', object: 'call note', to: 'crm', toLabel: 'in' },
    { id: 'quote', actor: 'cl2', verb: 'sends', object: 'quote', to: 'lead' },
    { id: 'remind', actor: 'crm', verb: 'reminds', object: 'follow-up task', to: 'cl1' },
    { id: 'read', actor: 'cl1', verb: 'reads', object: 'follow-up task', to: 'crm', toLabel: 'in' },
    { id: 'dial', actor: 'cl1', verb: 'dials', object: 'phone call', to: 'lead', ...(o.dial ?? {}) },
    ...(o.more ?? []),
  ],
  annotations: o.notes ?? [{ on: 'lead', text: 'A company that asked for a demo' }],
})
const near = (it: Item | BoardItem | undefined) => (it as { near?: unknown } | undefined)?.near
const by = (items: Array<Item | BoardItem>, id: string) => items.find((i) => i.id === id)

test('drawAgain draws the actor again for that sentence, next to it — with or without repeat', () => {
  for (const repeat of [true, false]) {
    // without drawAgain the layout reuses Lead's one drawing for ⑪ (it is a cell away in its own grid)
    assert.equal(dsCasting(calls({ repeat })).cast.get('dial')!.to[0], 'lead')
    const forced = calls({ repeat, dial: { drawAgain: 'lead' } })
    const { cast, drawn } = dsCasting(forced)
    assert.equal(cast.get('dial')!.to[0], 'lead#2', `repeat: ${repeat}`)
    assert.ok(drawn.includes('lead#2'))
    assert.equal(cast.get('call')!.to[0], 'lead', 'the sentences before keep the first drawing')
    const items = renderDomainStory(forced, { scope: 'k', now })
    const again = by(items, 'k.actor.lead.2')!
    assert.equal(again.data?.occurrence, true)
    assert.equal(again.data?.drawAgain, 'dial', 'the sentence that asked for it')
    assert.equal(near(again), 'k.actor.cl1', 'drawn next to the sentence: CL1')
    const cl1 = by(items, 'k.actor.cl1')!
    assert.ok(Math.hypot(again.x - cl1.x, again.y - cl1.y) < 700, 'one grid cell from CL1')
    // ⑪'s onward arrow goes to the new drawing
    const obj = by(items, 'k.object.dial')!
    assert.ok(items.some((a) => a.type === 'arrow' && a.from === obj.id && a.to === again.id))
    // by text, or a list, the same
    assert.deepEqual(dsCasting(calls({ repeat, dial: { drawAgain: ['Lead'] } })).cast.get('dial'), cast.get('dial'))
  }
  // an actor named only by drawAgain: exactly the drawings asked for, and later sentences use the nearest one
  const later = calls({ dial: { drawAgain: 'lead' }, more: [{ id: 'sign', actor: 'lead', verb: 'signs', object: 'contract', to: 'cl1' }] })
  const { cast, drawn } = dsCasting(later)
  assert.deepEqual(drawn.filter((k) => k.startsWith('lead')), ['lead', 'lead#2'])
  assert.equal(cast.get('sign')!.actor, 'lead#2', 'the drawing next to the story')
  assert.deepEqual(drawn.filter((k) => !k.startsWith('lead')), ['mkt', 'crm', 'sup', 'cl1', 'cl2'], 'no other actor is drawn twice')
  // deterministic
  assert.deepEqual(renderDomainStory(later, { scope: 'k', now }), renderDomainStory(later, { scope: 'k', now }))
})

test('a story without drawAgain draws exactly as before; every pictogram and note says what it was placed next to', () => {
  const plain = renderDomainStory(calls(), { scope: 'k', now })
  const empty = calls()
  empty.sentences = empty.sentences.map((s) => ({ ...s, drawAgain: [] }))
  assert.deepEqual(renderDomainStory(empty, { scope: 'k', now }), plain)
  assert.ok(!plain.some((i) => i.data?.occurrence))
  // hints: every actor but the first next to an actor, a work object next to its sentence's actor, a note next to what it is on
  const actors = plain.filter((i) => i.data?.ds === 'actor')
  assert.equal(near(actors[0]), undefined)
  for (const a of actors.slice(1)) assert.match(String(near(a)), /^k\.actor\./, a.id)
  assert.equal(near(by(plain, 'k.object.dial')), 'k.actor.cl1')
  assert.equal(near(by(plain, 'k.note.note-lead')), 'k.actor.lead')
  for (const i of plain.filter((i) => i.type === 'arrow' || i.data?.ds === 'group' || i.role?.startsWith('legend'))) assert.equal(near(i), undefined, i.id)
})

test('lint: drawAgain naming an actor the sentence does not have warns; one it is the first to name is info', () => {
  const rules = (c: DomainStoryContent) => checkDomainStory(c).filter((f) => f.rule.startsWith('draw-again'))
  assert.deepEqual(rules(calls({ dial: { drawAgain: 'lead' } })), [])
  const off = rules(calls({ dial: { drawAgain: ['crm', 'Nobody'] } }))
  assert.deepEqual(off.map((f) => [f.rule, f.severity, f.element]), [['draw-again-not-in-sentence', 'warning', 'dial'], ['draw-again-not-in-sentence', 'warning', 'dial']])
  assert.match(off[0].message, /drawAgain names "CRM", who is not in this sentence.*\(CL1, Lead\)/)
  assert.match(off[1].message, /"Nobody"/)
  const first = rules({ actors: ['A', 'B'], sentences: [{ actor: 'A', verb: 'sends', object: 'x', to: 'B', drawAgain: 'B' }] })
  assert.deepEqual(first.map((f) => [f.rule, f.severity]), [['draw-again-first-appearance', 'info']])
  assert.match(first[0].message, /first appears here/)
  // a name that is no actor adds no actor (unlike `to`), and the file's schema knows the field
  assert.equal(normalizeDomainStory(calls({ dial: { drawAgain: 'Nobody' } })).actors.length, 6)
  const findings = lintDesignContent(designFromObject('c.domain-story.yaml', calls({ dial: { drawAgain: 'lead' } })))
  assert.ok(!findings.some((f) => f.severity === 'error' || /unknown field/.test(f.message)), findings.map((f) => f.message).join('\n'))
})

test('the outline names the sentence that drew an actor again; Egon.io gets the drawing as an actor of the same name', () => {
  const items = renderDomainStory(calls({ dial: { drawAgain: 'lead' } }), { scope: 'ds', now })
  const frame = { id: 'frame', type: 'frame', x: -40, y: -40, w: 6000, h: 4000, text: 'Story', createdBy: 'agent', updatedBy: 'agent', updatedAt: now, data: { diagram: { kind: 'domain-story', key: 'ds' } } } as unknown as Item
  const all = [frame, ...items.map((i) => (i.type === 'arrow' ? i : { ...i, parent: 'frame' }))]
  const board = { id: 'b', title: 'b', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(all.map((i) => [i.id, i])) } as Board
  assert.match(outline(board), /drawn 2 times: also #ds\.actor\.lead\.2 \(drawAgain in dial\)/)
  const egn = toEgon(calls({ dial: { drawAgain: 'lead' } })) as { domainStory: { businessObjects: Array<{ type: string; name?: string }> } }
  assert.equal(egn.domainStory.businessObjects.filter((o) => o.type.startsWith('domainStory:actor') && o.name === 'Lead').length, 2)
})

// ── on the board ──

const FRAME: BoardItem = { id: 'frame', type: 'frame', x: 0, y: 0, w: 5000, h: 4000, text: 'Story', data: { diagram: { kind: 'domain-story', key: 'ds' } } }
const SCOPE = { prefix: 'ds.', keep: new Set(['frame']), frame: 'frame' }
/** What the canvas serves a redraw: the frame and its items, with the template's hints. */
const drawnFrom = (c: DomainStoryContent): BoardItem[] => [FRAME, ...renderDomainStory(c, { scope: 'ds', now }).map((i) => (i.type === 'arrow' ? i : { ...i, parent: 'frame' }))] as unknown as BoardItem[]
const boardOf = (items: BoardItem[]): Record<string, BoardItem> => Object.fromEntries(items.map((i) => withoutHints(i)).map((i) => [i.id, i]))
const apply = (board: Record<string, BoardItem>, ops: TemplateOp[]) => applyOps({ id: 'b', title: 'b', kind: 'freeform', seq: 0, createdAt: now, updatedAt: now, items: board as never }, ops as Op[], 'agent').board.items as unknown as Record<string, BoardItem>
type B = { x: number; y: number; w: number; h: number }
const overlap = (a: B, b: B) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const added = (ops: TemplateOp[], id: string) => ops.find((o) => o.kind === 'add' && o.item?.id === id)?.item as (BoardItem & B) | undefined

test('a new drawing lands next to where the person put its neighbour — moved, or on a locked frame — and stays there', () => {
  const first = drawnFrom(calls())
  // ⑪ draws Lead again; a new ⑫ by CL1 (its work object goes next to CL1); a new note on the CRM, which nobody moved
  const forced = drawnFrom(calls({ dial: { drawAgain: 'lead' }, more: [{ id: 'book', actor: 'cl1', verb: 'books', object: 'demo' }], notes: [{ on: 'lead', text: 'A company that asked for a demo' }, { on: 'crm', text: 'The team’s one CRM' }] }))
  const cl1 = (items: BoardItem[]) => by(items, 'ds.actor.cl1') as BoardItem & B
  const offset = (id: string) => ({ x: (by(forced, id) as B).x - cl1(forced).x, y: (by(forced, id) as B).y - cl1(forced).y })
  const expect = offset('ds.actor.lead.2')
  const far = { x: 300, y: 3200 }
  for (const how of ['moved', 'locked'] as const) {
    let board = boardOf(first)
    board['ds.actor.cl1'] = { ...board['ds.actor.cl1'], ...far }
    if (how === 'locked') board.frame = { ...board.frame, data: { ...board.frame.data, lock: 'layout' } }
    const placed = new Set(how === 'moved' ? ['ds.actor.cl1'] : [])
    const { ops, plan } = explainRedraw(board, forced, { placed }, SCOPE)
    assert.ok(!JSON.stringify(ops).includes('"near"'), 'the hint is never written')
    const lead2 = added(ops, 'ds.actor.lead.2')!
    assert.deepEqual([lead2.x, lead2.y], [far.x + expect.x, far.y + expect.y], `${how}: next to CL1 where it is on the board`)
    assert.equal(lead2.data?.placedNear, 'ds.actor.cl1')
    assert.match(plan.added.find((l) => l.id === lead2.id)!.why!, how === 'moved' ? /placed next to "CL1", where you put it/ : /placed next to "CL1", where it is on the board/)
    // the work object of a new sentence follows its actor the same way; a note next to an item the file places stays as drawn
    const book = added(ops, 'ds.object.book')!
    assert.deepEqual([book.x - far.x, book.y - far.y], [offset('ds.object.book').x, offset('ds.object.book').y])
    const crmNote = added(ops, 'ds.note.note-crm')!
    if (how === 'moved') assert.deepEqual([crmNote.x, crmNote.y, crmNote.data?.placedNear], [(by(forced, crmNote.id) as B).x, (by(forced, crmNote.id) as B).y, undefined])
    board = apply(board, ops)
    for (const it of Object.values(board)) assert.equal(near(it), undefined, it.id)
    // a second redraw: no churn — nothing moves back, nothing is rewritten
    const again = explainRedraw(board, forced, { placed }, SCOPE)
    assert.deepEqual(again.ops, [], `${how}: ${JSON.stringify(again.plan.updated)}`)
  }
})

test('a new drawing that would land on something is moved aside to the nearest free spot', () => {
  const forced = drawnFrom(calls({ dial: { drawAgain: 'lead' } }))
  const board = boardOf(drawnFrom(calls()))
  board['ds.actor.cl1'] = { ...board['ds.actor.cl1'], x: 300, y: 3200 }
  const spot = { x: 300 + (by(forced, 'ds.actor.lead.2') as B).x - (by(forced, 'ds.actor.cl1') as B).x, y: 3200 + (by(forced, 'ds.actor.lead.2') as B).y - (by(forced, 'ds.actor.cl1') as B).y }
  board.sticky = { id: 'sticky', type: 'sticky', ...spot, w: 160, h: 110, parent: 'frame', text: 'the person’s sticky', createdBy: 'user' }
  const { ops, plan } = explainRedraw(board, forced, { placed: new Set(['ds.actor.cl1']) }, SCOPE)
  const lead2 = added(ops, 'ds.actor.lead.2')!
  assert.ok(!overlap(lead2, board.sticky as BoardItem & B), 'off the sticky')
  assert.ok(!overlap(lead2, board['ds.actor.cl1'] as BoardItem & B), 'off CL1')
  assert.ok(Math.hypot(lead2.x - spot.x, lead2.y - spot.y) < 400, 'near where it would have gone')
  assert.match(plan.added.find((l) => l.id === lead2.id)!.why!, /moved aside to a free spot/)
})

test('note ids are named after what they are on: a note inserted above moves no other note', () => {
  const notes = [{ on: 'lead', text: 'A company that asked for a demo' }, { on: 'cl1', text: 'First-line caller' }, { on: 'crm', text: 'The team’s one CRM' }]
  assert.deepEqual(normalizeDomainStory(calls({ notes })).annotations.map((n) => n.id), ['note-lead', 'note-cl1', 'note-crm'])
  const inserted = [{ on: 'Marketer', text: 'Buys the lists' }, ...notes, { on: 'lead', text: 'Often a reseller' }, { id: 'budget', on: 'lead', text: 'Has a budget' }]
  assert.deepEqual(normalizeDomainStory(calls({ notes: inserted })).annotations.map((n) => n.id), ['note-mkt', 'note-lead', 'note-cl1', 'note-crm', 'note-lead-2', 'budget'])
  // on the board: the person moved the three notes; after the insert each keeps its place
  const board = boardOf(drawnFrom(calls({ notes })))
  const ids = ['ds.note.note-lead', 'ds.note.note-cl1', 'ds.note.note-crm']
  ids.forEach((id, i) => (board[id] = { ...board[id], x: 100 + i * 400, y: 3600 }))
  const { ops } = explainRedraw(board, drawnFrom(calls({ notes: inserted })), { placed: new Set(ids) }, SCOPE)
  for (const op of ops.filter((o) => ids.includes(o.id ?? ''))) assert.ok(!('x' in (op.patch ?? {})) && !('y' in (op.patch ?? {})), op.id)
  assert.ok(!ops.some((o) => o.kind === 'remove' && ids.includes(o.id ?? '')))
})

test('a board drawn with numbered note ids: the first redraw carries each note’s place, presentation and threads over, and keeps them after', () => {
  const notes = [{ on: 'lead', text: 'A company that asked for a demo' }, { on: 'cl1', text: 'First-line caller' }, { on: 'crm', text: 'The team’s one CRM' }]
  // the old ids, as an earlier version numbered them
  const old = drawnFrom(calls({ notes: notes.map((n, i) => ({ ...n, id: `note-${i + 1}` })) }))
  let board = boardOf(old)
  const drawLog: LoggedChange = { author: 'agent', note: 'awd design draw: calls.domain-story.yaml', ops: Object.values(board).map((item) => ({ kind: 'add', item })) }
  const moves: LoggedChange = { author: 'user', ops: [{ kind: 'update', id: 'ds.note.note-1', patch: { x: 100, y: 3600 } }, { kind: 'update', id: 'ds.note.note-2', patch: { x: 600, y: 3600 } }] }
  board = apply(board, moves.ops)
  board['ds.note.note-3'] = { ...board['ds.note.note-3'], data: { ...board['ds.note.note-3'].data, lock: 'layout', lockedBy: 'person' }, x: 1100, y: 3600 }
  const link = Object.values(board).find((a) => a.type === 'arrow' && a.from === 'ds.note.note-2')!
  board[link.id] = { ...link, data: { ...link.data, bend: [{ x: 640, y: 3500 }] } }
  board.c1 = { id: 'c1', type: 'comment', target: 'ds.note.note-2', text: 'Is CL1 always first-line?', createdBy: 'user' }
  board.c2 = { id: 'c2', type: 'comment', target: 'c1', text: 'Yes', createdBy: 'agent' }
  // the file now: default ids, a note inserted on top, the CL1 note reworded
  const now2 = [{ on: 'Marketer', text: 'Buys the lists' }, notes[0], { on: 'cl1', text: 'The first-line caller' }, notes[2]]
  const drawn = drawnFrom(calls({ notes: now2 }))
  const changes = [drawLog, moves]
  const { ops, plan } = explainRedraw(board, drawn, redrawInputs(changes), SCOPE)
  const lead = added(ops, 'ds.note.note-lead')!
  const cl1 = added(ops, 'ds.note.note-cl1')!
  const crm = added(ops, 'ds.note.note-crm')!
  assert.deepEqual([lead.x, lead.y, lead.data?.renamedFrom], [100, 3600, 'ds.note.note-1'], 'same on, same text')
  assert.deepEqual([cl1.x, cl1.y, cl1.text, cl1.data?.renamedFrom], [600, 3600, 'The first-line caller', 'ds.note.note-2'], 'same on, the only one left')
  assert.deepEqual([crm.x, crm.y, crm.data?.lock], [1100, 3600, 'layout'], 'a locked note keeps its place and its lock')
  assert.ok(added(ops, 'ds.note.note-mkt'), 'the new note is added')
  assert.deepEqual(ops.filter((o) => o.kind === 'remove' && /note-\d/.test(o.id ?? '')).map((o) => o.id).sort(), ['ds.note.note-1', 'ds.note.note-2', 'ds.note.note-3'])
  assert.match(plan.removed.find((l) => l.id === 'ds.note.note-1')!.why!, /renamed: now ds\.note\.note-lead/)
  assert.match(plan.added.find((l) => l.id === 'ds.note.note-lead')!.why!, /replaces ds\.note\.note-1 .*keeps where you put it/)
  // the dashed line keeps its fold; the thread follows its note (the reply stays on its thread)
  const newLink = ops.find((o) => o.kind === 'add' && o.item?.type === 'arrow' && o.item.from === 'ds.note.note-cl1')!.item!
  assert.deepEqual(newLink.data?.bend, [{ x: 640, y: 3500 }])
  assert.deepEqual(ops.filter((o) => o.kind === 'update' && (o.id === 'c1' || o.id === 'c2')), [{ kind: 'update', id: 'c1', patch: { target: 'ds.note.note-cl1' } }])
  // after: the renamed notes count as placed (the log says the redraw's add took a placed note's place) — a later
  // redraw, here with the notes' text unchanged and the drawing moved, keeps them where they are
  board = apply(board, ops)
  const later = [...changes, { author: 'agent', note: 'awd design draw: calls.domain-story.yaml', ops }] as LoggedChange[]
  const inputs = redrawInputs(later)
  assert.ok(inputs.placed.has('ds.note.note-lead') && inputs.placed.has('ds.note.note-cl1'))
  assert.deepEqual([...foldRedrawInputs(foldRedrawInputs(emptyRedrawInputs(), later.slice(0, 2)), later.slice(2)).placed].sort(), [...inputs.placed].sort(), 'folded the same')
  const roomy = drawnFrom({ ...calls({ notes: now2 }), layout: { spacing: 'roomy' } })
  const second = explainRedraw(board, roomy, inputs, SCOPE)
  for (const id of ['ds.note.note-lead', 'ds.note.note-cl1', 'ds.note.note-crm']) {
    const op = second.ops.find((o) => o.id === id)
    assert.ok(!op || !('x' in (op.patch ?? {})), `${id} stays where the person put it`)
  }
  assert.ok(!second.ops.some((o) => o.kind === 'add' || o.kind === 'remove'), 'nothing renamed twice')
  assert.equal(explainRedraw(board, drawn, inputs, SCOPE).ops.length, 0, 'the same file again: nothing to do')
})

// ── through the canvas ──

let srv: RunningServer
before(async () => {
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-draw-again-')), webDist: '/nonexistent' })
})
after(() => srv.close())

const yaml = (c: DomainStoryContent) => JSON.stringify(c)

test('canvas: the hint never reaches the board — create, template ops, design_draw — and the drawing follows the moved CL1', async () => {
  const client = new CanvasClient(srv.url, { agentName: 'claude-a' })
  const created = await client.createBoard({ title: 'Made', kind: 'domain-story', content: calls() })
  const made = Object.values((await client.getBoard(created.id)).items)
  assert.ok(made.some((i) => i.data?.ds === 'actor') && !made.some((i) => near(i) !== undefined))
  const r = await drawDesignContent(client, 'calls.domain-story.yaml', yaml(calls()), 'title:Calls')
  const t = await client.template(r.boardId, 'domain-story', calls(), undefined, undefined, { key: r.key })
  assert.ok(t.items.some((i) => near(i) !== undefined), 'the served items carry it, for the redraw')
  assert.ok(!JSON.stringify(t.ops).includes('"near"'), 'the ops do not')
  // the person drags CL1 far away
  const b0 = await client.getBoard(r.boardId)
  const cl1 = Object.values(b0.items).find((i) => i.id.endsWith('.actor.cl1'))!
  await client.apply(r.boardId, [{ kind: 'update', id: cl1.id, patch: { x: cl1.x - 1200, y: cl1.y + 1400 } }], 'user')
  await drawDesignContent(client, 'calls.domain-story.yaml', yaml(calls({ dial: { drawAgain: 'lead' } })), 'title:Calls')
  const b1 = await client.getBoard(r.boardId)
  assert.ok(!Object.values(b1.items).some((i) => near(i) !== undefined), 'nothing on the board carries the hint')
  const lead2 = Object.values(b1.items).find((i) => i.id.endsWith('.actor.lead.2'))!
  const movedCl1 = b1.items[cl1.id]
  assert.ok(Math.hypot(lead2.x - movedCl1.x, lead2.y - movedCl1.y) < 700, `lead.2 (${lead2.x},${lead2.y}) next to CL1 (${movedCl1.x},${movedCl1.y})`)
  const p = await previewDesignContent(client, 'calls.domain-story.yaml', yaml(calls({ dial: { drawAgain: 'lead' } })), r.boardId)
  assert.deepEqual([p.plan!.added.length, p.plan!.updated.length, p.plan!.removed.length], [0, 0, 0], p.lines.join('\n'))
})
