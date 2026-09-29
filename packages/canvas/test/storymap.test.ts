// Story map with ids, acceptance, traces and release cut lines (docs/diagrams.md §5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderUserStoryMap } from '../src/templates/index.js'

const NOW = '2026-09-23T00:00:00.000Z'
const content = {
  releases: ['Release 1', 'Later'],
  activities: [
    { id: 'ask', text: 'Ask', steps: [{ id: 'send', text: 'Send Ask AI', stories: [{ id: 'chat', text: 'Chat with the selection', release: 'Release 1', acceptance: ['Event: Ask AI sent'], traces: [{ from: 'studio-es/send-ask', rel: 'derived-from' as const }] }, { text: 'Voice input' }] }] },
  ],
}

test('ids are <scope>.<role>.<element id>; stories keep acceptance and traces', () => {
  const items = renderUserStoryMap(content, { now: NOW, scope: 'studio-story-map' })
  const story = items.find((i) => i.id === 'studio-story-map.story.chat')!
  assert.deepEqual(story.data?.acceptance, ['Event: Ask AI sent'])
  assert.deepEqual(story.data?.traces, [{ from: 'studio-es/send-ask', rel: 'derived-from' }])
  assert.ok(items.some((i) => i.id === 'studio-story-map.activity.ask'))
  assert.ok(items.some((i) => i.id === 'studio-story-map.story.voice-input' && i.data?.release === 'Later'))
})

test('a cut line sits above every release but the first', () => {
  const items = renderUserStoryMap(content, { now: NOW })
  const cuts = items.filter((i) => i.role === 'release-cut')
  assert.equal(cuts.length, 1)
  const later = items.find((i) => i.type === 'lane' && i.text === 'Later')!
  const first = items.find((i) => i.type === 'lane' && i.text === 'Release 1')!
  assert.ok(cuts[0].y > first.y + first.h - 1 && cuts[0].y < later.y, 'between Release 1 and Later')
})
