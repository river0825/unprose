import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkflow } from '../src/schema.js'
import { lint } from '../src/lint.js'

const good = `
name: demo
key: "{{ event.data.card }}"
triggers:
  trello:
    on: webhook
    emit: card.moved
    data: { card: "{{ body.card }}", to: "{{ body.to }}" }
steps:
  qualify:
    on: card.moved
    if: "event.data.to == 'Ready'"
    run: echo '{"outcome":"pick"}'
    outcomes: [pick, skip]
    terminal: [skip]
  plan:
    on: qualify.pick
    ai:
      role: planner
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } }
  confirm:
    on: plan.done
    human:
      resume_on: card.moved
      outcomes: { approved: "event.data.to == 'Go'", rejected: "event.data.to == 'Backlog'" }
  gate:
    on: confirm.approved
    gate:
      outcomes: { build: "vars.qualify.size != 'XL'" }
      default: split
  build:
    on: gate.build
    run: make
    terminal: true
  split:
    on: gate.split
    run: echo split
    terminal: true
  handle-reject:
    on: confirm.rejected
    run: echo bye
    terminal: true
`

test('a well-formed workflow lints clean', () => {
  const r = lint(parseWorkflow(good))
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
})

test('dead references, bad ids, unreachable, unknown identifiers', () => {
  const def = parseWorkflow(`
name: bad
triggers:
  t: { on: cron, every: 5m, emit: tick }
steps:
  A_step:
    on: tick
    run: echo
  orphan:
    on: nothing.here
    run: echo
  lonely:
    on: [tick]
    if: "cards.count > 1"
    run: echo
  g:
    on: tick
    gate: { outcomes: {} }
  h:
    on: tick
    human: { outcomes: { ok: "true" } }
  ai:
    on: tick
    ai: { output: { type: object, properties: { summary: { type: string } } } }
  island:
    on: island.done
    run: echo
`)
  const r = lint(def)
  const msgs = r.errors.map((e) => `${e.where}: ${e.message}`)
  assert.ok(msgs.some((m) => m.includes('steps.A_step') && m.includes('kebab-case')), msgs.join('\n'))
  assert.ok(msgs.some((m) => m.includes('nothing produces event "nothing.here"')))
  assert.ok(msgs.some((m) => m.includes('unknown identifier "cards"')))
  assert.ok(msgs.some((m) => m.includes('gate needs at least one outcome')))
  assert.ok(msgs.some((m) => m.includes('human step needs `resume_on`')))
  assert.ok(msgs.some((m) => m.includes('outcome') && m.includes('enum')))
  assert.ok(msgs.some((m) => m.includes('steps.island') && m.includes('unreachable')))
})

test('warnings: unconsumed outcome and unguarded cycle', () => {
  const def = parseWorkflow(`
name: w
triggers: { t: { on: manual, emit: go } }
steps:
  a: { on: [go, b.done], run: echo, outcomes: [done, extra] }
  b: { on: a.done, run: echo }
`)
  const r = lint(def)
  assert.equal(r.ok, true)
  const w = r.warnings.map((x) => x.message)
  assert.ok(w.some((m) => m.includes('outcome "extra" is not consumed')))
  assert.ok(w.some((m) => m.includes('cycle')))
})

test('duration parsing', () => {
  const def = parseWorkflow(`
name: d
triggers: { t: { on: cron, every: 30m } }
steps:
  s: { on: t, run: echo, timeout: 2h, retry: { max: 2, backoff: 5m } }
`)
  assert.equal(def.triggers[0].every, 1_800_000)
  assert.equal(def.steps[0].timeout, 7_200_000)
  assert.deepEqual(def.steps[0].retry, { max: 2, backoff: 300_000 })
})

