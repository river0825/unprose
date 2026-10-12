// UI mock frames (docs/diagrams.md §6c): schema and ids, layout, rendering, lint checks, and the text proposal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { checkUiMock, layoutScreen, normalizeUiMock, unknownContentFields, walkUi, uiCalloutOf, uiCalloutSize, uiGutterOf, UI_CALLOUT, UI_GUTTER, type UiMockContent } from '../src/diagrams/index.js'
import { contentSchemas, render, renderUiMock } from '../src/templates/index.js'
import { readingOrder } from '../src/templates/ui-mock.js'
import { autoPlaceComments } from '../src/place.js'
import { wrap } from '../src/textMetrics.js'
import { placeInFrame, resolveTraces } from '../src/templates/frame.js'
import { applyOps, type Board, type Item } from '../src/model.js'
import { isUiElement, uiPendingOf, uiTextOp, uiUndoOps } from '../web/src/diagrams/uiProposal.js'
import { applyUiText, yamlScalar } from '../web/src/diagrams/uiProposalFile.js'

const NOW = '2026-10-01T00:00:00.000Z'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const exampleText = fs.readFileSync(path.join(repo, 'design/unprose-board-list.ui.yaml'), 'utf8')
const example = (() => {
  const { title: _t, ...content } = YAML.parse(exampleText)
  return content as UiMockContent
})()

const small: UiMockContent = {
  screens: [
    {
      name: 'Home',
      body: [
        { type: 'navbar', text: 'Acme', items: ['Home', 'Docs'], active: 'Home', children: [{ type: 'button', text: 'Sign in' }] },
        {
          type: 'section',
          children: [
            { type: 'row', justify: 'between', children: [{ type: 'heading', text: 'Welcome', level: 1 }, { type: 'button', id: 'go', text: 'Get started', goto: 'signup' }] },
            { type: 'grid', cols: 2, children: [{ type: 'card', text: 'One', children: [{ type: 'text', text: 'First' }] }, { type: 'card', text: 'Two' }] },
            { type: 'text', text: 'Welcome' },
          ],
        },
      ],
    },
    { id: 'signup', name: 'Sign up', device: 'phone', theme: 'dark', body: [{ type: 'input', label: 'Email', placeholder: 'you@example.com' }] },
  ],
}

test('the example file validates, lints clean and has unknown-field-free content', () => {
  assert.ok(contentSchemas['ui-mock'].safeParse(example).success)
  assert.deepEqual(unknownContentFields('ui-mock', example), [])
  assert.deepEqual(checkUiMock(example).filter((f) => f.severity === 'warning'), [])
})

test('ids: explicit, else the slug of the words, else the type; unique per screen; referenced as <screen>/<element>', () => {
  const m = normalizeUiMock(small)
  assert.deepEqual(m.screens.map((s) => s.id), ['home', 'signup'])
  const refs = walkUi(m.screens[0].body).map((e) => e.ref)
  assert.ok(refs.includes('home/acme') && refs.includes('home/go') && refs.includes('home/welcome') && refs.includes('home/welcome-2') && refs.includes('home/row'))
  const email = walkUi(m.screens[1].body)[0]
  assert.equal(email.ref, 'signup/email')
  assert.equal(email.textKey, 'label')
  assert.deepEqual(email.path, ['screens', 1, 'body', 0])
  assert.equal(m.screens[1].w, 390)
  assert.equal(m.screens[1].theme.theme, 'dark')
})

