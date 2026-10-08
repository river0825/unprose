// The notes view (web/src/flow/notesView.ts): which comments are drawn, and how, under all / badges / none; a
// proposal thread that was applied (or declined) folds into a ✓ by itself; a UI mock's callouts (numbered pins and their cards).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { DECLINE_TEXT, calloutCommentOf, hasComments, isApplied, isDeclined, isProposal, isSettled, itemCallout, itemNote, litCallouts, notesShown, rowCallout, rowNote, uiCalloutOf, NOTES_MODES } from '../web/src/flow/notesView.js'
import { boardToFlow } from '../web/src/flow/boardToFlow.js'

const now = '2026-10-08T00:00:00.000Z'
const item = (id: string, patch: Partial<Item> = {}): Item => ({ id, type: 'comment', x: 0, y: 0, w: 160, h: 64, text: id, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...patch })
const board = (...items: Item[]): Board => ({ id: 'b', title: 'b', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) } as Board)

const sticky = item('s1', { type: 'sticky' })
// a proposal applied by the holder: prop_ root, the person's yes, the applied.<t> answer
const applied = [item('prop_a', { target: 's1', data: { discuss: { edit: { file: 'x.yaml', diff: '@@' } } } }), item('c_yes', { target: 'prop_a', createdBy: 'user', text: 'Yes — apply this edit.' }), item('applied.m1', { target: 'prop_a', text: 'Applied to x.yaml. Redrawn from the file.' })]
// a proposal declined by the person
const declined = [item('prop_d', { target: 's1', data: { discuss: { edit: { file: 'x.yaml', diff: '@@' } } } }), item('c_no', { target: 'prop_d', createdBy: 'user', text: DECLINE_TEXT })]
// a proposal still open
const open = [item('prop_o', { target: 's1', data: { discuss: { edit: { file: 'x.yaml', diff: '@@' } } } })]
// a plain thread, and a loose comment with no target
const plain = [item('c_p', { target: 's1', createdBy: 'user' }), item('c_r', { target: 'c_p' })]
const loose = item('c_loose', { createdBy: 'user' })
const all = board(sticky, ...applied, ...declined, ...open, ...plain, loose)

test('isProposal: a prop_ id or data.discuss.edit; a plain comment or a sticky is not', () => {
  assert.ok(isProposal(item('prop_x')))
  assert.ok(isProposal(item('c_x', { data: { discuss: { edit: { file: 'a', diff: '@@' } } } })))
  assert.ok(!isProposal(item('c_x', { data: { discuss: { model: 'sonnet' } } })))
  assert.ok(!isProposal(item('c_x')))
  assert.ok(!isProposal(item('prop_s', { type: 'sticky' })))
})

test('isApplied: a reply with an applied. id or text starting "Applied to "; never the root itself', () => {
  assert.ok(isApplied(applied))
  assert.ok(isApplied([item('prop_a'), item('c_1', { text: '  Applied to design/x.yaml — committed abc' })]))
  assert.ok(!isApplied([item('applied.root', { text: 'Applied to x' })]), 'the root does not count')
  assert.ok(!isApplied(open))
  assert.ok(!isApplied([item('prop_a'), item('c_1', { text: 'Not applied to anything' })]))
})

test('isDeclined: the Decline button’s reply from the person; an agent saying the same words does not decline', () => {
  assert.ok(isDeclined(declined))
  assert.ok(!isDeclined([item('prop_d'), item('c_no', { target: 'prop_d', text: DECLINE_TEXT })]), 'agent reply')
  assert.ok(!isDeclined(open))
})

test('isSettled: a proposal that was applied or declined; an open proposal or an applied plain thread is not', () => {
  assert.ok(isSettled(applied))
  assert.ok(isSettled(declined))
  assert.ok(!isSettled(open))
  assert.ok(!isSettled([item('c_p', { createdBy: 'user' }), item('applied.x', { text: 'Applied to x' })]), 'not a proposal')
})

const none = new Set<string>()
const shown = (mode: (typeof NOTES_MODES)[number], o: { open?: string[]; expanded?: string[]; editing?: string | null } = {}) => notesShown(all, { mode, open: new Set(o.open ?? []), expanded: new Set(o.expanded ?? []), editing: o.editing })

test('all: open threads open, the rest badges, settled proposals done — by root id only', () => {
  const m = shown('all', { open: ['c_p'] })
  assert.deepEqual([...m.keys()].sort(), ['c_loose', 'c_p', 'prop_a', 'prop_d', 'prop_o'], 'one entry per thread root')
  assert.equal(m.get('c_p'), 'open')
  assert.equal(m.get('c_loose'), 'badge')
  assert.equal(m.get('prop_o'), 'badge')
  assert.equal(m.get('prop_a'), 'done')
  assert.equal(m.get('prop_d'), 'done')
})

