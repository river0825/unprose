// Long-term memory: `learn` → memory.learned event → MemoryStore projection →
// recalled into the next call's system prompt. Both adapters agree on recall.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseWorkflow } from '@awd/core'
import { createRuntime, FakeWorker, FileMemoryStore, MemoryMemoryStore, syncMemory, renderMemory, keyFor, MEMORY_LEARNED } from '../src/index.js'
import type { LoadedWorkflow, MemoryStore, MemoryEntry, WorkerRuntime, WorkerRequest } from '../src/index.js'

const yaml = `
name: mem
key: "{{ event.data.card }}"
agents:
  planner: { system: "You plan.", memory: { recall: 5 } }
steps:
  plan:
    on: card.ready
    terminal: true
    ai:
      agent: planner
      input: { card: "{{ key }}" }
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } }
`

function loaded(): LoadedWorkflow {
  const def = parseWorkflow(yaml)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-mem-'))
  return { def, file: path.join(dir, 'workflow.yaml'), dir, roles: {}, agents: def.agents, storeDir: path.join(dir, '.awd') }
}

const entry = (id: string, note: string, extra: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, agent: 'planner', note, tags: [], at: `2026-09-2${id.slice(-1)}T00:00:00.000Z`, ...extra })

async function exercise(store: MemoryStore) {
  await store.record(entry('m1', 'oldest, about card A', { key: 'A' }))
  await store.record(entry('m2', 'middle, tagged', { tags: ['rollback'] }))
  await store.record(entry('m3', 'newest, plain'))
  await store.record(entry('m3', 'duplicate id is ignored'))
  await store.record({ ...entry('o1', 'someone else'), agent: 'reviewer' })
  assert.deepEqual((await store.list('planner')).map((e) => e.id), ['m1', 'm2', 'm3'])
  assert.deepEqual((await store.recall('planner')).map((e) => e.id), ['m3', 'm2', 'm1'], 'newest first')
  assert.deepEqual((await store.recall('planner', { key: 'A' })).map((e) => e.id), ['m1', 'm3', 'm2'], 'the key-matching note jumps the queue')
  assert.deepEqual((await store.recall('planner', { tags: ['rollback'], limit: 1 })).map((e) => e.id), ['m2'])
  assert.equal(await store.forget('planner', 'm2'), true)
  assert.equal(await store.forget('planner', 'nope'), false)
  assert.deepEqual((await store.list('planner')).map((e) => e.id), ['m1', 'm3'])
  await store.record(entry('m2', 'the log still has it — a re-sync must not bring it back', { tags: ['rollback'] }))
  assert.deepEqual((await store.list('planner')).map((e) => e.id), ['m1', 'm3'], 'forgotten stays forgotten')
  assert.equal((await store.list()).length, 3)
}

test('MemoryMemoryStore and FileMemoryStore agree on record / recall / forget', async () => {
  await exercise(new MemoryMemoryStore())
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-memfile-'))
  await exercise(new FileMemoryStore(dir))
  // a fresh instance reads what the previous one wrote
  const again = new FileMemoryStore(dir)
  assert.deepEqual((await again.list('planner')).map((e) => e.id), ['m1', 'm3'])
  await again.record(entry('m2', 'back from the log?'))
  assert.deepEqual((await again.list('planner')).map((e) => e.id), ['m1', 'm3'], 'tombstones persist across instances')
})

test('learn → memory.learned event → recalled on the next run, in the system prompt and the outcome meta', async () => {
  const wf = loaded()
  const seen: WorkerRequest[] = []
  const fake = new FakeWorker(undefined, { planner: [{ outcome: 'done', learn: [{ note: 'Cards without a spec need the rollback section inline.', tags: ['rollback'] }] }, { outcome: 'done' }] })
  const recording: WorkerRuntime = { name: 'rec', run: async (req) => { seen.push(req); return fake.run(req) } }
  const rt = createRuntime({ workflow: wf, store: 'memory', worker: recording, port: false, cron: false, timerIntervalMs: 20 })
  await rt.start()
  const fire = async (card: string) => {
    const ev = { id: 'x', type: 'card.ready', data: { card }, ts: new Date().toISOString() }
    rt.store.append({ type: ev.type, key: keyFor(wf.def, ev), data: ev.data })
    await rt.engine.idle()
  }
  await fire('A')
  const learned = rt.store.read({ type: MEMORY_LEARNED })
  assert.equal(learned.length, 1)
  assert.deepEqual(learned[0].data, { agent: 'planner', key: 'A', step: 'plan', note: 'Cards without a spec need the rollback section inline.', tags: ['rollback'] })
  assert.equal(rt.engine.states.get('A')?.status, 'done')
  assert.ok(!seen[0].system?.includes('learned before'), 'nothing to recall on the first run')

  await fire('B')
  assert.match(seen[1].system ?? '', /What you learned before[\s\S]*rollback section inline/)
  assert.equal(seen[1].memory?.longTerm.length, 1)
  const outcome = rt.store.read({ key: 'B', type: 'plan.done' })[0]
  assert.deepEqual(outcome.meta?.recalled, ['Cards without a spec need the rollback section inline.'])
  await rt.stop()

  // The projection is rebuildable from the log alone.
  const rebuilt = new MemoryMemoryStore()
  assert.equal(await syncMemory(rt.store.all(), rebuilt), 1)
  assert.equal((await rebuilt.list('planner'))[0].id, learned[0].id)
})

test('renderMemory is compact and says how to write back', () => {
  const text = renderMemory({ longTerm: [entry('m1', 'x'.repeat(400), { key: 'A' })], short: { trail: [{ step: 'plan', agent: 'planner', outcome: 'done', summary: 'short', at: 't' }], remembered: { size: 'M' } } })
  assert.match(text, /^## What you learned before/)
  assert.ok(text.includes('…'), 'long notes are clipped')
  assert.match(text, /## Earlier in this run/)
  assert.match(text, /plan \(@planner\) → done: short/)
  assert.match(text, /remember.*size/)
  assert.match(text, /`learn: \[\{ note, tags \}\]`/)
  assert.equal(renderMemory(undefined), '')
  assert.equal(renderMemory({ longTerm: [], short: { trail: [], remembered: {} } }), '')
})
