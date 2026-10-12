// The person's side of annotations (web/src/flow/annotationsView.ts, annotationDraft.ts, notesView.ts): which pins each item carries — one
// map per board change —, the person's draft (detected, drawn as a card, settled by the holder's "Applied to"), the
// draft built from an item and the board's copy of the file (its diff applies and adds exactly one entry), and the
// number a board-only annotation takes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import type { Board, Item } from '../src/model.js'
import { addAnnotationToFile } from '../src/annotationFile.js'
import { applyUnifiedDiff } from '../src/patch.js'
import { annotateHint, annotateWhere, besideItem, boardAnnotation, freeSpotBeside, draftHolder, draftStatus, hasAnnotations, marksByTarget, nextCallout, sameMarks } from '../web/src/flow/annotationsView.js'
import { annotationDraft, withBase } from '../web/src/flow/annotationDraft.js'
import { DECLINE_TEXT, isProposal, isSettled, notesShown } from '../web/src/flow/notesView.js'
import { boardToFlow, type ItemNode } from '../web/src/flow/boardToFlow.js'
import { sameNode } from '../web/src/flow/reuse.js'

const now = '2026-10-12T00:00:00.000Z'
const item = (id: string, patch: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 120, h: 80, text: id, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...patch })
const comment = (id: string, patch: Partial<Item> = {}) => item(id, { type: 'comment', w: 240, h: 40, ...patch })
const board = (items: Item[], meta?: Board['meta'], kind: Board['kind'] = 'freeform'): Board => ({ id: 'b', title: 'b', kind, seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])), ...(meta ? { meta } : {}) }) as Board

// an EventStorming frame drawn from design/a.es.yaml, held by codex-b, with two cards on 'paid' and one on 'placed'
const FILE = 'events:\n  - id: placed\n    text: Order placed\n  - id: paid\n    text: Order paid\n'
const frame = item('diagram.es', { type: 'frame', x: 0, y: 0, w: 800, h: 400, data: { diagram: { kind: 'event-storming', key: 'es', source: 'design/a.es.yaml' } } })
const paid = item('es.event.paid', { parent: 'diagram.es', x: 200, y: 40, data: { element: 'paid' } })
const placed = item('es.event.placed', { parent: 'diagram.es', x: 40, y: 40, data: { element: 'placed' } })
const card = (id: string, target: string, n: number, text = id) => comment(id, { role: 'note', color: 'yellow', target, text, data: { callout: n, annotation: { on: target } } })
const c2 = card('es.annotation.2', 'es.event.paid', 2, 'Only after the bank says yes')
const c1 = card('es.annotation.1', 'es.event.paid', 1, 'The money is ours')
const c3 = card('es.annotation.3', 'es.event.placed', 3)
const meta = { diagrams: { es: { kind: 'event-storming', source: 'design/a.es.yaml', files: { 'design/a.es.yaml': FILE }, holder: { agent: 'codex-b' } } } }
const es = board([frame, paid, placed, c2, c1, c3], meta)

// the person's draft on 'placed', and the holder's answers
const draft = comment('c_draft', { createdBy: 'user', target: 'es.event.placed', text: 'Shown at checkout', data: { annotation: { draft: true, on: 'placed', file: 'design/a.es.yaml' }, discuss: { about: ['es.event.placed'], edit: { file: 'design/a.es.yaml', base: 'x', diff: '@@' } } } })
const bare = comment('c_bare', { createdBy: 'user', target: 'es.event.placed', text: 'No diff with me', data: { annotation: { draft: true, on: 'placed' }, discuss: { about: ['es.event.placed'] } } })
const reply = comment('c_r1', { target: 'c_draft', text: 'Good idea — shall I add it?', data: { by: 'codex-b' } })
const applied = comment('applied.t1', { target: 'c_draft', text: 'Applied to design/a.es.yaml. Redrawn from the file.' })

