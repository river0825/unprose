// The panel's Links (web/src/inspector/links.ts): every line is an arrow, and the panel sorts an item's lines by
// what they are — a workflow's wire, a trace to another diagram, an arrow inside the diagram, a link a person drew.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { linkKind, lineLabel, linksOf } from '../web/src/inspector/links.js'

const who = { kind: 'user' as const, name: 'river' }
const item = (id: string, p: Partial<Item>): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 60, createdBy: who, updatedBy: who, updatedAt: '2026-10-08T00:00:00Z', ...p })
const board = (...items: Item[]): Board => ({ id: 'b', title: 't', items: Object.fromEntries(items.map((i) => [i.id, i])), seq: 1 }) as unknown as Board

const dsFrame = item('diagram.ds', { type: 'frame', text: 'story', data: { diagram: { kind: 'domain-story', key: 'ds', source: 'design/ds.domain-story.yaml' } } })
const smFrame = item('diagram.sm', { type: 'frame', text: 'map', data: { diagram: { kind: 'user-story-map', key: 'sm', source: 'design/sm.story-map.yaml' } } })
const reader = item('ds.actor.reader', { text: '讀者', role: 'actor', parent: 'diagram.ds' })
const card = item('ds.object.card', { text: '借書證', role: 'work-object', parent: 'diagram.ds' })
const story = item('sm.story.scan', { text: 'scan card', role: 'story', parent: 'diagram.sm' })
const note = item('note-1', { text: 'a thought' })
const activity = item('ds.arrow.1', { type: 'arrow', role: 'activity', from: 'ds.actor.reader', to: 'ds.object.card', label: '出示', parent: 'diagram.ds' })
const trace = item('sm.story.scan.trace', { type: 'arrow', role: 'trace', from: 'ds.object.card', to: 'sm.story.scan', label: '來自', data: { trace: { rel: 'derived-from' } } })
const drawn = item('arrow-hand', { type: 'arrow', from: 'note-1', to: 'ds.object.card' })

test('linkKind: a trace, a line inside a diagram, a line a person drew', () => {
  const b = board(dsFrame, smFrame, reader, card, story, note, activity, trace, drawn)
  assert.equal(linkKind(b, trace), 'trace')
  assert.equal(linkKind(b, activity), 'arrow')
  assert.equal(linkKind(b, drawn), 'link')
})

test('linksOf: the work object has the activity in its diagram, the trace across, the drawn link apart — no line twice', () => {
  const b = board(dsFrame, smFrame, reader, card, story, note, activity, trace, drawn)
  const l = linksOf(b, card)
  assert.equal(l.diagram, 'Domain story')
  assert.deepEqual(l.inDiagram.map((r) => [r.dir, r.other?.id, r.label]), [['in', 'ds.actor.reader', '出示']])
  assert.deepEqual(l.across.map((r) => [r.dir, r.other?.id, r.rel, r.otherDiagram]), [['out', 'sm.story.scan', 'derived-from', 'Story map']])
  assert.deepEqual(l.drawn.map((r) => [r.dir, r.other?.id]), [['in', 'note-1']])
  const all = [...l.inDiagram, ...l.across, ...l.drawn].map((r) => r.line.id)
  assert.equal(new Set(all).size, all.length)
})

test('linksOf: a line to itself and lines elsewhere are left out; an item outside any diagram has no diagram name', () => {
  const self = item('loop', { type: 'arrow', from: 'note-1', to: 'note-1' })
  const b = board(dsFrame, smFrame, reader, card, story, note, activity, trace, drawn, self)
  const l = linksOf(b, note)
  assert.equal(l.diagram, undefined)
  assert.deepEqual(l.drawn.map((r) => r.line.id), ['arrow-hand'])
  assert.equal(l.inDiagram.length + l.across.length, 0)
})

test('lineLabel: the label, else the event, else the role as words', () => {
  assert.equal(lineLabel(activity), '出示')
  assert.equal(lineLabel(item('w', { type: 'arrow', role: 'flow', data: { event: { event: 'lead.qualified' } } })), 'lead.qualified')
  assert.equal(lineLabel(item('h', { type: 'arrow', role: 'read-model' })), 'read model')
  assert.equal(lineLabel(item('f', { type: 'arrow', role: 'flow' })), '')
})
