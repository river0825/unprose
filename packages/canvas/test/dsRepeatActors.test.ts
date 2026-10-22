// Repeated actors in a domain story (docs/diagrams.md §6b "Repeated actors"): `layout.actors: repeat` (or `repeat: true`
// on one actor) draws an actor again where the story comes back to it, instead of an arrow back across the picture.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import type { DomainStoryContent } from '../src/diagrams/domainStory.js'
import { countCrossings, dsCasting, renderDomainStory, segmentHitsBox } from '../src/templates/domain-story.js'
import { fromEgon, toEgon } from '../src/diagrams/egon.js'
import { designFromObject, lintDesignContent } from '../src/diagrams/designFile.js'
import { outline } from '../src/outline.js'
import { buildReplay, statusAt } from '../web/src/diagrams/replay.js'
import { sameWorkObject } from '../web/src/diagrams/sameObject.js'

const now = 'T'

// main's output for this story (v0.27.1), pinned: with every actor drawn once (the default) nothing may move
const small: DomainStoryContent = {
  actors: ['Customer', { id: 'clerk', text: 'Clerk' }, { text: 'Policy system', kind: 'system' }],
  workObjects: [{ id: 'form', text: 'application form' }, { text: 'policy' }],
  sentences: [
    { id: 'send', actor: 'Customer', verb: 'sends', object: 'form', to: 'clerk' },
    { id: 'check', actor: 'clerk', verb: 'checks', object: 'form' },
    { id: 'enter', actor: 'clerk', verb: 'enters', object: 'policy', to: 'Policy system', toLabel: 'into' },
    { id: 'call', actor: 'clerk', verb: 'calls', to: 'Customer' },
    { id: 'notify', actor: 'Policy system', verb: 'notifies', object: 'policy', to: 'Customer' },
  ],
  annotations: [{ on: 'clerk', text: 'Only in office hours' }],
  groups: [{ id: 'back', text: 'Back office', members: ['enter', 'Policy system'] }],
}
const PINNED_BOXES = [["p.group.back",875,186,475,328],["p.actor.customer",40,216,132,100],["p.actor.clerk",615,216,132,100],["p.actor.policy-system",1190,216,132,100],["p.object.send",328,216,132,100],["p.object.check",928,216,132,100],["p.object.enter",903,392,132,100],["p.object.notify",615,40,132,100],["p.note.note-1",601,356,160,40],["p.legend-title.legend",40,604,560,24],["p.legend.l0",40,640,110,88],["p.legend.l1",170,640,110,88],["p.legend.l2",300,640,110,88],["p.legend.l3",430,640,110,88],["p.legend.l4",570,640,260,88]]
const PINNED_ARROWS = [["p.arrow.6f9e25","p.actor.customer","p.object.send"],["p.arrow.ab1e89","p.object.send","p.actor.clerk"],["p.arrow.3f8f15","p.actor.clerk","p.object.check"],["p.arrow.fd7116","p.actor.clerk","p.object.enter"],["p.arrow.4c24a7","p.object.enter","p.actor.policy-system"],["p.arrow.84c1d4","p.actor.clerk","p.actor.customer"],["p.arrow.783648","p.actor.policy-system","p.object.notify"],["p.arrow.71d1f6","p.object.notify","p.actor.customer"],["p.arrow.3284f1","p.note.note-1","p.actor.clerk"]]

