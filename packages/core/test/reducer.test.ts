import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkflow } from '../src/schema.js'
import { initialState, reduce, replay } from '../src/reducer.js'
import type { Event, Command } from '../src/events.js'

const def = parseWorkflow(`
name: demo
key: "{{ event.data.card }}"
triggers:
  trello: { on: webhook, emit: card.moved }
steps:
  qualify:
    on: card.moved
    if: "event.data.to == 'Ready'"
    run: qualify.sh {{ event.data.card }}
    outcomes: [pick, skip]
    terminal: [skip]
  plan:
    on: qualify.pick
    ai:
      role: planner
      input: { card: "{{ key }}", size: "{{ vars.qualify.size }}" }
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] }, summary: { type: string } } }
  confirm:
    on: plan.done
    timeout: 7d
    human:
      resume_on: card.moved
      outcomes: { approved: "event.data.to == 'Go'", rejected: "event.data.to == 'Backlog'" }
  size-gate:
    on: confirm.approved
    gate:
      outcomes: { build: "vars.qualify.size in ['XS','S','M','L']" }
      default: split
  build:
    on: size-gate.build
    run: build.sh
    retry: { max: 1, backoff: 0 }
    terminal: true
  split:
    on: size-gate.split
    run: split.sh
    terminal: true
  bye:
    on: confirm.rejected
    run: bye.sh
    terminal: true
`)

let n = 0
const ev = (type: string, data?: unknown, extra: Partial<Event> = {}): Event => ({ id: `e${++n}`, type, key: 'c1', data, ts: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...extra })
const kinds = (cs: Command[]) => cs.map((c) => c.kind + (('step' in c && c.step) ? ':' + c.step : c.kind === 'emit' ? ':' + c.event.type : ''))

test('happy path: trigger → script → ai → human → gate → script', () => {
  let s = initialState('c1')
  let r = reduce(def, s, ev('card.moved', { card: 'c1', to: 'Ready' }))
  assert.deepEqual(kinds(r.commands), ['run_script:qualify'])
  const rs = r.commands[0]
  assert.equal(rs.kind === 'run_script' && rs.cmd, 'qualify.sh c1')
  assert.equal(r.state.status, 'running')

  r = reduce(def, r.state, ev('qualify.pick', { size: 'M' }, { causationId: rs.id }))
  assert.deepEqual(kinds(r.commands), ['call_ai:plan'])
  const ai = r.commands[0]
  assert.ok(ai.kind === 'call_ai')
  assert.deepEqual(ai.input, { card: 'c1', size: 'M' })
  assert.deepEqual(r.state.vars.qualify, { size: 'M' })

  r = reduce(def, r.state, ev('plan.done', { summary: 'ok' }))
  assert.deepEqual(kinds(r.commands), ['wait_human:confirm', 'schedule'])
  assert.equal(r.state.status, 'waiting')

  // an unrelated move does nothing
  r = reduce(def, r.state, ev('card.moved', { card: 'c1', to: 'Somewhere' }))
  assert.deepEqual(r.commands, [])
  assert.equal(r.state.status, 'waiting')

  r = reduce(def, r.state, ev('card.moved', { card: 'c1', to: 'Go' }))
  assert.deepEqual(kinds(r.commands), ['cancel_schedule', 'emit:confirm.approved'])
  const emitted = r.commands[1]
  assert.ok(emitted.kind === 'emit')
  r = reduce(def, r.state, ev(emitted.event.type, emitted.event.data))
  assert.deepEqual(kinds(r.commands), ['emit:size-gate.build'])
  r = reduce(def, r.state, ev('size-gate.build'))
  assert.deepEqual(kinds(r.commands), ['run_script:build'])
  r = reduce(def, r.state, ev('build.done', { pr: 42 }))
  assert.deepEqual(r.commands, [])
  assert.equal(r.state.status, 'done')
  assert.deepEqual(r.state.history.map((h) => `${h.step}.${h.outcome}`), ['qualify.pick', 'plan.done', 'confirm.approved', 'size-gate.build', 'build.done'])
})

test('human rejection path', () => {
  const { state, steps } = replay(def, 'c1', [
    ev('card.moved', { card: 'c1', to: 'Ready' }),
    ev('qualify.pick', { size: 'S' }),
    ev('plan.done', {}),
    ev('card.moved', { card: 'c1', to: 'Backlog' }),
  ])
  const last = steps.at(-1)!.commands
  assert.deepEqual(kinds(last), ['cancel_schedule', 'emit:confirm.rejected'])
  assert.equal(Object.keys(state.waiting).length, 0)
})

test('human timeout', () => {
  const { state, steps } = replay(def, 'c1', [
    ev('card.moved', { card: 'c1', to: 'Ready' }),
    ev('qualify.pick', { size: 'S' }),
    ev('plan.done', {}),
    ev('confirm.timeout', {}),
  ])
  assert.equal(state.status, 'done') // timeout recorded, nothing consumes it here
  assert.equal(state.history.at(-1)!.outcome, 'timeout')
  assert.deepEqual(steps.at(-1)!.commands, [])
})

