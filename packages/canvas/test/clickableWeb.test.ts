// "Clickable" on a UI mock (web/src/diagrams/uiClickable.ts, flow/clickableView.ts): which elements a click leads
// from — Play's own answer (buildPlay) — the tag on the outermost element of each chain only, nothing for a goto to a
// screen that does not exist, the side panel's list by screen, and what the switch, Play and its hint draw.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { renderUiMock, type UiMockContent } from '../src/templates/ui-mock.js'
import { buildPlay } from '../web/src/diagrams/uiPlay.js'
import { boardClickTags, clickList, clickTags, uiMockFrames } from '../web/src/diagrams/uiClickable.js'
import { applyClickable, clickLooks, type ClickOn } from '../web/src/flow/clickableView.js'
import type { ItemNode } from '../web/src/flow/boardToFlow.js'

const now = '2026-10-13T00:00:00Z'
const mock: UiMockContent = {
  screens: [
    {
      id: 'home',
      name: 'Home',
      body: [
        { type: 'navbar', text: 'Shop', items: ['Home', 'Orders'] },
        {
          type: 'section',
          children: [
            { type: 'button', id: 'new-order', text: 'New order', goto: 'checkout' },
            // a card that leads somewhere: what it holds follows it, so only the card is tagged
            { type: 'card', id: 'promo', text: 'Spring sale', goto: 'details', children: [{ type: 'text', id: 'promo-text', text: 'Up to 30% off' }, { type: 'button', id: 'promo-more', text: 'More' }, { type: 'button', id: 'promo-same', text: 'Same', goto: 'details' }] },
            // … unless something in it leads elsewhere
            { type: 'card', id: 'other', text: 'Other', goto: 'details', children: [{ type: 'button', id: 'other-cta', text: 'Buy now', goto: 'checkout' }] },
            { type: 'link', id: 'broken', text: 'Nowhere', goto: 'missing' },
            { type: 'card', id: 'flowed', text: 'Recent order' },
          ],
        },
      ],
    },
    { id: 'checkout', name: 'Checkout', body: [{ type: 'section', children: [{ type: 'input', id: 'card', label: 'Card' }, { type: 'button', id: 'back', text: 'Back', goto: 'home' }] }] },
    { id: 'details', name: 'Sale details', body: [{ type: 'heading', id: 'h', text: 'Details' }] },
  ],
  flows: [
    { from: 'home/flowed', to: 'details', label: 'open' },
    { from: 'home', to: 'checkout' },
  ],
}

function frameOf(id: string, content: UiMockContent, scope: string, dy = 0): Item[] {
  const frame = { id, type: 'frame', x: -40, y: -40 + dy, w: 6000, h: 3000, text: id, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, data: { diagram: { kind: 'ui-mock', key: scope } } } as unknown as Item
  const items = renderUiMock(content, { scope, now }).map((i) => ({ ...i, y: i.y + dy, ...(i.type === 'arrow' || i.parent ? {} : { parent: id }) }))
  return [frame, ...items]
}

const boardOf = (...items: Item[]): Board => ({ id: 'b', title: 't', kind: 'freeform', seq: 0, items: Object.fromEntries(items.map((i) => [i.id, i])) }) as unknown as Board

const board = boardOf(...frameOf('frame', mock, 'x-ui'))
const model = buildPlay(board, 'frame')
const tags = clickTags(board, model)
const S = (s: string) => `x-ui.screen.${s}`
const E = (ref: string) => `x-ui.ui.${ref.replace('/', '.')}`

test('a goto tags its element with the screen it leads to, by the name drawn', () => {
  assert.deepEqual(tags.get(E('home/new-order')), { to: S('checkout'), name: 'Checkout', text: '→ Checkout' })
  assert.deepEqual(tags.get(E('checkout/back')), { to: S('home'), name: 'Home', text: '→ Home' })
  assert.equal(tags.get(E('home/promo'))?.text, '→ Sale details', 'the screen’s name, not its id')
})

test('a flows entry drawn from an element tags it; a flow from a whole screen tags nothing', () => {
  assert.equal(tags.get(E('home/flowed'))?.to, S('details'))
  assert.equal(tags.has(S('home')), false)
})

test('a card that leads somewhere carries the tag; what it holds does not repeat it', () => {
  assert.equal(tags.get(E('home/promo'))?.to, S('details'))
  assert.equal(model.gotoOf.get(E('home/promo-text')), S('details'), 'Play still follows the card from its text')
  assert.equal(tags.has(E('home/promo-text')), false)
  assert.equal(tags.has(E('home/promo-more')), false)
  assert.equal(tags.has(E('home/promo-same')), false, 'its own goto to the same screen says nothing new')
  assert.equal(tags.get(E('home/other'))?.to, S('details'))
  assert.equal(tags.get(E('home/other-cta'))?.to, S('checkout'), 'an element in it that leads elsewhere is tagged')
})

