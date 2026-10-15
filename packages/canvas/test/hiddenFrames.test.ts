// Hiding a frame's contents (src/hidden.ts, web/src/flow/hiddenFrames.ts, docs/canvas.md "Hiding a frame"): the board as
// drawn — what a hidden frame holds by `parent` (any depth, nested frames too), the wires with an end in it and the
// threads about any of that left out, the frame collapsed with its count — where a jump lands, the drop target, and what
// agents get: the outline, the summary, json, the layout check, the snapshot, the diff, and over HTTP.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyOps, type Board, type Item } from '../src/model.js'
import { HIDDEN_FRAME_H, HIDDEN_FRAME_W, drawnBoard, drawnTargets, hiddenCountOf, hiddenOf, hiddenOp, hiddenToast } from '../web/src/flow/hiddenFrames.js'
import { boardToFlow, containerAt } from '../web/src/flow/boardToFlow.js'
import { readBoard, ReadError } from '../src/read.js'
import { checkLayout, layoutLines } from '../src/layoutCheck.js'
import { renderSnapshot } from '../src/snapshot.js'
import { summarize } from '../src/diff.js'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'

const now = '2026-10-15T00:00:00.000Z'
const item = (id: string, patch: Partial<Item> = {}): Item => ({ id, type: 'sticky', x: 0, y: 0, w: 120, h: 60, text: id, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...patch })
const boardOf = (items: Item[]): Board => ({ id: 'b', title: 'Hide test', kind: 'freeform', seq: 3, createdAt: now, updatedAt: now, items: Object.fromEntries(items.map((i) => [i.id, i])) })

const OLD = { diagram: { kind: 'ui-mock', key: 'old' } }
const fixture = (hidden = true): Item[] => [
  // a UI-mock frame no longer used: hidden, holding a visible sub-frame, a hidden one, and stickies
  item('diagram.old', { type: 'frame', w: 1000, h: 800, text: 'Old options', data: { ...OLD, ...(hidden ? { hidden: true } : {}) } }),
  item('sub', { type: 'frame', x: 20, y: 40, w: 400, h: 300, text: 'Sub', parent: 'diagram.old' }),
  item('s1', { x: 40, y: 80, parent: 'sub' }),
  item('s2', { x: 500, y: 80, parent: 'diagram.old' }),
  item('s2b', { x: 540, y: 90, parent: 'diagram.old' }),
  item('inner', { type: 'frame', x: 500, y: 400, w: 300, h: 200, text: 'Inner', parent: 'diagram.old', data: { hidden: true } }),
  item('s3', { x: 520, y: 440, parent: 'inner' }),
  // a frame in use, and a sticky with no parent lying where the old frame was drawn
  item('live', { type: 'frame', x: 1200, y: 0, w: 400, h: 300, text: 'Live' }),
  item('t1', { x: 1220, y: 40, parent: 'live' }),
  item('t2', { x: 1400, y: 40, parent: 'live' }),
  item('loose', { x: 300, y: 500 }),
  item('w1', { type: 'arrow', w: 0, h: 0, from: 's2', to: 't1' }),
  item('w2', { type: 'arrow', w: 0, h: 0, from: 't1', to: 't2' }),
  item('w3', { type: 'arrow', w: 0, h: 0, from: 'diagram.old', to: 'live' }),
  // threads: about a hidden sticky (with a reply), about a hidden wire, about the hidden frame itself, about a live sticky, loose
  item('c1', { type: 'comment', x: 200, y: 100, target: 's1', text: 'about s1' }),
  item('c1r', { type: 'comment', target: 'c1', text: 'a reply' }),
  item('c2', { type: 'comment', target: 'w1', text: 'about w1' }),
  item('c3', { type: 'comment', x: 1020, y: 0, target: 'diagram.old', text: 'not used any more' }),
  item('c3r', { type: 'comment', target: 'c3', text: 'agreed' }),
  item('c4', { type: 'comment', x: 1620, y: 0, target: 't1', text: 'about t1' }),
  item('c5', { type: 'comment', x: 1700, y: 400, text: 'loose' }),
]

