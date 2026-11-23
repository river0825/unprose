// Feedback from drawing a real pair of domain stories (a hub story: 12 sentences, 9 of them through one actor):
// group outlines that overlap although the groups share no member, `layout.actors: repeat` that draws nothing again,
// a note's dashed line through a pictogram, and notes with a kind (pain / assumption / decision) in their own colour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDomainStory, DS_NOTE_COLORS, DS_NOTE_KINDS, type DomainStoryContent } from '../src/diagrams/domainStory.js'
import { domainStoryLayoutFindings } from '../src/diagrams/domainStoryLayout.js'
import { designFromObject, lintDesignContent } from '../src/diagrams/designFile.js'
import { renderDomainStory } from '../src/templates/domain-story.js'
import { checkLayout } from '../src/layoutCheck.js'
import { renderSnapshot } from '../src/snapshot.js'
import type { Board, Item } from '../src/model.js'

const NOW = '2026-11-17T00:00:00.000Z'
const toBoard = (items: Item[]): Board => ({ id: 'b', title: 't', kind: 'freeform', seq: 0, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(items.map((i) => [i.id, i])) })

/** The hub story: everything goes through `ai`. */
const hub = (extra: Partial<DomainStoryContent> = {}): DomainStoryContent => ({
  scope: { granularity: 'coarse-grained', time: 'to-be', purity: 'digitalized' },
  actors: [
    { id: 'requester', text: 'Requester', kind: 'person' },
    { id: 'ai', text: 'Assistant', kind: 'system' },
    { id: 'store', text: 'Store', kind: 'system' },
    { id: 'po', text: 'Product Owner', kind: 'person' },
    { id: 'board', text: 'Task board', kind: 'system' },
    { id: 'newcomer', text: 'Newcomer', kind: 'person' },
  ],
  workObjects: [],
  sentences: [
    { id: 'tell', actor: 'requester', verb: 'explains', object: 'need', to: 'ai' },
    { id: 'search', actor: 'ai', verb: 'searches', object: 'source message' },
    { id: 'probe', actor: 'ai', verb: 'asks', object: 'four questions', to: 'requester' },
    { id: 'draft', actor: 'ai', verb: 'hands over', object: 'spec draft', to: 'requester' },
    { id: 'confirm', actor: 'requester', verb: 'confirms', object: 'spec draft', to: 'ai' },
    { id: 'save-spec', actor: 'ai', verb: 'saves', object: 'spec', to: 'store' },
    { id: 'read-spec', actor: 'po', verb: 'reads', object: 'spec', to: 'ai' },
    { id: 'decide', actor: 'po', verb: 'records', object: 'decision', to: 'store' },
    { id: 'open-card', actor: 'po', verb: 'opens', object: 'card', to: 'board' },
    { id: 'ask', actor: 'newcomer', verb: 'asks', object: 'question', to: 'ai' },
    { id: 'reply', actor: 'ai', verb: 'answers', object: 'answer with sources', to: 'newcomer' },
    { id: 'correct', actor: 'newcomer', verb: 'appends', object: 'correction', to: 'store' },
  ],
  layout: { spacing: 'roomy' },
  ...extra,
})
const bySentence = [
  { id: 'g-spec', text: 'Need becomes spec', members: ['tell', 'search', 'probe', 'draft', 'confirm', 'save-spec'] },
  { id: 'g-decide', text: 'PO decides', members: ['read-spec', 'decide', 'open-card'] },
  { id: 'g-ask', text: 'Newcomer asks', members: ['ask', 'reply', 'correct'] },
]

