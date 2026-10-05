import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Edge } from '@xyflow/react'
import type { Board, Item } from '../src/model.js'
import { autoSides, bestTurn, crossings, hits, planSides, routeOf, type Box, type Side } from '../web/src/flow/route.js'
import { applyWireMode, catchAllWires, wireBadges } from '../web/src/flow/catchAll.js'
import { boardToFlow } from '../web/src/flow/boardToFlow.js'

const now = '2026-10-02T00:00:00.000Z'
const item = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 160, h: 110, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...p }) as Item
const board = (items: Item[]): Board => ({ id: 'b', title: 't', kind: 'workflow', seq: 0, items: Object.fromEntries(items.map((i) => [i.id, i])) }) as unknown as Board

// ---- task 3: the route that crosses the fewest boxes

// card-pipeline as `awd graph` lays it out: human-review sits lower right; review is up and back, with qa
// right under review. Facing sides (top → bottom) go up into review through qa (and along ready-gate/park).
const B = (x: number, y: number): Box => ({ x, y, w: 160, h: 110 })
const humanReview = B(4960, 980)
const review = B(3730, 520)
const others = [B(3730, 670) /* qa */, B(4140, 730) /* ready-gate */, B(4550, 730) /* park */, B(4960, 830) /* escalate */, B(4550, 570) /* fix-round */, B(4140, 520) /* architect-review */, B(3320, 520) /* push */]

test('planSides: human-review.bounced no longer goes up into review through qa', () => {
  const auto = autoSides(humanReview, review) as { fromSide: Side; toSide: Side }
  const facing = routeOf(humanReview, review, auto.fromSide, auto.toSide, others)!
  assert.ok(facing.some((p, i) => i > 0 && hits({ x1: facing[i - 1].x, y1: facing[i - 1].y, x2: p.x, y2: p.y }, others[0])), 'the facing route does cross qa (the known case)')
  const plan = planSides(humanReview, review, others)
  assert.equal(plan.n, 0)
  const pts = routeOf(humanReview, review, plan.fromSide, plan.toSide, others)!
  assert.equal(crossings(pts, others), 0, `${plan.fromSide} → ${plan.toSide} still crosses a box`)
})

test('planSides: a clear forward wire keeps its facing sides', () => {
  assert.deepEqual(planSides(B(0, 0), B(400, 0), [B(200, 300)]), { fromSide: 'right', toSide: 'left', n: 0 })
  // a fix round back along the row keeps its loop underneath when nothing is in the way
  assert.equal(planSides(B(800, 0), B(0, 0), []).fromSide, 'bottom')
})

test('planSides: switches sides when the facing pair has no clear route', () => {
  // target ahead, but a wall of boxes stands between them in every gap: going round over the top is the only clear way
  const wall = [B(250, -400), B(250, -260), B(250, -120), B(250, 20), B(250, 160), B(250, 300)]
  const plan = planSides(B(0, 0), B(500, 0), wall.filter((b) => b.y !== -400))
  assert.ok(plan.n === 0, `planned ${plan.fromSide}/${plan.toSide} crosses ${plan.n}`)
  assert.notDeepEqual([plan.fromSide, plan.toSide], ['right', 'left'])
})

test('bestTurn: a right-to-left run (left side → right side) also turns in a gap', () => {
  const box = { x: 250, y: 150, w: 100, h: 100 }
  const cx = bestTurn(600, 0, 0, 200, [box], 300)
  const segs = [
    { x1: 600, y1: 0, x2: cx, y2: 0 },
    { x1: cx, y1: 0, x2: cx, y2: 200 },
    { x1: cx, y1: 200, x2: 0, y2: 200 },
  ]
  assert.ok(cx < 600 && cx > 0)
  assert.ok(!segs.some((s) => hits(s, box)), `turn at ${cx} crosses the box`)
})

// ---- task 2: catch-all listeners as badges

const node = (id: string, x: number, data: Record<string, unknown> = {}) => item({ id, type: 'card', x, y: 0, data: { nodeId: id, ...data } })
const wire = (id: string, from: string, to: string, event: string, extra: Record<string, unknown> = {}) =>
  item({ id, type: 'arrow', role: 'flow', from, to, label: event, data: { event: { event, from, to, ...extra } } })

