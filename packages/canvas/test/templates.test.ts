import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render, renderEventStorming, renderUserStoryMap, renderUserJourney, renderWireframe, renderWorkflow, renderFreeform, contentSchemas, diagramKinds } from '../src/templates/index.js'
import { demoBoards } from '../src/demo.js'
import type { Item } from '../src/model.js'

const NOW = '2026-09-22T00:00:00.000Z'

function overlaps(a: Item, b: Item) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

test('every demo board content validates and renders', () => {
  for (const b of demoBoards) {
    const parsed = contentSchemas[b.kind].safeParse(b.content)
    assert.ok(parsed.success, `${b.title}: ${parsed.success ? '' : parsed.error.message}`)
    const items = render(b.kind, parsed.data, { now: NOW })
    assert.ok(items.length > 3, `${b.title} rendered only ${items.length} items`)
    const ids = new Set(items.map((i) => i.id))
    assert.equal(ids.size, items.length, `${b.title}: duplicate ids`)
    for (const i of items) {
      assert.equal(i.createdBy, 'agent')
      assert.equal(i.updatedAt, NOW)
      if (i.parent) assert.ok(ids.has(i.parent), `${b.title}: ${i.id} parent ${i.parent} missing`)
      if (i.type === 'arrow') {
        assert.ok(ids.has(i.from!) && ids.has(i.to!), `${b.title}: arrow endpoints missing`)
      }
    }
  }
})

test('rendering is deterministic: same content → same ids and geometry', () => {
  for (const b of demoBoards) {
    const a = render(b.kind, b.content, { now: NOW })
    const c = render(b.kind, b.content, { now: NOW })
    assert.deepEqual(a, c)
  }
})

test('all diagram kinds are covered', () => {
  assert.deepEqual([...diagramKinds].sort(), ['domain-story', 'event-storming', 'freeform', 'kanban', 'user-journey', 'user-story-map', 'wireframe', 'workflow'])
})

test('event storming: big-picture drops commands/policies, process keeps them', () => {
  const content = demoBoards[0].content as Parameters<typeof renderEventStorming>[0]
  const big = renderEventStorming({ ...content, level: 'big-picture' }, { now: NOW })
  const proc = renderEventStorming({ ...content, level: 'process' }, { now: NOW })
  assert.equal(big.filter((i) => i.role === 'command').length, 0)
  assert.equal(big.filter((i) => i.role === 'policy').length, 0)
  assert.ok(big.filter((i) => i.role === 'event').length === content.events.length)
  assert.ok(big.filter((i) => i.role === 'hotspot').length === content.hotspots!.length)
  assert.equal(proc.filter((i) => i.role === 'command').length, content.commands!.length)
  assert.equal(proc.filter((i) => i.role === 'policy').length, content.policies!.length)
  assert.equal(proc.filter((i) => i.role === 'read-model').length, 2)
  assert.equal(proc.filter((i) => i.role === 'external').length, 2)
})

test('event storming: lanes contain their events; no two stickies of the same role overlap in a lane', () => {
  const items = renderEventStorming(demoBoards[0].content as never, { now: NOW })
  const lanes = items.filter((i) => i.type === 'lane')
  assert.equal(lanes.length, 3)
  const events = items.filter((i) => i.role === 'event')
  for (const e of events) {
    const lane = lanes.find((l) => l.id === e.parent)
    assert.ok(lane, `event ${e.text} has no lane`)
    assert.ok(e.x >= lane!.x && e.x + e.w <= lane!.x + lane!.w && e.y >= lane!.y && e.y + e.h <= lane!.y + lane!.h, `event "${e.text}" outside its lane`)
  }
  // No two stickies overlap at all — whatever their role. (Pivotal marker lines are
  // meant to cross the band, so they are excluded.)
  const stickies = items.filter((i) => i.type === 'sticky')
  for (let a = 0; a < stickies.length; a++)
    for (let b = a + 1; b < stickies.length; b++)
      assert.ok(!overlaps(stickies[a], stickies[b]), `${stickies[a].role} "${stickies[a].text}" overlaps ${stickies[b].role} "${stickies[b].text}"`)
  // Events follow the timeline left → right in declaration order.
  const xs = events.sort((a, b) => a.order! - b.order!).map((e) => e.x)
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1])
})

test('event storming: commands point at their event, policies whenever→then', () => {
  const items = renderEventStorming(demoBoards[0].content as never, { now: NOW })
  const byText = (t: string) => items.find((i) => i.text === t)!
  const arrows = items.filter((i) => i.type === 'arrow')
  assert.ok(arrows.some((a) => a.from === byText('Qualify card').id && a.to === byText('Card qualified (size XS–L, RFA)').id))
  const policy = byText('Whenever a card is confirmed Ready, qualify it')
  assert.ok(arrows.some((a) => a.from === byText('Card confirmed into Ready').id && a.to === policy.id && a.label === 'whenever'))
  assert.ok(arrows.some((a) => a.from === policy.id && a.to === byText('Qualify card').id && a.label === 'then'))
  const hs = byText('Mock shipped as implementation')
  assert.equal(hs.role, 'hotspot')
  assert.equal(hs.color, 'purple') // the book: hotspots are purple, red is not a sticky colour (p.307)
})