// a long story that keeps coming back to Customer and Sales rep
const long: DomainStoryContent = {
  actors: [
    { id: 'customer', text: 'Customer' },
    { id: 'shop', text: 'Web shop', kind: 'system' },
    { id: 'sales', text: 'Sales rep' },
    { id: 'erp', text: 'ERP', kind: 'system' },
    { id: 'warehouse', text: 'Warehouse', kind: 'group' },
    { id: 'courier', text: 'Courier' },
    { id: 'billing', text: 'Billing' },
    { id: 'bank', text: 'Bank', kind: 'system' },
    { id: 'support', text: 'Support' },
  ],
  workObjects: ['order', 'quote', 'invoice', 'parcel', 'payment', 'ticket'],
  sentences: [
    { actor: 'customer', verb: 'places', object: 'order', to: 'shop', toLabel: 'in' },
    { actor: 'shop', verb: 'forwards', object: 'order', to: 'sales' },
    { actor: 'sales', verb: 'prepares', object: 'quote', to: 'customer' },
    { actor: 'customer', verb: 'accepts', object: 'quote', to: 'sales' },
    { actor: 'sales', verb: 'enters', object: 'order', to: 'erp', toLabel: 'into' },
    { actor: 'erp', verb: 'sends', object: 'order', to: 'warehouse' },
    { actor: 'warehouse', verb: 'packs', object: 'parcel', to: 'courier', toLabel: 'for' },
    { actor: 'courier', verb: 'delivers', object: 'parcel', to: 'customer' },
    { actor: 'erp', verb: 'creates', object: 'invoice', to: 'billing', toLabel: 'for' },
    { actor: 'billing', verb: 'sends', object: 'invoice', to: 'customer' },
    { actor: 'customer', verb: 'pays', object: 'payment', to: 'bank', toLabel: 'via' },
    { actor: 'bank', verb: 'confirms', object: 'payment', to: 'billing' },
    { actor: 'billing', verb: 'closes', object: 'invoice', to: 'erp', toLabel: 'in' },
    { actor: 'customer', verb: 'reports', object: 'ticket', to: 'support' },
    { actor: 'support', verb: 'asks', object: 'ticket', to: 'sales' },
    { actor: 'sales', verb: 'answers', object: 'ticket', to: 'customer' },
    { actor: 'support', verb: 'closes', object: 'ticket', to: 'shop', toLabel: 'in' },
  ],
  annotations: [{ on: 'customer', text: 'a returning customer' }],
}
const repeating = (c: DomainStoryContent, more: Record<string, unknown> = {}): DomainStoryContent => ({ ...c, layout: { ...(c.layout ?? {}), actors: 'repeat', ...more } }) as DomainStoryContent

const centre = (b: Item) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
function shape(items: Item[]) {
  const by = new Map(items.map((i) => [i.id, i]))
  const pics = items.filter((i) => i.data?.ds === 'actor' || i.data?.ds === 'object')
  const arrows = items.filter((i) => i.type === 'arrow' && i.data?.ds && i.role !== 'annotation-link').map((a) => [by.get(a.from!)!, by.get(a.to!)!] as const)
  const lines = arrows.map(([p, q]) => [centre(p), centre(q)] as [{ x: number; y: number }, { x: number; y: number }])
  let through = 0
  for (const [p, q] of arrows) for (const b of pics) if (b !== p && b !== q && segmentHitsBox(centre(p), centre(q), b, -10)) through++
  return { crossings: countCrossings(lines), through, longest: Math.max(...lines.map(([p, q]) => Math.hypot(q.x - p.x, q.y - p.y))), actors: items.filter((i) => i.data?.ds === 'actor') }
}

function boardOf(items: Item[]): Board {
  const frame = { id: 'frame', type: 'frame', x: -40, y: -40, w: 6000, h: 4000, text: 'Story', createdBy: 'agent', updatedBy: 'agent', updatedAt: now, data: { diagram: { kind: 'domain-story', key: 'ds' } } } as unknown as Item
  const all = [frame, ...items.map((i) => (i.type === 'arrow' ? i : { ...i, parent: 'frame' }))]
  return { id: 'b', title: 'b', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(all.map((i) => [i.id, i])) } as Board
}

