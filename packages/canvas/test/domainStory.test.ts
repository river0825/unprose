import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDomainStory, checkDomainStory, readSentence, circled, type DomainStoryContent } from '../src/diagrams/domainStory.js'
import { renderDomainStory, countCrossings } from '../src/templates/domain-story.js'
import { unknownContentFields } from '../src/diagrams/check.js'
import type { Item } from '../src/model.js'

const now = '2026-09-30T00:00:00Z'
const story: DomainStoryContent = {
  scope: { granularity: 'coarse-grained', time: 'to-be', purity: 'digitalized' },
  actors: ['Customer', { id: 'clerk', text: 'Clerk' }, { text: 'Policy system', kind: 'system' }],
  workObjects: [{ id: 'form', text: 'application form' }, { text: 'policy', kind: 'document' }],
  sentences: [
    { actor: 'Customer', verb: 'sends', object: 'form', to: 'clerk' },
    { actor: 'clerk', verb: 'checks', object: 'form' },
    { actor: 'clerk', verb: 'enters', object: 'policy', to: 'Policy system', toLabel: 'into' },
    { actor: 'Policy system', verb: 'notifies', to: 'Customer' },
  ],
  annotations: [{ on: 'clerk', text: 'Only in office hours' }],
  groups: [{ text: 'Back office', members: ['clerk', 'Policy system'] }],
}

test('normalize: stable ids, sequence numbers in order, references by id or text', () => {
  const m = normalizeDomainStory(story)
  assert.deepEqual(m.actors.map((a) => [a.id, a.kind]), [['customer', 'person'], ['clerk', 'person'], ['policy-system', 'system']])
  assert.deepEqual(m.sentences.map((s) => s.seq), [1, 2, 3, 4])
  assert.equal(m.sentences[0].object, 'form')
  assert.equal(m.sentences[0].objectText, 'application form')
  assert.deepEqual(m.sentences[2].to, ['policy-system'])
  assert.equal(m.unresolved.length, 0)
  assert.equal(readSentence(m, m.sentences[0]), '① Customer sends application form to Clerk')
  assert.equal(readSentence(m, m.sentences[2]), '③ Clerk enters policy into Policy system')
  assert.equal(circled(21), '(21)')
})

test('grammar: unknown actors, missing work objects, sequence gaps and shared numbers, unused elements', () => {
  const findings = checkDomainStory({
    actors: ['A', 'Idle'],
    workObjects: ['orphan'],
    sentences: [
      { seq: 1, actor: 'A', verb: 'writes', object: 'note', to: 'Ghost' },
      { seq: 1, actor: 'A', verb: 'calls', object: 'phone' },
      { seq: 3, actor: 'A', verb: 'waves' },
    ],
  })
  const rules = findings.map((f) => f.rule).sort()
  assert.deepEqual(rules, ['actor-unused', 'scope-missing', 'sentence-without-object', 'sequence-gap', 'sequence-shared', 'unresolved-reference', 'work-object-unused'])
  assert.ok(findings.every((f) => f.page), 'every finding says where the rule comes from')
  assert.deepEqual(checkDomainStory(story).filter((f) => f.severity === 'warning'), [])
})

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const mid = (i: Item) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 })

