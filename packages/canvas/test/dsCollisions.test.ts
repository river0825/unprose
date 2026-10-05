// Domain Storytelling without collisions (docs/diagrams.md §6b "No collisions"): self-directed activities, pictograms
// that never share a spot, group outlines that do not intersect, annotations sized from their text, verbs and number
// circles that keep off each other — and the lint and the layout check that catch what is left.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDomainStory, NOTE_RECOMMENDED, type DomainStoryContent } from '../src/diagrams/domainStory.js'
import { renderDomainStory, groupOutlines, withTitle, segmentHitsBox, NOTE_MAX_W } from '../src/templates/domain-story.js'
import { planWires, seqBox } from '../src/wireGeometry.js'
import { checkLayout, layoutLines } from '../src/layoutCheck.js'
import { renderSnapshot } from '../src/snapshot.js'
import { fitText } from '../src/textMetrics.js'
import { explainRedraw, type BoardItem } from '../src/diagrams/redraw.js'
import type { Board, Item } from '../src/model.js'

const NOW = '2026-10-05T00:00:00.000Z'
const toBoard = (items: Item[]): Board => ({ id: 'b', title: 't', kind: 'freeform', seq: 0, createdAt: NOW, updatedAt: NOW, items: Object.fromEntries(items.map((i) => [i.id, i])) })
const draw = (c: DomainStoryContent) => renderDomainStory(c, { now: NOW })
const pictos = (items: Item[]) => items.filter((i) => i.data?.ds === 'actor' || i.data?.ds === 'object')
type Box = { x: number; y: number; w: number; h: number }
const cover = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
const hits = (a: Box, b: Box, tol = 2) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tol && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tol

/** The Codex report, in small: an actor that sends to itself twice (steps 7 and 8). */
const selfStory: DomainStoryContent = {
  actors: [{ id: 'owner', text: 'Owner · 業主' }, { id: 'cl', text: 'Claude', kind: 'system' }, { id: 'canvas', text: 'Canvas', kind: 'system' }, { id: 'cx', text: 'Codex', kind: 'system' }],
  sentences: [
    { actor: 'owner', verb: 'asks', object: 'request', to: 'cl' },
    { actor: 'cl', verb: 'drafts', object: 'story file', to: 'canvas' },
    { actor: 'canvas', verb: 'shows', object: 'board', to: 'owner' },
    { actor: 'owner', verb: 'comments', object: 'comment', to: 'canvas' },
    { actor: 'canvas', verb: 'wakes', object: 'event', to: 'cl' },
    { actor: 'cl', verb: 'asks a second opinion', object: 'question', to: 'cx' },
    { actor: 'cl', verb: 'lints the file · 檢查', object: 'lint report', to: 'cl' },
    { actor: 'cl', verb: 'redraws · 重畫', object: 'layout', to: 'cl' },
    { actor: 'cx', verb: 'answers', object: 'answer', to: 'cl' },
  ],
}

/** A hub: one actor working with many — arrows leave it at close angles. */
const hubStory: DomainStoryContent = {
  actors: ['Hub', 'A', 'B', 'C', 'D', 'E', 'F'],
  sentences: [
    ...['A', 'B', 'C', 'D', 'E', 'F'].map((r) => ({ actor: 'Hub', verb: `sends the ${r} report · 傳送`, object: `${r} report`, to: r })),
    ...['A', 'C', 'E'].map((r) => ({ actor: r, verb: 'replies', object: `${r} reply`, to: 'Hub' })),
    { actor: 'Hub', verb: 'files it', object: 'archive', to: 'Hub' },
  ],
}

/** Two sentences straight between the same actors, without work objects (identical lines), and a parallel number. */
const sameWay: DomainStoryContent = {
  actors: ['Clerk', 'Customer', 'Archive'],
  sentences: [
    { actor: 'Clerk', verb: 'calls', to: 'Customer' },
    { actor: 'Clerk', verb: 'emails a long confirmation message', to: 'Customer' },
    { seq: 2, actor: 'Clerk', verb: 'stores', object: 'form', to: 'Archive' },
    { actor: 'Customer', verb: 'signs', object: 'contract', to: 'Clerk' },
  ],
}

