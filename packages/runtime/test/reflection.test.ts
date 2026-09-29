// Reflection: signals (failures + reflect notes) → patterns → cards, and the
// canvas adapter's idempotent upsert. The engine turns a script's `reflect`
// and an agent's `reflect` into reflection.noted events.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseWorkflow, type Event } from '@awd/core'
import { createRuntime, FakeWorker, signalsOf, patternsOf, decisionsOf, cardForPattern, renderPatterns, reasonClass, canvasCards, REFLECTION_NOTED } from '../src/index.js'
import type { LoadedWorkflow } from '../src/index.js'

const ev = (id: string, type: string, key: string, data?: unknown, ts = '2026-09-22T00:00:00Z'): Event => ({ id, type, key, data, ts })

test('signals: failures are classified by reason, reflections keep kind/tags; patterns count keys and carry a guard', () => {
  const events: Event[] = [
    ev('1', 'build.failed', 'c1', { error: 'exit 1', stderr: 'gate fail' }),
    ev('2', 'build.failed', 'c2', { error: 'exit 2' }, '2026-09-23T00:00:00Z'),
    ev('3', 'plan.failed', 'c3', { error: 'output does not match schema: outcome missing' }),
    ev('4', 'confirm.timeout', 'c4'),
    ev('5', REFLECTION_NOTED, 'c1', { source: 'ai', agent: 'reviewer', step: 'review', note: 'no CI link in the input', kind: 'friction', tags: ['review', 'ci'] }),
    ev('6', REFLECTION_NOTED, 'c2', { source: 'ai', agent: 'reviewer', step: 'review', note: 'still no CI link', kind: 'friction', tags: ['ci', 'review'] }),
    ev('7', REFLECTION_NOTED, 'c9', { source: 'script', step: 'merge', note: 'never merge without the migration gate', kind: 'rule' }),
    ev('8', 'timer.set', 'c1'),
    ev('9', 'memory.learned', 'c1', { agent: 'planner', note: 'x' }),
    ev('10', 'build.retry', 'c1'),
  ]
  const signals = signalsOf(events)
  assert.equal(signals.length, 7)
  assert.equal(reasonClass({ error: 'exit 137' }), 'exit non-zero')
  assert.equal(reasonClass({ reason: 'agent_blocked', error: 'agent_blocked: x' }), 'agent_blocked')
  assert.equal(reasonClass({ error: 'ENOENT: no such file /tmp/x' }), 'missing file or command')

  const patterns = patternsOf(events)
  const build = patterns.find((p) => p.step === 'build')!
  assert.equal(build.count, 2)
  assert.deepEqual(build.keys, ['c1', 'c2'])
  assert.equal(build.firstAt, '2026-09-22T00:00:00Z')
  assert.equal(build.lastAt, '2026-09-23T00:00:00Z')
  assert.match(build.guard, /tests\/build-exit-non-zero\.golden\.yaml/)
  const ci = patterns.find((p) => p.kind === 'reflection' && p.rkind === 'friction')!
  assert.equal(ci.count, 2, 'same kind + same tag set groups two differently worded notes')
  const rule = patterns.find((p) => p.rkind === 'rule')!
  assert.match(rule.guard, /lint rule or a gate/)

  const decisions = decisionsOf(patterns)
  assert.deepEqual(decisions.map((d) => (d.kind === 'failure' ? d.step : d.rkind)).sort(), ['build', 'friction', 'rule'], 'threshold 2, plus any rule')
  assert.equal(decisionsOf(patterns, { threshold: 3 }).map((d) => d.rkind).join(), 'rule')

  const card = cardForPattern(build)
  assert.match(card.id, /^rf-[0-9a-f]{8}$/)
  assert.equal(card.pattern, card.id)
  assert.match(card.description, /Suggested guard: add a golden/)
  assert.match(card.description, /Keys: c1, c2/)
  assert.deepEqual(card.labels, ['reflection', 'failure'])

  // stable ids across runs
  assert.equal(patternsOf(events)[0].id, patterns[0].id)
  assert.match(renderPatterns(patterns), /build fails: exit non-zero/)
  assert.equal(signalsOf(events, { since: '2026-09-23T00:00:00Z' }).length, 1)
})