test('pictographic story: actors once, a pictogram per work object, numbers and verbs on the arrows', () => {
  const items = renderDomainStory(story, { scope: 'ds', now })
  const actors = items.filter((i) => i.role === 'actor')
  assert.equal(actors.length, 3, 'every actor appears once')
  assert.ok(actors.every((a) => a.data?.ds === 'actor' && a.text && !/[👤👥🖥]/u.test(a.text)), 'actors are pictograms: the name is plain text, the icon comes from data.kind')
  assert.equal(actors.find((a) => a.text === 'Policy system')!.data?.kind, 'system')
  const objects = items.filter((i) => i.role === 'work-object')
  assert.equal(objects.length, 3, 'one work object per activity that has one')
  assert.ok(objects.every((o) => o.data?.ds === 'object'))
  assert.equal(objects.find((o) => o.data?.seq === 1)!.data!.sentence, '① Customer sends application form to Clerk')
  // no board item carries "① verb": the number is data.seq on the activity arrow, the verb its label
  assert.ok(!items.some((i) => i.type !== 'arrow' && /^[①-⑳] /.test(i.text ?? '')), 'no sentence card')
  const activities = items.filter((i) => i.role === 'activity')
  assert.deepEqual(activities.map((a) => a.data?.seq).sort(), [1, 2, 3, 4])
  assert.deepEqual(activities.map((a) => a.label).sort(), ['checks', 'enters', 'notifies', 'sends'])
  assert.ok(activities.every((a) => a.data?.ds), 'the web draws these as numbered domain-story arrows')
  // a sentence without a work object is one arrow actor → actor, carrying the sentence's element id
  const direct = activities.find((a) => a.label === 'notifies')!
  assert.equal(direct.from, 'ds.actor.policy-system')
  assert.equal(direct.to, 'ds.actor.customer')
  assert.equal(direct.data?.element, '4-notifies')
  assert.equal(items.filter((i) => i.role === 'activity-to').length, 2)
  assert.equal(items.find((i) => i.role === 'activity-to' && i.label === 'into')!.to, 'ds.actor.policy-system')
  // no lifelines, rows or activity cards any more
  assert.ok(!items.some((i) => /lifeline|activity-node/.test(i.role ?? '')))
  // pictograms and notes never overlap; the group encloses its members; the annotation is linked
  const boxes = items.filter((i) => i.type !== 'arrow' && i.role !== 'group')
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${boxes[i].id} overlaps ${boxes[j].id}`)
  const group = items.find((i) => i.role === 'group')!
  for (const id of ['ds.actor.clerk', 'ds.actor.policy-system']) {
    const b = items.find((i) => i.id === id)!
    assert.ok(b.x >= group.x && b.y >= group.y && b.x + b.w <= group.x + group.w && b.y + b.h <= group.y + group.h, `${id} inside the group`)
  }
  assert.ok(items.some((i) => i.role === 'annotation-link' && i.to === 'ds.actor.clerk'))
  assert.match(items.find((i) => i.role === 'scope')!.text!, /coarse-grained · to-be · digitalized/)
  const legend = items.filter((i) => i.role === 'legend').map((i) => i.data?.ds)
  assert.ok(legend.includes('legend-actor') && legend.includes('legend-object') && legend.includes('legend-activity'), 'the legend shows the icons and the numbered arrow')
})

test('actors are placed freely, not on one row; work objects sit on the way from actor to receiver', () => {
  const items = renderDomainStory(
    { actors: ['顧客', 'Clerk', { text: 'Policy system', kind: 'system' }, 'Auditor', 'Archive'], sentences: [
      { actor: '顧客', verb: '寄出', object: 'form', to: 'Clerk' },
      { actor: 'Clerk', verb: 'forwards', object: 'form', to: 'Auditor' },
      { actor: 'Auditor', verb: 'approves', object: 'decision', to: '顧客' },
      { actor: 'Clerk', verb: 'enters', object: 'policy', to: 'Policy system', toLabel: 'into' },
      { actor: 'Clerk', verb: 'files', object: 'copy', to: 'Archive' },
      { actor: 'Policy system', verb: 'notifies', to: '顧客' },
    ] },
    { scope: 'ds', now },
  )
  const byId = new Map(items.map((i) => [i.id, i]))
  const actors = items.filter((i) => i.role === 'actor')
  assert.equal(new Set(actors.map((a) => a.text)).size, actors.length, 'every actor appears once')
  assert.ok(new Set(actors.map((a) => a.y)).size > 1, 'actors are not all on one row')
  const first = actors.find((a) => a.text === '顧客')!
  assert.ok(actors.every((a) => a.x >= first.x), 'the first actor is on the left')
  for (const o of items.filter((i) => i.role === 'work-object')) {
    const from = byId.get(items.find((i) => i.role === 'activity' && i.to === o.id)!.from!)!
    const outs = items.filter((i) => i.role === 'activity-to' && i.from === o.id).map((a) => byId.get(a.to!)!)
    if (!outs.length) continue
    const [a, b, c] = [mid(from), mid(o), mid(outs[0])]
    // between: closer to the middle of the way than to either end's far side
    const along = ((b.x - a.x) * (c.x - a.x) + (b.y - a.y) * (c.y - a.y)) / ((c.x - a.x) ** 2 + (c.y - a.y) ** 2 || 1)
    assert.ok(along > 0.15 && along < 0.85, `${o.text} lies on the way from ${from.text} to ${outs[0].text} (t = ${along.toFixed(2)})`)
  }
  const boxes = items.filter((i) => i.type !== 'arrow' && i.role !== 'group')
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${boxes[i].id} overlaps ${boxes[j].id}`)
  // fewer (or no more) crossings than the naive picture: every actor on one row, objects half-way
  const segs = (list: Item[]) => {
    const b = new Map(list.map((i) => [i.id, i]))
    return list.filter((i) => i.role === 'activity' || i.role === 'activity-to').map((a) => [mid(b.get(a.from!)!), mid(b.get(a.to!)!)] as [{ x: number; y: number }, { x: number; y: number }])
  }
  const naive = items.map((i) => {
    if (i.role === 'actor') return { ...i, x: actors.indexOf(i) * 400, y: 0 }
    return i
  })
  const nb = new Map(naive.map((i) => [i.id, i]))
  const naive2 = naive.map((i) => {
    if (i.role !== 'work-object') return i
    const a = nb.get(items.find((x) => x.role === 'activity' && x.to === i.id)!.from!)!
    const r = items.find((x) => x.role === 'activity-to' && x.from === i.id)
    const b = r ? nb.get(r.to!)! : { ...a, x: a.x + 200 }
    return { ...i, x: (a.x + b.x) / 2, y: 150 }
  })
  assert.ok(countCrossings(segs(items)) <= countCrossings(segs(naive2)), 'not worse than the naive layout')
})

