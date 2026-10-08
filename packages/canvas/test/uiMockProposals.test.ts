// UI mock frames, second round (docs/diagrams.md §6c): lint findings on the drawn items, and removing,
// adding and editing table cells / list items as proposals whose diff keeps the rest of the file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { designFromObject, lintDesignContent, lintUiMock, uiMockSchema, withDesignFindings, type UiMockContent } from '../src/diagrams/index.js'
import { renderUiMock } from '../src/templates/index.js'
import { placeInFrame } from '../src/templates/frame.js'
import { applyOps, type Board, type Item } from '../src/model.js'
import { canEditValue, uiAddOps, uiPendingOf, uiProposalOf, uiRemoveOps, uiRemovedIds, uiTextOp, uiUndoOps, uiValueOp } from '../web/src/diagrams/uiProposal.js'
import { applyUiPending, insertUiNode, removeUiNode } from '../web/src/diagrams/uiProposalFile.js'
import { uiFindings, uiFindingsOf } from '../web/src/diagrams/uiFindings.js'
import { findingCount } from '../web/src/diagrams/findings.js'

const NOW = '2026-10-02T00:00:00.000Z'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const exampleText = fs.readFileSync(path.join(repo, 'design/unprose-board-list.ui.yaml'), 'utf8')

const mock: UiMockContent = {
  screens: [
    {
      id: 'home',
      name: 'Home',
      body: [
        {
          type: 'section',
          children: [
            { type: 'row', gap: 4, children: [{ type: 'heading', text: 'Hi' }], colour: 'red' } as never,
            { type: 'button', id: 'go', text: 'Go', goto: 'nowhere' },
            { type: 'table', id: 'orders', columns: ['Order', 'Total'], rows: [['A-1', 42], ['A-2', '[Paid]']] },
            { type: 'list', id: 'people', items: ['Ann', { text: 'Bob', meta: 'admin' }] },
            { type: 'card', id: 'box', text: 'Box', children: [{ type: 'text', id: 'inside', text: 'Inside' }] },
          ],
        },
      ],
    },
  ],
  flows: [{ from: 'home', to: 'gone' }],
}

function boardOf(content: UiMockContent): { board: Board; frame: Item } {
  const items = placeInFrame({}, { kind: 'ui-mock', key: 'm', source: 'design/m.ui.yaml' }, renderUiMock(content, { now: NOW, scope: 'm' }), NOW).items
  const board: Board = { id: 'b', title: 't', kind: 'freeform', seq: 1, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(items.map((i) => [i.id, i])) }
  const frame = items.find((i) => i.type === 'frame')!
  return { board, frame }
}
const apply = (board: Board, ops: Parameters<typeof applyOps>[1]) => applyOps(board, ops, 'user').board

test('lint findings: the drawing puts each on the element it is about; a layout node’s on what holds it; the rest on the first screen', () => {
  const { board, frame } = boardOf(mock)
  const go = board.items['m.ui.home.go']
  assert.match(uiFindingsOf(go).map((f) => f.message).join(), /goto: no screen "nowhere"/)
  // the unknown `colour` sits on a row (not drawn): the section that holds it shows it
  const section = Object.values(board.items).find((i) => i.role === 'section')!
  assert.match(uiFindingsOf(section)[0].message, /unknown field `colour` at screens\[0\]\.body\[0\]\.children\[0\]/)
  assert.match(uiFindingsOf(board.items['m.screen.home']).map((f) => f.message).join(), /flow to "gone"/)
  const all = uiFindings(board, frame.id)
  assert.equal(all.length, lintUiMock(mock).length, 'every finding of awd design lint is on the board')
  assert.equal(findingCount(board, frame, undefined, 'ui-mock'), all.length)
  assert.equal(findingCount(board, frame, undefined, 'kanban'), undefined)
  assert.equal(uiFindings(boardOf({ screens: [{ name: 'Clean', body: [{ type: 'text', text: 'ok' }] }] }).board, 'm').length, 0)
})