function pipeline(): Board {
  return board([
    node('trello', 0, { kind: 'trigger', config: { on: 'webhook' } }),
    node('cron', 0, { kind: 'trigger', config: { on: 'cron', every: '30m' } }),
    node('plan', 200),
    node('confirm', 400, { kind: 'human' }),
    node('human-review', 600, { kind: 'human' }),
    node('sweep', 200),
    node('any-failed', 0, { kind: 'outcome', config: { wildcard: true } }),
    node('reflect', 200),
    node('a', 800),
    node('b', 900),
    node('c', 1000),
    node('d', 1100),
    node('park', 1300),
    wire('w.start', 'trello', 'plan', 'card.moved', { condition: "event.data.to == 'Planning'" }),
    wire('w.r1', 'trello', 'confirm', 'card.moved', { resume: true }),
    wire('w.r2', 'trello', 'human-review', 'card.moved', { resume: true }),
    wire('w.tick', 'cron', 'sweep', 'tick'),
    wire('w.star', 'any-failed', 'reflect', '*.failed'),
    wire('w.flow', 'plan', 'confirm', 'plan.done'),
    // park listens to four different blocks: a hub
    wire('w.p1', 'a', 'park', 'a.failed'),
    wire('w.p2', 'b', 'park', 'b.failed'),
    wire('w.p3', 'b', 'park', 'b.timeout'),
    wire('w.p4', 'c', 'park', 'c.failed'),
    wire('w.p5', 'd', 'park', 'd.failed'),
    // plan.done to four blocks: a fan-out
    wire('w.f1', 'confirm', 'a', 'confirm.ok'),
    wire('w.f2', 'confirm', 'b', 'confirm.ok'),
    wire('w.f3', 'confirm', 'c', 'confirm.ok'),
    wire('w.f4', 'confirm', 'd', 'confirm.ok'),
    item({ id: 'owns', type: 'arrow', role: 'owns', from: 'a', to: 'b' }),
  ])
}

test('catchAllWires: wildcard, resume, clock, fan-out and fan-in — and nothing else', () => {
  const c = catchAllWires(pipeline())
  assert.equal(c.get('w.star'), 'wildcard')
  assert.equal(c.get('w.r1'), 'resume')
  assert.equal(c.get('w.r2'), 'resume')
  assert.equal(c.get('w.tick'), 'clock')
  for (const id of ['w.p1', 'w.p2', 'w.p3', 'w.p4', 'w.p5']) assert.equal(c.get(id), 'fan-in', id)
  for (const id of ['w.f1', 'w.f2', 'w.f3', 'w.f4']) assert.equal(c.get(id), 'fan-out', id)
  // the trigger's real start wire is not a fan-out just because the same event also resumes two steps
  assert.equal(c.has('w.start'), false)
  assert.equal(c.has('w.flow'), false)
  assert.equal(c.has('owns'), false)
})

test('wireBadges: listener badges name the subscription, emitter badges say where it goes', () => {
  const b = pipeline()
  const badges = wireBadges(b, catchAllWires(b), new Set())
  const texts = (id: string, end: 'in' | 'out') => (badges.get(id) ?? []).filter((x) => x.end === end).map((x) => x.text)
  assert.deepEqual(texts('reflect', 'in'), ['on *.failed'])
  assert.deepEqual(texts('confirm', 'in'), ['resume: card.moved'])
  assert.deepEqual(texts('sweep', 'in'), ['on tick'])
  assert.deepEqual(texts('park', 'in'), ['on 5 events · 4 blocks'])
  assert.deepEqual(texts('trello', 'out'), ['card.moved → 2 blocks'])
  assert.deepEqual(texts('b', 'out'), ['2 events → park'])
  assert.deepEqual(texts('confirm', 'out'), ['confirm.ok → 4 blocks'])
  assert.match(badges.get('park')![0].title, /b\.timeout ← b/)
  // a badge whose wires were all expanded reads as open
  const open = wireBadges(b, catchAllWires(b), new Set(['w.r1']))
  assert.equal(open.get('confirm')!.find((x) => x.end === 'in')!.open, true)
})