test('event storming: software level adds aggregate frames', () => {
  const items = renderEventStorming({ ...(demoBoards[0].content as object), level: 'software' } as never, { now: NOW })
  const frame = items.find((i) => i.type === 'frame' && i.role === 'aggregate')
  assert.ok(frame)
  assert.match(frame!.text!, /Card/)
  assert.ok(items.some((i) => i.role === 'aggregate' && i.type === 'sticky' && i.color === 'pale-yellow'))
})

test('user story map: releases become lanes, stories land under their step', () => {
  const items = renderUserStoryMap(demoBoards[2].content as never, { now: NOW })
  const lanes = items.filter((i) => i.type === 'lane')
  assert.deepEqual(lanes.map((l) => l.text), ['v1 (replay + lint)', 'v2 (event-driven)', 'Later'])
  const step = items.find((i) => i.role === 'step' && i.text === 'Lint it')!
  const story = items.find((i) => i.role === 'story' && i.text === 'Dead outcome references fail lint')!
  assert.equal(story.x, step.x)
  assert.equal(story.parent, lanes[0].id)
  const laneY = lanes.map((l) => l.y)
  for (let i = 1; i < laneY.length; i++) assert.ok(laneY[i] > laneY[i - 1])
  const activities = items.filter((i) => i.role === 'activity')
  assert.equal(activities.length, 3)
})

test('user journey: emotion curve maps -2..2 to rows, arrows connect stages', () => {
  const items = renderUserJourney(demoBoards[3].content as never, { now: NOW })
  const emotions = items.filter((i) => i.role === 'emotion').sort((a, b) => a.x - b.x)
  assert.equal(emotions.length, 6)
  const hi = emotions.find((e) => e.data?.emotion === 2)!
  const lo = emotions.find((e) => e.data?.emotion === -2)!
  assert.ok(hi.y < lo.y, 'higher emotion should be drawn higher')
  assert.equal(items.filter((i) => i.role === 'emotion-curve').length, 5)
  assert.equal(items.filter((i) => i.role === 'stage').length, 6)
  assert.ok(items.some((i) => i.role === 'pain' && i.color === 'red'))
})

test('wireframe: elements live inside their screen on the 12-col grid', () => {
  const items = renderWireframe(demoBoards[4].content as never, { now: NOW })
  const screens = items.filter((i) => i.role === 'screen')
  assert.equal(screens.length, 2)
  assert.ok(screens[1].x > screens[0].x + screens[0].w)
  for (const el of items.filter((i) => i.type === 'wireframe' && i.role !== 'screen')) {
    const s = screens.find((x) => x.id === el.parent)!
    assert.ok(el.x >= s.x && el.x + el.w <= s.x + s.w + 1 && el.y >= s.y && el.y + el.h <= s.y + s.h + 1, `${el.role} "${el.text}" outside screen`)
  }
  const notes = items.filter((i) => i.type === 'comment')
  assert.equal(notes.length, 2)
  assert.ok(notes.every((n) => items.some((i) => i.id === n.target)))
})

test('workflow: triggers in layer 0, layered left → right, edges labelled', () => {
  const items = renderWorkflow(demoBoards[5].content as never, { now: NOW })
  const node = (id: string) => items.find((i) => i.data?.nodeId === id)!
  assert.equal(node('trello').x, node('reconcile').x)
  assert.ok(node('qualify').x > node('trello').x)
  assert.ok(node('plan').x > node('qualify').x)
  assert.ok(node('build').x > node('size-ok').x)
  assert.equal(node('build').x, node('split').x)
  assert.equal(node('trello').color, 'pink')
  assert.equal(node('plan').color, 'lilac')
  assert.equal(node('confirm').color, 'green')
  const edge = items.find((i) => i.type === 'arrow' && i.from === node('trello').id && i.to === node('qualify').id)!
  assert.match(edge.label!, /event\.data\.to == 'Ready'/)
  // An ai node carries its agent on a second label line and in data.agent (awd graph --json sets config.agent).
  const withAgent = renderWorkflow({ nodes: [{ id: 'plan', kind: 'ai', label: 'plan\n@planner (opus)', config: { agent: 'planner' } }], edges: [] } as never, { now: NOW })
  const plan = withAgent.find((i) => i.data?.nodeId === 'plan')!
  assert.equal(plan.text, 'plan\n@planner (opus)')
  assert.equal(plan.data?.agent, 'planner')
})

