import { test } from 'node:test'
import assert from 'node:assert/strict'
import { READABLE_ZOOM, TELL_ZOOM, centred, fitZoom, inView, keptZoom, stepView, tellingZoom, type Area } from '../web/src/flow/replayCamera.js'

// a laptop screen's canvas, below the replay bar
const area: Area = { left: 24, top: 120, width: 1392, height: 740 }
const sentence = (x: number, y: number, width = 520, height = 240) => ({ x, y, width, height })

test('a story that can be read whole starts whole, at the zoom that fits it (never past 100 %)', () => {
  const story = { x: 0, y: 0, width: 1300, height: 760 }
  const t = tellingZoom(story, area)
  assert.equal(t.whole, true)
  assert.ok(Math.abs(t.zoom - fitZoom(story, area, 24)) < 1e-9)
  assert.ok(t.zoom >= READABLE_ZOOM && t.zoom < TELL_ZOOM)
  assert.deepEqual(tellingZoom({ x: 0, y: 0, width: 300, height: 200 }, area), { zoom: TELL_ZOOM, whole: true })
})

test('a big story is told sentence by sentence at 100 %: whole, its names would be ~5 px', () => {
  const big = { x: 0, y: 0, width: 3200, height: 2200 }
  assert.ok(fitZoom(big, area, 24) * 13 < 6)
  assert.deepEqual(tellingZoom(big, area), { zoom: TELL_ZOOM, whole: false })
  assert.deepEqual(tellingZoom(undefined, area), { zoom: TELL_ZOOM, whole: false })
})

test('a sentence in view and readable: the view stays', () => {
  const s = sentence(100, 100)
  const v = { x: 0, y: 150, zoom: 1 }
  assert.equal(inView(s, v, area), true)
  assert.equal(stepView(s, v, area, 1), null)
  // a little smaller than the telling zoom but readable (after a long sentence): still stays, no pumping
  assert.equal(stepView(s, { x: 0, y: 150, zoom: 0.85 }, area, 1), null)
})

test('a sentence out of view: centred at the telling zoom', () => {
  const s = sentence(2600, 1900)
  const to = stepView(s, { x: 0, y: 150, zoom: 1 }, area, 1)
  assert.ok(to)
  assert.equal(to.zoom, 1)
  assert.equal(inView(s, to, area), true)
  assert.ok(Math.abs(s.x + s.width / 2 + to.x - (area.left + area.width / 2)) < 1e-9)
  assert.ok(Math.abs(s.y + s.height / 2 + to.y - (area.top + area.height / 2)) < 1e-9)
})

test('in view but too small to read (the whole big frame fitted): zoomed in to it', () => {
  const s = sentence(100, 100)
  const v = { x: 30, y: 130, zoom: 0.35 }
  assert.equal(inView(s, v, area), true)
  assert.equal(stepView(s, v, area, 1)?.zoom, 1)
})

test('a sentence too long for 100 % is shown whole, smaller; the next one comes back to 100 %', () => {
  const long = sentence(0, 0, 2400, 300)
  const to = stepView(long, { x: 0, y: 0, zoom: 1 }, area, 1)
  assert.ok(to)
  assert.ok(to.zoom < READABLE_ZOOM)
  assert.ok(Math.abs(to.zoom - fitZoom(long, area, 48)) < 1e-9)
  assert.equal(inView(long, to, area), true)
  const next = sentence(200, 0)
  assert.equal(inView(next, to, area), true)
  assert.equal(stepView(next, to, area, 1)?.zoom, 1)
})

test('the zoom the person chose is kept: smaller stays small, larger stays large', () => {
  assert.equal(keptZoom(1, 1, 1), 1)
  assert.equal(keptZoom(1, undefined, 0.4), 1)
  const tell = keptZoom(1, 1, 0.4)
  assert.equal(tell, 0.4)
  const v = { x: 0, y: 150, zoom: 0.4 }
  assert.equal(stepView(sentence(100, 100), v, area, tell), null)
  assert.equal(stepView(sentence(5000, 100), v, area, tell)?.zoom, 0.4)
  assert.equal(stepView(sentence(5000, 100), { x: 0, y: 0, zoom: 1.6 }, area, keptZoom(1, 1, 1.6))?.zoom, 1.6)
})

test('centred puts the box in the middle', () => {
  const r = { x: 10, y: 20, width: 100, height: 50 }
  const v = centred(r, area, 2)
  assert.equal(r.x * 2 + v.x + (r.width * 2) / 2, area.left + area.width / 2)
  assert.equal(r.y * 2 + v.y + (r.height * 2) / 2, area.top + area.height / 2)
})
