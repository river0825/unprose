// A domain story's actors, work objects, sentences, groups and notes share one set of ids (docs/diagrams.md §2): a
// sentence given the id of a work object (both `quote`) was drawn as `quote-2` without a word, and a trace from another
// diagram to `<key>/quote` found nothing — cards carry their sentence's element, not the work object's. Now a trace to a
// declared work object reaches its first card (as a note or a group on it does), and the lint names the clash.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDomainStory, type DomainStoryContent } from '../src/diagrams/domainStory.js'
import { designFromObject, lintDesignContent } from '../src/diagrams/designFile.js'
import { renderDomainStory } from '../src/templates/domain-story.js'
import { renderKanban } from '../src/templates/kanban.js'
import { resolveTraces } from '../src/templates/frame.js'
import type { Item } from '../src/model.js'

const now = 'T'
const board = (items: Item[]) => Object.fromEntries(items.map((i) => [i.id, i]))
const tracing = (...from: string[]) => renderKanban({ columns: [{ name: 'A' }], cards: [{ id: 'c', title: 'Card', column: 'A', traces: from.map((f) => ({ from: f, rel: 'relates' as const })) }] }, { scope: 'kb', now })

const story = (sentenceId = 'quote'): DomainStoryContent => ({
  actors: [{ id: 'clerk', text: 'Clerk' }, { id: 'customer', text: 'Customer' }],
  workObjects: [{ id: 'request', text: 'Request' }, { id: 'quote', text: 'Quote' }],
  sentences: [
    { id: 'ask', actor: 'customer', verb: 'asks for', object: 'request', to: 'clerk' },
    { id: sentenceId, actor: 'clerk', verb: 'sends', object: 'quote', to: 'customer' },
    { id: 'accept', actor: 'customer', verb: 'accepts', object: 'quote', to: 'clerk' },
  ],
})

test('a trace to a work object whose id a sentence also has is drawn, to its first card', () => {
  const ds = renderDomainStory(story(), { scope: 'ds', now })
  assert.ok(ds.some((i) => i.id === 'ds.object.quote-2'), 'the sentence is drawn under the next free id')
  const { wires, unresolved } = resolveTraces(tracing('ds/quote'), board(ds), now)
  assert.deepEqual(unresolved, [])
  assert.deepEqual(wires.map((w) => [w.from, w.to]), [['kb.card.c', 'ds.object.quote-2']])
})

test('a trace to a declared work object reaches its first card; a sentence id still wins', () => {
  const ds = renderDomainStory(story('send'), { scope: 'ds', now })
  const { wires, unresolved } = resolveTraces(tracing('ds/quote', 'ds/accept', 'ds/request', 'ds/nothing'), board(ds), now)
  assert.deepEqual(wires.map((w) => w.to), ['ds.object.send', 'ds.object.accept', 'ds.object.ask'])
  assert.deepEqual(unresolved.map((u) => u.trace.from), ['ds/nothing'])
})

test('the lint names an explicit id another element already has (id-taken), and only then', () => {
  const findings = checkDomainStory(story()).filter((f) => f.rule === 'id-taken')
  assert.equal(findings.length, 1)
  assert.equal(findings[0].severity, 'warning')
  assert.equal(findings[0].element, 'quote-2')
  assert.match(findings[0].message, /sentence "② sends" has the id "quote", which work object "Quote" already has/)
  assert.match(findings[0].message, /drawn as "quote-2"/)
  assert.deepEqual(checkDomainStory(story('send')).filter((f) => f.rule === 'id-taken'), [])
  // a group or a note too; two sentences with no id on the same verb get -2 quietly (no id was asked for)
  const more = { ...story('send'), groups: [{ id: 'clerk', text: 'Desk', members: ['clerk'] }], annotations: [{ id: 'ask', on: 'quote', text: 'priced by hand' }] }
  assert.deepEqual(checkDomainStory(more).filter((f) => f.rule === 'id-taken').map((f) => f.element), ['clerk-2', 'ask-2'])
  const lint = lintDesignContent(designFromObject('design/quotes.domain-story.yaml', story()))
  assert.ok(lint.some((f) => f.severity === 'warning' && f.element === 'quote-2' && /already has/.test(f.message)))
})