test('freeform: geometry filled in, explicit ids kept', () => {
  const items = renderFreeform({ items: [{ text: 'a' }, { id: 'x', type: 'comment', text: 'why?', target: 'nope' }] }, { now: NOW })
  assert.equal(items.length, 2)
  assert.equal(items[1].id, 'x')
  assert.equal(items[0].w, 160)
  assert.equal(items[0].color, 'yellow')
})

test('at offset shifts everything except arrows', () => {
  const a = renderWorkflow(demoBoards[5].content as never, { now: NOW })
  const b = renderWorkflow(demoBoards[5].content as never, { now: NOW, at: { x: 100, y: 50 } })
  for (let i = 0; i < a.length; i++) {
    if (a[i].type === 'arrow') assert.deepEqual(a[i], b[i])
    else {
      assert.equal(b[i].x, a[i].x + 100)
      assert.equal(b[i].y, a[i].y + 50)
    }
  }
})

test('workflow: agents become an Agents frame above the graph; owns/delegates arrows; nothing overlaps', () => {
  const content = {
    name: 'crew',
    nodes: [
      { id: 'go', kind: 'trigger', label: 'go (cli)' },
      { id: 'plan', kind: 'ai', label: 'plan\n@planner (opus)', config: { agent: 'planner' } },
      { id: 'review', kind: 'ai', label: 'review\n@reviewer (sonnet)', config: { agent: 'reviewer' } },
      { id: 'arch', kind: 'ai', label: 'arch\n@architect (opus)', config: { agent: 'architect' } },
    ],
    edges: [
      { from: 'go', to: 'plan', label: 'ping' },
      { from: 'plan', to: 'review', label: 'done' },
      { from: 'review', to: 'arch', label: 'needs-architect' },
    ],
    agents: [
      { id: 'planner', model: 'opus', tools: ['Read'], steps: ['plan'] },
      { id: 'reviewer', model: 'sonnet', delegates: ['architect'], steps: ['review'] },
      { id: 'architect', model: 'opus', runner: 'cli', steps: ['arch', 'ghost-step'] },
    ],
  }
  const items = renderWorkflow(content as never, { now: NOW })
  const frame = items.find((i) => i.role === 'agents')!
  assert.equal(frame.type, 'frame')
  const agents = items.filter((i) => i.role === 'agent')
  assert.equal(agents.length, 3)
  for (const a of agents) {
    assert.equal(a.parent, frame.id)
    assert.equal(a.color, 'lilac')
    assert.equal(a.type, 'card')
    assert.ok(typeof a.data?.agent === 'string')
    assert.ok(a.x >= frame.x && a.x + a.w <= frame.x + frame.w && a.y >= frame.y && a.y + a.h <= frame.y + frame.h, `agent ${a.id} outside frame`)
  }
  assert.equal(agents.find((a) => a.data?.agent === 'architect')!.text, '@architect\nopus · cli')
  assert.equal(agents.find((a) => a.data?.agent === 'planner')!.text, '@planner\nopus · claude-code')
  // the graph moved below the frame: no step card overlaps the frame or an agent card
  const steps = items.filter((i) => i.type === 'card' && i.role !== 'agent')
  for (const s of steps) {
    assert.ok(s.y >= frame.y + frame.h, `step ${s.id} overlaps the Agents frame`)
    for (const a of agents) assert.ok(!overlaps(s, a), `step ${s.id} overlaps agent ${a.id}`)
  }
  // owns arrows: one per existing step, none for the ghost step; delegates arrow between agent cards
  const owns = items.filter((i) => i.type === 'arrow' && i.role === 'owns')
  assert.equal(owns.length, 3)
  const cardIds = new Set(items.filter((i) => i.type === 'card').map((i) => i.id))
  for (const o of owns) assert.ok(cardIds.has(o.to!) && cardIds.has(o.from!), 'owns arrow points at a missing card')
  const del = items.filter((i) => i.type === 'arrow' && i.role === 'delegates')
  assert.equal(del.length, 1)
  assert.equal(del[0].label, 'delegates')
  assert.equal(del[0].from, agents.find((a) => a.data?.agent === 'reviewer')!.id)
  // deterministic and update-in-place friendly
  assert.deepEqual(renderWorkflow(content as never, { now: NOW }), items)
  assert.equal(agents[0].id, 'wf.agent.planner')
  // no agents → no frame, graph starts at the top as before
  const plain = renderWorkflow({ ...content, agents: [] } as never, { now: NOW })
  assert.ok(!plain.some((i) => i.role === 'agents'))
  assert.ok(plain.find((i) => i.data?.nodeId === 'go')!.y < items.find((i) => i.data?.nodeId === 'go')!.y)
})
