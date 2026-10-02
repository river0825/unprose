import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BoardStore } from '../src/store.js'
import { agentSeenOps, outline, summarize, containerOf } from '../src/diff.js'
import { render } from '../src/templates/index.js'
import { demoBoards } from '../src/demo.js'
import { isBookkeeping, isUnread, markSeen, seenBy } from '../src/model.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'awd-canvas-diff-'))

function eventStormBoard() {
  const store = new BoardStore(tmp())
  const items = render('event-storming', demoBoards[0].content)
  const board = store.create({ title: 'ES', kind: 'event-storming', items })
  const byText = (t: string) => Object.values(board.items).find((i) => i.text === t)!
  return { store, board, byText }
}

test('summarize: moving a sticky into another lane reads as "moved from A → B"', () => {
  const { store, board, byText } = eventStormBoard()
  const ev = byText('Card qualified (size XS–L, RFA)')
  const review = byText('Review & merge')
  // Move via parent change
  store.apply(board.id, [{ kind: 'update', id: ev.id, patch: { parent: review.id, y: review.y + 200 } }], 'user')
  let lines = summarize(store.get(board.id)!, store.changes(board.id, { since: board.seq }))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^\[2 user\] event "Card qualified \(size XS–L, RFA\)" \[es\.event\.[^\]]+\]: moved from Build → Review & merge$/)

  // Move geometrically only (no parent in patch) into the Planning lane
  const planning = byText('Planning')
  const build = byText('Build claimed')
  const seq = store.get(board.id)!.seq
  store.apply(board.id, [{ kind: 'update', id: build.id, patch: { parent: undefined, x: planning.x + 60, y: planning.y + planning.h / 2 } }], 'user')
  lines = summarize(store.get(board.id)!, store.changes(board.id, { since: seq }))
  assert.match(lines[0], /moved from Build → Planning/)
})

test('summarize: small move inside the same lane reports the delta and the next neighbour', () => {
  const { store, board, byText } = eventStormBoard()
  const ev = byText('Card confirmed into Ready')
  // its neighbour is whatever sticky sits next to it on its row, to the right, in the same lane
  const next = Object.values(board.items)
    .filter((o) => o.type === 'sticky' && o.parent === ev.parent && o.x > ev.x && Math.abs(o.y - ev.y) <= ev.h / 2)
    .sort((a, b) => a.x - b.x)[0]
  assert.ok(next, 'the event has a neighbour to its right')
  store.apply(board.id, [{ kind: 'update', id: ev.id, patch: { x: ev.x + 20, y: ev.y + 5 } }], 'user')
  const [line] = summarize(store.get(board.id)!, store.changes(board.id, { since: board.seq }))
  assert.match(line, /moved by \(\+20, \+5\)/)
  assert.ok(line.includes(`now before ${next.role} "${next.text}"`), line)
})

test('summarize: comments, renames, recolours, removals, arrows', () => {
  const { store, board, byText } = eventStormBoard()
  const target = byText('Qualify card')
  const seq = board.seq
  store.apply(
    board.id,
    [
      { kind: 'add', item: { id: 'c1', type: 'comment', x: 0, y: 0, w: 200, h: 60, text: 'what if size is unset?', target: target.id, createdBy: 'user', updatedBy: 'user', updatedAt: 'x' } },
      { kind: 'update', id: target.id, patch: { text: 'Qualify card (deterministic)' } },
      { kind: 'update', id: byText('Plan card').id, patch: { color: 'orange' } },
      { kind: 'remove', id: byText('Trello').id },
      { kind: 'add', item: { id: 'a1', type: 'arrow', x: 0, y: 0, w: 0, h: 0, from: byText('Build claimed').id, to: byText('PR marked ready').id, label: 'then', createdBy: 'user', updatedBy: 'user', updatedAt: 'x' } },
      { kind: 'add', item: { id: 'n1', type: 'sticky', x: 10, y: 10, w: 160, h: 110, text: 'Retry policy', role: 'policy', createdBy: 'user', updatedBy: 'user', updatedAt: 'x' } },
    ],
    'user',
  )
  const lines = summarize(store.get(board.id)!, store.changes(board.id, { since: seq }))
  assert.equal(lines.length, 6)
  assert.match(lines[0], /added comment on command "Qualify card \(deterministic\)" \[es\.command\.[^\]]+\]: "what if size is unset\?"/)
  assert.match(lines[1], /renamed "Qualify card" → "Qualify card \(deterministic\)"/)
  assert.match(lines[2], /recoloured blue → orange/)
  assert.match(lines[3], /removed external "Trello"/)
  assert.match(lines[4], /connected event "Build claimed" \[[^\]]+\] → event "PR marked ready" \[[^\]]+\] \("then"\)/)
  assert.match(lines[5], /added policy "Retry policy"/)
})