test('groups of sentences around one hub actor: the outlines overlap and the lint says so, although no member is shared', () => {
  const story = hub({ groups: bySentence })
  // the grammar alone is silent: no member is in two groups
  assert.equal(checkDomainStory(story).filter((f) => f.rule === 'groups-overlap').length, 0)
  // the drawing does overlap (the board's own layout check)
  const drawn = checkLayout(toBoard(renderDomainStory(story, { now: NOW }))).findings.filter((f) => f.kind === 'group')
  assert.ok(drawn.length >= 1, 'the outlines overlap on the board')
  const found = domainStoryLayoutFindings(story).filter((f) => f.rule === 'group-outlines-overlap')
  assert.equal(found.length, drawn.length, 'one lint warning per overlapping pair')
  assert.equal(found[0].severity, 'warning')
  assert.match(found[0].message, /share no member/)
  assert.ok(bySentence.some((g) => g.id === found[0].element), 'the finding names a group of the file')
  // `awd design lint` and the draw (CLI and MCP) read it through lintDesignContent
  const lint = lintDesignContent(designFromObject('hub.domain-story.yaml', story))
  assert.ok(lint.some((f) => f.severity === 'warning' && /overlaps the outline/.test(f.message)))
})

test('groups that do not overlap, and groups sharing members, get no group-outlines-overlap warning', () => {
  const apart = hub({ groups: [{ id: 'g1', text: 'Requester side', members: ['requester'] }, { id: 'g2', text: 'Board side', members: ['board'] }] })
  assert.equal(domainStoryLayoutFindings(apart).filter((f) => f.rule === 'group-outlines-overlap').length, 0)
  const sharing = hub({ groups: [{ id: 'g1', text: 'A', members: ['requester', 'ai'] }, { id: 'g2', text: 'B', members: ['ai', 'store'] }] })
  assert.equal(domainStoryLayoutFindings(sharing).filter((f) => f.rule === 'group-outlines-overlap').length, 0, 'groups-overlap already says it')
  assert.equal(checkDomainStory(sharing).filter((f) => f.rule === 'groups-overlap').length, 1)
})

test('layout.actors: repeat that draws no actor again is said, with the way to force one', () => {
  const once = renderDomainStory(hub(), { now: NOW })
  const repeat = renderDomainStory(hub({ layout: { spacing: 'roomy', actors: 'repeat' } }), { now: NOW })
  // the observed behaviour: the same drawing (every sentence sits within two cells of the hub)
  assert.equal(repeat.length, once.length)
  assert.equal(repeat.filter((i) => i.data?.occurrence).length, 0)
  const said = domainStoryLayoutFindings(hub({ layout: { spacing: 'roomy', actors: 'repeat' } })).filter((f) => f.rule === 'repeat-no-effect')
  assert.equal(said.length, 1)
  assert.equal(said[0].severity, 'info')
  assert.match(said[0].message, /drawAgain/)
  // not said without `repeat`, nor when an actor is in fact drawn again
  assert.equal(domainStoryLayoutFindings(hub()).filter((f) => f.rule === 'repeat-no-effect').length, 0)
  const forced = hub({ layout: { spacing: 'roomy', actors: 'repeat' } })
  forced.sentences[9] = { ...forced.sentences[9], drawAgain: 'ai' }
  assert.ok(renderDomainStory(forced, { now: NOW }).some((i) => i.data?.occurrence), 'drawAgain draws the hub again')
  assert.equal(domainStoryLayoutFindings(forced).filter((f) => f.rule === 'repeat-no-effect').length, 0)
})

test("a note's dashed line does not run through another pictogram", () => {
  // the note on sentence 6 (save-spec) used to be placed above "source message", its line running through it
  const story = hub({ annotations: [{ id: 'd-write', on: 'save-spec', text: 'Decision B | who writes: the requester’s assistant directly, or the PO’s assistant' }] })
  const items = renderDomainStory(story, { now: NOW })
  const through = checkLayout(toBoard(items)).findings.filter((f) => f.kind === 'wire-through')
  assert.deepEqual(through.map((f) => f.message), [])
  assert.equal(domainStoryLayoutFindings(story).filter((f) => f.rule === 'line-through').length, 0)
  // every note of every sentence, one at a time: no line through a pictogram, no note on a pictogram
  for (const s of story.sentences) {
    const one = hub({ annotations: [{ on: s.id!, text: 'A note long enough to wrap onto a second line of the note box' }] })
    const f = checkLayout(toBoard(renderDomainStory(one, { now: NOW }))).findings.filter((x) => x.kind === 'wire-through' || x.kind === 'overlap')
    assert.deepEqual(f.map((x) => x.message), [], `note on ${s.id}`)
  }
})

