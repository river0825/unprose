// A domain-story group's colour (docs/diagrams.md §6b): `color:` in the file, or Change colour on the board — a pale
// wash behind the members on the page and in the snapshot, the group's outline colour in Egon.io; a redraw keeps the
// person's colour unless the file gives one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDomainStory, normalizeDomainStory, type DomainStoryContent } from '../src/diagrams/domainStory.js'
import { renderDomainStory } from '../src/templates/domain-story.js'
import { renderSnapshot } from '../src/snapshot.js'
import { toEgon } from '../src/diagrams/egon.js'
import { explainRedraw, type BoardItem } from '../src/diagrams/redraw.js'
import type { Item } from '../src/model.js'

const now = '2026-10-22T00:00:00.000Z'
const story = (color?: string): DomainStoryContent => ({
  scope: { granularity: 'coarse-grained', time: 'to-be', purity: 'digitalized' },
  actors: ['CL1', 'Lead', { text: 'CRM', kind: 'system' }],
  workObjects: [{ text: 'call', kind: 'call' }, { text: 'note', kind: 'document' }],
  sentences: [
    { id: 'dial', actor: 'CL1', verb: 'dials', object: 'call', to: 'Lead' },
    { id: 'log', actor: 'CL1', verb: 'logs', object: 'note', to: 'CRM' },
  ],
  groups: [{ text: 'CL1 撥號 calling', members: ['dial'], ...(color ? { color } : {}) } as DomainStoryContent['groups'][number]],
})
const groupOf = (items: Item[]) => items.find((i) => i.data?.ds === 'group')!

test('a colour in the file goes on the group; without one the group carries none (the board keeps its own)', () => {
  assert.equal(groupOf(renderDomainStory(story('blue'), { scope: 'k', now })).color, 'blue')
  const plain = groupOf(renderDomainStory(story(), { scope: 'k', now }))
  assert.equal('color' in plain, false)
  assert.equal(normalizeDomainStory(story('green')).groups[0].color, 'green')
  assert.throws(() => normalizeDomainStory(story('teal')), /color/)
  assert.deepEqual(checkDomainStory(story('pink')).filter((f) => f.severity === 'warning'), [])
})

test('the snapshot washes a coloured group and leaves grey and uncoloured ones as outlines', () => {
  const svgOf = (color?: string) => {
    const items = renderDomainStory(story(), { scope: 'k', now }).map((i) => (i.data?.ds === 'group' && color ? { ...i, color: color as Item['color'] } : i))
    return renderSnapshot({ id: 'b', title: 't', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) }).svg
  }
  assert.match(svgOf('blue'), /fill="#7dbdff" fill-opacity="0\.16" stroke="#7dbdff" stroke-width="1\.6" stroke-dasharray="6 5"/)
  assert.doesNotMatch(svgOf('grey'), /fill-opacity="0\.16"/)
  assert.doesNotMatch(svgOf(), /fill-opacity="0\.16"/)
})

test('Egon.io gets the colour as the group outline; an uncoloured group stays black', () => {
  const groupIn = (c?: string) => (toEgon(story(c)) as { domainStory: { businessObjects: Array<{ type: string; pickedColor?: string }> } }).domainStory.businessObjects.find((o) => o.type === 'domainStory:group')!
  assert.equal(groupIn('blue').pickedColor, '#4f8fd8')
  assert.equal(groupIn().pickedColor, 'black')
})

test('a redraw keeps the colour the person gave a group, unless the file gives one', () => {
  const drawn = (color?: string) => renderDomainStory(story(color), { scope: 'k', now }) as unknown as BoardItem[]
  const board = Object.fromEntries(drawn().map((i) => [i.id, i.data?.ds === 'group' ? { ...i, color: 'green' } : i]))
  const kept = explainRedraw(board, drawn(), { placed: new Set() }, { prefix: 'k.' })
  assert.equal(kept.ops.some((op) => op.kind === 'update' && op.patch && 'color' in op.patch), false)
  const fromFile = explainRedraw(board, drawn('blue'), { placed: new Set() }, { prefix: 'k.' })
  assert.deepEqual(fromFile.ops.filter((op) => op.kind === 'update' && op.patch && 'color' in op.patch).map((op) => op.patch!.color), ['blue'])
})
