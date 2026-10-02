import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { renderSnapshot, SnapshotError } from '../src/snapshot.js'
import { KANBAN_GAP, KANBAN_HEADER, KANBAN_PAD } from '../src/shown.js'
import { render } from '../src/templates/index.js'

const now = '2026-10-02T00:00:00.000Z'
const item = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 100, h: 80, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...p }) as Item
const board = (items: Item[], kind: Board['kind'] = 'freeform'): Board => ({ id: 'b', title: 'Test board', kind, seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) })

const twoFrames = () =>
  board([
    item({ id: 'diagram.es', type: 'frame', role: 'diagram', x: 0, y: 0, w: 600, h: 300, text: 'Ask AI', data: { diagram: { kind: 'event-storming', key: 'es' } } }),
    item({ id: 'es.event.a', type: 'sticky', role: 'event', color: 'orange', x: 40, y: 60, w: 120, h: 90, text: 'Ask sent', parent: 'diagram.es' }),
    item({ id: 'es.command.b', type: 'sticky', role: 'command', color: 'blue', x: 300, y: 60, w: 120, h: 90, text: 'Send ask', parent: 'diagram.es' }),
    item({ id: 'es.arrow.ab', type: 'arrow', from: 'es.command.b', to: 'es.event.a', label: 'produces' }),
    item({ id: 'diagram.sm', type: 'frame', role: 'diagram', x: 800, y: 0, w: 400, h: 300, text: 'Story map', data: { diagram: { kind: 'user-story-map', key: 'sm' } } }),
    item({ id: 'sm.story.x', type: 'card', role: 'story', x: 840, y: 60, w: 150, h: 90, text: 'Chat with the selection', parent: 'diagram.sm' }),
    item({ id: 'c1', type: 'comment', x: 170, y: 40, w: 220, h: 80, text: 'why here?', target: 'es.event.a', createdBy: 'user' }),
    item({ id: 'c2', type: 'comment', x: 0, y: 0, w: 220, h: 80, text: 'because', target: 'c1' }),
  ])

test('the whole board: every item, wires with arrowheads, a self-contained svg', () => {
  const s = renderSnapshot(twoFrames())
  assert.match(s.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+" viewBox="/)
  for (const t of ['Ask sent', 'Send ask', 'Chat with the', 'Ask AI', 'Story map', 'produces']) assert.ok(s.svg.includes(t), t)
  assert.ok(s.svg.includes('marker-end="url(#ah-ink2)"'))
  assert.ok(!s.svg.includes('var(--'), 'no CSS variables')
  assert.ok(!/href=/.test(s.svg), 'no external references')
  // a comment thread is a folded badge with its message count
  assert.ok(s.svg.includes('data-id="c1"'))
  assert.ok(!s.svg.includes('data-id="c2"'), 'a reply is inside its thread')
  assert.match(s.svg, />2<\/text>/)
  assert.equal(s.scale, 1)
  assert.equal(s.width, Math.round(s.region.w + 48))
})

test('a frame key: only that frame, region = the frame box (and its title above)', () => {
  const s = renderSnapshot(twoFrames(), { frame: 'sm' })
  assert.ok(s.svg.includes('Chat with the'))
  assert.ok(!s.svg.includes('Ask sent'))
  assert.deepEqual(s.region, { x: 800, y: -28, w: 400, h: 328 })
  const byId = renderSnapshot(twoFrames(), { frame: 'diagram.sm' })
  assert.equal(byId.svg, s.svg)
  // the es frame brings its wire and the comment on its event
  const es = renderSnapshot(twoFrames(), { frame: 'es' })
  assert.ok(es.svg.includes('data-id="es.arrow.ab"'))
  assert.ok(es.svg.includes('data-id="c1"'))
})

test('ids: those items (a container brings its contents), wires only between drawn items', () => {
  const s = renderSnapshot(twoFrames(), { ids: ['es.event.a'] })
  assert.ok(s.svg.includes('Ask sent'))
  assert.ok(!s.svg.includes('Send ask'))
  assert.ok(!s.svg.includes('data-id="es.arrow.ab"'))
  // the comment thread on it comes along (its badge at 170,40)
  assert.deepEqual(s.region, { x: 40, y: 40, w: 156, h: 110 })
  const both = renderSnapshot(twoFrames(), { ids: ['diagram.sm', 'es.command.b'] })
  assert.ok(both.svg.includes('Chat with the') && both.svg.includes('Send ask'))
})

test('an unknown frame or item is a 404 that names the keys; bad options a 400', () => {
  assert.throws(() => renderSnapshot(twoFrames(), { frame: 'nope' }), (e: unknown) => e instanceof SnapshotError && e.status === 404 && /es, sm/.test(e.message))
  assert.throws(() => renderSnapshot(twoFrames(), { ids: ['ghost'] }), (e: unknown) => e instanceof SnapshotError && e.status === 404)
  assert.throws(() => renderSnapshot(twoFrames(), { scale: 0 }), (e: unknown) => e instanceof SnapshotError && e.status === 400)
  assert.throws(() => renderSnapshot(twoFrames(), { theme: 'pink' as 'dark' }), (e: unknown) => e instanceof SnapshotError && e.status === 400)
  // a legacy board's own kind is the whole board
  const legacy = { ...twoFrames(), kind: 'event-storming' as const }
  assert.equal(renderSnapshot(legacy, { frame: 'event-storming' }).svg, renderSnapshot(legacy).svg)
})