test('a note has a kind: pain, assumption and decision are drawn in their own colour, with a legend', () => {
  const story = hub({
    annotations: [
      { id: 'n-plain', on: 'tell', text: 'A plain note' },
      { id: 'n-note', on: 'search', text: 'Said to be a note', kind: 'note' },
      { id: 'n-pain', on: 'probe', text: 'Back and forth several times', kind: 'pain' },
      { id: 'n-assumed', on: 'draft', text: 'Not yet confirmed by ops', kind: 'assumption' },
      { id: 'n-decide', on: 'save-spec', text: 'Who writes?', kind: 'decision' },
    ],
  })
  const items = renderDomainStory(story, { now: NOW })
  const note = (id: string) => items.find((i) => i.id === `ds.note.${id}`)!
  assert.equal(note('n-plain').color, undefined)
  assert.equal(note('n-note').color, undefined, 'kind: note is the plain note')
  assert.equal(note('n-pain').color, DS_NOTE_COLORS.pain)
  assert.equal(note('n-pain').data?.noteKind, 'pain')
  assert.equal(note('n-assumed').color, DS_NOTE_COLORS.assumption)
  assert.equal(note('n-decide').color, DS_NOTE_COLORS.decision)
  assert.equal(new Set(Object.values(DS_NOTE_COLORS)).size, 3, 'three different colours')
  // the legend names the kinds this story uses, in their colours
  const legend = items.filter((i) => i.data?.legend && i.data?.ds === 'annotation')
  assert.deepEqual(legend.map((i) => i.data?.noteKind).sort(), ['assumption', 'decision', 'pain'])
  assert.equal(renderDomainStory(hub({ annotations: [{ on: 'tell', text: 'plain' }] }), { now: NOW }).filter((i) => i.data?.legend).length, 0, 'no kinds, no legend entries')
  // the snapshot draws the colour
  const svg = renderSnapshot(toBoard(items), {}).svg
  for (const hex of ['#ff7a7a', '#ffe14a', '#7dbdff']) assert.ok(svg.includes(`fill="${hex}" fill-opacity="0.3"`), `wash ${hex}`)
  // the layout check has nothing to say about the coloured notes or the legend
  assert.deepEqual(checkLayout(toBoard(items)).findings.filter((f) => /note|legend/.test(f.id)).map((f) => f.message), [])
})

test('the lint knows `kind` on a note: no unknown field, a wrong kind is an error, a kind written in words is hinted', () => {
  const ok = designFromObject('hub.domain-story.yaml', hub({ annotations: [{ on: 'tell', text: 'Back and forth', kind: 'pain' }] }))
  assert.deepEqual(lintDesignContent(ok).filter((f) => /unknown field|note-kind|names its kind/.test(f.message)), [])
  const bad = designFromObject('hub.domain-story.yaml', { ...hub(), annotations: [{ on: 'tell', text: 'x', kind: 'risk' }] })
  const errors = lintDesignContent(bad).filter((f) => f.severity === 'error')
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /annotations\[0\]\.kind/)
  for (const k of DS_NOTE_KINDS) assert.match(errors[0].message, new RegExp(k))
  const words = hub({
    annotations: [
      { id: 'a', on: 'tell', text: '痛點：來回好幾次' },
      { id: 'b', on: 'search', text: '假設：還沒請 ops 親口說過' },
      { id: 'c', on: 'probe', text: '決定 B｜誰寫入' },
      { id: 'd', on: 'draft', text: 'Pain point: nobody knows' },
      { id: 'e', on: 'confirm', text: 'The decision was made last year' },
      { id: 'f', on: 'save-spec', text: '痛點：已有 kind', kind: 'pain' },
    ],
  })
  const hints = checkDomainStory(words).filter((f) => f.rule === 'note-kind-in-text')
  assert.deepEqual(hints.map((f) => [f.element, /kind: (\w+)/.exec(f.message)![1]]), [['a', 'pain'], ['b', 'assumption'], ['c', 'decision'], ['d', 'pain']])
  assert.ok(hints.every((f) => f.severity === 'info'))
})
