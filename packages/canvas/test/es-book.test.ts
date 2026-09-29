// EventStorming drawn the way the book describes it (docs/diagrams.md §3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderEventStorming } from '../src/templates/index.js'
import { demoBoards } from '../src/demo.js'
import type { Item } from '../src/model.js'
import { studioEs } from './fixtures-es.js'

const NOW = '2026-09-23T00:00:00.000Z'
const overlaps = (a: Item, b: Item) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const items = renderEventStorming(studioEs, { now: NOW, scope: 'studio-es' })
const byId = (id: string) => items.find((i) => i.id === id)!
const wire = (from: string, to: string) => items.find((i) => i.type === 'arrow' && i.from === from && i.to === to)

test('ids are <scope>.<role>.<element id>; every item carries its element id', () => {
  assert.equal(byId('studio-es.event.ask-sent').text, 'Ask AI sent')
  assert.equal(byId('studio-es.command.send-ask').data?.element, 'send-ask')
  assert.equal(byId('studio-es.policy.whenever-asked').role, 'policy')
  // an element without an explicit id gets the slug of its text
  assert.ok(items.some((i) => i.id === 'studio-es.milestone.first-chat'))
})

test('the book palette: purple hotspots, pink systems, small yellow people, green read models (p.314)', () => {
  assert.equal(byId('studio-es.hotspot.cost').color, 'purple')
  assert.equal(byId('studio-es.system.canvas.send-ask').color, 'pink')
  assert.equal(byId('studio-es.read-model.thread').color, 'green')
  const person = items.find((i) => i.role === 'person')!
  assert.equal(person.color, 'yellow')
  assert.ok(person.w < byId('studio-es.event.ask-sent').w)
})

test('command → system → event, event → policy → command (p.202)', () => {
  assert.ok(wire('studio-es.command.send-ask', 'studio-es.system.canvas.send-ask'))
  assert.ok(wire('studio-es.system.canvas.send-ask', 'studio-es.event.ask-sent'))
  assert.ok(!wire('studio-es.command.send-ask', 'studio-es.event.ask-sent'), 'no shortcut past the system')
  assert.equal(wire('studio-es.event.ask-sent', 'studio-es.policy.whenever-asked')?.label, 'whenever')
  assert.equal(wire('studio-es.policy.whenever-asked', 'studio-es.command.pick-request')?.label, 'then')
})

test('read models: events update them, they inform people and commands (p.200-202)', () => {
  assert.ok(wire('studio-es.event.reply-posted', 'studio-es.read-model.thread'))
  assert.ok(wire('studio-es.read-model.thread', 'studio-es.command.send-ask'))
  const person = items.find((i) => i.role === 'person')!
  assert.ok(wire('studio-es.read-model.thread', person.id))
})

test('an external system raises its event; pivotal events are larger; time-triggered events say so', () => {
  const herdr = items.find((i) => i.role === 'external' && i.data?.element === 'herdr')!
  assert.ok(wire(herdr.id, 'studio-es.event.pane-opened'))
  assert.ok(byId('studio-es.event.request-picked').w > byId('studio-es.event.ask-sent').w)
  assert.ok(items.some((i) => i.role === 'pivotal' && i.data?.element === 'request-picked'))
  assert.equal(byId('studio-es.event.idle-closed').data?.time, 'after 30 min')
})

test('phases, milestones, values, votes, definitions and the legend are drawn', () => {
  const phases = items.filter((i) => i.role === 'phase')
  assert.deepEqual(phases.map((p) => p.text), ['Ask', 'Work'])
  assert.ok(phases[0].x + phases[0].w <= phases[1].x, 'phases follow the timeline')
  assert.equal(byId('studio-es.value.no-copy-paste').color, 'green')
  assert.match(byId('studio-es.value.no-copy-paste').text!, /^\+ time: /)
  assert.equal(items.find((i) => i.role === 'vote')!.text, '↑ 2')
  assert.match(items.find((i) => i.role === 'definition')!.text!, /^brief: /)
  const legend = items.filter((i) => i.role === 'legend').map((i) => i.data?.for)
  for (const k of ['event', 'command', 'system', 'policy', 'read-model', 'person', 'hotspot']) assert.ok(legend.includes(k), `legend has ${k}`)
  assert.ok(!legend.includes('aggregate'), 'only kinds the diagram uses')
})

test('nothing overlaps (markers and bars excepted), and every wire has both ends', () => {
  const boxes = items.filter((i) => i.type === 'sticky')
  for (let a = 0; a < boxes.length; a++)
    for (let b = a + 1; b < boxes.length; b++) assert.ok(!overlaps(boxes[a], boxes[b]), `${boxes[a].id} overlaps ${boxes[b].id}`)
  const ids = new Set(items.map((i) => i.id))
  for (const w of items.filter((i) => i.type === 'arrow')) assert.ok(ids.has(w.from!) && ids.has(w.to!), `${w.id} dangles`)
  assert.equal(ids.size, items.length, 'ids are unique')
})