test('marksByTarget: numbered pins by the card they stand for, in number order; only items with marks are in the map', () => {
  const m = marksByTarget(es, { annotations: 'all', todos: 'open' })
  assert.deepEqual(m.get('es.event.paid')?.pins, [
    { card: 'es.annotation.1', n: 1, text: 'The money is ours' },
    { card: 'es.annotation.2', n: 2, text: 'Only after the bank says yes' },
  ])
  assert.deepEqual(m.get('es.event.placed')?.pins.map((p) => p.n), [3])
  assert.ok(!m.has('diagram.es'), 'the frame carries nothing')
  assert.equal(marksByTarget(es, { annotations: 'pins', todos: 'open' }).get('es.event.paid')?.pins.length, 2, 'pins mode keeps the pins')
  assert.equal(marksByTarget(es, { annotations: 'none', todos: 'open' }).size, 0, 'none: no pin')
})

test('marksByTarget: a draft is a ✎ pin after the numbers until it is settled; a UI element’s pins are listed (for their tooltips)', () => {
  const open = board([frame, paid, placed, c3, draft, reply], meta)
  assert.deepEqual(marksByTarget(open, { annotations: 'all', todos: 'open' }).get('es.event.placed')?.pins, [
    { card: 'es.annotation.3', n: 3, text: 'es.annotation.3' },
    { card: 'c_draft', text: 'Shown at checkout', draft: true },
  ])
  const done = board([frame, paid, placed, c3, draft, reply, applied], meta)
  assert.deepEqual(marksByTarget(done, { annotations: 'all', todos: 'open' }).get('es.event.placed')?.pins.map((p) => p.card), ['es.annotation.3'], 'applied: the card from the file replaces it')
  const ui = board([item('ui1', { type: 'ui', data: { ui: { type: 'button', callout: 1 } } }), card('n1', 'ui1', 1, 'Primary action')])
  assert.deepEqual(marksByTarget(ui, { annotations: 'all', todos: 'open' }).get('ui1')?.pins, [{ card: 'n1', n: 1, text: 'Primary action' }])
})

test('marksByTarget: TODO squares follow the TODOs switch; cards about a comment or a wire put nothing anywhere', () => {
  const todoOpen = comment('c_t1', { createdBy: 'user', target: 'es.event.paid', text: 'Refund limit?', data: { todo: { state: 'open', ask: 'PM' } } })
  const todoDone = comment('c_t2', { createdBy: 'user', target: 'es.event.paid', text: 'Currency?', data: { todo: { state: 'done', answer: 'EUR' } } })
  const wire = item('a1', { type: 'arrow', from: 'es.event.placed', to: 'es.event.paid' })
  const b = board([frame, paid, placed, todoOpen, todoDone, wire, card('n9', 'a1', 9), comment('c_x'), card('n8', 'c_x', 8)], meta)
  assert.deepEqual(marksByTarget(b, { annotations: 'all', todos: 'open' }).get('es.event.paid')?.todos, [{ card: 'c_t1', text: 'Refund limit?', done: false, ask: 'PM' }])
  assert.deepEqual(marksByTarget(b, { annotations: 'all', todos: 'all' }).get('es.event.paid')?.todos.map((t) => [t.card, t.done]), [['c_t1', false], ['c_t2', true]], 'open ones first')
  assert.ok(!marksByTarget(b, { annotations: 'all', todos: 'none' }).has('es.event.paid'))
  assert.ok(![...marksByTarget(b, { annotations: 'all', todos: 'all' }).keys()].some((k) => k === 'a1' || k === 'c_x'))
})

test('sameMarks: the same pins and squares say the same, whatever the objects; a changed text or number does not', () => {
  const a = marksByTarget(es, { annotations: 'all', todos: 'open' }).get('es.event.paid')
  const b = marksByTarget(es, { annotations: 'all', todos: 'open' }).get('es.event.paid')
  assert.notEqual(a, b)
  assert.ok(sameMarks(a, b))
  assert.ok(sameMarks(undefined, undefined))
  assert.ok(!sameMarks(a, undefined))
  assert.ok(!sameMarks(a, { ...b!, pins: [b!.pins[0], { ...b!.pins[1], text: 'changed' }] }))
  assert.ok(!sameMarks(a, { ...b!, todos: [{ card: 't', text: 't', done: false }] }))
})

