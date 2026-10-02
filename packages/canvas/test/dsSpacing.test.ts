// Domain Storytelling spacing (docs/diagrams.md §6b "Spacing"): roomier by default, measured with the text
// metrics, and a `layout` option in the file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { domainStorySchema, type DomainStoryContent } from '../src/diagrams/domainStory.js'
import { renderDomainStory, arrowRoom, dsGeometry, ICON_W, ICON_H } from '../src/templates/domain-story.js'
import { normalizeDomainStory } from '../src/diagrams/domainStory.js'
import { unknownContentFields } from '../src/diagrams/check.js'
import type { Item } from '../src/model.js'

const NOW = '2026-10-02T00:00:00.000Z'
const story: DomainStoryContent = {
  actors: [{ id: 'river', text: 'River · 業主' }, { id: 'codex', text: 'Codex', kind: 'system' }, { id: 'canvas', text: 'Canvas · 畫布', kind: 'system' }, { id: 'contacts', text: 'Contacts', kind: 'group' }],
  sentences: [
    { actor: 'river', verb: 'composes · 撰寫', object: 'cadence', to: 'codex' },
    { actor: 'codex', verb: 'drafts cadences · 草擬', object: 'cadence library', to: 'canvas' },
    { actor: 'river', verb: 'configures · 設定', object: 'configuration', to: 'canvas' },
    { actor: 'canvas', verb: 'checks conflicts · 檢查衝突', object: 'conflicts', to: 'river' },
    { actor: 'river', verb: 'revises · 修訂', object: 'revised config', to: 'canvas' },
    { actor: 'canvas', verb: 'schedules · 排程', object: 'message', to: 'contacts' },
    { actor: 'contacts', verb: 'replies · 回覆', object: 'reply', to: 'canvas' },
  ],
}
const draw = (layout?: DomainStoryContent['layout']) => renderDomainStory({ ...story, ...(layout ? { layout } : {}) }, { now: NOW })
const pictos = (items: Item[]) => items.filter((i) => i.data?.ds === 'actor' || i.data?.ds === 'object')
const area = (items: Item[]) => {
  const p = pictos(items)
  return (Math.max(...p.map((i) => i.x + i.w)) - Math.min(...p.map((i) => i.x))) * (Math.max(...p.map((i) => i.y + i.h)) - Math.min(...p.map((i) => i.y)))
}
/** Free length of a floating arrow between two pictogram boxes (as ItemEdge cuts it, 6 px off each box). */
function freeLength(a: Item, b: Item): number {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const [dx, dy] = [Math.abs(cb.x - ca.x), Math.abs(cb.y - ca.y)]
  const d = Math.hypot(dx, dy)
  const cut = (o: Item) => Math.min(dx ? (o.w / 2 + 6) / dx : Infinity, dy ? (o.h / 2 + 6) / dy : Infinity) * d
  return d - cut(a) - cut(b)
}

test('the default (normal) is roomier than compact, and roomy roomier than normal', () => {
  const [compact, normal, roomy] = [draw({ spacing: 'compact' }), draw(), draw({ spacing: 'roomy' })]
  assert.ok(area(normal) > area(compact) * 1.2, 'normal is clearly roomier than compact')
  assert.ok(area(roomy) > area(normal), 'roomy is roomier than normal')
  const g = (spacing?: 'compact' | 'normal' | 'roomy') => dsGeometry(normalizeDomainStory({ ...story, ...(spacing ? { layout: { spacing } } : {}) }))
  assert.deepEqual(g('compact'), { cellW: 460, cellH: 330, spread: 150, slot: 250, nudge: 70 }, 'compact keeps the earlier pitches')
  assert.ok(g().cellW > 460 && g().cellH > 330 && g().spread > 150 && g().slot > 250)
  assert.ok(g('roomy').cellW > g().cellW && g('roomy').cellH > g().cellH)
})

test('every activity arrow has room for its number circle and its verb (text metrics)', () => {
  for (const spacing of ['normal', 'roomy'] as const) {
    const items = draw(spacing === 'normal' ? undefined : { spacing })
    const at = new Map(items.map((i) => [i.id, i]))
    for (const w of items.filter((i) => i.type === 'arrow' && i.role === 'activity')) {
      const need = arrowRoom(w.label, 'compact') // circle + verb, no extra air
      const free = freeLength(at.get(w.from!)!, at.get(w.to!)!)
      assert.ok(free >= need, `${spacing}: "${w.label}" has ${Math.round(free)} px, needs ${Math.round(need)}`)
    }
  }
  // a longer verb widens the grid
  const short = dsGeometry(normalizeDomainStory({ actors: ['A', 'B'], sentences: [{ actor: 'A', verb: 'asks', object: 'x', to: 'B' }] }))
  const long = dsGeometry(normalizeDomainStory({ actors: ['A', 'B'], sentences: [{ actor: 'A', verb: 'asks for a very long thing · 很長很長的動作', object: 'x', to: 'B' }] }))
  assert.ok(long.cellW > short.cellW)
})

test('layout.gapX / gapY set the actor grid pitch', () => {
  const g = dsGeometry(normalizeDomainStory({ ...story, layout: { gapX: 900, gapY: 500 } }))
  assert.equal(g.cellW, 900)
  assert.equal(g.cellH, 500)
  const items = draw({ gapX: 900, gapY: 500 })
  const actors = items.filter((i) => i.data?.ds === 'actor')
  for (const a of actors) for (const b of actors) {
    assert.equal(Math.abs(a.x - b.x) % 900, 0, 'actors sit on a 900 px column pitch')
    assert.equal(Math.abs(a.y - b.y) % 500, 0, 'and a 500 px row pitch')
  }
  assert.equal(ICON_W, 132)
  assert.equal(ICON_H, 100)
})

test('the schema checks layout; unknown-field reporting knows it', () => {
  assert.ok(domainStorySchema.safeParse({ ...story, layout: { spacing: 'roomy' } }).success)
  assert.ok(!domainStorySchema.safeParse({ ...story, layout: { spacing: 'huge' } }).success)
  assert.ok(!domainStorySchema.safeParse({ ...story, layout: { gapX: 10 } }).success, 'a gap too small to hold a pictogram')
  assert.ok(!domainStorySchema.safeParse({ ...story, layout: { gapY: 99999 } }).success)
  assert.deepEqual(unknownContentFields('domain-story', { ...story, layout: { spacing: 'compact', gapX: 600 } }), [])
  assert.ok(unknownContentFields('domain-story', { ...story, layout: { spaceing: 'roomy' } }).some((f) => f.field === 'spaceing'))
})

test('item ids are the same under every spacing (a redraw keeps the person\'s moves and locks by id)', () => {
  const ids = (items: Item[]) => items.map((i) => i.id).sort()
  const base = ids(draw())
  for (const layout of [{ spacing: 'compact' as const }, { spacing: 'roomy' as const }, { gapX: 700, gapY: 400 }]) assert.deepEqual(ids(draw(layout)), base)
})