test('traces on a sentence travel with its work object; a sentence with no work object puts them on its actor', () => {
  const items = renderDomainStory(
    { actors: ['A', 'B'], sentences: [
      { actor: 'A', verb: 'asks', object: 'q', to: 'B', traces: [{ from: 'es/ask', rel: 'relates' }] },
      { actor: 'B', verb: 'calls', to: 'A', traces: [{ from: 'es/call', rel: 'derived-from' }] },
    ] },
    { scope: 'ds', now },
  )
  assert.deepEqual(items.find((i) => i.role === 'work-object')!.data!.traces, [{ from: 'es/ask', rel: 'relates' }])
  assert.deepEqual(items.find((i) => i.id === 'ds.actor.b')!.data!.traces, [{ from: 'es/call', rel: 'derived-from' }])
})

test('the layout is deterministic', () => {
  const a = JSON.stringify(renderDomainStory(story, { scope: 'ds', now }))
  const b = JSON.stringify(renderDomainStory(story, { scope: 'ds', now }))
  assert.equal(a, b)
})

test('unknown fields in a domain story file are reported', () => {
  const found = unknownContentFields('domain-story', { actors: ['A'], sentences: [{ actor: 'A', verb: 'x', colour: 'red' }], stories: [] })
  assert.deepEqual(found.map((u) => `${u.path}.${u.field}`).sort(), ['(root).stories', 'sentences[0].colour'].sort())
})

test('story proposals from a domain story: people and groups propose, systems do not', async () => {
  const { proposeFromDomainStory } = await import('../src/diagrams/proposeFromDomainStory.js')
  const { candidates, activities } = proposeFromDomainStory(story, { dsKey: 'claims-ds', storyName: 'Claims' })
  assert.deepEqual(candidates.map((c) => c.text), ['As Customer, I sends application form to Clerk', 'As Clerk, I checks application form', 'As Clerk, I enters policy into Policy system'])
  assert.deepEqual(candidates[0].traces, [{ from: 'claims-ds/1-sends', rel: 'derived-from' }])
  assert.deepEqual(candidates[0].acceptance, ['application form reaches Clerk'])
  assert.equal(candidates[1].activity.text, 'Back office', 'a sentence in a group goes under that group')
  assert.equal(candidates[0].activity.text, 'Claims')
  assert.equal(candidates[0].source.kind, 'sentence')
  assert.deepEqual(activities.map((a) => a.text), ['Claims', 'Back office'])
  const again = proposeFromDomainStory(story, { dsKey: 'claims-ds', existing: { releases: [], activities: [{ text: 'Claims', steps: [{ text: 'Customer', stories: [{ text: 'x', traces: [{ from: 'claims-ds/1-sends', rel: 'derived-from' }] }] }] }] } })
  assert.equal(again.candidates.length, 2, 'already traced sentences are not proposed again')
})