test('layout: every drawn element sits inside its screen; siblings in a row or stack do not overlap', () => {
  for (const s of normalizeUiMock(example).screens) {
    const lay = layoutScreen(s)
    assert.ok(lay.h >= s.minH)
    for (const b of lay.boxes) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= lay.w + 1 && b.y + b.h <= lay.h + 1, `${b.el.ref} out of its screen`)
    }
    const byParent = new Map<string, typeof lay.boxes>()
    for (const b of lay.boxes) byParent.set(b.parent ?? '', [...(byParent.get(b.parent ?? '') ?? []), b])
    for (const [parent, boxes] of byParent)
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, c] = [boxes[i], boxes[j]]
          const overlap = a.x < c.x + c.w - 1 && c.x < a.x + a.w - 1 && a.y < c.y + c.h - 1 && c.y < a.y + a.h - 1
          assert.ok(!overlap, `${a.el.ref} overlaps ${c.el.ref} in ${parent || s.id}`)
        }
  }
})

test('layout: a row with justify between puts the button at the right edge; hugging elements keep their width', () => {
  const lay = layoutScreen(normalizeUiMock(small).screens[0])
  const go = lay.boxes.find((b) => b.el.ref === 'home/go')!
  const heading = lay.boxes.find((b) => b.el.ref === 'home/welcome')!
  assert.equal(go.x + go.w, 1280 - 24)
  assert.ok(go.w < 200 && heading.w > 800)
  const signIn = lay.boxes.find((b) => b.el.ref === 'home/sign-in')!
  assert.equal(signIn.parent, 'home/acme')
  assert.equal(signIn.x + signIn.w, 1280 - 16)
})

test('render: one ui item per drawn element, parents first-class, flows as navigate arrows, deterministic', () => {
  const items = renderUiMock(small, { now: NOW, scope: 'k' })
  const ids = new Set(items.map((i) => i.id))
  assert.equal(ids.size, items.length)
  for (const i of items) if (i.parent) assert.ok(ids.has(i.parent), `${i.id} → ${i.parent}`)
  const screen = items.find((i) => i.id === 'k.screen.home')!
  assert.equal(screen.type, 'ui')
  assert.equal(screen.role, 'screen')
  const go = items.find((i) => i.id === 'k.ui.home.go')!
  assert.equal(go.data?.element, 'home/go')
  assert.deepEqual((go.data?.ui as { path: unknown }).path, ['screens', 0, 'body', 1, 'children', 0, 'children', 1])
  assert.equal(items.find((i) => i.id === 'k.ui.home.one-2' || i.id === 'k.ui.home.first')?.parent, 'k.ui.home.one')
  assert.ok(!items.some((i) => i.id === 'k.ui.home.row' || i.id === 'k.ui.home.grid'), 'layout nodes are not drawn')
  const nav = items.find((i) => i.type === 'arrow' && i.role === 'navigate')!
  assert.deepEqual([nav.from, nav.to], ['k.ui.home.go', 'k.screen.signup'])
  assert.deepEqual(render('ui-mock', small, { now: NOW, scope: 'k' }), items)
})

test('render: inside a frame, traces from another diagram resolve to a ui element by its reference', () => {
  const drawn = placeInFrame({}, { kind: 'ui-mock', key: 'home-ui' }, renderUiMock(small, { now: NOW, scope: 'home-ui' }), NOW).items
  const story: Item = { id: 'usm.story.sign-up', type: 'card', x: 0, y: 0, w: 10, h: 10, createdBy: 'agent', updatedBy: 'agent', updatedAt: NOW, data: { element: 'sign-up', traces: [{ from: 'home-ui/home/go', rel: 'shows' }] } }
  const { wires, unresolved } = resolveTraces([story], Object.fromEntries(drawn.map((i) => [i.id, i])), NOW)
  assert.deepEqual(unresolved, [])
  assert.equal(wires[0].to, 'home-ui.ui.home.go')
})

