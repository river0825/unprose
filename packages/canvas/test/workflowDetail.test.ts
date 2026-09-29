// docs/studio.md §1: block detail travels from the graph to `item.data.detail`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderWorkflow } from '../src/templates/index.js'

test('workflow template copies node and agent detail to item.data.detail', () => {
  const items = renderWorkflow({
    name: 'wf',
    nodes: [
      { id: 'hook', kind: 'trigger' },
      { id: 'plan', kind: 'ai', config: { agent: 'planner' }, detail: { kind: 'ai', prompt: 'You plan.', source: { workflow: 'wf.yaml', line: 9 } } },
    ],
    edges: [{ from: 'hook', to: 'plan' }],
    agents: [{ id: 'planner', steps: ['plan'], detail: { kind: 'agent', persona: 'You plan.' } }],
  })
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  assert.deepEqual((byId['wf.node.plan'].data as { detail: unknown }).detail, { kind: 'ai', prompt: 'You plan.', source: { workflow: 'wf.yaml', line: 9 } })
  assert.deepEqual((byId['wf.agent.planner'].data as { detail: unknown }).detail, { kind: 'agent', persona: 'You plan.' })
  assert.equal('detail' in (byId['wf.node.hook'].data ?? {}), false, 'no detail → no key')
})

test('one flow wire per event, labelled with the event and carrying data.event (docs/studio.md §7)', () => {
  const items = renderWorkflow({
    nodes: [
      { id: 'plan', kind: 'ai' },
      { id: 'move', kind: 'script' },
      { id: 'wait', kind: 'human' },
    ],
    edges: [
      { from: 'plan', to: 'move', label: 'ready', event: 'plan.ready' },
      { from: 'plan', to: 'move', label: 'needs-human', event: 'plan.needs-human', condition: 'true' },
      { from: 'plan', to: 'wait', label: 'resume: ready', event: 'plan.ready', resume: true },
    ],
  })
  const wires = items.filter((i) => i.type === 'arrow' && i.role === 'flow')
  assert.equal(wires.length, 3)
  assert.equal(new Set(wires.map((w) => w.id)).size, 3, 'two events between the same blocks are two wires')
  const ready = wires.find((w) => w.label === 'plan.ready')!
  assert.deepEqual(ready.data, { event: { event: 'plan.ready', from: 'plan', to: 'move' } })
  const nh = wires.find((w) => (w.data as { event: { event: string } }).event.event === 'plan.needs-human')!
  assert.equal(nh.label, 'plan.needs-human if true')
  assert.deepEqual(nh.data, { event: { event: 'plan.needs-human', from: 'plan', to: 'move', condition: 'true' } })
  const resume = wires.find((w) => w.to === 'wf.node.wait')!
  assert.equal(resume.label, 'resume: plan.ready')
  assert.equal((resume.data as { event: { resume?: boolean } }).event.resume, true)
})

test('older graph JSON without events still draws one labelled wire', () => {
  const items = renderWorkflow({ nodes: [{ id: 'a', kind: 'script' }, { id: 'b', kind: 'script' }], edges: [{ from: 'a', to: 'b', label: 'done' }] })
  const w = items.find((i) => i.type === 'arrow')!
  assert.equal(w.label, 'done')
  assert.equal(w.data, undefined)
})

test('workflow columns leave room for the widest wire label', async () => {
  const { renderWorkflow } = await import('../src/templates/workflow.js')
  const graph = (event: string) => ({
    nodes: [{ id: 't', kind: 'trigger' as const }, { id: 'a', kind: 'script' as const }],
    edges: [{ from: 't', to: 'a', label: 'x', event }],
  })
  const x = (items: Array<{ id: string; x: number }>) => items.find((i) => i.id === 'wf.node.a')!.x - items.find((i) => i.id === 'wf.node.t')!.x
  const short = x(renderWorkflow(graph('go')))
  const long = x(renderWorkflow(graph('a-rather-long-step.needs-human')))
  assert.ok(long > short, `long label widens the gap (${short} → ${long})`)
  assert.ok(long - 160 >= 'a-rather-long-step.needs-human'.length * 7.5, 'gap fits the label')
})
