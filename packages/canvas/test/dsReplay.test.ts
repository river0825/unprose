import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import type { DomainStoryContent } from '../src/diagrams/domainStory.js'
import { renderDomainStory } from '../src/templates/domain-story.js'
import { buildReplay, canReplay, clampStep, statusAt, statusesAt } from '../web/src/diagrams/replay.js'

const now = '2026-10-02T00:00:00Z'
const story: DomainStoryContent = {
  actors: ['Customer', { id: 'clerk', text: 'Clerk' }, { text: 'Policy system', kind: 'system' }, 'Idle'],
  workObjects: [{ id: 'form', text: 'application form' }, { text: 'policy' }],
  sentences: [
    { id: 'send', actor: 'Customer', verb: 'sends', object: 'form', to: 'clerk' },
    { id: 'check', actor: 'clerk', verb: 'checks', object: 'form' },
    // two activities share number 3: parallel, one step
    { id: 'enter', seq: 3, actor: 'clerk', verb: 'enters', object: 'policy', to: 'Policy system', toLabel: 'into' },
    { id: 'call', seq: 3, actor: 'clerk', verb: 'calls', to: 'Customer' },
    { id: 'notify', actor: 'Policy system', verb: 'notifies', to: 'Customer' },
  ],
  annotations: [{ on: 'clerk', text: 'Only in office hours' }, { on: 'enter', text: 'Typed by hand' }],
  groups: [{ id: 'back', text: 'Back office', members: ['enter', 'Policy system'] }],
}

function boardOf(content: DomainStoryContent): { board: Board; items: Item[] } {
  const frame = { id: 'frame', type: 'frame', x: -40, y: -40, w: 4000, h: 3000, text: 'Story', createdBy: 'agent', updatedBy: 'agent', updatedAt: now, data: { diagram: { kind: 'domain-story', key: 'ds' } } } as unknown as Item
  const items = renderDomainStory(content, { scope: 'ds', now }).map((i) => (i.type === 'arrow' ? i : { ...i, parent: 'frame' }))
  const comment = { id: 'c1', type: 'comment', x: 0, y: 0, w: 160, h: 64, text: 'why?', target: 'ds.object.enter', createdBy: 'user', updatedBy: 'user', updatedAt: now } as Item
  const reply = { ...comment, id: 'c2', target: 'c1', text: 'because' } as Item
  const outside = { id: 'loose', type: 'sticky', x: 9000, y: 0, w: 100, h: 100, createdBy: 'user', updatedBy: 'user', updatedAt: now } as Item
  const all = [frame, ...items, comment, reply, outside]
  return { board: { id: 'b', title: 't', kind: 'freeform', seq: 0, items: Object.fromEntries(all.map((i) => [i.id, i])) } as unknown as Board, items }
}

const { board, items } = boardOf(story)
const model = buildReplay(board, 'frame')
const find = (pred: (i: Item) => boolean) => items.find(pred)!.id
const actor = (el: string) => `ds.actor.${el}`
const object = (el: string) => `ds.object.${el}`
const activityInto = (to: string) => find((i) => i.type === 'arrow' && i.role === 'activity' && i.to === to)
const onward = (from: string) => find((i) => i.type === 'arrow' && i.role === 'activity-to' && i.from === from)

test('one step per sequence number; parallel activities (a shared number) are one step', () => {
  assert.deepEqual(model.steps.map((s) => s.seq), [1, 2, 3, 4])
  assert.equal(model.steps[2].sentences.length, 2, 'step 3 tells both sentences numbered 3')
  assert.match(model.steps[2].sentences[0], /Clerk enters policy into Policy system/)
  assert.match(model.steps[2].sentences[1], /Clerk calls to Customer/)
  assert.ok(canReplay(board, 'frame'))
})

