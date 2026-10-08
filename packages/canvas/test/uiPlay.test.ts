import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { renderUiMock, type UiMockContent } from '../src/templates/ui-mock.js'
import { buildPlay, canPlay, currentScreen, emptyPlay, gotoTarget, playBack, playGoto, playOpen, playPick, playRestart, playStatuses, playTab, playToggle, playType, reconcilePlay, startPlay } from '../web/src/diagrams/uiPlay.js'

const now = '2026-10-07T00:00:00Z'
const mock: UiMockContent = {
  screens: [
    {
      id: 'boards',
      name: 'Boards',
      body: [
        { type: 'navbar', text: 'Unprose', items: ['Boards', 'Docs'] },
        {
          type: 'section',
          children: [
            { type: 'button', id: 'new-board', text: 'New board', goto: 'new-board' },
            { type: 'tabs', id: 'projects', items: ['All', 'Mine'], active: 0 },
            { type: 'card', id: 'studio', text: 'Studio', children: [{ type: 'badge', text: 'Freeform' }] },
            { type: 'link', id: 'broken', text: 'Nowhere', goto: 'missing' },
          ],
        },
      ],
    },
    {
      id: 'new-board',
      name: 'New board',
      body: [
        { type: 'input', id: 'title', label: 'Title' },
        { type: 'select', id: 'project', label: 'Project', value: 'a', items: ['a', 'b'] },
        { type: 'checkbox', id: 'hints', text: 'Hints', checked: true },
        { type: 'button', id: 'cancel', text: 'Cancel', goto: 'boards' },
      ],
    },
    { id: 'phone', name: 'Phone', device: 'phone', body: [{ type: 'heading', id: 'h', text: 'Boards' }] },
  ],
  flows: [
    { from: 'boards/studio', to: 'phone', label: 'same list' },
    { from: 'boards', to: 'phone' },
  ],
}

function boardOf(content: UiMockContent): Board {
  const frame = { id: 'frame', type: 'frame', x: -40, y: -40, w: 6000, h: 3000, text: 'Board list', createdBy: 'agent', updatedBy: 'agent', updatedAt: now, data: { diagram: { kind: 'ui-mock', key: 'x-ui' } } } as unknown as Item
  const items = renderUiMock(content, { scope: 'x-ui', now }).map((i) => (i.type === 'arrow' || i.parent ? i : { ...i, parent: 'frame' }))
  const loose = { id: 'loose', type: 'sticky', x: 9000, y: 0, w: 100, h: 100, createdBy: 'user', updatedBy: 'user', updatedAt: now } as Item
  const comment = { id: 'c1', type: 'comment', x: 0, y: 0, w: 160, h: 64, text: 'secondary?', target: 'x-ui.ui.boards.new-board', createdBy: 'user', updatedBy: 'user', updatedAt: now } as Item
  const reply = { ...comment, id: 'c2', target: 'c1', text: 'yes' } as Item
  const all = [frame, ...items, loose, comment, reply]
  return { id: 'b', title: 't', kind: 'freeform', seq: 0, items: Object.fromEntries(all.map((i) => [i.id, i])) } as unknown as Board
}

const board = boardOf(mock)
const model = buildPlay(board, 'frame')
const S = (s: string) => `x-ui.screen.${s}`
const E = (ref: string) => `x-ui.ui.${ref.replace('/', '.')}`

test('the frame\'s screens in order, and where each goto leads', () => {
  assert.deepEqual(model.screens.map((s) => [s.id, s.element, s.name]), [[S('boards'), 'boards', 'Boards'], [S('new-board'), 'new-board', 'New board'], [S('phone'), 'phone', 'Phone']])
  assert.equal(gotoTarget(model, E('boards/new-board')), S('new-board'))
  assert.equal(gotoTarget(model, E('new-board/cancel')), S('boards'))
  assert.equal(gotoTarget(model, E('boards/broken')), undefined, 'a goto to no screen leads nowhere')
  assert.equal(gotoTarget(model, E('boards/studio')), S('phone'), 'a flow drawn from an element leads there too')
  assert.equal(gotoTarget(model, S('boards')), undefined, 'a flow from a whole screen is not a click')
  assert.equal(gotoTarget(model, E('boards/freeform')), S('phone'), 'what a card holds follows the card')
  assert.equal(gotoTarget(model, E('new-board/title')), undefined, 'a field keeps its own job')
  assert.ok(canPlay(board, 'frame'))
  assert.ok(!canPlay(board, 'loose'))
})

