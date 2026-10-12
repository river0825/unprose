// Annotations in every diagram kind (docs/diagrams.md "Annotations"): the file's `annotations:` list drawn as numbered
// cards beside the drawing — a band below the timeline kinds, a column right of each wireframe / UI mock screen —
// never on the drawing or on each other; `on` that names nothing is skipped by the draw and an error for the lint.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, DiagramKind, Item } from '../src/model.js'
import { calloutOf, annotationOf, annotationRefOf } from '../src/annotations.js'
import { contentSchemas, render, renderUiMock, renderWireframe, resolveOn, timelineOrder } from '../src/templates/index.js'
import { placeInFrame } from '../src/templates/frame.js'
import { checkLayout } from '../src/layoutCheck.js'
import { explainRedraw, lintDesignContent, designFromObject } from '../src/diagrams/index.js'
import { UI_GUTTER, uiCalloutOf } from '../src/diagrams/uiMock.js'

const NOW = '2026-10-12T10:00:00.000Z'
const cards = (items: Item[]) => items.filter((i) => calloutOf(i) !== undefined).sort((a, b) => calloutOf(a)! - calloutOf(b)!)
const box = (a: Item, b: Item) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const drawing = (items: Item[]) => items.filter((i) => i.type !== 'arrow' && i.type !== 'comment')

/** Every card sits on nothing the diagram drew and on no other card. */
function apart(items: Item[]) {
  const cs = cards(items)
  for (const c of cs) {
    for (const it of drawing(items)) assert.ok(!box(c, it), `${c.id} covers ${it.id}`)
    for (const o of cs) if (o !== c) assert.ok(!box(c, o), `${c.id} overlaps ${o.id}`)
  }
}

const ES = {
  level: 'process' as const,
  events: [{ id: 'placed', text: 'Order placed' }, { id: 'paid', text: 'Order paid' }],
  commands: [{ id: 'pay', text: 'Pay', by: 'Customer', system: 'Shop', produces: 'paid' }],
  annotations: [
    { on: 'paid', text: 'Only after the bank says yes' },
    { on: 'Order placed', text: 'The cart is frozen from here on' },
    { on: 'command.pay', text: 'One button, no confirmation page' },
  ],
}
const USM = {
  activities: [{ id: 'buy', text: 'Buy', steps: [{ id: 'choose', text: 'Choose', stories: [{ id: 'search', text: 'Search', release: 'MVP' }] }, { id: 'pay-step', text: 'Pay', stories: [{ id: 'card', text: 'Pay by card', release: 'MVP' }] }] }],
  releases: ['MVP'],
  annotations: [{ on: 'card', text: 'Visa and Mastercard only' }, { on: 'buy', text: 'The backbone: what a buyer does' }],
}
const JOURNEY = {
  persona: 'Ann',
  stages: [{ text: 'Browse', actions: ['Search'], emotion: 1 }, { text: 'Checkout', actions: ['Pay'], pains: ['Too many fields'], emotion: -1 }],
  annotations: [{ on: 'checkout', text: 'Where most carts are left' }, { on: 'Search', text: 'Mostly on the phone' }],
}
const KANBAN = {
  columns: [{ name: 'Todo' }, { name: 'Done' }],
  cards: [{ id: 'q1', title: 'Pick a payment provider', column: 'Todo' }, { title: 'Ship the cart', column: 'Done' }],
  annotations: [{ on: 'done', text: 'Done means deployed' }, { on: 'q1', text: 'Waits for legal' }, { on: 'Ship the cart', text: 'Shipped on Monday' }],
}
const WORKFLOW = {
  name: 'cards',
  nodes: [{ id: 'start', kind: 'trigger' as const, label: 'start\n(manual)' }, { id: 'plan', kind: 'ai' as const, label: 'plan\n@planner' }, { id: 'ship', kind: 'script' as const }],
  edges: [{ from: 'start', to: 'plan', event: 'start' }, { from: 'plan', to: 'ship', event: 'plan.done' }],
  annotations: [{ on: 'ship', text: 'Runs the deploy script' }, { on: 'plan', text: 'The only step that thinks' }],
}

