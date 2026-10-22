// Wire labels never cover cards (docs/canvas.md "Wires → Wire labels"): edgeLabel.ts, the snapshot and the layout check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EDGE_LABEL, labelControl, labelHits, labelLines, placeEdgeLabel, type LabelBox } from '../src/edgeLabel.js'
import { defaultFont, measure } from '../src/textMetrics.js'
import { renderSnapshot } from '../src/snapshot.js'
import { checkLayout, layoutLines } from '../src/layoutCheck.js'
import { labelObstacles, planWires } from '../src/wireGeometry.js'
import type { Board, Item } from '../src/model.js'

const NOW = '2026-10-02T00:00:00.000Z'
const card = (x: number, y = 0): LabelBox => ({ x, y, w: 160, h: 110 })
/** a straight forward wire between two cards side by side, `gap` apart */
const between = (gap: number) => {
  const a = card(0)
  const b = card(160 + gap)
  return { boxes: [a, b], path: [{ x: 160, y: 55 }, { x: 160 + gap, y: 55 }] }
}

test('a wire label is set smaller than the text on cards', () => {
  assert.ok(EDGE_LABEL.font < defaultFont({ type: 'sticky' }))
  assert.ok(EDGE_LABEL.dsFont < 12.5, 'a domain-story verb is under the pictogram names')
})

test('a label that fits goes whole on the wire, between the cards', () => {
  const { boxes, path } = between(200)
  const l = placeEdgeLabel('updates · 更新視圖', path, boxes)!
  assert.equal(l.mode, 'full')
  assert.deepEqual(l.lines, ['updates · 更新視圖'])
  assert.equal(labelHits(l.x, l.y, l.w, l.h, boxes).length, 0)
  assert.equal(l.y, 55, 'on the line')
})

test('the Contact Loop case: two cards 40 px apart — no text on the cards, only a dot that keeps the full text', () => {
  const { boxes, path } = between(40)
  const l = placeEdgeLabel('updates · 更新視圖', path, boxes)!
  assert.equal(l.mode, 'dot')
  assert.equal(l.text, 'updates · 更新視圖')
  assert.ok(l.x > 160 && l.x < 200, 'the dot sits on the wire, in the gap')
})

test('a long label is wrapped to two lines, then cut with … — never wider than the free stretch', () => {
  const long = 'updates the cadence library view so the coach sees it · 更新節奏庫視圖'
  const two = labelLines(long, EDGE_LABEL.maxW)
  assert.equal(two.lines.length, 2)
  assert.ok(two.cut && two.lines[1].endsWith('…'))
  for (const line of two.lines) assert.ok(measure(line, EDGE_LABEL.font) <= EDGE_LABEL.maxW + 0.5)
  const { boxes, path } = between(120)
  const l = placeEdgeLabel(long, path, boxes)!
  assert.equal(l.mode, 'cut')
  assert.equal(l.text, long, 'the whole text stays for the tooltip')
  assert.equal(labelHits(l.x, l.y, l.w, l.h, boxes).length, 0)
})

test('data.label.short is shown when the whole label does not fit; data.label.at is tried first', () => {
  const { boxes, path } = between(90)
  const l = placeEdgeLabel('informs the coordinator · 提供資訊給協調者', path, boxes, { short: 'informs' })!
  assert.equal(l.mode, 'short')
  assert.deepEqual(l.lines, ['informs'])
  const wide = between(400)
  const early = placeEdgeLabel('then', wide.path, wide.boxes, { at: 0.2 })!
  assert.ok(Math.abs(early.x - (160 + 80)) < 1, `at 0.2 of the way: ${early.x}`)
  assert.deepEqual(labelControl({ label: { at: 3, short: '  ok ', other: 1 } }), { at: 1, short: 'ok' })
  assert.deepEqual(labelControl({ label: 'nope' }), {})
})

test('beside the line when the line itself runs past a card', () => {
  // a long horizontal run with a card sitting just under its middle: the label moves along or off the line
  const boxes = [card(0), card(600), { x: 250, y: 60, w: 160, h: 110 }]
  const l = placeEdgeLabel('whenever · 每當', [{ x: 160, y: 55 }, { x: 600, y: 55 }], boxes)!
  assert.notEqual(l.mode, 'dot')
  assert.equal(labelHits(l.x, l.y, l.w, l.h, boxes).length, 0)
})