test('every actor once (the default): the same drawing as before, to the pixel', () => {
  for (const c of [small, { ...small, layout: { actors: 'once' } } as DomainStoryContent]) {
    const items = renderDomainStory(c, { scope: 'p', now })
    assert.deepEqual(items.filter((i) => i.type !== 'arrow').map((i) => [i.id, i.x, i.y, i.w, i.h]), PINNED_BOXES)
    assert.deepEqual(items.filter((i) => i.type === 'arrow').map((i) => [i.id, i.from, i.to]), PINNED_ARROWS)
    assert.ok(!items.some((i) => i.data?.occurrence))
  }
  // a story whose actors would repeat but do not need to (every sentence next to the last): drawn as with `once`
  const strip = (items: Item[]) => items.map((i) => [i.id, i.x, i.y, i.from, i.to])
  const chain: DomainStoryContent = { actors: ['A', 'B', 'C'], sentences: [{ actor: 'A', verb: 'sends', object: 'x', to: 'B' }, { actor: 'B', verb: 'sends', object: 'y', to: 'C' }] }
  assert.deepEqual(strip(renderDomainStory(repeating(chain), { scope: 'p', now })), strip(renderDomainStory(chain, { scope: 'p', now })))
})

test('actors repeat: the story is drawn again next to itself instead of arrows back — fewer crossings, no line through a pictogram', () => {
  const once = shape(renderDomainStory(long, { scope: 'k', now }))
  const items = renderDomainStory(repeating(long), { scope: 'k', now })
  const rep = shape(items)
  assert.equal(once.actors.length, 9)
  assert.ok(rep.actors.length > 9, 'some actors are drawn again')
  assert.ok(rep.crossings < once.crossings, `crossings ${rep.crossings} < ${once.crossings}`)
  assert.ok(rep.through <= once.through && rep.through === 0, `through ${rep.through} (once: ${once.through})`)
  assert.ok(rep.longest < once.longest, `longest arrow ${Math.round(rep.longest)} < ${Math.round(once.longest)}`)
  // the first drawing keeps the actor's id; later ones are <id>.2, <id>.3 … and marked as occurrences, same element
  const customers = rep.actors.filter((a) => a.data?.element === 'customer')
  assert.ok(customers.length >= 2)
  assert.equal(customers[0].id, 'k.actor.customer')
  assert.ok(!customers[0].data?.occurrence)
  customers.slice(1).forEach((c, i) => {
    assert.equal(c.id, `k.actor.customer.${i + 2}`)
    assert.equal(c.data?.occurrence, true)
    assert.equal(c.text, 'Customer')
  })
  // the annotation on an actor goes to its first drawing
  const link = items.find((i) => i.role === 'annotation-link')!
  assert.equal(link.to, 'k.actor.customer')
  // deterministic: the same ids and places every time (a redraw keeps what the person moved, by id)
  assert.deepEqual(renderDomainStory(repeating(long), { scope: 'k', now }), items)
})

test('one actor repeats (`repeat: true` on it): only that one is drawn again', () => {
  const one: DomainStoryContent = { ...long, actors: (long.actors as Array<{ id: string; text: string }>).map((a) => (a.id === 'customer' ? { ...a, repeat: true } : a)) }
  const actors = shape(renderDomainStory(one, { scope: 'k', now })).actors
  assert.ok(actors.filter((a) => a.data?.element === 'customer').length >= 2)
  for (const id of ['shop', 'sales', 'erp', 'billing', 'support']) assert.equal(actors.filter((a) => a.data?.element === id).length, 1, id)
  // and an actor that says `repeat: false` in a repeating story stays once
  const not: DomainStoryContent = repeating({ ...long, actors: (long.actors as Array<{ id: string; text: string }>).map((a) => (a.id === 'customer' ? { ...a, repeat: false } : a)) })
  assert.equal(shape(renderDomainStory(not, { scope: 'k', now })).actors.filter((a) => a.data?.element === 'customer').length, 1)
})

test('every sentence uses a drawing of its own actors, next to each other', () => {
  const { drawn, cast } = dsCasting(repeating(long))
  assert.ok(drawn.includes('customer') && drawn.some((k) => k.startsWith('customer#')))
  for (const c of cast.values()) for (const k of [c.actor, ...c.to]) assert.ok(drawn.includes(k), k)
  const items = renderDomainStory(repeating(long), { scope: 'k', now })
  for (const a of items.filter((i) => i.type === 'arrow' && (i.role === 'activity' || i.role === 'activity-to'))) {
    const ends = [items.find((i) => i.id === a.from)!, items.find((i) => i.id === a.to)!]
    assert.ok(ends.every(Boolean), a.id)
  }
})