test('a kanban card is drawn where the page shows it (stacked), not at its stored y', () => {
  const b = board([
    item({ id: 'col', type: 'lane', role: 'column', x: 0, y: 0, w: 280, h: 600, text: 'Todo' }),
    item({ id: 'card', type: 'card', role: 'card', x: 500, y: 900, w: 240, h: 96, text: 'Lost card', parent: 'col', data: { labels: ['ops'], size: 'S' } }),
  ])
  const s = renderSnapshot(b)
  const y = KANBAN_HEADER + KANBAN_GAP
  assert.ok(s.svg.includes(`<g data-id="card"><rect x="${KANBAN_PAD}" y="${y}" width="240" height="96"`), 'card at the stacked position')
  assert.ok(!s.svg.includes('y="900"'))
  assert.ok(s.svg.includes('>ops<') && s.svg.includes('>S<'))
  assert.ok(s.svg.includes('>1<'), 'the column counts its card')
})

test('dark theme: the dark paper and sticky colours', () => {
  const light = renderSnapshot(twoFrames())
  const dark = renderSnapshot(twoFrames(), { theme: 'dark' })
  assert.ok(light.svg.includes('fill="#fbfbf9"'))
  assert.ok(dark.svg.includes('fill="#1b2027"'))
  assert.ok(dark.svg.includes('fill="#d9922e"'), 'dark orange event')
})

test('text is escaped for XML', () => {
  const b = board([item({ id: 's', type: 'sticky', text: '<script>alert("x")</script> & co' })])
  const s = renderSnapshot(b)
  assert.ok(!s.svg.includes('<script>'))
  assert.ok(s.svg.includes('&lt;script&gt;'))
  assert.ok(s.svg.includes('&amp; co'))
})

test('long sticky text wraps into several lines, cut where the box ends', () => {
  const text = 'When the person sends an ask from the canvas the studio picks it up and opens a session for the board'
  const s = renderSnapshot(board([item({ id: 's', type: 'sticky', w: 160, h: 200, text })]))
  const lines = (s.svg.match(/<tspan /g) ?? []).length
  assert.ok(lines >= 4, `${lines} lines`)
  const small = renderSnapshot(board([item({ id: 's', type: 'sticky', w: 160, h: 60, text })]))
  assert.ok((small.svg.match(/<tspan /g) ?? []).length < lines, 'fewer lines fit a short box')
})

test('a big region is scaled down to maxPx, with a note saying how to get detail', () => {
  const b = board([item({ id: 'a', type: 'sticky', x: 0, y: 0 }), item({ id: 'z', type: 'sticky', x: 9000, y: 500 })])
  const s = renderSnapshot(b, { maxPx: 1000 })
  assert.ok(s.width <= 1000 && s.height <= 1000)
  assert.ok(s.scale < 0.2)
  assert.ok(s.notes.some((n) => /scaled to .* to fit 1000 px/.test(n)))
  assert.equal(renderSnapshot(b, { maxPx: 99999 }).width <= 4000, true)
})

test('UI mock elements and domain-story pictograms draw recognisably', () => {
  const ui = render('ui-mock', { screens: [{ id: 'home', name: 'Home', body: [{ type: 'heading', text: 'Welcome', level: 1 }, { type: 'button', id: 'go', text: 'Start' }, { type: 'table', id: 't', columns: ['A', 'B'], rows: [['1', '[Done]']] }] }] })
  const u = renderSnapshot(board(ui, 'ui-mock'))
  for (const t of ['Welcome', 'Start', 'Done', '>A<']) assert.ok(u.svg.includes(t), t)
  const ds = board([
    item({ id: 'a', type: 'card', role: 'actor', x: 0, y: 0, w: 132, h: 100, text: 'Reader', data: { ds: 'actor', kind: 'person' } }),
    item({ id: 'o', type: 'card', role: 'work-object', x: 300, y: 0, w: 132, h: 100, text: 'Card', data: { ds: 'object', kind: 'document' } }),
    item({ id: 'w', type: 'arrow', role: 'activity', from: 'a', to: 'o', label: 'shows', data: { ds: true, seq: 1 } }),
  ])
  const d = renderSnapshot(ds)
  assert.ok(d.svg.includes('<circle cx="12" cy="7.2"'), 'a person glyph')
  assert.ok(d.svg.includes('>shows<') && d.svg.includes('>1</text>'), 'verb and sequence number')
})

test('deterministic: the same board gives the same svg', () => {
  assert.equal(renderSnapshot(twoFrames()).svg, renderSnapshot(twoFrames()).svg)
})
