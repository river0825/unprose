// esTimeline.placeFlow: time only runs forward (docs/diagrams.md §3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeFlow } from '../src/templates/esTimeline.js'

const band = 'timeline'
const nodes = (...ids: string[]) => ids.map((id) => ({ id, band }))
const never = () => false

test('a wire back in time becomes a later occurrence right after its source, on its row', () => {
  // configure → configured → check → conflict → retry policy → (configure again)
  const time = new Map([['configure', -0.5], ['configured', 0], ['check', 0.5], ['conflict', 1], ['retry', 1.25]])
  const p = placeFlow(nodes('configure', 'configured', 'check', 'conflict', 'retry'), [['configure', 'configured'], ['configured', 'check'], ['check', 'conflict'], ['conflict', 'retry'], ['retry', 'configure']], ['configured', 'conflict'], never, { time })
  assert.deepEqual(p.again, [{ id: 'configure.again', of: 'configure', after: 'retry', band }])
  assert.equal(p.retarget.get('retry>configure'), 'configure.again')
  assert.equal(p.rank.get('configure'), 0, 'the first occurrence keeps its place')
  assert.equal(p.rank.get('configure.again'), p.rank.get('retry')! + 1)
  assert.equal(p.row.get('configure.again'), p.row.get('retry'))
})

test('the path that goes on keeps the row; a dead-end retry drops below it', () => {
  const time = new Map([['a', 0], ['retry', 0.25], ['b', 1], ['c', 2], ['d', 3], ['start', -0.5]])
  // a → b → c → d on the timeline; a → retry → start again (a dead end)
  const p = placeFlow(nodes('start', 'a', 'retry', 'b', 'c', 'd'), [['start', 'a'], ['a', 'retry'], ['retry', 'start']], ['a', 'b', 'c', 'd'], never, { time })
  assert.equal(p.row.get('b'), 0, 'the timeline goes on on row 0')
  assert.equal(p.row.get('retry'), 1)
  assert.equal(p.row.get('start.again'), 1)
})

test('several wires back into one node: one occurrence each, numbered', () => {
  const time = new Map([['k', -0.5], ['e', 0], ['p1', 0.25], ['f', 1], ['p2', 1.25]])
  const p = placeFlow(nodes('k', 'e', 'p1', 'f', 'p2'), [['k', 'e'], ['e', 'p1'], ['p1', 'k'], ['f', 'p2'], ['p2', 'k']], ['e', 'f'], never, { time })
  assert.deepEqual(p.again.map((a) => a.id), ['k.again', 'k.again-2'])
  for (const a of p.again) assert.ok(p.rank.get(a.id)! > p.rank.get(a.after)!)
})

test('without times, a loop is still cut where it closes (older callers)', () => {
  const p = placeFlow(nodes('a', 'b'), [['a', 'b'], ['b', 'a']], [], never)
  assert.deepEqual(p.again.map((a) => [a.of, a.after]), [['a', 'b']])
  assert.ok(p.rank.get('a.again')! > p.rank.get('b')!)
})