test('a goto to a screen that does not exist, a field and a plain element: no tag', () => {
  assert.equal(tags.has(E('home/broken')), false)
  assert.equal(tags.has(E('checkout/card')), false)
  assert.equal(tags.has(E('details/h')), false)
  assert.equal([...tags.keys()].some((id) => id.includes('navbar') || id === E('home/shop')), false)
  assert.equal(tags.size, 6)
})

test('the panel list: by screen in the frame’s order, each in reading order, screens with nothing left out', () => {
  const groups = clickList(board, model)
  assert.deepEqual(groups.map((g) => g.screen.name), ['Home', 'Checkout'])
  const home = groups[0].rows
  assert.deepEqual(home.map((r) => r.id).sort(), [E('home/new-order'), E('home/promo'), E('home/other'), E('home/other-cta'), E('home/flowed')].sort())
  assert.ok(home.findIndex((r) => r.id === E('home/other')) < home.findIndex((r) => r.id === E('home/other-cta')), 'a card before what it holds')
  assert.ok(home.findIndex((r) => r.id === E('home/new-order')) < home.findIndex((r) => r.id === E('home/promo')))
  assert.deepEqual(home.find((r) => r.id === E('home/other-cta')), { id: E('home/other-cta'), label: 'Buy now', to: S('checkout'), toName: 'Checkout' })
  assert.deepEqual(groups[1].rows.map((r) => `${r.label} → ${r.toName}`), ['Back → Home'])
})

test('the list names an element without words by its id in the file; a long screen name is cut short on the tag only', () => {
  const long = 'Order confirmation and receipt'
  const b = boardOf(...frameOf('frame', { screens: [{ id: 'a', name: 'A', body: [{ type: 'button', id: 'go', icon: 'plus', goto: 'b' }] }, { id: 'b', name: long, body: [] }] }, 'y-ui'))
  const m = buildPlay(b, 'frame')
  const [g] = clickList(b, m)
  assert.deepEqual(g.rows.map((r) => [r.label, r.toName]), [['go', long]])
  assert.deepEqual(clickTags(b, m).get('y-ui.ui.a.go'), { to: 'y-ui.screen.b', name: long, text: '→ Order confirmation and…' })
})

test('the switch applies to every UI mock on the board', () => {
  const two = boardOf(...frameOf('f1', mock, 'x-ui'), ...frameOf('f2', { screens: [{ id: 'a', name: 'A', body: [{ type: 'button', id: 'go', text: 'Go', goto: 'b' }] }, { id: 'b', name: 'B', body: [] }] }, 'y-ui', 4000))
  assert.deepEqual(uiMockFrames(two), ['f1', 'f2'])
  const all = boardClickTags(two)
  assert.equal(all.size, 7)
  assert.equal(all.get('y-ui.ui.a.go')?.text, '→ B')
})

test('what is drawn: tags with the switch on, none in the frame being played, Play’s hint as an outline only', () => {
  assert.equal(clickLooks(tags, { on: false }).size, 0)
  const on = clickLooks(tags, { on: true })
  assert.deepEqual(on.get(E('home/new-order')), { tag: '→ Checkout', name: 'Checkout' })
  assert.equal(clickLooks(tags, { on: true, played: model.screenOf }).size, 0, 'Play’s own look wins')
  const hint = clickLooks(tags, { on: false, played: model.screenOf, hint: [E('home/new-order')] })
  assert.deepEqual([...hint], [[E('home/new-order'), { hint: true }]])
})

test('the nodes: only tagged ones change, and stay the same objects while nothing about them does', () => {
  const node = (id: string) => ({ id, position: { x: 0, y: 0 }, data: { item: board.items[id], pulse: false, open: true, replies: [] } }) as unknown as ItemNode
  const nodes = [node(E('home/new-order')), node(E('details/h'))]
  const cache = new WeakMap<ItemNode, { look: ClickOn; out: ItemNode }>()
  assert.equal(applyClickable(nodes, new Map(), cache), nodes, 'switch off: the same array')
  const first = applyClickable(nodes, clickLooks(tags, { on: true }), cache)
  assert.deepEqual(first[0].data.click, { tag: '→ Checkout', name: 'Checkout' })
  assert.equal(first[1], nodes[1])
  const again = applyClickable(nodes, clickLooks(tags, { on: true }), cache)
  assert.equal(again[0], first[0], 'a new look that says the same keeps the node')
})