/** Each kind, its content, and its cards in number order: [the text of what it is about, the card's text]. */
const BANDS: Array<[DiagramKind, Record<string, unknown>, Array<[string, string]>]> = [
  ['event-storming', ES, [['Order placed', 'The cart is frozen from here on'], ['Pay', 'One button, no confirmation page'], ['Order paid', 'Only after the bank says yes']]],
  ['user-story-map', USM, [['Buy', 'The backbone: what a buyer does'], ['Pay by card', 'Visa and Mastercard only']]],
  // left to right: the first column's card, then the Done column itself (it starts left of its cards), then its card
  ['kanban', KANBAN, [['Pick a payment provider', 'Waits for legal'], ['Done', 'Done means deployed'], ['Ship the cart', 'Shipped on Monday']]],
  ['workflow', WORKFLOW, [['plan\n@planner', 'The only step that thinks'], ['ship', 'Runs the deploy script']]],
  ['user-journey', JOURNEY, [['Search', 'Mostly on the phone'], ['Checkout', 'Where most carts are left']]],
]

test('the timeline kinds: numbered cards in a band below the drawing, in reading order along it, each about its item', () => {
  for (const [kind, content, want] of BANDS) {
    const items = render(kind, contentSchemas[kind].parse(content), { scope: 'k', now: NOW, source: `design/x.${kind}.yaml` })
    const cs = cards(items)
    assert.deepEqual(cs.map((c) => [items.find((i) => i.id === c.target)?.text, c.text]), want, kind)
    const bottom = Math.max(...drawing(items).map((i) => i.y + i.h))
    for (const c of cs) {
      assert.equal(c.type, 'comment')
      assert.equal(c.role, 'note')
      assert.equal(c.color, 'yellow')
      assert.match(c.id, /^k\.annotation\./)
      assert.ok(c.y >= bottom + UI_GUTTER.gap, `${kind}: ${c.id} is not below the drawing`)
      assert.equal(annotationOf(c)?.file, `design/x.${kind}.yaml`)
      assert.ok(items.some((i) => i.id === c.target), `${kind}: ${c.id} is about nothing drawn`)
    }
    assert.deepEqual(cs.map((c) => calloutOf(c)), cs.map((_, i) => i + 1), `${kind}: numbered 1…n`)
    // the band runs in the order of the numbers, left to right
    for (let i = 1; i < cs.length; i++) if (cs[i].y === cs[i - 1].y) assert.ok(cs[i].x >= cs[i - 1].x + cs[i - 1].w, `${kind}: ${cs[i].id} is not right of ${cs[i - 1].id}`)
    apart(items)
    // the same file draws the same cards
    assert.deepEqual(render(kind, contentSchemas[kind].parse(content), { scope: 'k', now: NOW, source: `design/x.${kind}.yaml` }), items)
  }
})

test('a journey names its stages and stickies by slug (data.element), its text or its id inside the diagram', () => {
  const items = render('user-journey', JOURNEY, { scope: 'j', now: NOW })
  const stage = items.find((i) => i.role === 'stage' && i.text === 'Checkout')!
  assert.equal(stage.data?.element, 'checkout')
  assert.equal(items.find((i) => i.role === 'action' && i.text === 'Pay')!.data?.element, 'checkout/pay')
  assert.deepEqual(cards(items).map((c) => [c.target, annotationOf(c)?.on]), [[items.find((i) => i.text === 'Search' && i.role === 'action')!.id, 'Search'], [stage.id, 'checkout']])
  // what the web writes for an item is what resolves it
  for (const it of drawing(items).filter((i) => i.role !== 'row-label')) assert.equal(resolveOn(items, annotationRefOf(it, 'j'), 'j')?.id, it.id, it.id)
  apart(items)
})

test('resolving `on`: a full id, an id inside the diagram, data.element, the text — a repeated occurrence last', () => {
  const items = render('event-storming', contentSchemas['event-storming'].parse(ES), { scope: 'k', now: NOW })
  assert.equal(resolveOn(items, 'k.event.paid', 'k')?.id, 'k.event.paid')
  assert.equal(resolveOn(items, 'event.paid', 'k')?.id, 'k.event.paid')
  assert.equal(resolveOn(items, 'paid', 'k')?.id, 'k.event.paid')
  assert.equal(resolveOn(items, ' Order paid ', 'k')?.id, 'k.event.paid')
  assert.equal(resolveOn(items, 'customer', 'k')?.data?.occurrence, true, 'a person drawn where it acts: only an occurrence to name')
  assert.equal(resolveOn(items, 'nothing', 'k'), undefined)
  // EventStorming: what annotationRefOf writes (data.element) resolves every element
  for (const it of drawing(items).filter((i) => typeof i.data?.element === 'string' && !i.data?.occurrence)) assert.equal(resolveOn(items, annotationRefOf(it, 'k'), 'k')?.data?.element, it.data?.element)
})