test('delete: a UI element becomes a removal proposal (kept, struck with what it holds); undo takes it back', () => {
  const { board } = boardOf(mock)
  const r = uiRemoveOps(board, ['m.ui.home.box', 'not-there'], NOW)
  assert.deepEqual(r.handled, ['m.ui.home.box'])
  const b2 = apply(board, r.ops)
  const box = b2.items['m.ui.home.box']
  assert.ok(box, 'the item stays on the board')
  assert.deepEqual(uiProposalOf(box), { kind: 'remove', before: { type: 'card', text: 'Box' }, path: ['screens', 0, 'body', 0, 'children', 4], by: 'user', at: NOW })
  assert.deepEqual([...uiRemovedIds(b2)].sort(), ['m.ui.home.box', 'm.ui.home.inside'])
  assert.deepEqual(uiRemoveOps(b2, ['m.ui.home.box'], NOW).ops, [], 'already proposed: nothing more')
  // an open text proposal is dropped first: the words go back to the file's
  const edited = apply(board, [uiTextOp(board.items['m.ui.home.go'], 'Start', NOW)])
  const gone = apply(edited, uiRemoveOps(edited, ['m.ui.home.go'], NOW).ops).items['m.ui.home.go']
  assert.equal(gone.text, 'Go')
  assert.equal(uiProposalOf(gone)?.kind, 'remove')
  // text edits do nothing while the removal is open
  assert.equal(apply(b2, [uiTextOp(box, 'Other', NOW)]).items['m.ui.home.box'].text, 'Box')
  const back = apply(b2, uiUndoOps(box)).items['m.ui.home.box']
  assert.equal(back.data?.pending, undefined)
})

test('add: a proposed element with a fresh explicit id, inside a container or after an element; its words are part of it', () => {
  const { board } = boardOf(mock)
  const box = board.items['m.ui.home.box']
  const r = uiAddOps(board, box, 'button', NOW)!
  assert.equal(r.id, 'm.ui.home.new-button')
  const b2 = apply(board, r.ops)
  const it = b2.items[r.id]
  assert.equal(it.parent, box.id)
  assert.ok(it.y >= box.y && it.x >= box.x, 'placed inside the card')
  assert.ok(b2.items[box.id].y + b2.items[box.id].h >= it.y + it.h, 'the card grows to hold it (the board keeps children inside)')
  assert.deepEqual(apply(b2, uiUndoOps(it)).items[box.id].h, box.h, 'undo gives the card its height back')
  const p = uiProposalOf(it)!
  assert.equal(p.kind, 'add')
  assert.deepEqual(p.kind === 'add' && [p.node, p.parent?.element], [{ type: 'button', id: 'new-button', text: 'New button' }, 'home/box'])
  assert.equal(uiAddOps(b2, box, 'button', NOW)!.id, 'm.ui.home.new-button-2', 'ids stay unique')
  const renamed = apply(b2, [uiTextOp(it, 'Save', NOW)]).items[r.id]
  assert.equal(renamed.text, 'Save')
  assert.equal((uiProposalOf(renamed) as { node: { text: string } }).node.text, 'Save')
  // after a leaf: same list, next place
  const after = uiAddOps(board, board.items['m.ui.home.go'], 'text', NOW)!
  const ap = uiProposalOf(apply(board, after.ops).items[after.id])
  assert.deepEqual(ap?.kind === 'add' && ap.after?.element, 'home/go')
  // deleting a proposed element is not a removal proposal: the caller deletes it; undo removes it too
  assert.deepEqual(uiRemoveOps(b2, [r.id], NOW).handled, [])
  assert.deepEqual(uiUndoOps(it)[0], { kind: 'remove', id: r.id })
})

test('cells and list items: a text proposal for exactly that value; one proposal per element at a time', () => {
  const { board } = boardOf(mock)
  const table = board.items['m.ui.home.orders']
  const op = uiValueOp(table, ['rows', 0, 1], '43', NOW)!
  const t2 = apply(board, [op]).items[table.id]
  assert.deepEqual((t2.data?.ui as { rows: unknown[][] }).rows[0], ['A-1', '43'])
  assert.deepEqual(uiPendingOf(t2), { kind: 'text', before: { text: '42' }, after: { text: '43' }, path: ['screens', 0, 'body', 0, 'children', 2], key: 'rows', sub: ['rows', 0, 1], by: 'user', at: NOW })
  assert.equal(canEditValue(t2, ['rows', 1, 0]), false, 'another cell waits until this one is applied or undone')
  assert.equal(uiValueOp(t2, ['rows', 1, 0], 'x', NOW), undefined)
  assert.equal(uiPendingOf(apply(board, [uiValueOp(t2, ['rows', 0, 1], '42', NOW)!]).items[table.id]), undefined, 'back to the file’s value')
  const undone = apply(board, uiUndoOps(t2)).items[table.id]
  assert.deepEqual((undone.data?.ui as { rows: unknown[][] }).rows[0], ['A-1', '42'])
  assert.equal(undone.data?.pending, undefined)
  const list = board.items['m.ui.home.people']
  const l2 = apply(board, [uiValueOp(list, ['items', 1], 'Rob', NOW)!]).items[list.id]
  assert.equal((l2.data?.ui as { items: Array<{ text: string; meta?: string }> }).items[1].text, 'Rob')
  assert.equal((l2.data?.ui as { items: Array<{ meta?: string }> }).items[1].meta, 'admin')
})

