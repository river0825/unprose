import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASK_HINTS, HELP_HINT, promptParts } from '../web/src/askHints.js'

test('the ask hints name every Unprose slash command once', () => {
  const commands = [...ASK_HINTS, HELP_HINT].map((h) => h.command)
  assert.deepEqual(commands.sort(), [
    '/unprose:domain-story',
    '/unprose:eventstorm',
    '/unprose:help',
    '/unprose:kanban',
    '/unprose:review',
    '/unprose:storymap',
    '/unprose:wireframe',
  ])
  for (const h of [...ASK_HINTS, HELP_HINT]) assert.ok(h.title && h.what && h.prompt, h.id)
})

test('a prompt splits into text and <placeholder> parts', () => {
  assert.deepEqual(promptParts('Sketch a wireframe of the <checkout page>'), [
    { text: 'Sketch a wireframe of the ', slot: false },
    { text: '<checkout page>', slot: true },
  ])
  assert.deepEqual(promptParts('What can Unprose do?'), [{ text: 'What can Unprose do?', slot: false }])
})