test('the board as drawn: what a hidden frame holds (any depth), its wires and the threads about it are left out; the frame stays, collapsed, with its count', () => {
  const b = boardOf(fixture())
  const h = hiddenOf(b)!
  assert.deepEqual([...h.ids].sort(), ['c1', 'c1r', 'c2', 'inner', 's1', 's2', 's2b', 's3', 'sub', 'w1'])
  // only the outer hidden frame is drawn; the nested one is inside it and counted with it, as are the wires and threads it keeps from being drawn
  assert.deepEqual([...h.frames], [['diagram.old', 10]])
  assert.equal(h.frameOf.get('s3'), 'diagram.old', 'the outermost hidden frame')
  assert.equal(h.frameOf.get('c1r'), 'diagram.old', 'a reply goes with its thread')
  const d = drawnBoard(b, h)
  assert.deepEqual(Object.keys(d.items).sort(), ['c3', 'c3r', 'c4', 'c5', 'diagram.old', 'live', 'loose', 't1', 't2', 'w2', 'w3'])
  assert.equal(d.items['diagram.old'].h, HIDDEN_FRAME_H, 'collapsed in the drawn copy')
  assert.equal(d.items['diagram.old'].w, Math.min(b.items['diagram.old'].w, HIDDEN_FRAME_W))
  const wide = drawnBoard({ ...b, items: { ...b.items, 'diagram.old': { ...b.items['diagram.old'], w: 61004 } } })
  assert.equal(wide.items['diagram.old'].w, HIDDEN_FRAME_W, 'a frame as wide as a long row of screens is drawn as a short strip')
  assert.equal(hiddenCountOf(d.items['diagram.old']), 10)
  assert.equal(b.items['diagram.old'].h, 800, 'the model keeps its size, so Show restores it')
  assert.equal(hiddenCountOf(b.items['diagram.old']), undefined, 'the count is never stored')
  assert.equal(d.items.t1, b.items.t1, 'everything else is the same object')
})

test('no hidden frame: the same board object; an empty hidden frame says 0', () => {
  const b = boardOf(fixture(false).map((i) => (i.id === 'inner' ? { ...i, data: {} } : i)))
  assert.equal(hiddenOf(b), undefined)
  assert.equal(drawnBoard(b), b)
  const empty = boardOf([item('f', { type: 'frame', w: 300, h: 200, data: { hidden: true } })])
  assert.equal(hiddenCountOf(drawnBoard(empty).items.f), 0)
})

test('hide and show are one ordinary update op on the frame: data.hidden set, then dropped — the rest of data as it was', () => {
  const b = boardOf(fixture(false))
  const hide = hiddenOp(b.items['diagram.old'], true)
  assert.deepEqual(hide, { kind: 'update', id: 'diagram.old', patch: { data: { ...OLD, hidden: true } } })
  const hiddenBoard = applyOps(b, [hide], 'user').board
  // shown from the drawn copy (which carries the count): the count does not leak into the model
  const show = hiddenOp(drawnBoard(hiddenBoard).items['diagram.old'], false)
  assert.deepEqual(show, { kind: 'update', id: 'diagram.old', patch: { data: OLD } })
})

test('the page: no node for a hidden item, the frame node is the strip; a drop below the strip or on it does not go into the hidden frame', () => {
  const d = drawnBoard(boardOf(fixture()))
  const { nodes, edges } = boardToFlow(d, new Set(), new Map())
  const ids = new Set(nodes.map((n) => n.id))
  for (const gone of ['sub', 's1', 's2', 'inner', 's3', 'c1', 'c2']) assert.ok(!ids.has(gone), gone)
  assert.equal(nodes.find((n) => n.id === 'diagram.old')!.height, HIDDEN_FRAME_H)
  assert.deepEqual(edges.filter((e) => e.type === 'item').map((e) => e.id).sort(), ['w2', 'w3'])
  assert.equal(containerAt(d, 300, 300, 'new'), undefined, 'the empty paper the frame used to cover')
  assert.equal(containerAt(d, 300, 20, 'new'), undefined, 'the collapsed strip itself: nothing dropped there would be drawn')
  assert.equal(containerAt(d, 1300, 100, 'new')?.id, 'live')
})