test('a trace into a sentence without a work object reaches its actor', async () => {
  const { resolveTraces } = await import('../src/templates/frame.js')
  const ds = renderDomainStory({ actors: ['A', 'B'], sentences: [{ id: 'call', actor: 'B', verb: 'calls', to: 'A' }] }, { scope: 'k', now })
  const story = { id: 'sm.story.s', type: 'card', x: 0, y: 0, w: 10, h: 10, data: { element: 's', traces: [{ from: 'k/call', rel: 'derived-from' }] }, createdBy: 'agent', updatedBy: 'agent', updatedAt: now } as Item
  const board = Object.fromEntries(ds.map((i) => [i.id, i]))
  const { wires, unresolved } = resolveTraces([story], board, now)
  assert.deepEqual(unresolved, [])
  assert.equal(wires[0].to, 'k.actor.b')
})

test('review hints: scope, one concrete case, work objects that are things, come back and have their own icons', async () => {
  const rules = (c: DomainStoryContent) => checkDomainStory(c).map((f) => f.rule)
  const base = { scope: { granularity: 'coarse-grained', time: 'to-be', purity: 'digitalized' }, actors: ['Operator', { text: 'App', kind: 'system' }] } as const
  const findings = checkDomainStory({
    ...base,
    workObjects: ['segments', 'cadence', 'settings', 'Validation passed / 檢查通過', { text: 'experiment', kind: 'flask' }],
    sentences: [
      { actor: 'Operator', verb: 'selects', object: 'segments', to: 'App', toLabel: 'in' },
      { actor: 'App', verb: 'creates', object: 'cadence', to: 'Operator' },
      { actor: 'Operator', verb: 'configures or skips', object: 'settings', to: 'App' },
      { actor: 'App', verb: 'returns', object: 'Validation passed / 檢查通過', to: 'Operator' },
      { actor: 'Operator', verb: 'activates', object: 'experiment', to: 'App' },
    ],
  })
  assert.deepEqual(findings.map((f) => f.rule).sort(), ['conditional', 'icon-unknown', 'request-response', 'work-object-outcome', 'work-objects-never-repeat', 'work-objects-one-icon'])
  // "flask" has no icon, so it is drawn as a document too
  assert.match(findings.find((f) => f.rule === 'work-objects-one-icon')!.message, /^all 5 work objects are drawn with the "document" icon \("segments", "cadence", "settings", "Validation passed \/ 檢查通過", "experiment"\)/)
  assert.ok(findings.every((f) => f.severity === 'info' && f.page))

  // the same thing coming back under one name, with icons that differ: nothing to say
  assert.deepEqual(rules({ ...base, actors: [...base.actors, 'Marketing lead'], workObjects: [{ text: 'experiment', kind: 'digital' }, { text: 'check result', kind: 'info' }], sentences: [
    { actor: 'Marketing lead', verb: 'asks for', object: 'experiment', to: 'Operator' },
    { actor: 'App', verb: 'returns', object: 'check result', to: 'Operator' },
    { actor: 'Operator', verb: 'activates', object: 'experiment', to: 'App' },
    { actor: 'App', verb: 'runs', object: 'experiment' },
  ] }), [])
  // a state on the thing is fine ("signed contract"); three different things with one icon are not told apart
  assert.deepEqual(rules({ ...base, sentences: [
    { actor: 'Operator', verb: 'files', object: 'signed contract', to: 'App' },
    { actor: 'App', verb: 'sends', object: 'invoice', to: 'Operator' },
    { actor: 'Operator', verb: 'pays', object: 'bill', to: 'App' },
  ] }), ['work-objects-one-icon'])
  // most of them alike is enough to ask (not only all); things only named in a sentence are told to be declared
  const mostly = (extra: DomainStoryContent['workObjects'], objects: string[]) => checkDomainStory({ ...base, workObjects: extra, sentences: objects.map((object, i) => ({ actor: i % 2 ? 'App' : 'Operator', verb: 'hands on', object, to: i % 2 ? 'Operator' : 'App' })) }).filter((f) => f.rule === 'work-objects-one-icon')
  const half = mostly([{ text: 'contract', kind: 'document' }, { text: 'call', kind: 'call' }, { text: 'parcel', kind: 'thing' }], ['contract', 'invoice', 'reminder', 'call', 'parcel', 'invoice'])
  assert.equal(half.length, 1)
  assert.match(half[0].message, /^3 of 5 work objects are drawn with the "document" icon \("contract", "invoice", "reminder"\)/)
  assert.match(half[0].message, /"invoice", "reminder" are only named in a sentence \(drawn as a document\) — declare them under `workObjects`/)
  // fewer than half alike, or a story's own icon for them: nothing to say
  assert.deepEqual(mostly([{ text: 'call', kind: 'call' }, { text: 'parcel', kind: 'thing' }, { text: 'chat', kind: 'conversation' }, { text: 'db', kind: 'digital' }], ['contract', 'invoice', 'reminder', 'call', 'parcel', 'chat', 'db']), [])
  const invoice = '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 7.5h6M9 11h6"/></svg>'
  assert.deepEqual(checkDomainStory({ ...base, icons: { invoice }, workObjects: [{ text: 'invoice', kind: 'invoice' }, { text: 'contract', kind: 'document' }, { text: 'call', kind: 'call' }], sentences: ['invoice', 'contract', 'call', 'invoice'].map((object, i) => ({ actor: i % 2 ? 'App' : 'Operator', verb: 'hands on', object, to: i % 2 ? 'Operator' : 'App' })) }).filter((f) => f.rule === 'work-objects-one-icon'), [])
  // the icon the hint shows as an example is one the board can draw
  const { parseDsIcon } = await import('../src/diagrams/dsIcons.js')
  const example = /invoice: '(<svg.*?<\/svg>)'/.exec(half[0].message)![1]
  assert.equal(parseDsIcon(example)?.shapes.length, 2)
  // a user and a system answering each other, sentence after sentence, is a screen flow
  assert.match(findings.find((f) => f.rule === 'request-response')!.message, /between "Operator" and "App"/)
  // pure means no software systems; a story that states no scope is asked for it
  const pure = checkDomainStory({ ...base, scope: { granularity: 'fine-grained', time: 'as-is', purity: 'pure' }, sentences: [{ actor: 'Operator', verb: 'opens', object: 'form', to: 'App' }] })
  assert.deepEqual(pure.map((f) => [f.rule, f.severity]), [['scope-purity', 'warning']])
  assert.match(checkDomainStory({ actors: ['A'], sentences: [{ actor: 'A', verb: 'writes', object: 'note' }] }).find((f) => f.rule === 'scope-missing')!.message, /granularity \(coarse-, medium- or fine-grained\), time .* purity/)
})