/** Lines of `a` that differ from `b`, when both have the same number of lines; else the line count change. */
const changedLines = (a: string, b: string) => {
  const x = a.split('\n')
  const y = b.split('\n')
  return x.filter((l) => !y.includes(l)).length + y.filter((l) => !x.includes(l)).length
}

test('the diff for a removal deletes exactly the element’s lines; comments and the rest stay', () => {
  const flow = applyUiPending(exampleText, { kind: 'remove', before: { type: 'text', text: '' }, path: [], by: 'user', at: NOW }, 'boards/subtitle')
  assert.equal(exampleText.split('\n').length - flow.split('\n').length, 1)
  assert.ok(!flow.includes('id: subtitle') && flow.startsWith('# A UI mock of the canvas home page'))
  const block = applyUiPending(exampleText, { kind: 'remove', before: { type: 'alert', text: '' }, path: [], by: 'user', at: NOW }, 'boards/ask-hint')
  assert.equal(exampleText.split('\n').length - block.split('\n').length, 6)
  assert.ok(!block.includes('ask-hint') && !block.includes('Should this hint go away'))
  assert.equal(YAML.parse(block).screens[0].body[1].children.length, YAML.parse(exampleText).screens[0].body[1].children.length - 1)
  // the last item of a list leaves `[]`, not an empty (null) value
  const one = 'screens:\n  - name: A # the only screen\n    body:\n      - type: card\n        children:\n          - { type: text, text: x }\n'
  const emptied = removeUiNode(one, ['screens', 0, 'body', 0, 'children', 0])
  assert.deepEqual(YAML.parse(emptied).screens[0].body[0].children, [])
  assert.ok(emptied.includes('# the only screen'))
  // a flow list
  assert.deepEqual(YAML.parse(removeUiNode('rows: [[a], [b], [c]]\n', ['rows', 1])).rows, [['a'], ['c']])
  // the element is found by its id, not by a place recorded before the file changed
  const stale = applyUiPending(exampleText, { kind: 'remove', before: { type: 'text', text: '' }, path: ['screens', 0, 'body', 0], by: 'user', at: NOW }, 'boards/subtitle')
  assert.equal(stale, flow)
})

test('the diff for a new element inserts one line in the right list; comments and the rest stay', () => {
  const into = applyUiPending(exampleText, { kind: 'add', node: { type: 'button', id: 'open', text: 'Open: now' }, parent: { element: 'boards/board-runner', path: [] }, path: [], by: 'user', at: NOW })
  assert.equal(changedLines(exampleText, into), 1)
  assert.ok(into.includes('                  - { type: button, id: open, text: "Open: now" }\n'))
  const after = applyUiPending(exampleText, { kind: 'add', node: { type: 'text', id: 'n', text: 'Note' }, after: { element: 'boards/title', path: [] }, path: [], by: 'user', at: NOW })
  const row = YAML.parse(after).screens[0].body[1].children[0].children
  assert.deepEqual(row.map((c: { id: string }) => c.id), ['title', 'n', 'new-board'])
  assert.equal(changedLines(exampleText, after), 1)
  // a container with no children yet: block style gets a `children:` list, flow style an inline one
  const t = 'screens:\n  - name: A\n    body:\n      - { type: card, text: C } # flow\n      - type: section\n        pad: 2 # pad\n'
  const flowCard = applyUiPending(t, { kind: 'add', node: { type: 'text', id: 'x', text: 'X' }, parent: { element: 'a/c', path: [] }, path: [], by: 'user', at: NOW })
  assert.ok(flowCard.includes('- { type: card, text: C, children: [{ type: text, id: x, text: X }] } # flow'))
  const blockSection = applyUiPending(t, { kind: 'add', node: { type: 'text', id: 'x', text: 'X' }, parent: { element: 'a/section', path: [] }, path: [], by: 'user', at: NOW })
  assert.deepEqual(YAML.parse(blockSection).screens[0].body[1].children, [{ type: 'text', id: 'x', text: 'X' }])
  assert.ok(blockSection.startsWith(t), 'appended below, nothing above changes')
  // a screen's body; an empty flow list
  assert.equal(YAML.parse(applyUiPending(t, { kind: 'add', node: { type: 'text', id: 'y', text: 'Y' }, parent: { element: 'a', path: [] }, path: [], by: 'user', at: NOW })).screens[0].body[2].id, 'y')
  assert.deepEqual(YAML.parse(insertUiNode('children: []\n', ['children'], '{ type: text, id: z, text: Z }')).children, [{ type: 'text', id: 'z', text: 'Z' }])
})

