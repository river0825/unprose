import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkflow } from '../src/schema.js'
import { initialState, reduce } from '../src/reducer.js'
import { lint } from '../src/lint.js'
import { withMemoryProperties, learnNotesOf, stripMemoryFields, parseMemoryConfig } from '../src/memory.js'
import type { Event, Command } from '../src/events.js'

const def = parseWorkflow(`
name: mem
key: "{{ event.data.card }}"
agents:
  planner: { system: "Plan.", model: opus, memory: { recall: 5 } }
  qa: { system: "Test.", memory: { longTerm: false, shortTerm: false } }
triggers:
  t: { on: cli, emit: card.ready }
steps:
  plan:
    on: card.ready
    ai:
      agent: planner
      input: { card: "{{ key }}" }
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] }, summary: { type: string } } }
  plan2:
    on: plan.done
    ai:
      agent: planner
      input: { card: "{{ key }}" }
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } }
  qa:
    on: plan2.done
    terminal: true
    ai:
      agent: qa
      output: { type: object, required: [outcome], properties: { outcome: { enum: [pass] } } }
`)

let n = 0
const ev = (type: string, data?: unknown, extra: Partial<Event> = {}): Event => ({ id: `e${++n}`, type, key: 'c1', data, ts: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...extra })
const ai = (cmds: Command[]) => cmds.find((c) => c.kind === 'call_ai') as Extract<Command, { kind: 'call_ai' }>

test('memory config parses with defaults and lints', () => {
  assert.deepEqual(parseMemoryConfig(undefined, 'x'), { longTerm: true, recall: 20, shortTerm: true })
  assert.deepEqual(parseMemoryConfig(false, 'x'), { longTerm: false, recall: 0, shortTerm: false })
  assert.deepEqual(parseMemoryConfig({ recall: 3 }, 'x'), { longTerm: true, recall: 3, shortTerm: true })
  assert.deepEqual(def.agents.planner.memory, { longTerm: true, recall: 5, shortTerm: true })
  assert.ok(lint(def).ok)
  const bad = parseWorkflow(`name: b\nagents: { a: { system: s, memory: { recall: -1 } } }\ntriggers: {}\nsteps: {}`)
  assert.ok(lint(bad).errors.some((e) => /recall/.test(e.message)))
})

test('call_ai carries short-term memory + the recall budget, and allows remember/learn in the schema', () => {
  const r = reduce(def, initialState('c1'), ev('card.ready', { card: 'c1' }))
  const cmd = ai(r.commands)
  assert.deepEqual(cmd.memory, { short: { trail: [], remembered: {} }, longTerm: { recall: 5 } })
  const props = cmd.outputSchema.properties as Record<string, unknown>
  assert.ok(props.remember && props.learn, 'remember/learn are always allowed output properties')
  assert.ok(props.summary, 'the step\'s own properties are kept')
})

test('an ai outcome feeds the trail, merges `remember`, and keeps vars clean', () => {
  let r = reduce(def, initialState('c1'), ev('card.ready', { card: 'c1' }))
  const first = ai(r.commands)
  r = reduce(def, r.state, ev('plan.done', { summary: 'CSV route + parser', remember: { size: 'M' }, learn: [{ note: 'x' }] }, { causationId: first.id }))
  assert.deepEqual(r.state.vars.plan, { summary: 'CSV route + parser' }, 'remember/learn are not vars')
  assert.deepEqual(r.state.memory.short, { planner: { size: 'M' } })
  assert.equal(r.state.memory.trail.length, 1)
  assert.equal(r.state.memory.trail[0].summary, 'CSV route + parser')
  assert.equal(r.state.memory.trail[0].agent, 'planner')
  // the next call by the same agent sees both
  const second = ai(r.commands)
  assert.equal(second.step, 'plan2')
  assert.deepEqual(second.memory?.short?.remembered, { size: 'M' })
  assert.equal(second.memory?.short?.trail.length, 1)
  // a later remember merges, it does not replace
  r = reduce(def, r.state, ev('plan2.done', { remember: { pr: 12 } }, { causationId: second.id }))
  assert.deepEqual(r.state.memory.short.planner, { size: 'M', pr: 12 })
  // an agent with memory off gets no memory block at all
  const qa = ai(r.commands)
  assert.equal(qa.step, 'qa')
  assert.equal(qa.memory, undefined)
})

test('learnNotesOf tolerates strings and bare notes; stripMemoryFields leaves other data alone', () => {
  assert.deepEqual(learnNotesOf({ learn: ['a', { note: ' b ', tags: ['t'] }, { nope: 1 }, ''] }), [{ note: 'a' }, { note: 'b', tags: ['t'] }])
  assert.deepEqual(learnNotesOf({ learn: 'solo' }), [{ note: 'solo' }])
  assert.deepEqual(learnNotesOf({}), [])
  assert.deepEqual(stripMemoryFields({ a: 1, remember: {}, learn: [] }), { a: 1 })
  assert.equal(stripMemoryFields('x'), 'x')
  assert.deepEqual(withMemoryProperties({ type: 'object' }).properties && Object.keys(withMemoryProperties({ type: 'object' }).properties as object), ['remember', 'learn', 'reflect'])
})