test('lint: unknown screens, ragged tables, unknown icons, children where none fit, duplicate ids', () => {
  const findings = checkUiMock({
    screens: [
      {
        id: 's',
        name: 'S',
        body: [
          { type: 'button', id: 'b', text: 'Go', goto: 'nowhere', icon: 'rocket' },
          { type: 'button', id: 'b', text: 'Again' },
          { type: 'table', columns: ['A', 'B'], rows: [['1']] },
          { type: 'text', text: 'x', children: [{ type: 'text', text: 'y' }] },
        ],
      },
    ],
    flows: [{ from: 's/zzz', to: 'gone' }],
  })
  const msgs = findings.map((f) => f.message).join('\n')
  for (const m of ['goto: no screen "nowhere"', 'icon "rocket"', 'id "b" is used 2 times', 'table row 1 has 1 cells for 2 columns', 'does not hold children', 'flow to "gone"', 'flow from "s/zzz"']) assert.ok(msgs.includes(m), m)
  assert.ok(unknownContentFields('ui-mock', { screens: [{ name: 'x', body: [{ type: 'button', txt: 'Go' }] }] }).some((u) => u.field === 'txt'))
  assert.equal(contentSchemas['ui-mock'].safeParse({ screens: [{ name: 'x', body: [{ type: 'carousel' }] }] }).success, false)
})

test('a text edit on the board is a proposal; undo and editing back clear it', () => {
  const items = renderUiMock(small, { now: NOW, scope: 'k' })
  const go = items.find((i) => i.id === 'k.ui.home.go')!
  assert.ok(isUiElement(go))
  const board: Board = { id: 'b', title: 't', kind: 'freeform', seq: 0, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(items.map((i) => [i.id, i])) }
  const after = applyOps(board, [uiTextOp(go, 'Start free', NOW)], 'user').board.items['k.ui.home.go']
  assert.equal(after.text, 'Start free')
  assert.deepEqual(uiPendingOf(after), { kind: 'text', before: { text: 'Get started' }, after: { text: 'Start free' }, path: ['screens', 0, 'body', 1, 'children', 0, 'children', 1], key: 'text', by: 'user', at: NOW })
  const twice = applyOps(board, [uiTextOp(after, 'Try it', NOW)], 'user').board.items['k.ui.home.go']
  assert.equal(uiPendingOf(twice)?.before.text, 'Get started', 'the file’s words are remembered across edits')
  assert.equal(uiPendingOf(applyOps(board, [uiTextOp(twice, 'Get started', NOW)], 'user').board.items['k.ui.home.go']), undefined)
  const undone = applyOps(board, uiUndoOps(twice), 'user').board.items['k.ui.home.go']
  assert.equal(undone.text, 'Get started')
  assert.equal(undone.data?.pending, undefined)
})