test('boardToFlow: catch-all wires are hidden behind badges, drawn when expanded or shown', () => {
  const b = pipeline()
  const hidden = (r: ReturnType<typeof boardToFlow>) => r.edges.filter((e) => e.hidden).map((e) => e.id).sort()
  const collapsed = boardToFlow(b, new Set(), new Set())
  assert.equal(hidden(collapsed).length, catchAllWires(b).size)
  assert.ok(!hidden(collapsed).includes('w.start'))
  assert.deepEqual(collapsed.nodes.find((n) => n.id === 'reflect')!.data.wireBadges!.map((x) => x.text), ['on *.failed'])
  const expanded = boardToFlow(b, new Set(), new Set(), { show: false, expanded: new Set(['w.star']) })
  assert.ok(!hidden(expanded).includes('w.star'))
  const shown = boardToFlow(b, new Set(), new Set(), { show: true, expanded: new Set() })
  assert.deepEqual(hidden(shown), [])
  assert.equal(shown.nodes.some((n) => n.data.wireBadges), false)
})

// ---- task 1: all / selected / none

test('applyWireMode: selected draws only the selection\'s wires, none draws none; tethers and picked wires stay', () => {
  const b = board([node('x', 0), node('y', 300), node('z', 600), item({ id: 'f', type: 'frame' }), item({ id: 'cm', type: 'comment', target: 'x' })])
  const e = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge => ({ id, source, target, type: 'item', ...extra })
  const edges: Edge[] = [e('xy', 'x', 'y'), e('yz', 'y', 'z'), e('zx', 'z', 'x', { hidden: true }), { id: 'tether:cm', source: 'cm', target: 'x', type: 'tether' }]
  const vis = (es: Edge[]) => es.filter((x) => !x.hidden).map((x) => x.id)
  assert.equal(applyWireMode(edges, 'all', [], b), edges, 'nothing to change in "all"')
  assert.deepEqual(vis(applyWireMode(edges, 'selected', ['x'], b)), ['xy', 'tether:cm'])
  assert.deepEqual(vis(applyWireMode(edges, 'selected', [], b)), ['tether:cm'])
  assert.deepEqual(vis(applyWireMode(edges, 'selected', ['f'], b)), ['tether:cm'], 'a frame selection picks no wires')
  assert.deepEqual(vis(applyWireMode(edges, 'none', ['x'], b)), ['tether:cm'])
  // a wire picked in the Inspector is drawn whatever the mode, even a collapsed catch-all
  const picked = edges.map((x) => (x.id === 'zx' || x.id === 'yz' ? { ...x, selected: true } : x))
  assert.deepEqual(vis(applyWireMode(picked, 'none', [], b)), ['yz', 'zx', 'tether:cm'])
})