test('step 1 shows only sentence 1: actor, activity, work object, onward arrow, receiver — all current', () => {
  const s = statusesAt(model, 1)
  for (const id of [actor('customer'), activityInto(object('send')), object('send'), onward(object('send')), actor('clerk')]) assert.equal(s.get(id), 'current', id)
  for (const id of [object('check'), object('enter'), actor('policy-system')]) assert.equal(s.get(id), 'untold', id)
  assert.deepEqual(model.steps[0].focus.sort(), [actor('clerk'), actor('customer'), object('send')].sort(), 'the view follows the pictograms, not the arrows')
})

test('earlier sentences stay (told), later ones are hidden, the current one is highlighted', () => {
  assert.equal(statusAt(model, 2, object('send')), 'told')
  assert.equal(statusAt(model, 2, actor('customer')), 'told')
  assert.equal(statusAt(model, 2, actor('clerk')), 'current', 'an actor who acts again is current again')
  assert.equal(statusAt(model, 2, object('check')), 'current')
  assert.equal(statusAt(model, 2, object('enter')), 'untold')
  assert.equal(statusAt(model, 3, object('enter')), 'current')
  assert.equal(statusAt(model, 3, actor('policy-system')), 'current')
  assert.equal(statusAt(model, 4, object('enter')), 'told')
  // the last step: everything of the story is shown
  const last = statusesAt(model, 4)
  assert.ok([...last].every(([id, st]) => st !== 'untold' || id === actor('idle')), 'only the actor in no sentence stays hidden')
})

test('annotations come with what they explain; a group when its first member appears; legend and others are left alone', () => {
  const noteOn = (target: string) => items.find((i) => i.type === 'arrow' && i.role === 'annotation-link' && i.to === target)!
  const clerkNote = noteOn(actor('clerk'))
  assert.equal(model.appear.get(clerkNote.from!), 1, 'the clerk is in sentence 1')
  assert.equal(model.appear.get(clerkNote.id), 1)
  const enterNote = noteOn(object('enter'))
  assert.equal(model.appear.get(enterNote.from!), 3)
  assert.equal(model.appear.get('ds.group.back'), 3, 'the group appears with its first member (the policy, sentence 3)')
  assert.equal(statusAt(model, 4, enterNote.from!), 'told', 'an annotation is never current itself')
  assert.equal(statusAt(model, 1, 'ds.legend.l0'), undefined, 'the legend is not part of the story')
  assert.equal(statusAt(model, 1, 'loose'), undefined, 'items outside the frame are left alone')
  assert.equal(model.appear.get(actor('idle')), Infinity, 'an actor in no sentence is not shown during the replay (as in Egon.io)')
})

test('a comment (and its replies) about a story item appears with the item', () => {
  assert.equal(model.appear.get('c1'), 3)
  assert.equal(model.appear.get('c2'), 3)
  assert.equal(statusAt(model, 2, 'c1'), 'untold')
})

test('a sentence without a work object: its single arrow and both actors', () => {
  const call = items.find((i) => i.type === 'arrow' && i.role === 'activity' && i.data?.element === 'call')!
  assert.equal(statusAt(model, 3, call.id), 'current')
  assert.equal(statusAt(model, 3, actor('customer')), 'current', 'the receiver of a parallel sentence is current too')
  const notify = items.find((i) => i.type === 'arrow' && i.role === 'activity' && i.data?.element === 'notify')!
  assert.equal(statusAt(model, 3, notify.id), 'untold')
})

test('gaps in the numbering are skipped; clampStep keeps a step inside the story; a frame without a story has no steps', () => {
  const gap = boardOf({ actors: ['A', 'B'], sentences: [{ seq: 2, actor: 'A', verb: 'asks', object: 'q', to: 'B' }, { seq: 5, actor: 'B', verb: 'answers', object: 'a', to: 'A' }] })
  const m = buildReplay(gap.board, 'frame')
  assert.deepEqual(m.steps.map((s) => s.seq), [2, 5])
  assert.equal(clampStep(m, 9), 2)
  assert.equal(clampStep(m, 0), 1)
  assert.equal(buildReplay(board, 'nope').steps.length, 0)
  assert.equal(canReplay(board, 'nope'), false)
})