test("icons of the story's own: only plain shapes are drawn, on the board, in the snapshot and in Egon", async () => {
  const { parseDsIcon, dsGlyphMarkup } = await import('../src/diagrams/dsIcons.js')
  const { toEgon } = await import('../src/diagrams/egon.js')
  const flask = '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script><path d="M9 3h6M10 3v6l-5 10h14l-5-10V3" style="fill:url(x)"/><circle cx="12" cy="16" r="1" onclick="x()"/><image href="http://x/y.png"/><path d="javascript:alert(1)"/></svg>'
  const glyph = parseDsIcon(flask)!
  assert.deepEqual(glyph.shapes, [{ tag: 'path', attrs: { d: 'M9 3h6M10 3v6l-5 10h14l-5-10V3' } }, { tag: 'circle', attrs: { cx: '12', cy: '16', r: '1' } }])
  assert.equal(dsGlyphMarkup(glyph), '<path d="M9 3h6M10 3v6l-5 10h14l-5-10V3"/><circle cx="12" cy="16" r="1"/>')
  assert.match(dsGlyphMarkup(parseDsIcon('<svg viewBox="0 0 48 48"><rect x="4" y="4" width="40" height="40"/></svg>')!), /^<g transform="translate\(0 0\) scale\(0\.5\) translate\(0 0\)"><rect /)
  assert.equal(parseDsIcon('<svg><text>hi</text></svg>'), undefined)
  assert.equal(parseDsIcon('<path d="M0 0' + ' L1 1'.repeat(2000) + '"/>'), undefined, 'too long')

  const content: DomainStoryContent = {
    scope: { granularity: 'coarse-grained', time: 'to-be', purity: 'pure' },
    actors: ['Operator'],
    workObjects: [{ text: 'experiment', kind: 'flask' }, { text: 'broken', kind: 'empty' }],
    sentences: [{ actor: 'Operator', verb: 'sets up', object: 'experiment' }, { actor: 'Operator', verb: 'drops', object: 'broken' }],
    icons: { flask, empty: '<svg><text>x</text></svg>' },
  }
  assert.deepEqual(unknownContentFields('domain-story', content), [])
  assert.deepEqual(checkDomainStory(content).map((f) => [f.rule, f.severity]), [['icon-invalid', 'warning']])
  const items = renderDomainStory(content, { scope: 'ds', now })
  const drawn = items.find((i) => i.role === 'work-object' && i.text === 'experiment')!
  assert.equal(drawn.data?.kind, 'flask')
  assert.equal(drawn.data?.icon, flask)
  assert.equal(items.find((i) => i.role === 'actor')!.data?.icon, undefined)
  const { renderSnapshot } = await import('../src/snapshot.js')
  const picture = renderSnapshot({ id: 'b', title: 't', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) }).svg
  assert.ok(picture.includes('<path d="M9 3h6M10 3v6l-5 10h14l-5-10V3"/><circle cx="12" cy="16" r="1"/>'), 'the snapshot draws the shapes')
  assert.doesNotMatch(picture, /script|onload|onclick|javascript/)
  const egon = toEgon(content) as { iconSet: { workObjects: Record<string, string> } }
  assert.match(egon.iconSet.workObjects.Flask, /<path d="M9 3h6M10 3v6l-5 10h14l-5-10V3"\/><circle cx="12" cy="16" r="1"\/><\/svg>$/)
  assert.doesNotMatch(egon.iconSet.workObjects.Flask, /script|onload|image|javascript/)
})