test('an actor sending to itself: its work objects sit beside it, never on it, and there is no return arrow', () => {
  const items = draw(selfStory)
  const cl = items.find((i) => i.id === 'ds.actor.cl')!
  const self = items.filter((i) => i.data?.ds === 'object' && i.data.self)
  assert.equal(self.length, 2)
  const spots = new Set(pictos(items).map((i) => `${i.x},${i.y}`))
  assert.equal(spots.size, pictos(items).length, 'every pictogram has its own position')
  for (const o of self) {
    assert.equal(cover(o, cl), 0, `${o.text} is not on the actor`)
    // only the activity arrow; nothing back onto the actor
    assert.equal(items.filter((a) => a.type === 'arrow' && a.from === o.id).length, 0)
    assert.equal(items.filter((a) => a.type === 'arrow' && a.to === o.id && a.from === cl.id && a.role === 'activity').length, 1)
  }
  assert.equal(cover(self[0], self[1]), 0)
  // no arrow of zero length anywhere
  for (const a of items.filter((i) => i.type === 'arrow')) assert.notEqual(a.from, a.to)
})

test('an actor acting on itself without a work object draws nothing (the lint says so)', () => {
  const items = draw({ actors: ['A', 'B'], sentences: [{ actor: 'A', verb: 'thinks', to: 'A' }, { actor: 'A', verb: 'tells', object: 'idea', to: 'B' }] })
  assert.equal(items.filter((i) => i.type === 'arrow' && i.from === i.to).length, 0)
  const f = checkDomainStory({ actors: ['A', 'B'], sentences: [{ actor: 'A', verb: 'thinks', to: 'A' }] }).find((x) => x.rule === 'self-receiver')!
  assert.match(f.message, /nothing can be drawn/)
})

test('no two pictograms overlap, and an object leaves its actor by an arrow that passes no other pictogram', () => {
  for (const story of [selfStory, hubStory, sameWay]) {
    for (const spacing of ['compact', 'normal', 'roomy'] as const) {
      const items = draw({ ...story, layout: { spacing } })
      const p = pictos(items)
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) assert.equal(cover(p[i], p[j]), 0, `${spacing}: ${p[i].text} / ${p[j].text}`)
    }
  }
  // the self-directed objects' arrows run clear of other pictograms
  const items = draw(selfStory)
  const byId = new Map(items.map((i) => [i.id, i]))
  const c = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
  for (const o of items.filter((i) => i.data?.self)) {
    const a = items.find((w) => w.type === 'arrow' && w.to === o.id)!
    const from = byId.get(a.from!)!
    for (const other of pictos(items)) if (other.id !== o.id && other.id !== from.id) assert.equal(segmentHitsBox(c(from), c(o), other, -10), false, `${o.text} arrow through ${other.text}`)
  }
})

test('group outlines: a sub-group is drawn inside, groups apart are trimmed apart, shared members are reported', () => {
  const box = (x: number, y: number) => ({ x, y, w: 132, h: 100 })
  // subset → nested, the outer one contains the inner one with its title
  const nested = groupOutlines([
    { id: 'outer', members: ['a', 'b', 'c'], boxes: [box(0, 0), box(400, 0), box(0, 300)] },
    { id: 'inner', members: ['a', 'b'], boxes: [box(0, 0), box(400, 0)] },
  ])
  const o = nested.get('outer')!.box
  const i = withTitle(nested.get('inner')!.box)
  assert.equal(nested.get('inner')!.nestedIn, 'outer')
  assert.ok(o.x < i.x && o.y < i.y && o.x + o.w > i.x + i.w && o.y + o.h > i.y + i.h, 'inner (with its title) inside outer')
  assert.deepEqual(nested.get('outer')!.overlaps, [])
  // two groups whose members are 80 px apart: padding would make them touch — they are trimmed apart
  const apart = groupOutlines([
    { id: 'left', members: ['a'], boxes: [box(0, 0)] },
    { id: 'right', members: ['b'], boxes: [box(212, 0)] },
    { id: 'below', members: ['c'], boxes: [box(0, 160)] },
  ])
  const [l, r, b] = ['left', 'right', 'below'].map((k) => withTitle(apart.get(k)!.box))
  assert.equal(hits(l, r, 0), false)
  assert.equal(hits(l, b, 0), false)
  for (const k of ['left', 'right', 'below']) assert.deepEqual(apart.get(k)!.overlaps, [])
  // every member stays inside its outline
  assert.ok(apart.get('right')!.box.x <= 212 && apart.get('left')!.box.x + apart.get('left')!.box.w >= 132)
  // sharing a member (neither inside the other): cannot be separated → reported on both
  const shared = groupOutlines([
    { id: 'g1', members: ['a', 'b'], boxes: [box(0, 0), box(400, 0)] },
    { id: 'g2', members: ['b', 'c'], boxes: [box(400, 0), box(800, 0)] },
  ])
  assert.deepEqual(shared.get('g1')!.overlaps, ['g2'])
  assert.deepEqual(shared.get('g2')!.overlaps, ['g1'])
})