test('timelineOrder: one column within 16 px, read top to bottom; the same spot in file order', () => {
  const at = (id: string, x: number, y: number, seq: number) => ({ id, anchorX: x, anchorY: y, seq })
  assert.deepEqual(timelineOrder([at('right', 400, 0, 0), at('low', 0, 300, 1), at('high', 10, 0, 2), at('same', 0, 300, 3)]).map((n) => n.id), ['high', 'low', 'same', 'right'])
})

test('an `on` that names nothing: the draw leaves it out, the lint says so as an error with what `on` can name', () => {
  const content = { ...ES, annotations: [{ on: 'paid', text: 'ok' }, { on: 'refunded', text: 'gone' }] }
  const items = render('event-storming', contentSchemas['event-storming'].parse(content), { scope: 'k', now: NOW })
  assert.deepEqual(cards(items).map((c) => c.text), ['ok'])
  const d = designFromObject('design/shop.es.yaml', content)
  const errors = lintDesignContent(d).filter((f) => f.severity === 'error')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].element, 'annotations[1]')
  assert.match(errors[0].message, /^on "refunded" matches nothing in this diagram, so its card is not drawn — name an element by its id or its text, or an item id on the board \(e\.g\. .*paid/)
  // every kind says what its `on` names
  const kb = lintDesignContent(designFromObject('design/w.kanban.yaml', { ...KANBAN, annotations: [{ on: 'nope', text: 'x' }] })).find((f) => f.severity === 'error')!
  assert.match(kb.message, /a card by its id \(else the slug of its title\) or its title, or a column by the slug of its name/)
  const ui = lintDesignContent(designFromObject('design/w.ui.yaml', { screens: [{ id: 'home', name: 'Home', body: [{ type: 'button', text: 'Go' }] }], annotations: [{ on: 'home/nope', text: 'x' }] })).find((f) => f.severity === 'error')!
  assert.match(ui.message, /a screen \(`<screen>`\) or an element \(`<screen>\/<element>`\)/)
  // `annotations` is not an unknown field anywhere
  for (const [file, c] of [['design/a.es.yaml', ES], ['design/a.story-map.yaml', USM], ['design/a.journey.yaml', JOURNEY], ['design/a.kanban.yaml', KANBAN], ['design/a.wireframe.yaml', { screens: [{ name: 'S', elements: [] }], annotations: [{ on: 's', text: 'x' }] }]] as const) {
    assert.ok(!lintDesignContent(designFromObject(file, c)).some((f) => /unknown field/.test(f.message)), file)
    assert.ok(!lintDesignContent(designFromObject(file, c)).some((f) => f.severity === 'error'), file)
  }
})

const WIRE = {
  screens: [
    { name: 'Home', elements: [{ role: 'heading' as const, text: 'Welcome', x: 0, y: 0, w: 12 }, { role: 'button' as const, text: 'Sign up', x: 0, y: 2, w: 4, note: 'The only call to action' }] },
    { name: 'Plain', elements: [{ role: 'paragraph' as const, text: 'Terms', x: 0, y: 0, w: 12 }] },
    { name: 'Done', elements: [{ role: 'heading' as const, text: 'Thanks', x: 0, y: 0, w: 12 }] },
  ],
  annotations: [{ on: 'home/welcome', text: 'Says who it is for' }, { on: 'Thanks', text: 'No upsell here' }],
}