test('a jump to something a hidden frame holds lands on the collapsed frame, once, and the toast names it', () => {
  const b = boardOf(fixture())
  assert.deepEqual(drawnTargets(b, ['s1', 'c2', 't1']), { ids: ['diagram.old', 't1'], hiddenIn: [b.items['diagram.old']] })
  assert.deepEqual(drawnTargets(b, ['diagram.old']).hiddenIn, [], 'the hidden frame itself is drawn')
  const plain = ['t1']
  assert.equal(drawnTargets(b, plain).ids, plain)
  assert.equal(hiddenToast([b.items['diagram.old']]), 'In the hidden frame “Old options” — click Show on it to see its contents')
})

test('read: a hidden frame is one line with its count, its contents listed only with includeHidden — outline, summary, json', () => {
  const b = boardOf(fixture())
  const text = readBoard(b).text
  assert.match(text, /^# Hide test \(freeform, seq 3, 11 items, 10 more in hidden frames\)/)
  assert.match(text, /^Hidden frames: old "Old options" \(10 items\) — the person hid their contents on the board \(not drawn for anyone\); canvas_read_board with includeHidden: true lists them$/m)
  assert.match(text, /## UI mock "Old options" — key old · hidden on the board: 10 items not listed \(includeHidden: true lists them\)  #diagram\.old/)
  for (const gone of ['s1', 's2', 'sub', 'inner', 's3', 'c1', 'c1r', 'c2']) assert.doesNotMatch(text, new RegExp(`#${gone}\\b`), gone)
  for (const kept of ['t1', 't2', 'loose', 'c3', 'c3r', 'c4', 'c5']) assert.match(text, new RegExp(`#${kept}\\b`), kept)
  assert.match(text, /## outside any frame or lane\n {2}- sticky: loose  #loose/, 'on the paper the hidden frame covered, without a parent: drawn on open paper, listed so')
  assert.doesNotMatch(text, /s2 → t1/, 'a wire with a hidden end')
  assert.match(text, /Old options → Live/, 'a wire from the hidden frame itself')

  const all = readBoard(b, { includeHidden: true }).text
  assert.match(all, /listed here because of includeHidden: true/)
  assert.match(all, /hidden on the board: 10 items  #diagram\.old/)
  assert.match(all, /## frame: Inner \[hidden on the board\]  #inner/, 'a hidden frame inside it says so too')
  for (const id of ['s1', 's3', 'c1', 'c1r', 'c2']) assert.match(all, new RegExp(`#${id}\\b`), id)

  const sum = readBoard(b, { format: 'summary' }).text
  assert.match(sum, /hidden on the board: 10 items not counted here \(includeHidden: true counts them\)/)
  assert.match(sum, /^Hidden frames: old/m)

  const json = readBoard(b, { format: 'json' })
  assert.match(json.text.split('\n')[0], /"hidden":"Hidden frames: old/)
  assert.ok(!json.items!.some((i) => i.id === 's1'))
  assert.equal((json.items!.find((i) => i.id === 'diagram.old')!.data as { hidden?: boolean }).hidden, true, 'the frame at its stored size, flagged hidden')
  assert.equal(json.items!.find((i) => i.id === 'diagram.old')!.h, 800)
})

test('read: asking only for what a hidden frame holds says where it is and how to read it; the hidden frame itself reads as its line', () => {
  const b = boardOf(fixture())
  assert.throws(() => readBoard(b, { ids: ['s1'] }), (e: unknown) => e instanceof ReadError && e.status === 404 && /item "s1" is inside the hidden frame "Old options" — the person hid its contents; pass includeHidden: true to read it/.test(e.message))
  assert.throws(() => readBoard(b, { frame: 'sub' }), /frame "sub" is inside the hidden frame "Old options"/)
  assert.match(readBoard(b, { ids: ['s1'], includeHidden: true }).text, /#s1\b/)
  const one = readBoard(b, { frame: 'old' }).text
  assert.match(one, /hidden on the board: 10 items not listed/)
  assert.match(one, /#c3\b/, 'a thread on the frame itself stays')
  assert.doesNotMatch(one, /#s2\b/)
})

test('layout check: what a hidden frame holds is not checked, and the count line says so', () => {
  const shownReport = checkLayout(boardOf(fixture(false)))
  assert.ok(shownReport.findings.some((f) => f.kind === 'overlap' && f.id === 's2b'), 'shown: the two stickies overlap')
  const report = checkLayout(boardOf(fixture()))
  assert.ok(!report.findings.some((f) => ['s1', 's2', 's2b', 's3', 'sub', 'inner'].includes(f.id)), JSON.stringify(report.findings))
  assert.equal(report.hidden, 10)
  assert.match(layoutLines(report, boardOf(fixture())).join('\n'), /10 in hidden frames not checked/)
  assert.equal(checkLayout(boardOf(fixture()), { frame: 'live' }).hidden, undefined, 'none in that frame')
})

test('snapshot: the hidden frame drawn collapsed with its count; asking for what it holds draws the frame, with a note', () => {
  const b = boardOf(fixture())
  const whole = renderSnapshot(b)
  assert.doesNotMatch(whole.svg, /data-id="s1"/)
  assert.match(whole.svg, /10 items hidden/)
  assert.ok(whole.notes.some((n) => /"Old options" is a hidden frame \(the person hid its contents\): drawn collapsed, its 10 items left out/.test(n)), whole.notes.join('\n'))
  const asked = renderSnapshot(b, { ids: ['s1'] })
  assert.match(asked.svg, /data-id="diagram\.old"/)
  assert.equal(asked.region.h, HIDDEN_FRAME_H + 28, 'the strip and its title')
  assert.ok(asked.notes.some((n) => /is a hidden frame/.test(n)))
  assert.match(renderSnapshot(b, { frame: 'sub' }).svg, /data-id="diagram\.old"/, 'a frame inside it: the hidden frame stands in')
})

test('diff: hiding and showing say so, not as data', () => {
  const b = boardOf(fixture(false))
  const hide = applyOps(b, [hiddenOp(b.items['diagram.old'], true)], 'user')
  const lines = summarize(hide.board, [{ seq: 4, ts: now, author: 'user', boardId: 'b', ops: [hiddenOp(b.items['diagram.old'], true)], before: hide.before }])
  assert.match(lines.join('\n'), /Old options.*hid its contents \(not drawn for anyone; canvas_read_board includeHidden: true lists them\)/)
  assert.doesNotMatch(lines.join('\n'), /data changed/)
  const show = applyOps(hide.board, [hiddenOp(hide.board.items['diagram.old'], false)], 'user')
  assert.match(summarize(show.board, [{ seq: 5, ts: now, author: 'user', boardId: 'b', ops: [hiddenOp(hide.board.items['diagram.old'], false)], before: show.before }]).join('\n'), /showed its contents again/)
})

// ── over HTTP: /read and /outline take includeHidden, /settings names the hidden frames, /focus says the page shows the frame ──

let srv: RunningServer
before(async () => {
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-hidden-')), webDist: '/nonexistent' })
})
after(() => srv.close())

test('HTTP: read and outline leave hidden contents out unless includeHidden; settings and focus name the hidden frame; GET /api/boards/:id stays whole', async () => {
  const client = new CanvasClient(srv.url)
  const b = await client.createBoard({ title: 'Hide over HTTP', kind: 'freeform' })
  await client.apply(b.id, fixture().map((i) => ({ kind: 'add', item: i })), 'user')
  const outline = await client.read(b.id)
  assert.match(outline.text, /hidden on the board: 10 items not listed/)
  assert.doesNotMatch(outline.text, /#s1\b/)
  assert.match((await client.read(b.id, { includeHidden: true })).text, /#s1\b/)
  assert.match(await client.outline(b.id), /^Hidden frames: old/m)
  const s = await client.settings(b.id)
  assert.deepEqual(s.hidden, [{ id: 'diagram.old', key: 'old', title: 'Old options', items: 10 }])
  const f = await client.focus(b.id, { ids: ['s1'] })
  assert.deepEqual(f.hidden?.map((x) => x.id), ['diagram.old'])
  assert.ok((await client.getBoard(b.id)).items.s1, 'the page gets the whole board')
})