test('canvas cards adapter: creates once, updates in place on the next run', async () => {
  const items: Record<string, { id: string; type: string; text?: string; data?: Record<string, unknown> }> = {}
  const calls: string[] = []
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push(`${init?.method ?? 'GET'} ${u.pathname}`)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    if (u.pathname === '/api/boards') return json({ boards: [{ id: 'b1', title: 'Dev board', kind: 'kanban' }] })
    if (u.pathname === '/api/boards/b1') return json({ board: { id: 'b1', title: 'Dev board', kind: 'kanban', items } })
    if (u.pathname === '/api/boards/b1/cards') {
      const id = `kb.card.${body.id}`
      items[id] = { id, type: 'card', text: body.title, data: { description: body.description, labels: body.labels } }
      return json({ card: items[id], seq: 2 }, 201)
    }
    if (u.pathname === '/api/boards/b1/ops') {
      for (const op of body.ops) if (op.kind === 'update') items[op.id] = { ...items[op.id], ...op.patch }
      return json({ seq: 3 })
    }
    return json({ error: 'nope' }, 404)
  }) as unknown as typeof fetch
  const cards = canvasCards({ base: 'http://canvas.test', fetch: fakeFetch })
  const card = cardForPattern(patternsOf([ev('1', 'build.failed', 'c1', { error: 'exit 1' }), ev('2', 'build.failed', 'c2', { error: 'exit 1' })])[0])
  const first = await cards.upsertCards('title:Dev board', [card])
  assert.equal(first.created.length, 1)
  assert.equal(Object.values(items)[0].data?.pattern, card.pattern)
  const again = await cards.upsertCards('b1', [card])
  assert.deepEqual([again.created.length, again.updated.length], [0, 0], 'same count → untouched')
  const grown = { ...card, count: 3, description: card.description + '\nmore' }
  const third = await cards.upsertCards('b1', [grown])
  assert.deepEqual([third.created.length, third.updated.length], [0, 1])
  assert.equal(Object.values(items)[0].data?.count, 3)
  assert.equal(Object.keys(items).length, 1, 'never a twin card')
})

test('engine: a script\'s `reflect` and an agent\'s `reflect` become reflection.noted; *.failed fires the reflection step', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-reflect-'))
  const def = parseWorkflow(`
name: r
key: "{{ event.data.k }}"
agents:
  bot: { system: "answer" }
steps:
  work:
    on: go
    run: 'echo ''{"outcome":"done","data":{"x":1},"reflect":[{"note":"the input format is awkward","kind":"friction","tags":["input"]}]}'''
  think:
    on: work.done
    terminal: true
    ai:
      agent: bot
      input: { x: "{{ vars.work.x }}" }
      output: { type: object, required: [outcome], properties: { outcome: { enum: [done] } } }
  boom:
    on: go
    run: 'exit 3'
    terminal: true
  reflect:
    on: "*.failed"
    run: 'echo ''{"outcome":"done"}'''
    terminal: true
`)
  const wf: LoadedWorkflow = { def, file: path.join(dir, 'workflow.yaml'), dir, roles: {}, agents: def.agents, storeDir: path.join(dir, '.awd') }
  const worker = new FakeWorker(undefined, { bot: { outcome: 'done', reflect: [{ note: 'we should lint this', kind: 'rule' }] } })
  const rt = createRuntime({ workflow: wf, store: 'memory', worker, port: false, cron: false, timerIntervalMs: 10 })
  await rt.start()
  rt.store.append({ type: 'go', key: 'k1', data: { k: 'k1' } })
  await rt.engine.idle()
  await rt.stop()
  const all = rt.store.all()
  const noted = all.filter((e) => e.type === REFLECTION_NOTED)
  assert.equal(noted.length, 2)
  assert.deepEqual(noted.map((e) => (e.data as { source: string }).source).sort(), ['ai', 'script'])
  assert.equal((noted.find((e) => (e.data as { source: string }).source === 'ai')!.data as { kind: string }).kind, 'rule')
  assert.ok(all.some((e) => e.type === 'boom.failed'))
  assert.ok(all.some((e) => e.type === 'reflect.done'), '*.failed listener ran on boom.failed')
  assert.ok(!('reflect' in ((rt.engine.states.get('k1')!.vars.work as object) ?? {})), 'reflect is not part of vars')
  const patterns = patternsOf(all)
  assert.equal(patterns.length, 3)
  assert.equal(decisionsOf(patterns).length, 1, 'only the rule crosses the threshold')
})
