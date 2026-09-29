// Each port has a second implementation, and the seams are real: the same
// engine runs on the memory store, timers fire on a fake clock, and the herdr
// worker talks to a fake channel through the channelExec bridge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseWorkflow } from '@awd/core'
import { createRuntime, MemoryEventStore, FakeWorker, FakeClock, Timer, HerdrWorker, FakeAgentChannel, channelExec, FileMailbox, MemoryMailbox, keyFor } from '../src/index.js'
import type { LoadedWorkflow } from '../src/index.js'

const yaml = `
name: seams
key: "{{ event.data.card }}"
steps:
  qualify:
    on: card.ready
    run: 'echo "{\\"outcome\\":\\"pick\\",\\"data\\":{\\"size\\":\\"S\\"}}"'
    outcomes: [pick]
  plan:
    on: qualify.pick
    terminal: true
    ai:
      agent: planner
      input: { size: "{{ vars.qualify.size }}" }
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } }
`

function loaded(): LoadedWorkflow {
  const def = parseWorkflow(yaml)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-seams-'))
  return { def, file: path.join(dir, 'workflow.yaml'), dir, roles: {}, agents: {}, storeDir: path.join(dir, '.awd') }
}

test('createRuntime({ store: "memory" }) runs the engine end to end with no file on disk', async () => {
  const wf = loaded()
  const rt = createRuntime({ workflow: wf, store: 'memory', worker: new FakeWorker(undefined, { planner: { outcome: 'done' } }), port: false, cron: false, timerIntervalMs: 20 })
  assert.ok(rt.store instanceof MemoryEventStore)
  await rt.start()
  const ev = { id: 'e1', type: 'card.ready', data: { card: 'c9' }, ts: new Date().toISOString() }
  rt.store.append({ type: ev.type, key: keyFor(wf.def, ev), data: ev.data })
  await rt.engine.idle()
  assert.equal(rt.engine.states.get('c9')?.status, 'done')
  assert.ok(!fs.existsSync(path.join(wf.storeDir, 'events.ndjson')), 'memory store must not write the NDJSON file')
  await rt.stop()
})

test('Timer fires on a FakeClock without waiting on the wall clock', () => {
  const store = new MemoryEventStore()
  const clock = new FakeClock(1_000)
  const timer = new Timer(store, 100, clock)
  timer.set({ id: 't1', key: 'k', at: 1_250, event: { type: 'step.timeout', data: {} } })
  timer.start()
  clock.advance(200)
  assert.equal(store.read({ type: 'step.timeout' }).length, 0)
  clock.advance(100)
  assert.equal(store.read({ type: 'step.timeout' }).length, 1)
  timer.stop()
})

test('HerdrWorker over a FakeAgentChannel: start in a fresh pane, mailbox round-trip, blocked → agent_blocked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-chan-'))
  const channel = new FakeAgentChannel({
    onPrompt: (_name, text) => {
      const out = /to (\S+\.out\.json)/.exec(text)![1]
      fs.writeFileSync(out, '{"outcome":"done","via":"fake channel"}')
    },
  })
  const worker = new HerdrWorker({ exec: channelExec(channel), mailDir: path.join(dir, 'mail'), pollMs: 5, settleMs: 1, stateEveryMs: 5 })
  const schema = { type: 'object', required: ['outcome'], properties: { outcome: { enum: ['done'] } } }
  const r = await worker.run({ agent: 'qa', runner: 'herdr', runnerConfig: { kind: 'opencode' }, input: {}, outputSchema: schema, key: 'c', step: 'qa', commandId: 'x:qa' })
  assert.deepEqual(r.output, { outcome: 'done', via: 'fake channel' })
  assert.deepEqual(channel.calls.slice(0, 3).map((c) => c[0]), ['list', 'openPane', 'start'])
  assert.ok(channel.calls.some((c) => c[0] === 'prompt'))

  channel.setState('awd-qa', 'blocked')
  await assert.rejects(worker.run({ agent: 'qa', runner: 'herdr', runnerConfig: { kind: 'opencode' }, input: {}, outputSchema: schema, key: 'c', step: 'qa', commandId: 'y:qa' }), /agent_blocked/)
})

test('FileMailbox and MemoryMailbox speak the same envelope', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-mail-'))
  const envelope = { step: 's', key: 'k', system: null, input: { q: 1 }, outputSchema: {} }
  for (const box of [new FileMailbox(dir), new MemoryMailbox()]) {
    const { inbox, outbox } = await box.post('id 1', envelope)
    assert.ok(inbox && outbox)
    assert.equal(await box.answer('id 1'), undefined)
    if (box instanceof MemoryMailbox) box.deliver('id 1', { outcome: 'done' })
    else fs.writeFileSync(outbox, 'Here you go:\n```json\n{"outcome":"done"}\n```')
    assert.deepEqual(await box.answer('id 1'), { outcome: 'done' })
    await box.clear('id 1')
    assert.equal(await box.answer('id 1'), undefined)
  }
})