test('the icon gallery agents copy from (domain-storytelling skill, references/icons.md) draws whole, and lints clean', async () => {
  const fs = await import('node:fs')
  const { parseDsIcon } = await import('../src/diagrams/dsIcons.js')
  const md = fs.readFileSync(new URL('../../../skills/domain-storytelling/references/icons.md', import.meta.url), 'utf8')
  const gallery = Object.fromEntries([...md.matchAll(/^([a-z]+): '(<svg viewBox="0 0 24 24">.*<\/svg>)'$/gm)].map((m) => [m[1], m[2]]))
  assert.ok(Object.keys(gallery).length >= 20)
  for (const [name, svg] of Object.entries(gallery)) {
    const shapes = svg.match(/<(path|circle|ellipse|rect|line|polyline|polygon)\b/g)!.length
    assert.equal(parseDsIcon(svg)?.shapes.length, shapes, `${name}: every shape is drawn`)
  }
  const names = Object.keys(gallery)
  const content: DomainStoryContent = {
    scope: { granularity: 'coarse-grained', time: 'to-be', purity: 'pure' },
    actors: ['Clerk', 'Customer'],
    workObjects: names.map((n) => ({ text: n, kind: n })),
    sentences: names.map((n, i) => ({ actor: i % 2 ? 'Customer' : 'Clerk', verb: 'hands', object: n, to: i % 2 ? 'Clerk' : 'Customer' })),
    icons: gallery,
  }
  assert.deepEqual(checkDomainStory(content).filter((f) => f.rule.startsWith('icon') || f.rule === 'work-objects-one-icon'), [])
})

