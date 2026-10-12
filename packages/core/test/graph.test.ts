import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkflow } from '../src/schema.js'
import { toGraph, toMermaid } from '../src/graph.js'

const wf = `
name: crew
agents:
  planner: { description: Plans, model: opus, tools: [Read], delegates: [architect] }
  architect: { model: opus, effort: xhigh, runner: cli }
triggers:
  go: { on: cli, emit: ping }
steps:
  plan:
    on: ping
    ai:
      agent: planner
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done, ask] } } }
  ask-architect:
    on: plan.ask
    terminal: [done]
    ai:
      agent: architect
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } }
  legacy-review:
    on: plan.done
    terminal: [done]
    ai:
      role: reviewer
      model: sonnet
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } }
`

test('toGraph lists agents with the steps they own; role: steps become legacy agents', () => {
  const g = toGraph(parseWorkflow(wf))
  const byId = Object.fromEntries(g.agents.map((a) => [a.id, a]))
  assert.deepEqual(byId.planner.steps, ['plan'])
  assert.deepEqual(byId.planner.delegates, ['architect'])
  assert.equal(byId.planner.model, 'opus')
  assert.deepEqual(byId.architect.steps, ['ask-architect'])
  assert.equal(byId.architect.runner, 'cli')
  assert.equal(byId.architect.effort, 'xhigh')
  assert.equal(byId.reviewer.legacy, true)
  assert.deepEqual(byId.reviewer.steps, ['legacy-review'])
  assert.equal(byId.reviewer.model, 'sonnet')
  // ai nodes keep carrying the agent in config so the canvas can link them
  assert.equal(g.nodes.find((n) => n.id === 'plan')!.config.agent, 'planner')
})

test('toMermaid stays a valid flowchart and appends the agent roster as comments', () => {
  const m = toMermaid(parseWorkflow(wf))
  assert.ok(m.startsWith('flowchart LR'))
  assert.match(m, /%% agent @planner \(opus\): plan/)
  assert.match(m, /%% agent @architect \(opus\) via cli: ask-architect/)
  assert.match(m, /%% agent @reviewer \(sonnet\): legacy-review/)
  for (const line of m.split('\n')) assert.ok(!line.includes('%%') || line.trim().startsWith('%%'), 'comments are whole lines')
})

test('a workflow without agents yields an empty roster (not undefined)', () => {
  const g = toGraph(parseWorkflow('name: bare\ntriggers:\n  go: { on: cli, emit: ping }\nsteps:\n  s:\n    on: ping\n    run: "true"\n    terminal: [done]\n'))
  assert.deepEqual(g.agents, [])
})

test('every edge names the event it stands for; a human resume_on is marked resume', () => {
  const g = toGraph(parseWorkflow(`
name: ev
triggers:
  go: { on: cli, emit: ping }
steps:
  a:
    on: ping
    run: "true"
    outcomes: [done, skip]
  b:
    on:
      - { event: a.done, if: "true" }
      - a.skip
    run: "true"
    terminal: [done]
  wait:
    on: b.done
    human: { resume_on: [ping], outcomes: { ok: "true" } }
    terminal: [ok, timeout]
  catch:
    on: "*.failed"
    run: "true"
    terminal: [done]
`))
  const e = (from: string, to: string) => g.edges.filter((x) => x.from === from && x.to === to).map((x) => ({ event: x.event, condition: x.condition, resume: x.resume }))
  assert.deepEqual(e('go', 'a'), [{ event: 'ping', condition: undefined, resume: undefined }])
  assert.deepEqual(e('a', 'b'), [{ event: 'a.done', condition: 'true', resume: undefined }, { event: 'a.skip', condition: undefined, resume: undefined }])
  assert.deepEqual(e('go', 'wait'), [{ event: 'ping', condition: undefined, resume: true }])
  assert.deepEqual(e('*.failed', 'catch'), [{ event: '*.failed', condition: undefined, resume: undefined }])
})

test('the file\'s annotations ride along in the graph (the board draws them; the runner ignores them)', () => {
  const src = 'name: bare\ntriggers:\n  go: { on: cli, emit: ping }\nsteps:\n  s:\n    on: ping\n    run: "true"\n    terminal: [done]\nannotations:\n  - on: s\n    text: Runs the deploy\n  - { id: odd, on: go }\n'
  assert.deepEqual(toGraph(parseWorkflow(src)).annotations, [{ on: 's', text: 'Runs the deploy' }])
  assert.equal('annotations' in toGraph(parseWorkflow('name: bare\ntriggers:\n  go: { on: cli, emit: ping }\nsteps:\n  s:\n    on: ping\n    run: "true"\n    terminal: [done]\n')), false)
})
