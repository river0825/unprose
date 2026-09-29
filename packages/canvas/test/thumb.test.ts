import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderThumb } from '../src/thumb.js'
import { render } from '../src/templates/index.js'
import { demoBoards } from '../src/demo.js'
import type { Board } from '../src/model.js'

function boardFromDemo(i: number): Board {
  const d = demoBoards[i]
  const items = render(d.kind, d.content as never)
  return {
    id: 'b_test', title: d.title, kind: d.kind, seq: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    items: Object.fromEntries(items.map((it) => [it.id, it])),
  }
}

test('thumbnail of the demo event-storming board', () => {
  const board = boardFromDemo(0)
  const svg = renderThumb(board)
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 280 160"/)
  const rects = (svg.match(/<rect /g) ?? []).length
  const boxed = Object.values(board.items).filter((i) => i.type !== 'arrow').length
  // background + one rect per non-arrow item
  assert.equal(rects, boxed + 1)
  assert.ok(svg.includes('prefers-color-scheme:dark'))
  assert.ok(svg.includes('fill="var(--orange)"'), 'events are orange')
  // deterministic
  assert.equal(svg, renderThumb(board))
  // everything fits inside the viewBox
  for (const m of svg.matchAll(/x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    const [x, y, w, h] = m.slice(1).map(Number)
    assert.ok(x >= 0 && y >= 0 && x + w <= 280.01 && y + h <= 160.01, `out of bounds: ${m[0]}`)
  }
})

test('thumbnail of an empty board is just paper', () => {
  const svg = renderThumb({ id: 'e', title: 'Empty', kind: 'freeform', seq: 0, createdAt: '', updatedAt: '', items: {} })
  assert.equal((svg.match(/<rect /g) ?? []).length, 1)
})