test('boardToFlow: marks ride on the node they are on; a node whose marks say the same is kept (sameNode)', () => {
  const marks = marksByTarget(es, { annotations: 'all', todos: 'open' })
  const shown = notesShown(es, { mode: 'all', open: new Set(), expanded: new Set() })
  const flow = boardToFlow(es, new Set(), shown, undefined, marks)
  const node = (f: { nodes: ItemNode[] }, id: string) => f.nodes.find((n) => n.id === id)!
  assert.equal(node(flow, 'es.event.paid').data.marks?.pins.length, 2)
  assert.equal(node(flow, 'diagram.es').data.marks, undefined)
  const again = boardToFlow(es, new Set(), shown, undefined, marksByTarget(es, { annotations: 'all', todos: 'open' }))
  assert.ok(sameNode(node(flow, 'es.event.paid'), node(again, 'es.event.paid')))
  const fewer = boardToFlow(es, new Set(), shown, undefined, marksByTarget(es, { annotations: 'none', todos: 'open' }))
  assert.ok(!sameNode(node(flow, 'es.event.paid'), node(fewer, 'es.event.paid')))
})

test('isProposal / isSettled: a draft is a proposal with or without the edit; applied by the holder or declined, it is settled', () => {
  assert.ok(isProposal(draft))
  assert.ok(isProposal(bare), 'no discuss.edit: still for the holder')
  assert.ok(!isSettled([draft, reply]))
  assert.ok(isSettled([draft, reply, applied]))
  assert.ok(isSettled([bare, comment('c_no', { target: 'c_bare', createdBy: 'user', text: DECLINE_TEXT })]))
})

test('notesShown: a draft is its card in Annotations: all, its thread once opened, hidden once settled, in pins and in none', () => {
  const b = board([frame, paid, placed, draft, reply], meta)
  const view = (annotations: 'all' | 'pins' | 'none', o: { open?: string[]; expanded?: string[] } = {}, on = b) => notesShown(on, { mode: 'all', annotations, open: new Set(o.open ?? []), expanded: new Set(o.expanded ?? []) }).get('c_draft')
  assert.equal(view('all'), 'badge', 'the draft card')
  assert.equal(view('all', { open: ['c_draft'] }), 'open', 'its thread')
  assert.equal(view('pins'), 'hidden')
  assert.equal(view('pins', { open: ['c_draft'] }), 'hidden', 'the stored open set does not draw it in pins')
  assert.equal(view('pins', { expanded: ['c_draft'] }), 'open', 'its ✎ opened the thread')
  assert.equal(view('none'), 'hidden')
  assert.equal(notesShown(b, { mode: 'none', annotations: 'all', open: new Set(), expanded: new Set() }).get('c_draft'), 'badge', 'Comments: none leaves drafts alone')
  const settled = board([frame, paid, placed, draft, reply, applied], meta)
  assert.equal(view('all', {}, settled), 'hidden', 'the card from the file replaces it')
  assert.equal(view('all', { open: ['c_draft'] }, settled), 'hidden', 'an old open does not keep it')
  assert.equal(view('all', { expanded: ['c_draft'] }, settled), 'open', 'opened from the Chats tab in this session')
})

test('boardToFlow: a folded draft is drawn as its card (its width), with no tether; an annotation card has none either', () => {
  const b = board([frame, paid, placed, c3, draft], meta)
  const flow = boardToFlow(b, new Set(), notesShown(b, { mode: 'all', open: new Set(), expanded: new Set() }))
  const d = flow.nodes.find((n) => n.id === 'c_draft')!
  assert.equal(d.width, 240)
  assert.equal(d.height, undefined, 'measured: as tall as its text')
  assert.ok(!flow.edges.some((e) => e.id === 'tether:c_draft' || e.id === 'tether:es.annotation.3'))
})

test('nextCallout: one more than the highest in the diagram frame; the board is the scope of a loose item', () => {
  assert.equal(nextCallout(es, paid), 4)
  const loose = item('s_loose', { x: 1000 })
  const b = board([frame, paid, c1, loose, card('n7', 's_loose', 7), item('s2', { x: 1200 })], meta)
  assert.equal(nextCallout(b, paid), 2, 'the loose card is in the board’s scope')
  assert.equal(nextCallout(b, b.items.s2), 8)
  assert.equal(nextCallout(board([loose]), loose), 1)
})

