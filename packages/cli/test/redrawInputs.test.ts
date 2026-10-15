// `awd design draw` / `awd graph --canvas` read what a redraw needs from GET …/redraw-inputs; a canvas without the
// route (404) sends the whole log, folded here — the same inputs either way.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redrawInputs, redrawInputsToJson, type LoggedChange } from '@awd/canvas/diagrams'
import { redrawInputsOf } from '../src/graphCanvas.js'
import type { Api } from '../src/projects.js'

const log: LoggedChange[] = [
  { author: 'agent', by: 'claude-a', note: 'awd design draw: design/k.es.yaml', ops: [{ kind: 'add', item: { id: 'k.a', type: 'sticky' } }, { kind: 'add', item: { id: 'k.b', type: 'sticky' } }] },
  { author: 'user', ts: '2026-10-15T00:00:00.000Z', ops: [{ kind: 'update', id: 'k.a', patch: { x: 3 } }, { kind: 'remove', id: 'k.b' }] },
]
const plain = (r: ReturnType<typeof redrawInputs>) => ({ placed: [...r.placed], origins: [...r.origins], removed: [...r.removed] })
/** canvasApi's way of failing: "GET <path> → <status> <message>". */
const fake = (answer: (p: string) => unknown, asked: string[]): Api =>
  (async (method: string, p: string) => {
    asked.push(p)
    const a = answer(p)
    if (typeof a === 'number') throw new Error(`${method} ${p} → ${a} ${a === 404 ? 'not found' : 'boom'}`)
    return a
  }) as Api

test('a canvas with the route: one small read', async () => {
  const asked: string[] = []
  const r = await redrawInputsOf(fake(() => ({ seq: 2, ...redrawInputsToJson(redrawInputs(log)) }), asked), 'b 1')
  assert.deepEqual(plain(r), plain(redrawInputs(log)))
  assert.deepEqual(asked, ['/api/boards/b%201/redraw-inputs'])
})

test('a canvas without it (404): the whole log, folded here; any other failure is reported', async () => {
  const asked: string[] = []
  const r = await redrawInputsOf(fake((p) => (p.endsWith('/redraw-inputs') ? 404 : { changes: log, seq: 2 }), asked), 'b1')
  assert.deepEqual(plain(r), plain(redrawInputs(log)))
  assert.deepEqual(asked, ['/api/boards/b1/redraw-inputs', '/api/boards/b1/changes?since=0'])
  await assert.rejects(redrawInputsOf(fake(() => 500, []), 'b1'), /→ 500 boom/)
})
