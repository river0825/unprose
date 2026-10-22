import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldsKey, nearestRun, removeFold, roundFolds, runMiddles, snapFold, toSegment, withFold } from '../web/src/flow/folds.js'

const S = { x: 0, y: 0 }
const T = { x: 400, y: 0 }

test('the run nearest a point: a fold put into run i goes in at index i', () => {
  const folds = [{ x: 100, y: 100 }, { x: 300, y: 100 }]
  const runs = [S, ...folds, T]
  assert.equal(nearestRun(runs, { x: 20, y: 40 }), 0)
  assert.equal(nearestRun(runs, { x: 200, y: 120 }), 1)
  assert.equal(nearestRun(runs, { x: 380, y: 30 }), 2)
  assert.equal(nearestRun([S, T], { x: 200, y: 50 }), 0)
  assert.equal(toSegment({ x: 200, y: 50 }, S, T), 50)
  assert.equal(toSegment({ x: -30, y: 40 }, S, T), 50)
})

test('a fold goes in, moves, comes out', () => {
  const a = { x: 100, y: 100 }
  const b = { x: 300, y: 100 }
  const p = { x: 200, y: 160 }
  assert.deepEqual(withFold([], 0, p, true), [p])
  assert.deepEqual(withFold([a, b], 1, p, true), [a, p, b])
  assert.deepEqual(withFold([a, b], 2, p, true), [a, b, p])
  assert.deepEqual(withFold([a, b], 1, p, false), [a, p])
  assert.deepEqual(removeFold([a, p, b], 1), [a, b])
  assert.deepEqual(removeFold([a], 0), [])
})

test('a dragged fold snaps to its neighbours, so a run can be made exactly straight', () => {
  // within 8 px of the end before it in y: the first run comes out horizontal
  assert.deepEqual(snapFold({ x: 150, y: 6 }, S, T, 8), { x: 150, y: 0 })
  // x snaps to the fold after it, y to the end before it
  assert.deepEqual(snapFold({ x: 296, y: -5 }, S, { x: 300, y: 200 }, 8), { x: 300, y: 0 })
  // the nearer of two candidates
  assert.deepEqual(snapFold({ x: 5, y: 50 }, { x: 0, y: 0 }, { x: 9, y: 400 }, 8), { x: 9, y: 50 })
  // too far: left where it is
  assert.deepEqual(snapFold({ x: 150, y: 30 }, S, T, 8), { x: 150, y: 30 })
  assert.deepEqual(snapFold({ x: 150, y: 3 }, undefined, undefined, 8), { x: 150, y: 3 })
})

test('stored folds are whole pixels, and a fold on top of the one before it is dropped', () => {
  assert.deepEqual(roundFolds([{ x: 10.4, y: 20.6 }, { x: 10.2, y: 21.1 }, { x: 50, y: 20 }]), [{ x: 10, y: 21 }, { x: 50, y: 20 }])
  assert.deepEqual(roundFolds([]), [])
})

test('a "fold here" handle in the middle of each run that is long enough', () => {
  const runs = [S, { x: 30, y: 0 }, { x: 30, y: 200 }, T]
  assert.deepEqual(runMiddles(runs), [
    { i: 1, x: 30, y: 100 },
    { i: 2, x: 215, y: 100 },
  ])
  assert.deepEqual(runMiddles([S, T], 40), [{ i: 0, x: 200, y: 0 }])
})

test('a plan is for the folds it was made for', () => {
  assert.equal(foldsKey([]), '')
  assert.equal(foldsKey([{ x: 10.2, y: 20 }, { x: 5, y: 5 }]), '10,20;5,5')
  assert.notEqual(foldsKey([{ x: 10, y: 20 }]), foldsKey([{ x: 10, y: 21 }]))
})
