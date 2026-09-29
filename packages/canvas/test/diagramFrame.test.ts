// Several diagrams on one board, each in its frame (docs/diagrams.md §1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer, type RunningServer } from '../src/server.js'
import { diagramOf, diagramFrameId, type Board, type Item } from '../src/model.js'
import { studioEs } from './fixtures-es.js'

let srv: RunningServer
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(srv.url + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as any }
}
const draw = async (id: string, body: unknown) => {
  const t = await call('POST', `/api/boards/${id}/template`, body)
  assert.equal(t.status, 200, JSON.stringify(t.body))
  await call('POST', `/api/boards/${id}/ops`, { author: 'agent', ops: t.body.ops })
  return t.body as { items: Item[]; ops: unknown[] }
}
const board = async (id: string) => (await call('GET', `/api/boards/${id}`)).body.board as Board

test.before(async () => {
  srv = await startServer({ port: 0, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'awd-canvas-frame-')), webDist: '/nonexistent' })
})
test.after(async () => srv.close())

test('a freeform board holds an EventStorming and a story map frame side by side, joined by traces', async () => {
  const { board: b } = (await call('POST', '/api/boards', { title: 'design', kind: 'freeform' })).body
  await draw(b.id, { kind: 'event-storming', content: studioEs, frame: { key: 'studio-es', title: 'Studio — EventStorming', source: 'design/studio.es.yaml', level: 'process' } })
  const story = { releases: ['R1'], activities: [{ text: 'Ask', steps: [{ text: 'Send', stories: [{ id: 'chat', text: 'Chat', release: 'R1', traces: [{ from: 'studio-es/send-ask', rel: 'derived-from' }] }] }] }] }
  await draw(b.id, { kind: 'user-story-map', content: story, frame: { key: 'studio-story-map', source: 'design/studio.story-map.yaml' } })
  const now = await board(b.id)
  const es = now.items[diagramFrameId('studio-es')]
  const usm = now.items[diagramFrameId('studio-story-map')]
  assert.deepEqual(es.data?.diagram, { kind: 'event-storming', key: 'studio-es', source: 'design/studio.es.yaml', level: 'process' })
  assert.equal(es.text, 'Studio — EventStorming')
  assert.ok(usm.x >= es.x + es.w, 'a new frame goes to the right of what is there')
  // children know their diagram
  const ev = now.items['studio-es.event.ask-sent']
  assert.equal(diagramOf(now, ev)?.key, 'studio-es')
  assert.equal(diagramOf(now, now.items['studio-story-map.story.chat'])?.kind, 'user-story-map')
  // the trace wire: story → the command it came from
  const trace = Object.values(now.items).find((i) => i.role === 'trace')!
  assert.equal(trace.from, 'studio-story-map.story.chat')
  assert.equal(trace.to, 'studio-es.command.send-ask')
  assert.equal(trace.label, '來自')
})

test('redrawing into an existing frame keeps the frame where and how big the person made it', async () => {
  const { board: b } = (await call('POST', '/api/boards', { title: 'moved', kind: 'freeform' })).body
  await draw(b.id, { kind: 'event-storming', content: studioEs, frame: { key: 'es' } })
  const f = (await board(b.id)).items[diagramFrameId('es')]
  await call('POST', `/api/boards/${b.id}/ops`, { author: 'user', ops: [{ kind: 'update', id: f.id, patch: { x: 2000, y: 900, w: 300, h: 200 } }] })
  const again = await draw(b.id, { kind: 'event-storming', content: studioEs, frame: { key: 'es', title: 'renamed' } })
  const frameOp = (again.ops as Array<{ kind: string; id?: string; patch?: Item }>).find((o) => o.id === f.id)!
  assert.equal(frameOp.patch!.x, 2000)
  assert.equal(frameOp.patch!.w, 300)
  assert.equal(frameOp.patch!.text, 'renamed')
  const ev = again.items.find((i) => i.id === 'es.event.ask-sent')!
  assert.ok(ev.x >= 2000 && ev.y >= 900, 'content is drawn at the frame, not where it first was')
})

test('bad keys and frames around freeform are refused', async () => {
  const { board: b } = (await call('POST', '/api/boards', { title: 'bad', kind: 'freeform' })).body
  assert.equal((await call('POST', `/api/boards/${b.id}/template`, { kind: 'event-storming', content: studioEs, frame: { key: 'Bad Key' } })).status, 400)
  assert.equal((await call('POST', `/api/boards/${b.id}/template`, { kind: 'freeform', content: { items: [{ text: 'x' }] }, frame: { key: 'ok' } })).status, 400)
})

test('legacy boards: the whole board is one diagram of its kind', () => {
  const legacy = { kind: 'kanban' as const, items: { c: { id: 'c', type: 'card', x: 0, y: 0, w: 1, h: 1, createdBy: 'agent', updatedBy: 'agent', updatedAt: 't' } as Item } }
  assert.deepEqual(diagramOf(legacy, legacy.items.c), { kind: 'kanban', key: 'kanban' })
  assert.equal(diagramOf({ kind: 'freeform', items: legacy.items }, legacy.items.c), undefined)
})