test('the board: replay brings a drawing in with its sentence, one drawing lights up the others, the outline lists the actor once', () => {
  const items = renderDomainStory(repeating(long), { scope: 'ds', now })
  const board = boardOf(items)
  const model = buildReplay(board, 'frame')
  const again = items.find((i) => i.data?.ds === 'actor' && i.data.occurrence)!
  const first = items.find((i) => i.data?.ds === 'actor' && i.data.element === again.data!.element && !i.data.occurrence)!
  const at = model.appear.get(again.id)!
  assert.ok(Number.isFinite(at) && at > 1, 'a later drawing is not shown from the start')
  assert.equal(statusAt(model, at - 1, again.id), 'untold')
  assert.notEqual(statusAt(model, at, again.id), 'untold')
  assert.equal(statusAt(model, at, first.id) !== undefined, true)
  // the same actor's other drawings, the first drawing first
  const same = sameWorkObject(board, board.items[again.id])
  assert.equal(same[0].id, first.id)
  assert.ok(same.every((o) => o.data?.element === first.data?.element && o.id !== again.id))
  assert.deepEqual(sameWorkObject(boardOf(renderDomainStory(long, { scope: 'ds', now })), board.items[first.id]), [], 'drawn once: nothing else to light up')
  // the agent's outline: the actor once, with its other drawings named
  const text = outline(board)
  const lines = text.split('\n').filter((l) => l.includes(`: ${first.text} [`) || l.endsWith(`#${first.id}`) || l.includes(`#${again.id}`))
  assert.ok(lines.some((l) => l.includes(`#${first.id}`) && /drawn \d+ times: also .*#ds\.actor\./.test(l)), lines.join('\n'))
  assert.ok(!text.split('\n').some((l) => l.trimStart().startsWith('- actor:') && l.endsWith(`#${again.id}`)), 'a later drawing has no line of its own')
})

test('Egon.io: each drawing is its own Egon actor with the same name; several Egon actors of one name come back as one actor that repeats', () => {
  const egn = toEgon(repeating(long)) as { domainStory: { businessObjects: Array<{ type: string; name?: string }> } }
  const actors = egn.domainStory.businessObjects.filter((o) => o.type.startsWith('domainStory:actor'))
  const drawn = dsCasting(repeating(long)).drawn
  assert.equal(actors.length, drawn.length)
  assert.ok(actors.filter((a) => a.name === 'Customer').length >= 2)
  const back = fromEgon(egn).content
  const customers = (back.actors as Array<{ text: string; repeat?: boolean }>).filter((a) => a.text === 'Customer')
  assert.equal(customers.length, 1)
  assert.equal(customers[0].repeat, true)
  assert.equal(back.sentences.length, long.sentences.length)
  // drawn once: one Egon actor each, as before
  assert.equal((toEgon(long) as typeof egn).domainStory.businessObjects.filter((o) => o.type.startsWith('domainStory:actor')).length, 9)
})

test('lint: `layout.actors` is once or repeat, an actor may say `repeat`', () => {
  const base = { actors: ['A', { text: 'B', repeat: true }], sentences: [{ actor: 'A', verb: 'sends', object: 'x', to: 'B' }], scope: { granularity: 'coarse-grained', time: 'to-be', purity: 'pure' } }
  const errors = (raw: unknown) => lintDesignContent(designFromObject('s.domain-story.yaml', raw)).filter((f) => f.severity === 'error' || /unknown field/.test(f.message))
  assert.deepEqual(errors({ ...base, layout: { actors: 'repeat' } }), [])
  assert.deepEqual(errors({ ...base, layout: { actors: 'once' } }), [])
  assert.match(errors({ ...base, layout: { actors: 'twice' } })[0]?.message ?? '', /layout\.actors/)
})
