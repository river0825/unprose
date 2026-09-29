import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unknownContentFields, contentSchemaFor } from '../src/diagrams/check.js'

test('#8: fields a schema would drop are reported with where they are', () => {
  const found = unknownContentFields('kanban', {
    columns: [{ name: 'A', colour: 'red' }],
    cards: [{ title: 'x', column: 'A' }, { title: 'y', column: 'A', link: 'https://x', traces: [{ from: 'k/a', rel: 'groups', note: 'n' }] }],
    swimlanes: [],
  })
  assert.deepEqual(found, [
    { path: 'columns[0]', field: 'colour' },
    { path: 'cards[1]', field: 'link' },
    { path: 'cards[1].traces[0]', field: 'note' },
    { path: '(root)', field: 'swimlanes' },
  ])
})

test('#8: known fields, unions and nested diagrams pass clean; every kind with a schema is checked', () => {
  assert.deepEqual(unknownContentFields('event-storming', {
    level: 'process',
    people: ['You', { id: 'ai', text: 'AI' }],
    events: [{ id: 'e', text: 'Asked' }],
    commands: [{ text: 'Ask', by: 'You', produces: ['e'] }],
  }), [])
  assert.deepEqual(unknownContentFields('user-story-map', { releases: ['R1'], activities: [{ text: 'A', steps: [{ text: 'S', stories: [{ text: 'x', acceptence: ['typo'] }] }] }] }), [
    { path: 'activities[0].steps[0].stories[0]', field: 'acceptence' },
  ])
  for (const kind of ['event-storming', 'user-story-map', 'kanban', 'wireframe', 'user-journey']) assert.ok(contentSchemaFor(kind), kind)
  assert.equal(contentSchemaFor('workflow'), undefined)
})