test('whatever the gap, a placed label never covers a card', () => {
  for (let gap = 10; gap <= 400; gap += 15)
    for (const text of ['then', 'updates · 更新視圖', 'a much longer label that has to be wrapped or cut somewhere · 很長的標籤']) {
      const { boxes, path } = between(gap)
      const l = placeEdgeLabel(text, path, boxes)!
      if (l.mode === 'dot') continue
      assert.equal(labelHits(l.x, l.y, l.w, l.h, boxes, 0).length, 0, `gap ${gap}: "${text}" covers a card`)
    }
})

// ── the server snapshot and the layout check use the same rule ─────────────

const base = { createdBy: 'agent', updatedBy: 'agent', updatedAt: NOW } as const
const sticky = (id: string, x: number, text: string): Item => ({ ...base, id, type: 'sticky', x, y: 0, w: 160, h: 110, text, color: 'orange', role: 'event' })
const wire = (id: string, from: string, to: string, label: string, data?: Record<string, unknown>): Item => ({ ...base, id, type: 'arrow', x: 0, y: 0, w: 0, h: 0, from, to, label, role: 'updates', ...(data ? { data } : {}) })
const board = (items: Item[]): Board => ({ id: 'b', title: 'Contact Loop', kind: 'freeform', seq: 1, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(items.map((i) => [i.id, i])) })
const contactLoop = board([
  sticky('conflict-found', 0, 'Conflict found · 發現衝突'),
  sticky('configuration-conflicts', 200, 'Configuration conflicts · 設定衝突'),
  sticky('far', 600, 'Cadence library · 節奏庫'),
  wire('w-tight', 'conflict-found', 'configuration-conflicts', 'updates · 更新視圖'),
  wire('w-roomy', 'configuration-conflicts', 'far', 'informs · 提供資訊給'),
])

test('snapshot: labels at the label size, off the cards; a tight one is a dot with the full text as its title', () => {
  const { svg } = renderSnapshot(contactLoop)
  assert.match(svg, /<circle [^>]*><title>updates · 更新視圖<\/title><\/circle>/)
  assert.match(svg, new RegExp(`<text font-size="${EDGE_LABEL.font}"[^>]*text-anchor="middle"[^>]*><tspan[^>]*>informs · 提供資訊給</tspan>`))
  assert.doesNotMatch(svg, />updates · 更新視圖<\/tspan>/, 'the tight label is not drawn over the cards')
})

test('layout check: a label with no room says how far to move a card or what short form to give', () => {
  const r = checkLayout(contactLoop)
  const f = r.findings.filter((x) => x.kind === 'label')
  assert.equal(f.length, 1)
  assert.equal(f[0].id, 'w-tight')
  assert.match(f[0].message, /no free spot beside the wire \(the gap is 40 px/)
  assert.match(f[0].suggestion, /move read-model|move event|move sticky/)
  assert.match(f[0].suggestion, /data\.label\.short/)
  assert.match(layoutLines(r, contactLoop).join('\n'), /\[label\]/)
  // giving it room (or a short form that fits) clears it
  const roomy = board([...Object.values(contactLoop.items).filter((i) => i.id !== 'configuration-conflicts'), { ...contactLoop.items['configuration-conflicts'], x: 320 }])
  assert.equal(checkLayout(roomy).findings.filter((x) => x.kind === 'label').length, 0)
})

test('a folded wire\'s label is placed along its runs, never on a card nor pinned to the fold (data.bend)', () => {
  // the fold (an older board's single data.bend point) sits on a card: the wire turns there, its label does not
  const b = board([...Object.values(contactLoop.items).filter((i) => i.id !== 'w-roomy'), wire('w-roomy', 'configuration-conflicts', 'far', 'informs', { bend: { x: 680, y: 50 } })])
  const plan = planWires(b).get('w-roomy')!
  assert.deepEqual(plan.shape.via, [{ x: 680, y: 50 }])
  const l = plan.label!
  assert.ok(l && l.mode !== 'dot')
  assert.notDeepEqual({ x: l.x, y: l.y }, { x: 680, y: 50 })
  assert.deepEqual(labelHits(l.x, l.y, l.w, l.h, labelObstacles(b), 0), [], 'the label covers no card')
  const f = checkLayout(b).findings.filter((x) => x.id === 'w-roomy' && x.kind === 'label')
  assert.equal(f.length, 0)
})
