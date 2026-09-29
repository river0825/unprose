// EventStorming → story map candidates (docs/diagrams.md §4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proposeStories } from '../src/diagrams/index.js'
import { studioEs } from './fixtures-es.js'

test('person + command → a story; events produced and read models shown → acceptance; traced back', () => {
  const p = proposeStories(studioEs, { esKey: 'studio-es' })
  const send = p.candidates.find((c) => c.source.id === 'send-ask')!
  assert.equal(send.text, 'As Designer, I send Ask AI')
  assert.deepEqual(send.acceptance, ['Event: Ask AI sent', 'Shows: Chat thread'])
  assert.deepEqual(send.traces, [{ from: 'studio-es/send-ask', rel: 'derived-from' }])
  assert.equal(send.id, 'from-send-ask')
  // no person: the command text alone
  assert.equal(p.candidates.find((c) => c.source.id === 'reply')!.text, 'Reply in thread')
})

test('phases become the backbone, commands the steps, in timeline order', () => {
  const p = proposeStories(studioEs, { esKey: 'studio-es' })
  assert.deepEqual(p.activities.map((a) => a.text), ['Ask', 'Work'])
  assert.deepEqual(p.activities[0].steps.map((s) => s.text), ['Send Ask AI', 'Pick up request'])
  assert.deepEqual(p.activities[1].steps.map((s) => s.text), ['Reply in thread'])
})

test('without phases, pivotal events cut the backbone', () => {
  const p = proposeStories({ ...studioEs, phases: [], events: studioEs.events.map(({ phase: _p, ...e }) => e) }, { esKey: 'studio-es' })
  assert.deepEqual(p.activities.map((a) => a.text), ['Request picked up', 'After: Request picked up'])
})

test('stories already tracing to a command are not proposed again; existing activity and step ids are reused', () => {
  const existing = { activities: [{ id: 'ask-activity', text: 'Ask', steps: [{ id: 'send-step', text: 'Send Ask AI', stories: [{ text: 'Old one', traces: [{ from: 'studio-es/pick-request', rel: 'derived-from' as const }] }] }] }] }
  const p = proposeStories(studioEs, { esKey: 'studio-es', existing })
  assert.ok(!p.candidates.some((c) => c.source.id === 'pick-request'))
  const send = p.candidates.find((c) => c.source.id === 'send-ask')!
  assert.equal(send.activity.id, 'ask-activity')
  assert.equal(send.step.id, 'send-step')
})

test('big picture: a person’s action becomes the candidate', () => {
  const p = proposeStories({ level: 'big-picture', events: [{ text: 'Card moved to Planning', actor: 'Human' }, { text: 'Plan written' }] }, { esKey: 'dev-es' })
  assert.equal(p.candidates.length, 1)
  assert.equal(p.candidates[0].text, 'As Human: Card moved to Planning')
  assert.equal(p.candidates[0].source.kind, 'event')
})
