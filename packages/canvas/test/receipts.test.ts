import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBookkeeping, type Change, type Item } from '../src/model.js'

const comment: Item = { id: 'c1', type: 'comment', x: 0, y: 0, w: 10, h: 10, text: 'why?', target: 'n1', createdBy: 'user', updatedBy: 'user', updatedAt: 't' }
const change = (data: Record<string, unknown>): Change =>
  ({ seq: 2, ts: 't', author: 'agent', ops: [{ kind: 'update', id: 'c1', patch: { data } }], before: { c1: comment } }) as Change

test('seenBy and agentState updates are bookkeeping; waits and diffs ignore them', () => {
  assert.equal(isBookkeeping(change({ seenBy: ['agent'] })), true)
  assert.equal(isBookkeeping(change({ seenBy: ['agent'], agentState: { state: 'working', session: 'awd-studio-plan', at: 't' } })), true)
})

test('any other data change is an edit', () => {
  assert.equal(isBookkeeping(change({ agentState: { state: 'idle', at: 't' }, anchor: { line: 3, quote: 'x' } })), false)
})