test('the diff for a proposal changes only that scalar, keeping comments and flow style', () => {
  const p = { path: ['screens', 0, 'body', 1, 'children', 0, 'children', 1], key: 'text', after: { text: 'Create a board' } }
  const out = applyUiText(exampleText, p)
  const changed = exampleText.split('\n').map((l, i) => [l, out.split('\n')[i]]).filter(([a, b]) => a !== b)
  assert.equal(changed.length, 1)
  assert.match(changed[0][1], /\{ type: button, id: new-board, text: Create a board, icon: plus/)
  // a key the element does not have yet is added; words that need quotes get them
  const added = applyUiText('screens:\n  - name: A\n    body:\n      - type: button\n', { path: ['screens', 0, 'body', 0], key: 'text', after: { text: 'Yes: really #1' } })
  assert.equal(YAML.parse(added).screens[0].body[0].text, 'Yes: really #1')
  for (const s of ['true', '12', 'a: b', 'ok #x', ' lead', 'Plain words', '登入']) assert.equal(YAML.parse(`v: ${yamlScalar(s)}`).v, s, s)
  // the screen's name
  assert.equal(YAML.parse(applyUiText(exampleText, { path: ['screens', 1], key: 'name', after: { text: 'Create a board' } })).screens[1].name, 'Create a board')
})

// ── the gutter: notes beside the screen, never on it (docs/diagrams.md §6c) ──────────────────────────────────

const noted: UiMockContent = {
  screens: [
    {
      id: 'home',
      name: 'Home',
      note: 'Is this the first screen after sign-in?',
      body: [
        { type: 'heading', id: 'title', text: 'Boards', level: 1 },
        { type: 'list', id: 'boards', items: ['Studio', { text: 'Runner', meta: 'workflow', note: 'Is the meta line worth the height?' }, 'Mock'] },
        { type: 'table', id: 'recent', columns: ['Board', 'When'], rows: [['Studio', 'now'], { cells: ['Runner', '2 h'], note: 'Relative or absolute time?' }, { cells: ['Mock', '1 d'] }] },
        { type: 'button', id: 'new', text: 'New board', note: 'Primary or secondary?', sample: true },
      ],
    },
    { id: 'phone', name: 'Phone', device: 'phone', sample: true, body: [{ type: 'heading', id: 'h', text: 'Boards', level: 2, note: 'Phone too?' }] },
  ],
}
const box = (a: Item, b: Item) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('gutter: every note is a comment right of its screen, on no ui item and on no other note, stacked by what it is about', () => {
  const items = renderUiMock(noted, { now: NOW, scope: 'k' })
  const ui = items.filter((i) => i.type === 'ui')
  const notes = items.filter((i) => i.type === 'comment')
  assert.equal(notes.length, 5)
  for (const n of notes) {
    assert.equal(n.role, 'note')
    assert.equal(n.color, 'yellow')
    const screen = ui.find((s) => s.role === 'screen' && (s.id === n.target || ui.find((e) => e.id === n.target)?.id.startsWith(`k.ui.${s.data?.element}.`)))!
    assert.ok(screen, `${n.id} has no screen`)
    assert.ok(n.x >= screen.x + screen.w + UI_GUTTER.gap, `${n.id} is not in the gutter`)
    assert.ok(n.x + n.w <= screen.x + screen.w + UI_GUTTER.gap + UI_GUTTER.w, `${n.id} sticks out of the gutter`)
    for (const u of ui) assert.ok(!box(n, u), `${n.id} covers ${u.id}`)
    for (const o of notes) if (o !== n) assert.ok(!box(n, o), `${n.id} overlaps ${o.id}`)
  }
  const home = ui.find((s) => s.id === 'k.screen.home')!
  const screenNote = notes.find((n) => n.id === 'k.note.home')!
  assert.deepEqual([screenNote.target, screenNote.y], ['k.screen.home', home.y])
  // ids and what each note belongs to
  const item = notes.find((n) => n.id === 'k.note.home.boards.item-1')!
  assert.deepEqual([item.target, item.data], ['k.ui.home.boards', { item: 1, callout: 1, annotation: { on: 'home/boards' } }])
  const row = notes.find((n) => n.id === 'k.note.home.recent.row-1')!
  assert.deepEqual([row.target, row.data], ['k.ui.home.recent', { row: 1, callout: 2, annotation: { on: 'home/recent' } }])
  const el = notes.find((n) => n.id === 'k.note.home.new')!
  assert.deepEqual([el.target, el.data], ['k.ui.home.new', { callout: 3, annotation: { on: 'home/new' } }])
  assert.equal(screenNote.data, undefined, 'the screen’s own note is not numbered')
  assert.equal(notes.find((n) => n.id === 'k.note.phone.h')!.data?.callout, 1, 'every screen counts from 1')
  // the order follows the anchors: screen, list item, table row, button
  const homeNotes = notes.filter((n) => n.id.startsWith('k.note.home')).sort((a, b) => a.y - b.y).map((n) => n.id)
  assert.deepEqual(homeNotes, ['k.note.home', 'k.note.home.boards.item-1', 'k.note.home.recent.row-1', 'k.note.home.new'])
  // the next screen starts right of the gutter
  const phone = ui.find((s) => s.id === 'k.screen.phone')!
  assert.ok(phone.x >= home.x + home.w + UI_GUTTER.gap + UI_GUTTER.w)
})

test('gutter: the diagram frame holds the gutter of every screen, with or without notes', () => {
  const { frame, items } = placeInFrame({}, { kind: 'ui-mock', key: 'k' }, renderUiMock(small, { now: NOW, scope: 'k' }), NOW)
  for (const s of items.filter((i) => i.type === 'ui' && i.role === 'screen')) {
    const g = uiGutterOf(s)
    assert.ok(g.x + g.w <= frame.x + frame.w, `the frame ends before the gutter of ${s.id}`)
  }
})

test('data contract: items[i].note, rowNotes keyed by row index, rows always cell arrays, sample: true only when set', () => {
  const items = renderUiMock(noted, { now: NOW, scope: 'k' })
  const ui = (id: string) => items.find((i) => i.id === id)!.data!.ui as Record<string, unknown>
  const list = ui('k.ui.home.boards')
  assert.deepEqual((list.items as Array<{ text: string; note?: string }>).map((i) => i.note), [undefined, 'Is the meta line worth the height?', undefined])
  const table = ui('k.ui.home.recent')
  assert.deepEqual(table.rows, [['Studio', 'now'], ['Runner', '2 h'], ['Mock', '1 d']])
  assert.deepEqual(table.rowNotes, { '1': 'Relative or absolute time?' })
  assert.equal(ui('k.ui.home.title').rowNotes, undefined)
  // the callout numbers: the element's own (with its note, the pin's tooltip), an entry's, a row's
  assert.deepEqual((list.items as Array<{ callout?: number }>).map((i) => i.callout), [undefined, 1, undefined])
  assert.equal(list.callout, undefined)
  assert.deepEqual(table.rowCallouts, { '1': 2 })
  assert.deepEqual([ui('k.ui.home.new').callout, ui('k.ui.home.new').note], [3, 'Primary or secondary?'])
  for (const id of ['k.ui.home.title', 'k.screen.home']) assert.deepEqual([ui(id).callout, ui(id).note, ui(id).rowCallouts], [undefined, undefined, undefined], id)
  assert.equal(ui('k.ui.home.new').sample, true)
  assert.equal(ui('k.ui.home.title').sample, undefined)
  assert.equal(ui('k.screen.phone').sample, true)
  assert.equal(ui('k.screen.home').sample, undefined)
  assert.equal(contentSchemas['ui-mock'].safeParse({ screens: [{ name: 'x', body: [{ type: 'table', rows: [{ cells: ['a'], note: 'n' }, ['b']] }] }] }).success, true)
  assert.equal(contentSchemas['ui-mock'].safeParse({ screens: [{ name: 'x', body: [{ type: 'table', rows: [{ note: 'n' }] }] }] }).success, false)
  // a ragged row given as an object is still checked against the columns
  assert.ok(checkUiMock({ screens: [{ name: 'x', body: [{ type: 'table', columns: ['A', 'B'], rows: [{ cells: ['1'], note: 'n' }] }] }] }).some((f) => f.message.includes('table row 1 has 1 cells')))
})

test('lint ui-text-reads-like-a-note: note words in product text, whole words for Latin, anywhere for Chinese', () => {
  const lint = (body: UiMockContent['screens'][0]['body']) => checkUiMock({ screens: [{ id: 's', name: 'S', body }] }).filter((f) => f.message.startsWith('ui-text-reads-like-a-note'))
  const hits = lint([
    { type: 'button', id: 'b', text: 'Open' },
    { type: 'input', id: 'i', label: 'Name', placeholder: 'TBD', hint: 'todo: ask legal' },
    { type: 'list', id: 'l', items: [{ text: 'Sample row', meta: 'lorem ipsum' }] },
    { type: 'table', id: 't', columns: ['Proposal', 'B'], rows: [['x', 'placeholder'], { cells: ['y', 'FIXME later'], note: 'a real note is fine' }] },
    { type: 'heading', id: 'h', text: '付款方式（待確認）' },
    { type: 'select', id: 'sel', label: 'Plan', value: 'proposed plan' },
  ])
  const where = hits.map((f) => `${f.element} ${f.message.split(' ')[1]}`)
  assert.deepEqual(where, ['s/b text', 's/i placeholder', 's/i hint', 's/l items[0].text', 's/l items[0].meta', 's/t columns[0]', 's/t rows[0][1]', 's/t rows[1][1]', 's/h text', 's/sel value'])
  for (const f of hits) {
    assert.equal(f.severity, 'warning')
    assert.ok(f.message.endsWith('reads like a design note, not product text: move it to `note` (on the element, the item or the row), and keep the product words here'), f.message)
  }
  assert.equal(hits.find((f) => f.element === 's/b')!.message, 'ui-text-reads-like-a-note: text "Open" (Open) reads like a design note, not product text: move it to `note` (on the element, the item or the row), and keep the product words here')
  // negatives: a word inside another, a note field, numbers, ordinary words
  const clean = lint([
    { type: 'button', id: 'b', text: 'Reopen ticket', note: 'TODO: confirm with support' },
    { type: 'text', id: 't', text: 'Samples shipped to the openly listed address; todos are tracked elsewhere' },
    { type: 'list', id: 'l', items: [{ text: 'Proposals', meta: 'unopened' }] },
    { type: 'table', id: 'tb', columns: ['Name'], rows: [[1, 2]] },
    { type: 'heading', id: 'h', text: '確認付款' },
  ])
  assert.deepEqual(clean, [])
})

// ── callouts: numbered pins on the items, their cards beside the screen (docs/diagrams.md §6c) ──────────────────

test('callouts are numbered 1…n per screen in reading order: top first, a line read left to right, ties in file order', () => {
  const mock: UiMockContent = {
    screens: [
      {
        id: 's',
        name: 'S',
        note: 'what this screen is for',
        body: [
          {
            type: 'row',
            justify: 'between',
            children: [
              { type: 'heading', id: 'title', text: 'Boards', level: 1, note: 'left on the first line' },
              { type: 'badge', id: 'count', text: '9', note: 'right on the first line, a few px lower (centred)' },
            ],
          },
          { type: 'tabs', id: 'tabs', items: [{ text: 'All', note: 'first tab' }, 'Mine', { text: 'Shared', note: 'third tab' }], note: 'the tabs bar itself' },
          { type: 'list', id: 'list', items: ['a', { text: 'b', note: 'second entry' }] },
          { type: 'table', id: 't', columns: ['A'], rows: [{ cells: ['x'], note: 'first row' }, ['y'], { cells: ['z'], note: 'third row' }] },
        ],
      },
    ],
  }
  const items = renderUiMock(mock, { now: NOW, scope: 'k' })
  const cards = items.filter((i) => uiCalloutOf(i) !== undefined).sort((a, b) => uiCalloutOf(a)! - uiCalloutOf(b)!)
  assert.deepEqual(
    cards.map((c) => [uiCalloutOf(c), c.id]),
    [
      [1, 'k.note.s.title'],
      [2, 'k.note.s.count'],
      [3, 'k.note.s.tabs'],
      [4, 'k.note.s.tabs.item-0'],
      [5, 'k.note.s.tabs.item-2'],
      [6, 'k.note.s.list.item-1'],
      [7, 'k.note.s.t.row-0'],
      [8, 'k.note.s.t.row-2'],
    ],
  )
  // the comment keeps its id, role, target and data.item / data.row, and gains data.callout and data.annotation (an annotation card)
  const tab = cards.find((c) => c.id === 'k.note.s.tabs.item-2')!
  assert.deepEqual([tab.type, tab.role, tab.target, tab.data], ['comment', 'note', 'k.ui.s.tabs', { item: 2, callout: 5, annotation: { on: 's/tabs' } }])
  const ui = (id: string) => items.find((i) => i.id === id)!.data!.ui as Record<string, unknown>
  assert.deepEqual([ui('k.ui.s.tabs').callout, (ui('k.ui.s.tabs').items as Array<{ callout?: number }>).map((i) => i.callout)], [3, [4, undefined, 5]])
  assert.deepEqual(ui('k.ui.s.t').rowCallouts, { '0': 7, '2': 8 })
  // the screen's own note: first in the gutter, unnumbered, a thread's size
  const screenNote = items.find((i) => i.id === 'k.note.s')!
  assert.equal(uiCalloutOf(screenNote), undefined)
  assert.equal(screenNote.h, UI_GUTTER.noteH)
  // the cards stack in their order below it, each at the height of what it is about when that is free
  const ordered = [screenNote, ...cards]
  for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i].y >= ordered[i - 1].y + ordered[i - 1].h + UI_GUTTER.calloutGap, `${ordered[i].id} is not below ${ordered[i - 1].id}`)
  const table = items.find((i) => i.id === 'k.ui.s.t')!
  assert.ok(cards.find((c) => c.id === 'k.note.s.t.row-2')!.y >= table.y, 'a row’s card is not above its table')
  // the same file draws the same numbers
  assert.deepEqual(renderUiMock(mock, { now: NOW, scope: 'k' }), items)
})