test('all: a settled proposal the viewer expanded is open; the stored open set alone does not open it', () => {
  assert.equal(shown('all', { open: ['prop_a'] }).get('prop_a'), 'done', 'an old stored "open" does not keep a finished thread open')
  assert.equal(shown('all', { expanded: ['prop_a'] }).get('prop_a'), 'open')
})

test('badges: every thread a marker whatever the stored set; an expanded one opens; settled stays ✓', () => {
  const m = shown('badges', { open: ['c_p', 'prop_o'] })
  assert.equal(m.get('c_p'), 'badge')
  assert.equal(m.get('prop_o'), 'badge')
  assert.equal(m.get('c_loose'), 'badge', 'a comment with no target keeps a marker')
  assert.equal(m.get('prop_a'), 'done')
  assert.equal(shown('badges', { expanded: ['c_p'] }).get('c_p'), 'open')
})

test('none: every thread hidden, whatever the stored set; one opened in this session stays until folded', () => {
  const m = shown('none', { open: ['c_p'] })
  assert.ok([...m.values()].every((v) => v === 'hidden'))
  const n = shown('none', { open: ['c_p'], expanded: ['prop_a'] })
  assert.equal(n.get('prop_a'), 'open')
  assert.equal(n.get('c_p'), 'hidden')
})

test('a thread being edited (root or reply) is open in every mode', () => {
  for (const mode of NOTES_MODES) {
    assert.equal(shown(mode, { editing: 'c_r' }).get('c_p'), 'open', `${mode}: reply edited`)
    assert.equal(shown(mode, { editing: 'prop_a' }).get('prop_a'), 'open', `${mode}: settled root edited`)
  }
})

test('boardToFlow: a hidden thread has no node and no tether; done rides on the node; a Set still means open ids', () => {
  const map = shown('all', { open: ['c_p'] })
  const flow = boardToFlow(all, none, map)
  const node = (id: string) => flow.nodes.find((n) => n.id === id)
  assert.ok(node('c_p')?.data.open)
  assert.equal(node('prop_a')?.data.open, false)
  assert.equal(node('prop_a')?.data.done, true)
  assert.equal(node('c_loose')?.data.done, undefined)
  assert.ok(flow.edges.some((e) => e.id === 'tether:prop_a'), 'a ✓ keeps its tether')
  const hidden = boardToFlow(all, none, shown('none'))
  assert.ok(!hidden.nodes.some((n) => n.type === 'comment'))
  assert.ok(!hidden.edges.some((e) => e.id.startsWith('tether:')))
  assert.ok(hidden.nodes.some((n) => n.id === 's1'), 'the rest of the board is drawn')
  const legacy = boardToFlow(all, none, new Set(['c_p']))
  assert.ok(legacy.nodes.find((n) => n.id === 'c_p')?.data.open)
  assert.equal(legacy.nodes.find((n) => n.id === 'prop_a')?.data.open, false)
  assert.equal(legacy.nodes.find((n) => n.id === 'prop_a')?.data.done, undefined, 'the older form folds nothing by itself')
})

test('hasComments: the switch is worth showing only when there is a comment', () => {
  assert.ok(hasComments(all))
  assert.ok(!hasComments(board(sticky)))
})

test('itemNote / rowNote: a non-empty string note, keyed by index (rows by the index as a string)', () => {
  const items = [{ text: 'a' }, { text: 'b', note: 'why b' }, { text: 'c', note: '  ' }, { text: 'd', note: 42 }]
  assert.equal(itemNote(items, 0), undefined)
  assert.equal(itemNote(items, 1), 'why b')
  assert.equal(itemNote(items, 2), undefined, 'blank')
  assert.equal(itemNote(items, 3), undefined, 'not a string')
  assert.equal(itemNote(undefined, 1), undefined)
  const ui = { rowNotes: { '0': 'first row', '2': '' } }
  assert.equal(rowNote(ui, 0), 'first row')
  assert.equal(rowNote(ui, 1), undefined)
  assert.equal(rowNote(ui, 2), undefined)
  assert.equal(rowNote({}, 0), undefined)
})

test('itemCallout / rowCallout: a positive whole number, keyed by index (rows by the index as a string)', () => {
  const items = [{ text: 'a' }, { text: 'b', callout: 2 }, { text: 'c', callout: 0 }, { text: 'd', callout: '3' }]
  assert.deepEqual([0, 1, 2, 3].map((i) => itemCallout(items, i)), [undefined, 2, undefined, undefined])
  assert.equal(itemCallout(undefined, 0), undefined)
  assert.equal(rowCallout({ rowCallouts: { '1': 4 } }, 1), 4)
  assert.equal(rowCallout({ rowCallouts: { '1': 4 } }, 0), undefined)
  assert.equal(rowCallout({}, 0), undefined)
})