test('the same work object in several sentences: its pictograms know each other', async () => {
  const { sameWorkObject } = await import('../web/src/diagrams/sameObject.js')
  const content: DomainStoryContent = {
    actors: ['Operator', { text: 'App', kind: 'system' }],
    workObjects: [{ id: 'experiment', text: 'Experiment E-01' }],
    sentences: [
      { actor: 'Operator', verb: 'creates', object: 'experiment', to: 'App' },
      { actor: 'Operator', verb: 'writes', object: 'note' },
      { actor: 'Operator', verb: 'submits', object: 'experiment', to: 'App' },
      { actor: 'Operator', verb: 'files', object: 'note' },
      { actor: 'Operator', verb: 'activates', object: 'experiment', to: 'App' },
    ],
  }
  const items = renderDomainStory(content, { scope: 'ds', now })
  const b = { id: 'b', title: 't', kind: 'freeform', seq: 1, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) } as never
  const objects = items.filter((i) => i.role === 'work-object')
  const seqs = (of: Item) => sameWorkObject(b, of).map((o) => o.data?.seq)
  assert.deepEqual(seqs(objects.find((o) => o.data?.seq === 3)!), [1, 5], 'a declared work object, by its id')
  assert.deepEqual(seqs(objects.find((o) => o.data?.seq === 2)!), [4], 'an undeclared one, by its name')
  assert.deepEqual(sameWorkObject(b, items.find((i) => i.role === 'actor')), [], 'actors appear once')
})

test('review hints: a story of things that do not happen, one thing under several names, dates in verbs; the story read back', async () => {
  const { tellBack, WHICH_DIAGRAM, DOMAIN_STORY_METHOD } = await import('../src/diagrams/guidance.js')
  const content: DomainStoryContent = {
    scope: { granularity: 'fine-grained', time: 'as-is', purity: 'digitalized' },
    actors: ['Ops', { text: 'ConvoAI', kind: 'system' }],
    sentences: [
      { actor: 'Ops', verb: '10/1 imports', object: 'Casey plan=free', to: 'ConvoAI' },
      { actor: 'ConvoAI', verb: 'checks', object: 'Casey plan=free', note: '不符合 → 不送' },
      { actor: 'Ops', verb: 'changes', object: 'Casey plan=growth', to: 'ConvoAI' },
      { actor: 'ConvoAI', verb: 'sends', object: 'webhook', to: 'Ops' },
      { actor: 'Ops', verb: 'renames', object: 'Casey new name', to: 'ConvoAI', note: '離開再回來也不會再送' },
      { actor: 'ConvoAI', verb: 'does not send', object: 'webhook' },
    ],
  }
  const rules = checkDomainStory(content).map((f) => f.rule)
  for (const r of ['negative-story', 'work-objects-variants', 'date-in-verb']) assert.ok(rules.includes(r), r)
  assert.match(checkDomainStory(content).find((f) => f.rule === 'work-objects-variants')!.message, /3 work objects start with "casey"/)
  // a positive story with distinct things says none of this
  const fine = checkDomainStory({ ...content, sentences: [
    { actor: 'Ops', verb: 'imports', object: 'Casey', to: 'ConvoAI' },
    { actor: 'ConvoAI', verb: 'sends', object: 'webhook', to: 'Ops' },
    { actor: 'Ops', verb: 'reads', object: 'webhook' },
  ] }).map((f) => f.rule)
  for (const r of ['negative-story', 'work-objects-variants', 'date-in-verb']) assert.ok(!fine.includes(r), `no ${r}`)
  const told = tellBack(content)
  assert.match(told[0], /did the person say this, or did you guess/)
  assert.equal(told.length, 7)
  assert.match(told[1], /^  ① Ops 10\/1 imports Casey plan=free to ConvoAI$/)
  assert.deepEqual(tellBack({ actors: [], sentences: [] } as never), [], 'nothing to tell for a file that does not parse')
  assert.match(WHICH_DIAGRAM, /does NOT happen/)
  assert.match(DOMAIN_STORY_METHOD, /no "does not"/)
})