test('groups in a drawn story: the outlines carry nestedIn / overlaps, and the lint warns only on shared members', () => {
  const story: DomainStoryContent = {
    ...selfStory,
    groups: [
      { id: 'agents', text: 'Agents', members: ['cl', 'cx'] },
      { id: 'all', text: 'Everyone', members: ['cl', 'cx', 'owner', 'canvas'] },
      { id: 'people', text: 'People', members: ['owner', 'cl'] },
    ],
  }
  const items = draw(story)
  const g = (id: string) => items.find((i) => i.id === `ds.group.${id}`)!
  assert.equal(g('agents').data!.nestedIn, 'all')
  assert.ok((g('people').data!.overlaps as string[]).includes('agents'))
  const lint = checkDomainStory(story).filter((f) => f.rule === 'groups-overlap')
  assert.equal(lint.length, 1, 'agents ⊂ all and people ⊂ all are fine; agents and people share Claude')
  assert.match(lint[0].message, /share "Claude"/)
  assert.match(lint[0].message, /sub-group/)
})

test('a long bilingual note grows to fit its text, within the maximum width', () => {
  const text = 'Review note · 審查備註：the proposal carries the base sha-1 of the file so a stale edit is refused; 提案帶著檔案的 base sha-1，過期的修改會被拒絕，避免覆蓋別人的變更。'
  const items = draw({ ...selfStory, annotations: [{ on: 'cl', text }, { on: 'owner', text: 'short' }] })
  const notes = items.filter((i) => i.data?.ds === 'annotation')
  const long = notes.find((n) => n.text === text)!
  const short = notes.find((n) => n.text === 'short')!
  assert.ok(long.w <= NOTE_MAX_W)
  assert.ok(long.h > 64, `grows past the old fixed 64 px (h ${long.h})`)
  assert.equal(fitText(long).clipped, false, 'nothing cut off')
  assert.equal(fitText(short).clipped, false)
  assert.ok(short.h < long.h && short.w < long.w)
  // notes keep off the pictograms and each other
  for (const n of notes) for (const p of [...pictos(items), ...notes.filter((x) => x !== n)]) assert.equal(cover(n, p), 0, `${n.text} / ${p.text}`)
  // and the layout check finds nothing cut off
  assert.equal(checkLayout(toBoard(items)).findings.filter((f) => f.kind === 'clipped').length, 0)
})

test('verbs and number circles: no collision with each other or with pictograms, over a sweep of stories and spacings', () => {
  const stories = [selfStory, hubStory, sameWay]
  for (const story of stories) {
    for (const spacing of ['compact', 'normal', 'roomy'] as const) {
      const items = draw({ ...story, layout: { spacing } })
      const b = toBoard(items)
      const plan = planWires(b)
      const marks: Array<{ id: string; box: Box; circle: boolean }> = []
      for (const [id, p] of plan) {
        if (p.seq) marks.push({ id, box: seqBox(p.seq), circle: true })
        if (p.label && p.label.mode !== 'dot') marks.push({ id, box: { x: p.label.x - p.label.w / 2, y: p.label.y - p.label.h / 2, w: p.label.w, h: p.label.h }, circle: false })
      }
      for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) assert.equal(hits(marks[i].box, marks[j].box), false, `${spacing}: ${marks[i].id} / ${marks[j].id}`)
      // a number circle sits at its arrow's start, on no pictogram but its own ends
      for (const [id, p] of plan) {
        if (!p.seq) continue
        const w = b.items[id]
        for (const o of pictos(items)) if (o.id !== w.from && o.id !== w.to) assert.equal(hits(seqBox(p.seq), o, 0), false, `${spacing}: circle of ${id} on ${o.text}`)
        const d = Math.hypot(p.seq.x - p.shape.p1.x, p.seq.y - p.shape.p1.y)
        const len = Math.hypot(p.shape.p2.x - p.shape.p1.x, p.shape.p2.y - p.shape.p1.y)
        assert.ok(d <= Math.max(24, len * 0.42) + 0.5, 'near the arrow start')
      }
      // the layout check agrees: no label findings about collisions
      const collisions = checkLayout(b).findings.filter((f) => f.kind === 'label' && /collides|overlaps|sits on/.test(f.message))
      assert.deepEqual(collisions.map((f) => f.message), [], spacing)
    }
  }
})

