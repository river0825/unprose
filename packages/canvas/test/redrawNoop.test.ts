// A redraw writes only what changed (diagrams/redraw.ts explainRedraw): drawing the same file again emits no ops —
// not for a big UI mock, not for the notes the file drew (comments: the canvas merges their data), not after the
// person moved something or read a note — and an edit to the file updates only what it changed.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { drawDesignContent, previewDesignContent } from '../src/designTools.js'
import type { Change } from '../src/model.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const DESIGNS = ['studio.es.yaml', 'runner.es.yaml', 'studio.story-map.yaml', 'studio.kanban.yaml', 'studio.domain-story.yaml', 'unprose-board-list.ui.yaml']

let srv: RunningServer
let claude: CanvasClient
before(async () => {
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-redraw-noop-')), webDist: '/nonexistent' })
  claude = new CanvasClient(srv.url, { agentName: 'claude-a' })
})
after(() => srv.close())

/** The ops a draw wrote: its change in the log. */
const opsOf = (boardId: string, seq: number): Change['ops'] => srv.store.changes(boardId, { since: seq - 1 }).find((c) => c.seq === seq)!.ops

test('drawing the same file again writes no op — every kind, all on one board', async () => {
  let boardId = ''
  for (const name of DESIGNS) {
    const text = fs.readFileSync(path.join(repo, 'design', name), 'utf8')
    const first = await drawDesignContent(claude, name, text, 'title:Same again')
    boardId = first.boardId
    assert.ok(opsOf(boardId, first.seq).length > 0, `${name}: the first draw adds the frame`)
    for (const round of [2, 3]) {
      const again = await drawDesignContent(claude, name, text, 'title:Same again')
      assert.deepEqual(opsOf(boardId, again.seq).map((o) => `${o.kind} ${o.kind === 'add' ? o.item.id : o.id}`), [], `${name}, draw ${round}`)
    }
    const p = await previewDesignContent(claude, name, text, `title:Same again`)
    assert.deepEqual([p.plan!.added, p.plan!.updated, p.plan!.removed], [[], [], []], p.lines.join('\n'))
    assert.ok(p.plan!.unchanged > 0)
  }
  // the redraw is still in the log (a change with no ops): the page re-reads the files snapshot after one
  assert.ok(srv.store.changes(boardId).some((c) => c.note === 'design_draw: unprose-board-list.ui.yaml' && c.ops.length === 0))
})

const ES = YAML.stringify({
  level: 'process',
  events: [{ id: 'placed', text: 'Order placed' }, { id: 'paid', text: 'Order paid' }],
  commands: [{ id: 'pay', text: 'Pay', by: 'Customer', system: 'Shop', produces: 'paid' }],
  annotations: [{ on: 'paid', text: 'Only after the bank says yes' }, { on: 'command.pay', text: 'One button, no confirmation page' }],
})

test("the file's notes, read and moved by the person, and an item they moved: still no op; their updatedBy stays theirs", async () => {
  const r = await drawDesignContent(claude, 'shop.es.yaml', ES, 'title:Shop')
  const b = await claude.getBoard(r.boardId)
  const notes = Object.values(b.items).filter((i) => i.type === 'comment')
  assert.ok(notes.length >= 2, 'the annotations are drawn as notes')
  assert.ok(notes.every((n) => typeof n.data?.postedAt === 'string'), 'the canvas stamped them (routing.ts)')
  const event = Object.values(b.items).find((i) => i.role === 'event' && i.text === 'Order paid')!
  await claude.apply(r.boardId, [{ kind: 'update', id: event.id, patch: { x: event.x + 120 } }, { kind: 'update', id: notes[0].id, patch: { x: notes[0].x + 40 } }], 'user', 'moved')
  await claude.apply(r.boardId, notes.map((n) => ({ kind: 'update' as const, id: n.id, patch: { data: { ...n.data, seenBy: ['user'] } } })), 'user', 'seen')
  const again = await drawDesignContent(claude, 'shop.es.yaml', ES, 'title:Shop')
  assert.deepEqual(opsOf(r.boardId, again.seq), [])
  const now = await claude.getBoard(r.boardId)
  assert.equal(now.items[event.id].x, event.x + 120, 'kept where the person put it')
  assert.equal(now.items[event.id].updatedBy, 'user', "the person's undo of that move still applies (no agent stamp since)")
})

test('an edit to the file updates only what it changed', async () => {
  const r = await drawDesignContent(claude, 'edit.es.yaml', ES, 'title:Edit')
  const b = await claude.getBoard(r.boardId)
  const paid = Object.values(b.items).find((i) => i.role === 'event' && i.text === 'Order paid')!
  const again = await drawDesignContent(claude, 'edit.es.yaml', ES.replace('Order paid', 'Payment taken'), 'title:Edit')
  const ops = opsOf(r.boardId, again.seq)
  assert.deepEqual(ops.map((o) => `${o.kind} ${o.kind === 'add' ? o.item.id : o.id}`), [`update ${paid.id}`])
  assert.equal((ops[0] as { patch: { text?: string } }).patch.text, 'Payment taken')
})