test('wireframe: an element note and the file annotations are numbered cards right of their screen; only a screen with some gets a gutter', () => {
  const items = renderWireframe(WIRE, { scope: 'w', now: NOW, source: 'design/x.wireframe.yaml' })
  const screens = items.filter((i) => i.role === 'screen')
  assert.deepEqual(screens.map((s) => s.data?.element), ['home', 'plain', 'done'])
  assert.equal(items.find((i) => i.text === 'Sign up')!.data?.element, 'home/sign-up')
  const cs = cards(items)
  assert.deepEqual(cs.map((c) => [calloutOf(c), c.text, items.find((i) => i.id === c.target)?.text, annotationOf(c)?.on]), [
    [1, 'Says who it is for', 'Welcome', 'home/welcome'],
    [2, 'The only call to action', 'Sign up', 'home/sign-up'],
    [3, 'No upsell here', 'Thanks', 'Thanks'],
  ])
  // the element's own note keeps its id across the upgrade (a card the person moved stays moved)
  assert.match(cs[1].id, /^w\.comment\./)
  assert.match(cs[0].id, /^w\.annotation\.home-welcome$/)
  for (const c of cs) {
    const screen = screens.find((s) => s.id === items.find((i) => i.id === c.target)!.parent)!
    assert.ok(c.x >= screen.x + screen.w + UI_GUTTER.gap && c.x + c.w <= screen.x + screen.w + UI_GUTTER.gap + UI_GUTTER.w, `${c.id} is not in its screen's gutter`)
    assert.equal(annotationOf(c)?.file, 'design/x.wireframe.yaml')
  }
  // Home has a gutter, Plain has none: Plain starts right of Home's gutter, Done right of Plain
  assert.equal(screens[1].x, screens[0].x + screens[0].w + UI_GUTTER.gap + UI_GUTTER.w + 80)
  assert.equal(screens[2].x, screens[1].x + screens[1].w + 80)
  apart(items)
  // a card at the height of what it is about when that is free
  assert.equal(cs[0].y, items.find((i) => i.text === 'Welcome')!.y)
})

test('UI mock: a file annotation on an element is one of its screen\'s callouts; several on one element stamp data.ui.callouts', () => {
  const mock = {
    screens: [{ id: 'home', name: 'Home', body: [{ type: 'heading' as const, id: 'title', text: 'Boards', note: 'Says where you are' }, { type: 'button' as const, id: 'new', text: 'New board' }] }],
    annotations: [{ on: 'home/title', text: 'Also the page title' }, { on: 'home/new', text: 'Primary: the one thing to do here' }, { on: 'home', text: 'The first screen after sign-in' }, { on: 'home/missing', text: 'skipped' }],
  }
  const items = renderUiMock(mock, { scope: 'k', now: NOW })
  const cs = items.filter((i) => uiCalloutOf(i) !== undefined).sort((a, b) => uiCalloutOf(a)! - uiCalloutOf(b)!)
  assert.deepEqual(cs.map((c) => [uiCalloutOf(c), c.id, c.target]), [
    [1, 'k.annotation.home', 'k.screen.home'],
    [2, 'k.note.home.title', 'k.ui.home.title'],
    [3, 'k.annotation.home-title', 'k.ui.home.title'],
    [4, 'k.annotation.home-new', 'k.ui.home.new'],
  ])
  const ui = (id: string) => items.find((i) => i.id === id)!.data!.ui as Record<string, unknown>
  assert.deepEqual([ui('k.ui.home.title').callout, ui('k.ui.home.title').callouts, ui('k.ui.home.title').note], [2, [2, 3], 'Says where you are'])
  assert.deepEqual([ui('k.ui.home.new').callout, ui('k.ui.home.new').callouts], [4, undefined])
  assert.equal(ui('k.screen.home').callout, 1)
  assert.deepEqual(annotationOf(cs[2]), { on: 'home/title' })
  assert.ok(!cs.some((c) => c.text === 'skipped'))
})

test('a new frame holds the band; the layout check finds no card on content or outside its frame', () => {
  for (const [kind, content] of BANDS) {
    const rendered = render(kind, contentSchemas[kind].parse(content), { scope: 'k', now: NOW, at: { x: 0, y: 44 } })
    const { items } = placeInFrame({}, { kind: kind as never, key: 'k' }, rendered, NOW)
    const board: Board = { id: 'b', title: 't', kind: 'freeform', seq: 0, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(items.map((i) => [i.id, i])) }
    const r = checkLayout(board)
    const about = r.findings.filter((f) => (f.kind === 'comment-covers' || f.kind === 'comment-outside') && cards(items).some((c) => c.id === f.id))
    assert.deepEqual(about, [], kind)
  }
  const w = placeInFrame({}, { kind: 'wireframe', key: 'w' }, renderWireframe(WIRE, { scope: 'w', now: NOW, at: { x: 0, y: 44 } }), NOW).items
  const r = checkLayout({ id: 'b', title: 't', kind: 'freeform', seq: 0, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(w.map((i) => [i.id, i])) })
  assert.deepEqual(r.findings.filter((f) => f.kind.startsWith('comment-')), [])
})

