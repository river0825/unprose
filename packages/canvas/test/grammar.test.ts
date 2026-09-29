// The grammar check (docs/diagrams.md §3): findings name an element and the book page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEventStorming, openHotspotCount } from '../src/diagrams/index.js'
import { studioEs } from './fixtures-es.js'

const rules = (f: ReturnType<typeof checkEventStorming>) => f.map((x) => `${x.rule}:${x.element ?? '-'}`)

test('a diagram in the book grammar only reports its open hotspots', () => {
  const f = checkEventStorming({ ...studioEs, commands: studioEs.commands!.map((k) => ({ ...k, by: k.by ?? undefined })) })
  // 'reply' is issued by nobody yet, and a pivotal event on a process board — the fixture's two gaps
  assert.deepEqual(rules(f).sort(), ['command-without-trigger:reply', 'open-hotspots:-', 'pivotal-on-process:request-picked'].sort())
  assert.match(f.find((x) => x.rule === 'open-hotspots')!.message, /^1 open hotspot/)
  assert.equal(openHotspotCount(studioEs), 1)
})

test('command without a system, without an event, policy halves, unused read model, sourceless event', () => {
  const f = checkEventStorming({
    level: 'process',
    events: [{ text: 'Started' }, { text: 'Orphan happened' }],
    commands: [{ text: 'Do it', by: 'Ann' }],
    policies: [{ text: 'Whenever nothing', when: 'Nope', then: [] }],
    readModels: [{ text: 'Unread list' }],
  })
  const r = rules(f)
  for (const want of ['command-without-system:do-it', 'command-without-event:do-it', 'policy-without-event:whenever-nothing', 'policy-without-command:whenever-nothing', 'read-model-unused:unread-list', 'event-without-source:orphan-happened', 'unresolved-reference:whenever-nothing'])
    assert.ok(r.includes(want), `missing ${want} in ${r.join(', ')}`)
  for (const x of f) assert.match(x.page, /^p\.\d+/)
})

test('big picture skips the process rules; process flags pivotal events; software flags idle aggregates', () => {
  assert.deepEqual(rules(checkEventStorming({ level: 'big-picture', events: [{ text: 'A' }, { text: 'B', pivotal: true }], commands: [{ text: 'X' }] })), [])
  assert.ok(rules(checkEventStorming({ level: 'process', events: [{ text: 'A', pivotal: true }] })).includes('pivotal-on-process:a'))
  assert.ok(rules(checkEventStorming({ level: 'software', events: [{ text: 'A' }], aggregates: ['Cart'] })).includes('aggregate-without-behaviour:cart'))
})