test('the diff for a cell or list item changes only that value', () => {
  const t = 'screens:\n  - name: A\n    body:\n      - type: table\n        columns: [A, B]\n        rows:\n          - [x, 42]   # first\n          - [y, "z"]\n      - type: list\n        items: [One, { text: Two, meta: m }]\n'
  const cell = applyUiPending(t, { kind: 'text', before: { text: '42' }, after: { text: '43' }, path: ['screens', 0, 'body', 0], key: 'rows', sub: ['rows', 0, 1], by: 'user', at: NOW }, 'a/table')
  assert.equal(cell, t.replace('[x, 42]', '[x, 43]'), 'a number stays a number; the comment stays')
  const str = applyUiPending(t, { kind: 'text', before: { text: 'z' }, after: { text: 'Paid #1' }, path: ['screens', 0, 'body', 0], key: 'rows', sub: ['rows', 1, 1], by: 'user', at: NOW }, 'a/table')
  assert.equal(YAML.parse(str).screens[0].body[0].rows[1][1], 'Paid #1')
  assert.equal(changedLines(t, str), 2)
  const plain = applyUiPending(t, { kind: 'text', before: { text: 'One' }, after: { text: 'Uno' }, path: ['screens', 0, 'body', 1], key: 'items', sub: ['items', 0], by: 'user', at: NOW }, 'a/list')
  assert.equal(plain, t.replace('[One,', '[Uno,'))
  const obj = applyUiPending(t, { kind: 'text', before: { text: 'Two' }, after: { text: 'Dos' }, path: ['screens', 0, 'body', 1], key: 'items', sub: ['items', 1], by: 'user', at: NOW }, 'a/list')
  assert.equal(obj, t.replace('text: Two', 'text: Dos'))
})

test('drawing from a file (CLI or remote design_draw): the findings of the file as written go on the drawn elements', () => {
  const d = designFromObject('shop.ui.yaml', { title: 'Shop', screens: [{ id: 's', name: 'S', body: [{ type: 'text', id: 't', text: 'x', colour: 'red' }] }] })
  assert.match(lintDesignContent(d).map((f) => `${f.element} ${f.message}`).join(), /s\/t unknown field `colour`/)
  // the server renders the parsed content, which has lost `colour`
  const served = renderUiMock(uiMockSchema.parse(d.content), { now: NOW, scope: d.key })
  assert.equal(uiFindingsOf(served.find((i) => i.id === `${d.key}.ui.s.t`)).length, 0)
  const drawn = withDesignFindings(d, served)
  assert.match(uiFindingsOf(drawn.find((i) => i.id === `${d.key}.ui.s.t`))[0].message, /unknown field `colour`/)
})

test('a table-cell edit lands in rows[r].cells[c] when the file wrote that row with a note, and in rows[r][c] otherwise', () => {
  const file = `screens:
  - id: home
    name: Home
    body:
      - type: table
        id: orders
        columns: [Order, Total]
        rows:
          - [A-1, 42]
          - cells: [A-2, 7]
            note: why seven?
`
  const plain = applyUiPending(file, { kind: 'text', before: { text: '42' }, after: { text: '43' }, path: ['screens', 0, 'body', 0], key: 'rows', sub: ['rows', 0, 1], by: 'user', at: NOW }, 'home/orders')
  assert.match(plain, /- \[A-1, 43\]/)
  const noted = applyUiPending(file, { kind: 'text', before: { text: '7' }, after: { text: '8' }, path: ['screens', 0, 'body', 0], key: 'rows', sub: ['rows', 1, 1], by: 'user', at: NOW }, 'home/orders')
  assert.match(noted, /cells: \[A-2, 8\]/)
  assert.match(noted, /note: why seven\?/)
})