test('branches: a command producing several events gets one wire per outcome, happy path first (p.209)', () => {
  const out = renderEventStorming(
    { level: 'process', events: [{ text: 'Payment accepted' }, { text: 'Payment refused' }], commands: [{ text: 'Pay', system: 'Bank', produces: ['Payment accepted', 'Payment refused'] }], systems: ['Bank'] },
    { now: NOW },
  )
  const produces = out.filter((i) => i.role === 'produces')
  assert.equal(produces.length, 2)
  assert.equal(produces.find((w) => w.data?.branch === 1)?.to, 'es.event.payment-refused')
})

test('software level: aggregates group their commands and events in frames instead of the timeline (p.21)', () => {
  const out = renderEventStorming({ ...(demoBoards[0].content as object), level: 'software' } as never, { now: NOW })
  const frame = out.find((i) => i.type === 'frame' && i.role === 'aggregate')!
  const inCard = out.filter((i) => i.parent === frame.id && i.role === 'event')
  assert.equal(inCard.length, 11, 'every Card event sits in the Card aggregate')
  assert.equal(out.filter((i) => i.role === 'event' && i.parent !== frame.id).length, 0, 'none left on the timeline')
  const k = out.find((i) => i.role === 'command' && i.text === 'Qualify card')!
  const e = out.find((i) => i.role === 'event' && i.text === 'Card qualified (size XS–L, RFA)')!
  assert.ok(k.x < e.x && Math.abs(k.y - e.y) < 1, 'a command sits left of its event, on the same row, inside the aggregate')
})

test('the old content shape still renders (text references, actors, externals, for)', () => {
  const out = renderEventStorming(demoBoards[0].content as never, { now: NOW })
  assert.equal(out.filter((i) => i.role === 'external').length, 2)
  assert.ok(out.some((i) => i.role === 'person' && i.text === 'Coordinator (Sonnet)'))
  assert.ok(out.some((i) => i.role === 'informs'))
})

test('big picture: people and systems stay (the People and Systems phase, p.88), commands and policies do not', () => {
  const out = renderEventStorming({ ...studioEs, level: 'big-picture' }, { now: NOW })
  assert.equal(out.filter((i) => i.role === 'command' || i.role === 'policy' || i.role === 'read-model').length, 0)
  assert.ok(out.some((i) => i.role === 'external'))
})

// ── left → right in time (the process-modelling sentence, p.200-202) ──────

const centre = (i: Item) => i.x + i.w / 2
const flowRoles = new Set(['handles', 'produces', 'triggers', 'raises'])

test('every flow wire runs left → right: person → command → system → event → policy → command', () => {
  for (const out of [items, renderEventStorming(demoBoards[0].content as never, { now: NOW })]) {
    const at = new Map(out.map((i) => [i.id, i]))
    for (const w of out.filter((i) => i.type === 'arrow' && flowRoles.has(i.role ?? ''))) {
      const [a, b] = [at.get(w.from!)!, at.get(w.to!)!]
      if (a.parent !== b.parent && (a.parent?.includes('aggregate') || b.parent?.includes('aggregate'))) continue
      assert.ok(centre(a) < centre(b), `${w.role} ${a.text} → ${b.text} runs backwards`)
    }
  }
})

test('a person sits directly above the command they issue', () => {
  const k = byId('studio-es.command.send-ask')
  const person = items.find((i) => i.role === 'person' && i.data?.for === 'send-ask')!
  assert.ok(person.y + person.h <= k.y, 'above')
  assert.ok(centre(person) === centre(k), 'same column')
})

test('branches: the happy path keeps the row, other outcomes drop below it in the same column (p.209)', () => {
  const out = renderEventStorming(
    { level: 'process', events: [{ text: 'Payment accepted' }, { text: 'Payment refused' }, { text: 'Receipt sent' }], commands: [{ text: 'Pay', system: 'Bank', produces: ['Payment accepted', 'Payment refused'] }, { text: 'Send receipt', produces: 'Receipt sent' }], policies: [{ text: 'When paid, send a receipt', when: 'Payment accepted', then: 'Send receipt' }], systems: ['Bank'] },
    { now: NOW },
  )
  const by = (t: string) => out.find((i) => i.text === t)!
  const ok = by('Payment accepted')
  const refused = by('Payment refused')
  assert.equal(ok.x, refused.x, 'branches share a column')
  assert.ok(refused.y > ok.y, 'the other outcome is below the happy path')
  assert.equal(by('Pay').y, ok.y, 'the happy path is one straight row')
  assert.equal(by('Receipt sent').y, ok.y)
  assert.ok(by('Receipt sent').x > ok.x)
})

test('the file order of events is the timeline: an unrelated later event is not drawn left of an earlier one', () => {
  const out = renderEventStorming({ level: 'process', events: [{ text: 'A happened' }, { text: 'B happened' }, { text: 'C happened' }] }, { now: NOW })
  const xs = ['A happened', 'B happened', 'C happened'].map((t) => out.find((i) => i.text === t)!.x)
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2])
})

test('the demo board (lanes, old content shape) has no overlapping stickies', () => {
  const out = renderEventStorming(demoBoards[0].content as never, { now: NOW }).filter((i) => i.type === 'sticky')
  for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) assert.ok(!overlaps(out[a], out[b]), `${out[a].text} overlaps ${out[b].text}`)
})