test('a redraw keeps a card the person moved, renumbers in place, and removes a card whose annotation left the file', () => {
  const first = render('kanban', KANBAN, { scope: 'k', now: NOW })
  const board = Object.fromEntries(first.map((i) => [i.id, i]))
  const moved = cards(first)[0]
  board[moved.id] = { ...moved, x: moved.x + 500, y: moved.y + 300 }
  // the file: the first annotation goes, a new one comes before the others
  const next = render('kanban', { ...KANBAN, annotations: [{ on: 'todo', text: 'Ordered by priority' }, ...KANBAN.annotations.slice(1)] }, { scope: 'k', now: NOW })
  const { ops, plan } = explainRedraw(board, next, { placed: new Set([moved.id]) }, { prefix: 'k.' })
  const gone = cards(first).find((c) => c.text === 'Done means deployed')!
  assert.ok(ops.some((o) => o.kind === 'remove' && o.id === gone.id), 'the card of an annotation no longer in the file is removed')
  assert.ok(plan.removed.some((l) => l.id === gone.id))
  const keep = cards(first).find((c) => c.text === 'Waits for legal')!
  if (keep.id === moved.id) {
    const op = ops.find((o) => o.kind === 'update' && o.id === moved.id)!
    assert.equal(op.patch!.x, undefined, 'a moved card keeps its place')
  }
  // the person's move: kept whatever the new number
  const movedNow = next.find((i) => i.id === moved.id)
  if (movedNow) {
    const op = ops.find((o) => o.kind === 'update' && o.id === moved.id)!
    assert.deepEqual([op.patch!.x, op.patch!.y], [undefined, undefined])
    assert.equal((op.patch!.data as Record<string, unknown>).callout, calloutOf(movedNow))
  }
  assert.ok(ops.some((o) => o.kind === 'add' && o.item?.text === 'Ordered by priority'))
})

test('canvas_snapshot draws an annotation card with its number, the same number pinned on its item, and a TODO as a check box', async () => {
  const { renderSnapshot } = await import('../src/snapshot.js')
  const { items } = placeInFrame({}, { kind: 'kanban', key: 'k' }, render('kanban', KANBAN, { scope: 'k', now: NOW, at: { x: 0, y: 44 } }), NOW)
  const todo: Item = { id: 'todo.1', type: 'comment', x: -60, y: 0, w: 260, h: 90, text: 'Ask legal', target: 'k.card.q1', data: { todo: { state: 'open' } }, createdBy: 'user', updatedBy: 'user', updatedAt: NOW }
  const done: Item = { ...todo, id: 'todo.2', x: -60, y: 40, data: { todo: { state: 'done', answer: 'yes' } } }
  const board: Board = { id: 'b', title: 'Work', kind: 'freeform', seq: 1, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries([...items, todo, done].map((i) => [i.id, i])) }
  const s = renderSnapshot(board, { frame: 'k' })
  const card = cards(items)[0]
  const g = s.svg.slice(s.svg.indexOf(`<g data-id="${card.id}">`))
  const mine = g.slice(0, g.indexOf('</g>'))
  assert.match(mine, /<rect [^>]*width="240"/, 'the card at its own size, not a badge')
  assert.ok(mine.includes('Waits for legal'))
  assert.equal((mine.match(/<circle /g) ?? []).length, 2, 'a pin on the card and one on its item')
  assert.match(mine, />1<\/text>[\s\S]*>1<\/text>/)
  const t = s.svg.slice(s.svg.indexOf('<g data-id="todo.2">'))
  assert.match(t.slice(0, t.indexOf('</g>')), /<path d="M[^"]+l3\.5 3\.5l6-7"/, 'a done TODO is ticked')
  assert.ok(s.region.y + s.region.h >= Math.max(...cards(items).map((c) => c.y + c.h)), 'the region holds the cards')
})