test('outline: groups by lane, shows comments and arrows, stays compact', () => {
  const { store, board, byText } = eventStormBoard()
  store.apply(board.id, [{ kind: 'add', item: { id: 'c1', type: 'comment', x: 0, y: 0, w: 200, h: 60, text: 'stuck here', target: byText('Card confirmed into Ready').id, createdBy: 'user', updatedBy: 'user', updatedAt: 'x' } }], 'user')
  const text = outline(store.get(board.id)!)
  assert.match(text, /^# ES \(event-storming, seq 2/)
  assert.match(text, /## lane: Planning/)
  assert.match(text, /## lane: Build/)
  assert.match(text, /- event: Card confirmed into Ready \[pivotal\]/)
  assert.match(text, /💬 \(user\) stuck here/)
  assert.match(text, /## arrows/)
  assert.match(text, /Qualify card → Card qualified/)
  assert.ok(text.length < 8000, `outline too long: ${text.length}`)
  // Planning lane content appears before Build lane content
  assert.ok(text.indexOf('## lane: Planning') < text.indexOf('## lane: Build'))
})

test('containerOf: uses parent when set, geometry otherwise', () => {
  const { board, byText } = eventStormBoard()
  const ev = byText('Build claimed')
  assert.equal(containerOf(board, ev)?.text, 'Build')
  const loose = { ...ev, id: 'loose', parent: undefined }
  assert.equal(containerOf(board, loose)?.text, 'Build')
  assert.equal(containerOf(board, { ...loose, x: -5000, y: -5000 }), undefined)
})

test('summarize: resize reads as "resized", reconnect names both ends, read receipts are silent', () => {
  const { store, board, byText } = eventStormBoard()
  const ev = byText('Build claimed')
  const arrow = Object.values(board.items).find((i) => i.type === 'arrow')!
  const other = byText('Plan card')
  store.apply(board.id, [{ kind: 'add', item: { id: 'c1', type: 'comment', x: 0, y: 0, w: 160, h: 64, text: 'hm', createdBy: 'agent', updatedBy: 'agent', updatedAt: 'x' } }], 'agent')
  const seq = store.get(board.id)!.seq
  store.apply(
    board.id,
    [
      { kind: 'update', id: ev.id, patch: { x: ev.x - 10, w: ev.w + 10, h: ev.h + 40, fontSize: 18 } },
      { kind: 'update', id: arrow.id, patch: { to: other.id, data: { ...arrow.data, fromSide: 'bottom', toSide: 'top' } } },
      { kind: 'update', id: arrow.id, patch: { label: 'then' } },
      { kind: 'update', id: arrow.id, patch: { data: { ...arrow.data, fromSide: 'bottom', toSide: 'top', bend: { x: 40, y: 90 } } } },
    ],
    'user',
  )
  store.apply(board.id, [markSeen(store.get(board.id)!.items.c1, 'user')!], 'user')
  const lines = summarize(store.get(board.id)!, store.changes(board.id, { since: seq }))
  assert.equal(lines.length, 4)
  assert.match(lines[0], /event "Build claimed" \[[^\]]+\]: resized \d+×\d+ → \d+×\d+$/)
  assert.match(lines[1], /reconnected to .* → command "Plan card" \[[^\]]+\]$/)
  assert.match(lines[2], /relabelled "[^"]*" → "then"/)
  assert.match(lines[3], /^\[\d+ user\] arrow .+ → .+: rerouted$/)
})

test('read receipts: markSeen / isBookkeeping / agentSeenOps; the item keeps its last editor', () => {
  const { store, board } = eventStormBoard()
  const comment = { id: 'u1', type: 'comment' as const, x: 0, y: 0, w: 160, h: 64, text: 'why?', createdBy: 'user' as const, updatedBy: 'user' as const, updatedAt: 'x' }
  store.apply(board.id, [{ kind: 'add', item: comment }], 'user')
  const shown = store.changes(board.id, { since: board.seq })
  const ops = agentSeenOps(store.get(board.id)!, shown)
  assert.equal(ops.length, 1)
  const change = store.apply(board.id, ops, 'agent', 'seen')
  assert.ok(isBookkeeping(change))
  const after = store.get(board.id)!.items.u1
  assert.deepEqual(seenBy(after), ['agent'])
  assert.equal(after.updatedBy, 'user')
  assert.equal(isUnread(after, 'agent'), false)
  assert.equal(agentSeenOps(store.get(board.id)!, shown).length, 0)
  assert.equal(isBookkeeping({ ...change, ops: [{ kind: 'update', id: 'u1', patch: { data: { seenBy: ['agent'], x: 1 } } }] }), false)
})

test('summarize collapseMoves: same-lane moves fold into one line; lane changes and edits keep their own', () => {
  const { store, board, byText } = eventStormBoard()
  const a = byText('Spec written & published')
  const b = byText('Card handed off to Agent Planned')
  const c = byText('Build claimed')
  const planning = byText('Planning')
  store.apply(board.id, [{ kind: 'update', id: a.id, patch: { x: a.x + 20 } }], 'user')
  store.apply(board.id, [{ kind: 'update', id: b.id, patch: { y: b.y + 10, w: b.w + 20 } }], 'user')
  store.apply(board.id, [{ kind: 'update', id: c.id, patch: { parent: planning.id, y: planning.y + 20 } }], 'user')
  store.apply(board.id, [{ kind: 'update', id: a.id, patch: { text: 'Spec out' } }], 'user')
  const changes = store.changes(board.id, { since: board.seq })
  const full = summarize(store.get(board.id)!, changes)
  assert.equal(full.length, 4)
  const lines = summarize(store.get(board.id)!, changes, { collapseMoves: true })
  assert.equal(lines.length, 3)
  assert.match(lines[0], /moved from Build → Planning/)
  assert.match(lines[1], /renamed/)
  assert.match(lines[2], /^\[2–3 user\] moved or resized 2 items: Spec out, Card handed off to Agent Plan…$/)
})

test('threads: a reply reads as "replied in thread", a root move is a thread move, deleting the root folds its replies', () => {
  const { store, board, byText } = eventStormBoard()
  const target = byText('Qualify card')
  const c = (id: string, t: string, by: 'user' | 'agent', text: string) => ({ id, type: 'comment' as const, x: 0, y: 0, w: 160, h: 64, text, target: t, createdBy: by, updatedBy: by, updatedAt: 'x' })
  store.apply(board.id, [{ kind: 'add', item: c('root', target.id, 'user', 'why here?') }], 'user')
  store.apply(board.id, [{ kind: 'add', item: c('r1', 'root', 'agent', 'because of RFA') }], 'agent')
  const seq = store.get(board.id)!.seq
  store.apply(board.id, [{ kind: 'add', item: c('r2', 'r1', 'user', 'ok, and size?') }], 'user')
  store.apply(board.id, [{ kind: 'update', id: 'root', patch: { x: 40, y: 10 } }], 'user')
  let lines = summarize(store.get(board.id)!, store.changes(board.id, { since: seq }))
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^\[\d+ user\] replied in thread on command "Qualify card" \[es\.command\.[^\]]+\]: "ok, and size\?" \[thread root\]$/)
  assert.match(lines[1], /comment thread "why here\?" \[root\]: moved by \(\+40, \+10\)/)

  const text = outline(store.get(board.id)!)
  assert.match(text, /💬 \(user\) why here\?(?: \[[^\]]*\])?  #root\n\s+↳ \(agent\) because of RFA  #r1\n\s+↳ \(user\) ok, and size\?  #r2/)
  assert.doesNotMatch(text, /comments \(general\)/)

  const seq2 = store.get(board.id)!.seq
  store.apply(board.id, ['root', 'r1', 'r2'].map((id) => ({ kind: 'remove' as const, id })), 'user')
  lines = summarize(store.get(board.id)!, store.changes(board.id, { since: seq2 }))
  assert.deepEqual(lines.length, 1)
  assert.match(lines[0], /removed comment "why here\?" \[root\] and its 2 replies$/)
})

test('threads: a comment cycle does not hang and every comment still shows', () => {
  const { store, board } = eventStormBoard()
  const c = (id: string, t: string) => ({ id, type: 'comment' as const, x: 0, y: 0, w: 160, h: 64, text: id, target: t, createdBy: 'user' as const, updatedBy: 'user' as const, updatedAt: 'x' })
  store.apply(board.id, [{ kind: 'add', item: c('a', 'b') }, { kind: 'add', item: c('b', 'a') }], 'user')
  const text = outline(store.get(board.id)!)
  assert.match(text, /#a/)
  assert.match(text, /#b/)
})