test('boardAnnotation: the card a template draws, with data.annotation.board, the next number, right of the item', () => {
  const loose = item('s_loose', { x: 1000, y: 100, w: 120 })
  const b = board([loose, card('n1', 's_loose', 1)])
  const a = boardAnnotation(b, loose, 'Why it is here', { id: 'c_new', now })
  assert.equal(a.type, 'comment')
  assert.equal(a.role, 'note')
  assert.equal(a.target, 's_loose')
  assert.equal(a.text, 'Why it is here')
  assert.deepEqual(a.data, { callout: 2, annotation: { board: true } })
  assert.equal(a.createdBy, 'user')
  assert.ok(a.x >= loose.x + loose.w, 'right of the item')
  assert.ok(a.w > 0 && a.h > 0)
})

test('besideItem: below what is already right of the item; a UI element’s card goes right of its screen', () => {
  const s = item('s1', { x: 0, y: 0, w: 100, h: 80 })
  const first = comment('c1', { target: 's1', x: 124, y: 0, h: 40 })
  assert.deepEqual(besideItem(board([s]), s), { x: 124, y: 0 })
  assert.deepEqual(besideItem(board([s, first]), s), { x: 124, y: 48 })
  const screen = item('scr', { type: 'ui', x: 0, y: 0, w: 400, h: 600, data: { ui: { type: 'screen', container: true } } })
  const btn = item('btn', { type: 'ui', parent: 'scr', x: 40, y: 300, w: 80, h: 30, data: { ui: { type: 'button' } } })
  assert.deepEqual(besideItem(board([screen, btn]), btn), { x: 424, y: 300 })
  // in a diagram frame: beside the item for a TODO, right of the frame for an annotation (gutter)
  assert.deepEqual(besideItem(es, paid), { x: 344, y: 40 })
  assert.deepEqual(besideItem(es, paid, { w: 240, h: 64 }, true), { x: 824, y: 40 })
  const taken = board([frame, paid, comment('c_g', { x: 824, y: 20, h: 60 })], meta)
  assert.deepEqual(besideItem(taken, paid, { w: 240, h: 64 }, true), { x: 824, y: 88 }, 'below what is in the gutter there')
  const gap = board([frame, paid, comment('c_g', { x: 824, y: 200, h: 60 })], meta)
  assert.deepEqual(besideItem(gap, paid, { w: 240, h: 64 }, true), { x: 824, y: 40 }, 'room above the next card')
})

test('annotateWhere: a diagram drawn from a file → a draft (its element, the holder, the file text); anything else → the board', () => {
  const w = annotateWhere(es, paid)
  assert.deepEqual(w, { kind: 'draft', key: 'es', file: 'design/a.es.yaml', on: 'paid', holder: 'codex-b', text: FILE })
  assert.deepEqual(annotateWhere(board([item('s1')]), item('s1')), { kind: 'board' }, 'freeform, no frame')
  const plainFrame = item('diagram.k', { type: 'frame', data: { diagram: { kind: 'kanban', key: 'k' } } })
  assert.deepEqual(annotateWhere(board([plainFrame, item('k.card.a', { parent: 'diagram.k' })]), item('k.card.a', { parent: 'diagram.k' })), { kind: 'board' }, 'a diagram with no file and no holder')
  const noId = item('es.hotspot.h1', { parent: 'diagram.es' })
  assert.equal((annotateWhere(board([frame, noId], meta), noId) as { on: string }).on, 'hotspot.h1', 'no element: its id inside the diagram')
  assert.match(annotateHint(w), /draft for codex-b: they add it to design\/a\.es\.yaml/)
  assert.match(annotateHint({ kind: 'board' }), /on the board/)
})

test('annotationDraft: data.annotation + discuss.edit whose diff applies to the board’s file and adds exactly the entry', () => {
  const plan = annotationDraft(es, paid, '  Only after the bank confirms: never before  ')!
  assert.deepEqual(plan.data.annotation, { draft: true, on: 'paid', file: 'design/a.es.yaml' })
  assert.equal(plan.baseText, FILE)
  assert.equal(plan.holder, 'codex-b')
  assert.equal(plan.why, undefined)
  const discuss = plan.data.discuss as { about: string[]; edit: { file: string; base: string; diff: string } }
  assert.deepEqual(discuss.about, ['es.event.paid'])
  assert.equal(discuss.edit.file, 'design/a.es.yaml')
  const r = applyUnifiedDiff(FILE, discuss.edit.diff)
  assert.ok(r.ok, r.ok ? '' : r.error)
  assert.equal(r.ok && r.text, addAnnotationToFile(FILE, { on: 'paid', text: 'Only after the bank confirms: never before' }))
  assert.deepEqual((parse(r.ok ? r.text : '') as { annotations: unknown[] }).annotations, [{ on: 'paid', text: 'Only after the bank confirms: never before' }])
  const based = withBase(plan, 'abc123') as { discuss: { edit: { base: string; diff: string } } }
  assert.equal(based.discuss.edit.base, 'abc123')
  assert.equal(based.discuss.edit.diff, discuss.edit.diff)
})

