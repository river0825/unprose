import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseWorkflow } from '@awd/core'
import { Engine } from '../src/engine.js'
import { FileEventStore, MemoryEventStore } from '../src/eventStore.js'
import { FakeWorker } from '../src/workers/fake.js'
import { keyFor } from '../src/load.js'

const yaml = `
name: e2e
key: "{{ event.data.card }}"
triggers:
  go: { on: manual, emit: card.ready }
  approve: { on: manual, emit: card.approved }
steps:
  qualify:
    on: card.ready
    run: |
      echo "log line"; echo '{"outcome":"pick","data":{"size":"M","seen":"'"$AWD_KEY"'"}}'
    outcomes: [pick, skip]
    terminal: [skip]
  plan:
    on: qualify.pick
    ai:
      role: planner
      input: { card: "{{ key }}", size: "{{ vars.qualify.size }}" }
      output: { type: object, required: [outcome, summary], properties: { outcome: { enum: [done] }, summary: { type: string } } }
  confirm:
    on: plan.done
    human:
      resume_on: card.approved
      outcomes: { approved: "event.data.go == true" }
  build:
    on: confirm.approved
    run: 'test "$AWD_ATTEMPT" = "2" && echo "{\\"outcome\\":\\"done\\"}" || (echo nope >&2; exit 3)'
    retry: { max: 1 }
    terminal: true
`

test('engine runs script → ai → human → retrying script, and survives a restart', async () => {
  const def = parseWorkflow(yaml)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-'))
  const file = path.join(dir, 'events.ndjson')
  const worker = new FakeWorker(undefined, { planner: { outcome: 'done', summary: 'three tasks' } })
  const logs: string[] = []

  let store = new FileEventStore(file)
  let engine = new Engine({ def, store, worker, cwd: dir, log: (l) => logs.push(l), timerIntervalMs: 20 })
  await engine.start()
  const ev = { id: 'x', type: 'card.ready', data: { card: 'c1' }, ts: new Date().toISOString() }
  store.append({ type: ev.type, key: keyFor(def, ev), data: ev.data })
  await engine.idle()
  let st = engine.states.get('c1')!
  assert.equal(st.status, 'waiting')
  assert.deepEqual(st.vars.qualify, { size: 'M', seen: 'c1' })
  assert.deepEqual(st.vars.plan, { summary: 'three tasks' })
  engine.stop()

  // Restart from the log: nothing re-executes, still waiting on the human.
  const before = store.size()
  store = new FileEventStore(file)
  engine = new Engine({ def, store, worker, cwd: dir, log: (l) => logs.push(l), timerIntervalMs: 20 })
  await engine.start()
  await engine.idle()
  assert.equal(store.size(), before)
  assert.equal(engine.states.get('c1')!.status, 'waiting')

  // Human approves → build fails once, retries, succeeds.
  store.append({ type: 'card.approved', key: 'c1', data: { card: 'c1', go: true } })
  await engine.idle()
  st = engine.states.get('c1')!
  assert.equal(st.status, 'done', JSON.stringify(st, null, 1))
  const outcomes = st.history.map((h) => `${h.step}.${h.outcome}`)
  assert.deepEqual(outcomes, ['qualify.pick', 'plan.done', 'confirm.approved', 'build.failed', 'build.done'])
  engine.stop()
})

test('timeouts fire from the durable timer', async () => {
  const def = parseWorkflow(`
name: t
triggers: { go: { on: manual, emit: go } }
steps:
  slow:
    on: go
    run: sleep 5
    timeout: 50ms
    terminal: true
`)
  const store = new MemoryEventStore()
  const engine = new Engine({ def, store, worker: new FakeWorker(), timerIntervalMs: 10 })
  await engine.start()
  store.append({ type: 'go', key: 'k', data: {} })
  await new Promise((r) => setTimeout(r, 400))
  await engine.idle()
  const st = engine.states.get('k')!
  assert.ok(st.history.some((h) => h.step === 'slow' && h.outcome === 'timeout'), JSON.stringify(st))
  assert.equal(st.status, 'failed')
  engine.stop()
})
