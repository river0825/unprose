import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Item } from '../src/model.js'
import { bandSelection, fullyInside, rectBetween, type BandNode } from '../web/src/flow/bandSelect.js'
import { passThrough } from '../web/src/flow/boardToFlow.js'

const nodes = new Map<string, BandNode>([
  ['frame', { id: 'frame', container: true, rect: { x: 0, y: 0, w: 1000, h: 600 } }],
  ['a', { id: 'a', container: false, rect: { x: 100, y: 100, w: 100, h: 100 } }],
  ['b', { id: 'b', container: false, rect: { x: 300, y: 100, w: 100, h: 100 } }],
  ['col', { id: 'col', container: true, rect: { x: 500, y: 50, w: 200, h: 400 } }],
])

test('rectBetween takes corners in any order', () => {
  assert.deepEqual(rectBetween({ x: 10, y: 50 }, { x: 0, y: 20 }), { x: 0, y: 20, w: 10, h: 30 })
})

test('fullyInside', () => {
  assert.equal(fullyInside({ x: 1, y: 1, w: 2, h: 2 }, { x: 0, y: 0, w: 3, h: 3 }), true)
  assert.equal(fullyInside({ x: 1, y: 1, w: 3, h: 2 }, { x: 0, y: 0, w: 3, h: 3 }), false)
})

test('a band drawn inside a frame selects the items it touches, not the frame', () => {
  const band = rectBetween({ x: 50, y: 50 }, { x: 350, y: 250 })
  assert.deepEqual([...bandSelection(['frame', 'a', 'b'], nodes, band)].sort(), ['a', 'b'])
})

test('a band that encloses a container whole selects it', () => {
  const band = rectBetween({ x: 450, y: 0 }, { x: 750, y: 500 })
  assert.deepEqual([...bandSelection(['frame', 'col'], nodes, band)], ['col'])
  const all = rectBetween({ x: -10, y: -10 }, { x: 1100, y: 700 })
  assert.deepEqual([...bandSelection(['frame', 'a', 'b', 'col'], nodes, all)].sort(), ['a', 'b', 'col', 'frame'])
})

test('Shift-drag adds to the selection that was there', () => {
  const band = rectBetween({ x: 250, y: 50 }, { x: 450, y: 250 })
  assert.deepEqual([...bandSelection(['frame', 'b'], nodes, band, ['a'], true)].sort(), ['a', 'b'])
  assert.deepEqual([...bandSelection(['frame', 'b'], nodes, band, ['a'], false)], ['b'])
})

const now = '2026-10-02T00:00:00.000Z'
const item = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 100, h: 100, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...p }) as Item

test('frames, lanes, columns and screens let a drag on their body reach the canvas; items do not', () => {
  assert.equal(passThrough(item({ id: 'f', type: 'frame' })), true)
  assert.equal(passThrough(item({ id: 'l', type: 'lane' })), true)
  assert.equal(passThrough(item({ id: 'c', type: 'lane', role: 'column' })), true)
  assert.equal(passThrough(item({ id: 'w', type: 'wireframe', role: 'screen' })), true)
  assert.equal(passThrough(item({ id: 'u', type: 'ui', data: { ui: { type: 'screen', container: true } } })), true)
  assert.equal(passThrough(item({ id: 'us', type: 'ui', data: { ui: { type: 'section', container: true } } })), true)
  assert.equal(passThrough(item({ id: 'uc', type: 'ui', data: { ui: { type: 'card', container: true } } })), false)
  assert.equal(passThrough(item({ id: 'wb', type: 'wireframe', role: 'box' })), false)
  assert.equal(passThrough(item({ id: 's', type: 'sticky' })), false)
  assert.equal(passThrough(item({ id: 'k', type: 'card', role: 'card' })), false)
})