test('readingOrder: one line within 16 px, read left to right; the same spot in file order', () => {
  const at = (id: string, x: number, y: number, seq: number) => ({ id, anchorX: x, anchorY: y, seq })
  const order = readingOrder([at('below', 0, 100, 0), at('right', 300, 4, 1), at('left', 0, 0, 2), at('same-spot-later', 0, 100, 3), at('next-line', 500, 40, 4)])
  assert.deepEqual(order.map((n) => n.id), ['left', 'right', 'next-line', 'below', 'same-spot-later'])
})

test('a callout card is the gutter’s width and as tall as its text: one line is small, a long note grows', () => {
  const one = uiCalloutSize('Why a pin?')
  assert.equal(one.w, UI_GUTTER.noteW)
  assert.equal(one.h, UI_CALLOUT.lineHeight + UI_CALLOUT.padTop + UI_CALLOUT.padBottom + UI_CALLOUT.border * 2)
  assert.ok(one.h < UI_GUTTER.noteH, 'smaller than a thread')
  const three = uiCalloutSize('Does a rewire that is still open belong under Recent activity, or under a Waiting for you list?')
  const inner = UI_GUTTER.noteW - UI_CALLOUT.padLeft - UI_CALLOUT.padRight - UI_CALLOUT.border * 2
  const lines = wrap('Does a rewire that is still open belong under Recent activity, or under a Waiting for you list?', inner - 6, UI_CALLOUT.font).length
  assert.ok(lines >= 2 && lines <= 4, `${lines} lines`)
  assert.equal(three.h, lines * UI_CALLOUT.lineHeight + 14)
  assert.ok(uiCalloutSize('一個很長的中文註解，'.repeat(8)).h > three.h, 'CJK wraps too')
})

test('a person’s comment or an agent’s thread in a UI mock goes to the gutter below the callouts, never numbered', () => {
  const items = renderUiMock(noted, { now: NOW, scope: 'k' })
  const b: Board = { id: 'b', title: 't', kind: 'freeform', seq: 0, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(items.map((i) => [i.id, i])) }
  const content = autoPlaceComments(b, { items: [{ type: 'comment', target: 'k.ui.home.title', text: 'why so big?' }] }) as { items: Array<{ x: number; y: number; w: number; h: number; data?: unknown }> }
  const c = content.items[0]
  const home = b.items['k.screen.home']
  const g = uiGutterOf(home)
  const lastCallout = Math.max(...items.filter((i) => uiCalloutOf(i) !== undefined && i.target?.startsWith('k.ui.home.')).map((i) => i.y + i.h))
  assert.equal(c.x, g.x)
  assert.ok(c.y >= lastCallout + UI_GUTTER.noteGap, `the comment at ${c.y} is not below the callouts (${lastCallout})`)
  assert.equal(c.data, undefined)
})