test('trace view: all, faded, bundled per pair of diagrams, selected only, none; badges count; relations filter', async () => {
  const { applyTraceView, traceCounts, bundleKey, diagramOf, DEFAULT_TRACE_VIEW } = await import('../web/src/flow/traceView.js')
  const frame = (id: string) => item({ id, type: 'frame', role: 'diagram' })
  const el = (id: string, parent: string) => item({ id, type: 'card', parent })
  const trace = (id: string, from: string, to: string, rel = 'derived-from') => item({ id, type: 'arrow', role: 'trace', from, to, label: rel })
  const b = board([
    frame('es'), frame('map'), frame('ui'),
    el('cmd1', 'es'), el('cmd2', 'es'), el('story1', 'map'), el('story2', 'map'), el('screen', 'ui'),
    trace('t1', 'story1', 'cmd1'), trace('t2', 'story2', 'cmd2'), trace('t3', 'story2', 'cmd1', 'relates'),
    trace('t4', 'screen', 'story1', 'shows'), trace('t5', 'story1', 'story2', 'relates'),
    item({ id: 'flow', type: 'arrow', from: 'cmd1', to: 'cmd2' }),
  ])
  const e = (id: string, extra: Partial<Edge> = {}): Edge => ({ id, source: b.items[id].from!, target: b.items[id].to!, type: 'item', ...(b.items[id].role === 'trace' ? { className: 'wire-trace' } : {}), ...extra })
  const edges = ['t1', 't2', 't3', 't4', 't5', 'flow'].map((id) => e(id))
  const vis = (es: Edge[]) => es.filter((x) => !x.hidden).map((x) => x.id)
  const view = (patch: object) => ({ ...DEFAULT_TRACE_VIEW, ...patch })

  assert.equal(diagramOf(b, 'story1'), 'map')
  assert.equal(bundleKey(b, b.items.t1), 'es|map')
  assert.equal(bundleKey(b, b.items.t5), '', 'inside one diagram: not bundled')

  assert.equal(applyTraceView(edges, view({ mode: 'all' }), [], b), edges, 'nothing to change in "all"')
  // selected (the default): only the traces of the selected or hovered element; other wires are not touched
  assert.deepEqual(vis(applyTraceView(edges, DEFAULT_TRACE_VIEW, [], b)), ['flow'])
  assert.deepEqual(vis(applyTraceView(edges, DEFAULT_TRACE_VIEW, ['story1'], b)), ['t1', 't4', 't5', 'flow'])
  assert.deepEqual(vis(applyTraceView(edges, view({ mode: 'none' }), ['story1'], b)), ['flow'])
  // a trace picked in the Inspector is drawn in every mode
  assert.deepEqual(vis(applyTraceView(edges.map((x) => (x.id === 't2' ? { ...x, selected: true } : x)), view({ mode: 'none' }), [], b)), ['t2', 'flow'])
  // faded: all drawn, those away from the selection faint
  const faded = applyTraceView(edges, view({ mode: 'faded' }), ['story1'], b)
  assert.deepEqual(vis(faded), ['t1', 't2', 't3', 't4', 't5', 'flow'])
  assert.deepEqual(faded.filter((x) => x.className?.includes('trace-faded')).map((x) => x.id), ['t2', 't3'])
  // bundled: one line stands for the three es ↔ map traces; a single trace and one inside a diagram stay as they are
  const bundled = applyTraceView(edges, view({ mode: 'bundled' }), [], b)
  assert.deepEqual(vis(bundled), ['t1', 't4', 't5', 'flow'])
  const stand = bundled.find((x) => x.id === 't1')!
  assert.equal(stand.label, '3 traces')
  assert.deepEqual((stand.data as { bundle: object }).bundle, { key: 'es|map', count: 3, open: false })
  assert.match(stand.className!, /trace-bundle/)
  assert.deepEqual(vis(applyTraceView(edges, view({ mode: 'bundled' }), [], b, new Set(['es|map']))), ['t1', 't2', 't3', 't4', 't5', 'flow'], 'a clicked bundle draws its traces')
  assert.deepEqual(vis(applyTraceView(edges, view({ mode: 'bundled' }), ['story2'], b)), ['t1', 't2', 't3', 't4', 't5', 'flow'], 'the selection\'s traces are drawn too')
  // leaving bundled takes the bundle off again
  const back = applyTraceView(bundled, view({ mode: 'all' }), [], b).find((x) => x.id === 't1')!
  assert.equal((back.data as { bundle?: object }).bundle, undefined)
  assert.equal(back.className, 'wire-trace')
  // relations: "relates" off hides and does not count those traces
  const noRelates = view({ mode: 'all', rels: { ...DEFAULT_TRACE_VIEW.rels, relates: false } })
  assert.deepEqual(vis(applyTraceView(edges, noRelates, [], b)), ['t1', 't2', 't4', 'flow'])
  assert.deepEqual(Object.fromEntries(traceCounts(b, DEFAULT_TRACE_VIEW)), { story1: 3, cmd1: 2, story2: 3, cmd2: 1, screen: 1 })
  assert.equal(traceCounts(b, noRelates).get('story2'), 1)
  // the wire mode no longer hides traces
  assert.deepEqual(vis(applyWireMode(edges, 'none', [], b)), ['t1', 't2', 't3', 't4', 't5'])
})
