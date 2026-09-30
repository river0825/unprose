import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderUserStoryMap } from '../src/templates/user-story-map.js'
import { renderKanban } from '../src/templates/kanban.js'
import { renderDomainStory } from '../src/templates/domain-story.js'
import { renderEventStorming } from '../src/templates/event-storming.js'
import type { Item } from '../src/model.js'

// Frozen headers (docs/diagrams.md): templates mark the items the web pins to the viewport edges.
const now = '2026-09-30T00:00:00Z'
const headers = (items: Item[], kind: 'column' | 'row') => items.filter((i) => i.data?.header === kind)

test('story map: activities and steps are column headers, release lanes are row headers', () => {
  const items = renderUserStoryMap(
    { releases: ['R1', 'R2'], activities: [{ id: 'ask', text: 'Ask', steps: [{ id: 'sel', text: 'Select', stories: [{ text: 'a', release: 'R1' }, { text: 'b', release: 'R2' }] }] }] },
    { scope: 'sm', now },
  )
  assert.deepEqual(headers(items, 'column').map((i) => i.role).sort(), ['activity', 'step'])
  assert.deepEqual(headers(items, 'row').map((i) => i.text), ['R1', 'R2'])
})

test('kanban: column lanes are column headers', () => {
  const items = renderKanban({ columns: [{ name: 'Backlog' }, { name: 'Done' }], cards: [{ title: 'x', column: 'Backlog' }] }, { scope: 'kb', now })
  assert.deepEqual(headers(items, 'column').map((i) => i.text), ['Backlog', 'Done'])
  assert.equal(headers(items, 'row').length, 0)
})

test('domain story: no frozen headers — actors are placed freely, so there are no columns or rows to pin', () => {
  const items = renderDomainStory(
    {
      actors: [{ id: 'you', text: 'You', kind: 'person' }, { id: 'st', text: 'Studio', kind: 'system' }],
      workObjects: [{ id: 'c', text: 'comment' }, { id: 'b', text: 'brief' }],
      sentences: [
        { id: 's1', actor: 'you', verb: 'writes', object: 'c', to: 'st' },
        { id: 's2', actor: 'st', verb: 'writes', object: 'b', to: 'you' },
      ],
    },
    { scope: 'ds', now },
  )
  assert.equal(headers(items, 'column').length + headers(items, 'row').length, 0)
})

test('event storming: swimlanes are row headers, phases are column headers', () => {
  const items = renderEventStorming(
    {
      level: 'big-picture',
      lanes: ['Customer', 'Back office'],
      events: [{ id: 'e1', text: 'Order placed', lane: 'Customer' }, { id: 'e2', text: 'Order shipped', lane: 'Back office' }],
      phases: [{ id: 'p1', text: 'Sales', from: 'e1', to: 'e2' }],
    },
    { scope: 'es', now },
  )
  assert.deepEqual(headers(items, 'row').map((i) => i.text).sort(), ['Back office', 'Customer'])
  assert.deepEqual(headers(items, 'column').map((i) => i.text), ['Sales'])
})