test('annotationDraft: no usable file → still a draft for the holder, without the edit, saying why; no file behind it → undefined', () => {
  const noCopy = annotationDraft(board([frame, paid], { diagrams: { es: { source: 'design/a.es.yaml', holder: { agent: 'codex-b' } } } }), paid, 'x')!
  assert.deepEqual(noCopy.data, { annotation: { draft: true, on: 'paid', file: 'design/a.es.yaml' }, discuss: { about: ['es.event.paid'] } })
  assert.match(noCopy.why!, /no copy of design\/a\.es\.yaml/)
  assert.equal(noCopy.baseText, undefined)
  assert.equal(withBase(noCopy, 'abc'), noCopy.data, 'nothing to stamp')
  const cut = annotationDraft(board([frame, paid], { ...meta, workflow: { truncated: ['design/a.es.yaml'] } }), paid, 'x')!
  assert.match(cut.why!, /cut short/)
  const broken = annotationDraft(board([frame, paid], { diagrams: { es: { source: 'design/a.es.yaml', files: { 'design/a.es.yaml': '- not\n- a map\n' }, holder: { agent: 'codex-b' } } } }), paid, 'x')!
  assert.match(broken.why!, /could not take the entry/)
  assert.equal((broken.data.discuss as { edit?: unknown }).edit, undefined)
  assert.equal(annotationDraft(board([item('s1')]), item('s1'), 'x'), undefined)
})

test('draftHolder / draftStatus: the holder of the draft’s file; waiting for it, or that it replied', () => {
  const b = board([frame, paid, placed, draft], meta)
  assert.equal(draftHolder(b, draft), 'codex-b')
  assert.equal(draftHolder(board([frame, paid, placed, bare], meta), bare), 'codex-b', 'no file named: the diagram’s holder')
  assert.equal(draftStatus([], 'codex-b'), 'Draft · waiting for codex-b')
  assert.equal(draftStatus([], 'agent'), 'Draft · waiting for studio')
  assert.equal(draftStatus([], undefined), 'Draft · waiting for the holder of the files')
  assert.equal(draftStatus([reply], 'codex-b'), 'codex-b replied · 1 reply')
  assert.equal(draftStatus([comment('c_me', { createdBy: 'user' })], 'codex-b'), 'Draft · waiting for codex-b · 1 reply')
})

test('hasAnnotations: a card or a draft; a plain comment is not', () => {
  assert.ok(hasAnnotations(es))
  assert.ok(hasAnnotations(board([placed, bare])))
  assert.ok(!hasAnnotations(board([placed, comment('c_x', { target: 'es.event.placed' })])))
})

test('freeSpotBeside: a TODO never lands on the next sticky — right when free, else below', () => {
  const at = (id: string, x: number, y = 0): Item => ({ id, type: 'sticky', x, y, w: 200, h: 140, text: id, createdBy: 'agent', updatedBy: 'agent', updatedAt: '2026-10-12T00:00:00.000Z' })
  const placed = at('placed', 0)
  const lone = freeSpotBeside(board([placed]), placed, { w: 220, h: 50 })
  assert.ok(lone.x >= 200 && lone.y === 0, `right of it: ${JSON.stringify(lone)}`)
  const row = board([placed, at('paid', 240), at('shipped', 480)])
  const spot = freeSpotBeside(row, placed, { w: 220, h: 50 })
  for (const s of [row.items.paid, row.items.shipped, placed]) assert.ok(!(spot.x < s.x + s.w && s.x < spot.x + 220 && spot.y < s.y + s.h && s.y < spot.y + 50), `covers ${s.id}: ${JSON.stringify(spot)}`)
})