// a UI mock's callouts: a card about an element, one about an entry, one about a row; the screen's own note is a thread
const el = item('ui1', { type: 'ui' })
const c1 = item('n1', { role: 'note', target: 'ui1', data: { callout: 1 } })
const c2 = item('n2', { role: 'note', target: 'ui1', data: { item: 1, callout: 2 } })
const c3 = item('n3', { role: 'note', target: 'ui2', data: { row: 0, callout: 1 } })
const screenNote = item('n0', { role: 'note', target: 'screen' })
const mock = board(el, item('ui2', { type: 'ui' }), item('screen', { type: 'ui', role: 'screen' }), c1, c2, c3, screenNote, item('c_q', { target: 'ui1', createdBy: 'user' }))

test('uiCalloutOf: a note comment with a positive data.callout; the screen note, a person’s comment, a non-comment are not', () => {
  assert.deepEqual([c1, c2, c3].map(uiCalloutOf), [1, 2, 1])
  assert.equal(uiCalloutOf(screenNote), undefined)
  assert.equal(uiCalloutOf(item('x', { data: { callout: 1 } })), undefined, 'not role note')
  assert.equal(uiCalloutOf(item('x', { type: 'sticky', role: 'note', data: { callout: 1 } })), undefined)
  assert.equal(uiCalloutOf(item('x', { role: 'note', data: { callout: 1.5 } })), undefined)
  assert.equal(uiCalloutOf(undefined), undefined)
})

test('calloutCommentOf: the card with that number about that element', () => {
  assert.equal(calloutCommentOf(mock, 'ui1', 1)?.id, 'n1')
  assert.equal(calloutCommentOf(mock, 'ui1', 2)?.id, 'n2')
  assert.equal(calloutCommentOf(mock, 'ui2', 1)?.id, 'n3')
  assert.equal(calloutCommentOf(mock, 'ui1', 3), undefined)
  assert.equal(calloutCommentOf(mock, 'screen', 1), undefined)
})

test('litCallouts: the pins of the callout cards among the ids, by element; nothing else, the same empty map', () => {
  assert.deepEqual([...litCallouts(mock, ['n2', 'c_q', 'ui1', 'gone'])], [['ui1', 2]])
  assert.deepEqual([...litCallouts(mock, ['n3', 'n1'])].sort(), [['ui1', 1], ['ui2', 1]])
  assert.equal(litCallouts(mock, []), litCallouts(undefined, ['n1']))
  assert.equal(litCallouts(mock, ['c_q']), litCallouts(mock, []), 'no new map for a plain comment')
})

test('notesShown: a callout card is drawn in all, in badges only once its pin opened it, never in none; threads as before', () => {
  const view = (mode: (typeof NOTES_MODES)[number], expanded: string[] = [], open: string[] = []) => notesShown(mock, { mode, open: new Set(open), expanded: new Set(expanded) })
  assert.deepEqual(['n1', 'n2', 'n3'].map((id) => view('all').get(id)), ['open', 'open', 'open'])
  assert.equal(view('all').get('n0'), 'badge', 'the screen note is a thread, folded until opened')
  assert.equal(view('all').get('c_q'), 'badge')
  assert.deepEqual(['n1', 'n2'].map((id) => view('badges').get(id)), ['hidden', 'hidden'])
  assert.equal(view('badges', ['n2']).get('n2'), 'open')
  assert.equal(view('badges').get('c_q'), 'badge')
  assert.deepEqual(['n1', 'n2', 'n3'].map((id) => view('none', ['n1']).get(id)), ['hidden', 'hidden', 'hidden'])
  assert.equal(view('all', [], ['n0']).get('n0'), 'open')
})

test('boardToFlow: a callout card has no tether (its number is on what it explains); other notes keep theirs', () => {
  const flow = boardToFlow(mock, none, notesShown(mock, { mode: 'all', open: new Set(), expanded: new Set() }))
  assert.ok(flow.nodes.some((n) => n.id === 'n1'))
  assert.ok(!flow.edges.some((e) => e.id === 'tether:n1' || e.id === 'tether:n2' || e.id === 'tether:n3'))
  assert.ok(flow.edges.some((e) => e.id === 'tether:n0'))
  assert.ok(flow.edges.some((e) => e.id === 'tether:c_q'))
})