test('the snapshot draws the circles and verbs where the plan puts them', () => {
  const items = draw(hubStory)
  const b = toBoard(items)
  const plan = planWires(b)
  const svg = renderSnapshot(b, { maxPx: 4000 }).svg
  const r = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString())
  for (const p of plan.values()) if (p.seq) assert.ok(svg.includes(`<circle cx="${r(p.seq.x)}" cy="${r(p.seq.y)}" r="11"`), 'circle at the planned spot')
})

test('lint: self receivers, groups sharing members, long notes', () => {
  const long = 'x'.repeat(NOTE_RECOMMENDED + 1)
  const f = checkDomainStory({ ...selfStory, groups: [{ text: 'G1', members: ['cl', 'owner'] }, { text: 'G2', members: ['cl', 'cx'] }], annotations: [{ on: 'cl', text: long }, { on: 'cx', text: '短的備註' }] })
  const self = f.filter((x) => x.rule === 'self-receiver')
  assert.equal(self.length, 2)
  assert.ok(self.every((x) => x.severity === 'warning'))
  assert.match(self[0].message, /⑦ "Claude lints the file · 檢查" goes to Claude itself/)
  assert.match(self[0].message, /omit the redundant `to: cl`/)
  assert.equal(f.filter((x) => x.rule === 'groups-overlap').length, 1)
  const notes = f.filter((x) => x.rule === 'note-long')
  assert.equal(notes.length, 1)
  assert.match(notes[0].message, /long \(121 > 120/)
  // CJK counts double
  assert.equal(checkDomainStory({ ...selfStory, annotations: [{ on: 'cl', text: '備'.repeat(61) }] }).filter((x) => x.rule === 'note-long').length, 1)
  assert.equal(checkDomainStory({ ...selfStory, annotations: [{ on: 'cl', text: '備'.repeat(60) }] }).filter((x) => x.rule === 'note-long').length, 0)
})

test('the layout check finds each problem on a deliberately broken board, in plain words', () => {
  const now = NOW
  const base = { createdBy: 'agent' as const, updatedBy: 'agent' as const, updatedAt: now }
  const picto = (id: string, x: number, y: number, ds = 'object'): Item => ({ ...base, id, type: 'card', x, y, w: 132, h: 100, text: id, data: { ds } }) as Item
  const wire = (id: string, from: string, to: string, extra: Partial<Item> = {}): Item => ({ ...base, id, type: 'arrow', x: 0, y: 0, w: 0, h: 0, from, to, ...extra }) as Item
  const items: Item[] = [
    picto('actor', 0, 0, 'actor'),
    picto('obj1', 400, 0),
    picto('obj2', 400, 0), // the same spot as obj1 (the Codex report)
    picto('obj3', 400, 300),
    picto('blocker', 150, 10), // right at the start of the arrows out of the actor
    wire('w1', 'actor', 'obj1', { role: 'activity', label: 'lints', data: { ds: true, seq: 7 } }),
    wire('w2', 'actor', 'obj2', { role: 'activity', label: 'redraws', data: { ds: true, seq: 8 } }),
    // a plain wire's label dragged onto a number circle
    wire('w3', 'actor', 'obj3', { label: 'checks the whole thing', data: { bend: { x: 175, y: 48 } } }),
    // two groups crossing each other
    { ...base, id: 'g1', type: 'frame', x: -30, y: -40, w: 600, h: 200, text: 'Group one', data: { ds: 'group', members: ['actor', 'obj1'] } } as Item,
    { ...base, id: 'g2', type: 'frame', x: 300, y: -20, w: 300, h: 460, text: 'Group two', data: { ds: 'group', members: ['obj1', 'obj3'] } } as Item,
    // a note whose box is too small for its text
    { ...base, id: 'n1', type: 'text', role: 'annotation', x: 700, y: 0, w: 200, h: 64, text: 'A long review note · 審查備註 that does not fit the fixed 64 px box the old layout gave every note, so its end is cut off', data: { ds: 'annotation' } } as Item,
    // other kinds: two workflow wires whose labels were dragged onto each other
    picto('p', 0, 700, 'none'),
    picto('q', 400, 700, 'none'),
    wire('x1', 'p', 'q', { label: 'first label', data: { bend: { x: 266, y: 760 } } }),
    wire('x2', 'q', 'p', { label: 'second label', data: { bend: { x: 270, y: 762 } } }),
  ]
  const b = toBoard(items)
  const r = checkLayout(b)
  const by = (kind: string, id: string) => r.findings.filter((f) => f.kind === kind && f.id === id)
  // pictogram on pictogram
  assert.ok(by('overlap', 'obj2').some((f) => /card "obj2" overlaps card "obj1"/.test(f.message) && /move it/.test(f.suggestion)))
  // group outlines
  const g = by('group', 'g2')
  assert.equal(g.length, 1)
  assert.match(g[0].message, /share obj1/)
  assert.match(g[0].suggestion, /keep the shared member/)
  // note text overflow
  assert.match(by('clipped', 'n1')[0].suggestion, /make it \d+ px taller/)
  // a number circle on a pictogram that is not its arrow's end
  assert.ok(by('label', 'w1').some((f) => /number circle 7 .* sits on card "blocker"/.test(f.message) && /move card "blocker"/.test(f.suggestion)), layoutLines(r, b).join('\n'))
  // two arrows leaving at the same angle with no free spot for their circles: the circles collide
  assert.ok(by('label', 'w2').some((f) => /number circle 8 .* collides with number circle 7/.test(f.message) && /spread/.test(f.suggestion)), layoutLines(r, b).join('\n'))
  // a label dragged onto a number circle
  assert.ok(r.findings.some((f) => f.kind === 'label' && /label "checks the whole thing".*collides with number circle|number circle .* collides with label "checks the whole thing"/.test(f.message)), layoutLines(r, b).join('\n'))
  // other kinds: labels on each other
  const x = r.findings.filter((f) => f.kind === 'label' && (f.id === 'x1' || f.id === 'x2') && /overlaps label/.test(f.message))
  assert.equal(x.length, 1)
  assert.match(x[0].suggestion, /drag that label onto a free stretch|clear data.bend/)
  assert.ok(r.wires >= 5)
  assert.match(layoutLines(r, b)[0], /\d+ items and \d+ wires checked/)
})

test('the layout check counts wires and says so when all is clear', () => {
  const items = draw({ actors: ['A', 'B'], sentences: [{ actor: 'A', verb: 'sends', object: 'letter', to: 'B' }] })
  const b = toBoard(items)
  const line = layoutLines(checkLayout(b), b)[0]
  assert.match(line, /nothing overlaps, collides, sticks out or is cut off \(\d+ items and 2 wires checked\)/)
})

test('a redraw keeps where the person moved a pictogram', () => {
  const first = draw(selfStory) as unknown as BoardItem[]
  const cl = first.find((i) => i.id === 'ds.actor.cl')!
  const board: Record<string, BoardItem> = Object.fromEntries(first.map((i) => [i.id, i.id === cl.id ? { ...i, x: cl.x + 333, y: cl.y + 77 } : i]))
  const { ops } = explainRedraw(board, draw(selfStory) as unknown as BoardItem[], { placed: new Set([cl.id]) }, { prefix: 'ds.' })
  // no op moves it back: either nothing for it, or an op that keeps the moved position
  for (const op of ops.filter((o) => (o.id ?? o.item?.id) === cl.id)) {
    const geo = { ...(op.item ?? {}), ...(op.patch ?? {}) } as Partial<BoardItem>
    if ('x' in geo) assert.equal(geo.x, cl.x + 333)
    if ('y' in geo) assert.equal(geo.y, cl.y + 77)
  }
})