test('agents: unknown agent, agent+role, bad delegate, undeclared delegation, runner config', () => {
  const def = parseWorkflow(`
name: a
triggers: { t: { on: manual, emit: go } }
agents:
  planner: { description: plans, model: opus, delegates: [ghost] }
  reviewer: { description: reviews, model: gpt-9000, runner: cli }
  runner-h: { description: h, runner: herdr }
steps:
  plan:
    on: go
    ai: { agent: planner, output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } } }
  review:
    on: plan.done
    ai: { agent: reviewer, role: reviewer, output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } } }
    terminal: true
  nobody:
    on: plan.done
    ai: { agent: nope, output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } } }
    terminal: true
`)
  const r = lint(def)
  const errs = r.errors.map((e) => `${e.where}: ${e.message}`)
  const warns = r.warnings.map((w) => `${w.where}: ${w.message}`)
  assert.ok(errs.some((m) => m.includes('agents.planner.delegates') && m.includes('"ghost"')), errs.join('\n'))
  assert.ok(errs.some((m) => m.includes('steps.review.ai') && m.includes('either `agent` or `role`')))
  assert.ok(errs.some((m) => m.includes('steps.nobody.ai') && m.includes('unknown agent "nope"')))
  assert.ok(errs.some((m) => m.includes('agents.reviewer.cli') && m.includes('cli.command')))
  assert.ok(errs.some((m) => m.includes('agents.runner-h.herdr')))
  assert.ok(warns.some((m) => m.includes('model "gpt-9000"')))
  // planner → review is a direct ai→ai edge and planner.delegates does not list reviewer
  assert.ok(warns.some((m) => m.includes('steps.review') && m.includes('hands work to "reviewer"')), warns.join('\n'))
})

test('agents: declared delegation lints clean and parses the agent block', () => {
  const def = parseWorkflow(`
name: a
triggers: { t: { on: manual, emit: go } }
agents:
  reviewer: { description: reviews, model: sonnet, tools: [Read, "Bash(gh *)"], effort: high, delegates: [architect] }
  architect: { system: "You decide.", model: opus, runner: cli, cli: { preset: codex, timeoutMs: 10m } }
steps:
  review:
    on: go
    ai: { agent: reviewer, output: { type: object, required: [outcome], properties: { outcome: { enum: [clean, needs-architect] } } } }
    terminal: [clean]
  ask:
    on: review.needs-architect
    ai: { agent: architect, output: { type: object, required: [outcome], properties: { outcome: { enum: [guidance] } } } }
    terminal: true
`)
  const r = lint(def)
  assert.deepEqual(r.errors, [])
  assert.ok(!r.warnings.some((w) => w.message.includes('hands work')))
  assert.deepEqual(def.agents.reviewer.tools, ['Read', 'Bash(gh *)'])
  assert.equal(def.agents.architect.cli?.timeoutMs, 600_000)
  assert.equal(def.agents.architect.runner, 'cli')
})

test('wildcard listeners: *.failed reaches every other step, only failed/timeout exist', () => {
  const ok = parseWorkflow(`
name: w
triggers: { go: { on: cli, emit: ping } }
steps:
  work: { on: ping, run: "false", terminal: [done] }
  reflect: { on: "*.failed", run: "true", terminal: [done] }
`)
  const r = lint(ok)
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors))
  const bad = parseWorkflow(`
name: w
triggers: { go: { on: cli, emit: ping } }
steps:
  work: { on: ping, run: "false", terminal: [done] }
  reflect: { on: "*.done", run: "true", terminal: [done] }
`)
  assert.ok(lint(bad).errors.some((e) => /only "\*\.failed" and "\*\.timeout"/.test(e.message)))
})

test('board trigger: frame is a diagram key, only on board triggers (docs/diagrams.md §7)', () => {
  const wf = (trigger: Record<string, unknown>) =>
    parseWorkflow({ name: 'w', triggers: { t: { emit: 'card.moved', ...trigger } }, steps: { s: { on: 'card.moved', run: 'true' } } })
  const ok = wf({ on: 'board', board: 'title:dev', frame: 'dev-kanban' })
  assert.equal(ok.triggers[0].frame, 'dev-kanban')
  assert.deepEqual(lint(ok).errors.filter((f) => f.where.startsWith('triggers')), [])
  assert.ok(lint(wf({ on: 'webhook', frame: 'dev-kanban' })).errors.some((f) => f.where === 'triggers.t.frame'))
  assert.ok(lint(wf({ on: 'board', board: 'x', frame: 'dev kanban!' })).errors.some((f) => f.where === 'triggers.t.frame'))
})