test('failure retries once then fails terminally', () => {
  let s = initialState('c1')
  let r = reduce(def, s, ev('size-gate.build'))
  assert.deepEqual(kinds(r.commands), ['run_script:build'])
  assert.equal((r.commands[0] as { attempt: number }).attempt, 1)
  r = reduce(def, r.state, ev('build.failed', { error: 'boom' }))
  assert.deepEqual(kinds(r.commands), ['emit:build.retry'])
  r = reduce(def, r.state, ev('build.retry'))
  assert.deepEqual(kinds(r.commands), ['run_script:build'])
  assert.equal((r.commands[0] as { attempt: number }).attempt, 2)
  r = reduce(def, r.state, ev('build.failed', { error: 'boom again' }))
  assert.deepEqual(r.commands, [])
  assert.equal(r.state.status, 'failed')
  assert.deepEqual(r.state.failed, ['build'])
})

test('concurrency: same step twice is queued; released when the first finishes', () => {
  let r = reduce(def, initialState('c1'), ev('card.moved', { card: 'c1', to: 'Ready' }))
  r = reduce(def, r.state, ev('card.moved', { card: 'c1', to: 'Ready' }))
  assert.deepEqual(r.commands, [])
  assert.equal(r.state.pending.length, 1)
  r = reduce(def, r.state, ev('qualify.skip', {}))
  assert.deepEqual(kinds(r.commands), ['run_script:qualify'])
  assert.equal(r.state.pending.length, 0)
})

test('command ids are deterministic across replays', () => {
  const events = [ev('card.moved', { card: 'c1', to: 'Ready' }), ev('qualify.pick', { size: 'M' })]
  const a = replay(def, 'c1', events), b = replay(def, 'c1', events)
  assert.deepEqual(a.steps.map((s) => s.commands.map((c) => c.id)), b.steps.map((s) => s.commands.map((c) => c.id)))
})

test('agents: the call_ai command carries the resolved agent (model, tools, effort, runner config)', () => {
  const adef = parseWorkflow(`
name: agents
triggers: { t: { on: manual, emit: go } }
agents:
  reviewer: { system: "Review {{ key }} carefully.", model: sonnet, tools: [Read, Grep], effort: high, delegates: [architect] }
  architect: { model: opus, runner: herdr, herdr: { kind: codex, timeoutMs: 1m } }
steps:
  review:
    on: go
    ai: { agent: reviewer, output: { type: object, required: [outcome], properties: { outcome: { enum: [clean, needs-architect] } } } }
    terminal: [clean]
  ask:
    on: review.needs-architect
    ai: { agent: architect, model: sonnet, output: { type: object, required: [outcome], properties: { outcome: { enum: [guidance] } } } }
    terminal: true
`)
  let r = reduce(adef, initialState('c9'), { id: 'e1', type: 'go', key: 'c9', data: {}, ts: '2026-01-01T00:00:00.000Z' })
  const c = r.commands[0]
  assert.ok(c.kind === 'call_ai')
  assert.equal(c.agent, 'reviewer')
  assert.equal(c.model, 'sonnet')
  assert.deepEqual(c.tools, ['Read', 'Grep'])
  assert.equal(c.effort, 'high')
  assert.equal(c.system, 'Review c9 carefully.')
  assert.equal(c.runner, undefined)
  assert.equal(r.state.active.review.agent, 'reviewer')
  // the delegation is an ordinary event → the architect's step, with the step's model override and the herdr config
  r = reduce(adef, r.state, { id: 'e2', type: 'review.needs-architect', key: 'c9', data: { question: 'q' }, ts: '2026-01-01T00:00:01.000Z' })
  const d = r.commands[0]
  assert.ok(d.kind === 'call_ai')
  assert.equal(d.agent, 'architect')
  assert.equal(d.model, 'sonnet')
  assert.equal(d.runner, 'herdr')
  assert.deepEqual(d.runnerConfig, { kind: 'codex', name: undefined, cwd: undefined, timeoutMs: 60_000 })
  // a resolved agents map (loader) wins over def.agents — e.g. the prompt read from agents/architect.md
  r = reduce(adef, initialState('c9'), { id: 'e3', type: 'go', key: 'c9', data: {}, ts: '2026-01-01T00:00:02.000Z' }, { agents: { reviewer: { id: 'reviewer', system: 'from file', model: 'haiku' } } })
  const f = r.commands[0]
  assert.ok(f.kind === 'call_ai' && f.system === 'from file' && f.model === 'haiku')
})

test('a *.failed listener fires for another step\'s failure, never for its own', () => {
  const def = parseWorkflow(`
name: w
key: "{{ event.data.k }}"
triggers: { go: { on: cli, emit: ping } }
steps:
  work: { on: ping, run: "false", terminal: [done] }
  reflect: { on: "*.failed", run: "true", terminal: [done] }
`)
  let s = initialState('k1')
  const ev = (type: string, id: string): Event => ({ id, type, key: 'k1', ts: '2026-01-01T00:00:00Z', data: { k: 'k1' } })
  s = reduce(def, s, ev('ping', 'e1')).state
  const r = reduce(def, s, ev('work.failed', 'e2'))
  assert.ok(r.commands.some((c) => c.kind === 'run_script' && c.step === 'reflect'), 'reflect should run on work.failed')
  const r2 = reduce(def, r.state, ev('reflect.failed', 'e3'))
  assert.ok(!r2.commands.some((c) => c.kind === 'run_script' && c.step === 'reflect'), 'a step must not reflect on itself')
})