test('every element knows its screen; a nested one too', () => {
  assert.equal(model.screenOf.get(E('boards/freeform')), S('boards'), 'a badge inside a card inside a section')
  assert.equal(model.screenOf.get(S('phone')), S('phone'))
  assert.equal(model.screenOf.has('loose'), false)
  assert.equal(model.screenOf.get('c1'), S('boards'), 'a comment about an element goes with its screen')
  assert.equal(model.screenOf.get('c2'), S('boards'), 'a reply follows its thread')
  assert.equal(model.arrows.length, 4, 'two gotos and two flows draw navigate arrows (the broken goto draws none)')
})

test('play starts on the first screen; goto moves, back returns, restart forgets', () => {
  const s0 = startPlay(model)!
  assert.equal(currentScreen(model, s0)?.name, 'Boards')
  const s1 = playGoto(s0, S('new-board'))
  assert.equal(s1.screen, S('new-board'))
  assert.deepEqual(s1.history, [S('boards')])
  assert.equal(playGoto(s1, S('new-board')).screen, S('new-board'), 'going where you are changes nothing')
  assert.deepEqual(playGoto(s1, S('new-board')).history, [S('boards')])
  const s2 = playType(playToggle(s1, E('new-board/hints'), true), E('new-board/title'), 'Refunds')
  assert.equal(s2.checked[E('new-board/hints')], false)
  assert.equal(s2.typed[E('new-board/title')], 'Refunds')
  const back = playBack(s2)
  assert.equal(back.screen, S('boards'))
  assert.deepEqual(back.history, [])
  assert.equal(back.typed[E('new-board/title')], 'Refunds', 'what was typed stays on the way back')
  assert.equal(playBack(back), back, 'back at the start does nothing')
  const again = playRestart(model, s2)
  assert.equal(again.screen, S('boards'))
  assert.deepEqual(again.typed, {})
  assert.deepEqual(again.checked, {})
})

test('a select opens, closes, and picks an option; a tab switches; a toggle flips from what the file says', () => {
  const s0 = playGoto(startPlay(model)!, S('new-board'))
  const sel = E('new-board/project')
  const open = playOpen(s0, sel)
  assert.equal(open.open, sel)
  assert.equal(playOpen(open, sel).open, undefined, 'opening again closes')
  const picked = playPick(open, sel, 'b')
  assert.equal(picked.picked[sel], 'b')
  assert.equal(picked.open, undefined, 'picking closes')
  assert.equal(playGoto(open, S('boards')).open, undefined, 'leaving the screen closes it')
  const tabs = E('boards/projects')
  assert.equal(playTab(s0, tabs, 1).tab[tabs], 1)
  const t1 = playToggle(s0, 'x', false)
  assert.equal(t1.checked.x, true)
  assert.equal(playToggle(t1, 'x', false).checked.x, false, 'the second toggle uses the state, not the file')
})

test('what the board shows: the screen on view and its elements are current, the rest and the arrows are other', () => {
  const st = playStatuses(model, playGoto(startPlay(model)!, S('new-board')))
  assert.equal(st.get(S('new-board')), 'current')
  assert.equal(st.get(E('new-board/title')), 'current')
  assert.equal(st.get(S('boards')), 'other')
  assert.equal(st.get(E('boards/freeform')), 'other')
  for (const a of model.arrows) assert.equal(st.get(a), 'other')
  assert.equal(st.get('frame'), undefined, 'the frame itself is left alone')
  assert.equal(st.get('loose'), undefined)
})

test('reconcile: an empty start takes the first screen; a redraw that lost the screen goes back; no screens stops', () => {
  const s = reconcilePlay(model, emptyPlay('frame'))!
  assert.equal(s.screen, S('boards'))
  const deep = playGoto(playGoto(startPlay(model)!, S('new-board')), S('phone'))
  const shorter = buildPlay(boardOf({ ...mock, screens: mock.screens.slice(0, 2) }), 'frame')
  const r = reconcilePlay(shorter, deep)!
  assert.equal(r.screen, S('new-board'), 'back to the screen left last')
  assert.deepEqual(r.history, [S('boards')])
  assert.equal(reconcilePlay(model, deep), deep, 'nothing to settle: the same state')
  assert.equal(reconcilePlay(buildPlay(board, 'loose'), deep), undefined)
})
