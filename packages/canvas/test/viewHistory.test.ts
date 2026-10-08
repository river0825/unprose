// The view history behind ⌥← / ⌥→ (web/src/flow/viewHistory.ts): a jump remembers where the view was, back
// returns there and keeps the place it left for forward, a new jump forgets the forward places, and the stack
// stays bounded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyHistory, goBack, goForward, pushView, sameView, VIEW_HISTORY_MAX } from '../web/src/flow/viewHistory.js'

const v = (x: number, zoom = 1) => ({ x, y: 0, zoom })

test('a jump remembers where the view was; back returns there; forward returns to where back left', () => {
  let h = pushView(emptyHistory(), v(0))
  const b = goBack(h, v(500))
  assert.ok(b)
  assert.deepEqual(b.to, v(0))
  h = b.next
  assert.equal(goBack(h, v(0)), null)
  const f = goForward(h, v(0))
  assert.ok(f)
  assert.deepEqual(f.to, v(500))
  assert.equal(goForward(f.next, v(500)), null)
})

test('a new jump after going back forgets the forward places', () => {
  let h = pushView(emptyHistory(), v(0))
  h = goBack(h, v(500))!.next
  assert.equal(h.forward.length, 1)
  h = pushView(h, v(0))
  assert.equal(h.forward.length, 0)
  assert.deepEqual(h.back, [v(0)])
})

test('a jump from where the last mark was does not push a duplicate', () => {
  const h = pushView(pushView(emptyHistory(), v(0)), v(0.4))
  assert.equal(h.back.length, 1)
  assert.ok(sameView(v(0), v(0.4)))
  assert.ok(!sameView(v(0), v(0, 1.1)))
})

test('the stack keeps the newest places only', () => {
  let h = emptyHistory()
  for (let i = 0; i < VIEW_HISTORY_MAX + 5; i++) h = pushView(h, v(i * 100))
  assert.equal(h.back.length, VIEW_HISTORY_MAX)
  assert.deepEqual(h.back[0], v(500))
})
