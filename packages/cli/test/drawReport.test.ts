// `awd design draw` says what a redraw did to the layout (a changed `layout:` is not silent) and can put a board
// looked up by title in the personal space instead of registering the file's repo as a project.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drawDesign, redrawReport } from '../src/design.js'
import type { RedrawPlan } from '@awd/canvas/diagrams'

const plan = (o: Partial<RedrawPlan> = {}): RedrawPlan => ({ prefix: 'k.', added: [], updated: [], unchanged: 0, removed: [], keptMoved: [], keptLocked: [], keptRemoved: [], held: [], settled: [], foreign: [], ...o })
const line = (id: string, why?: string) => ({ id, label: id, ...(why ? { why } : {}) })

test('redrawReport: a first draw says nothing; a redraw gives the counts', () => {
  assert.deepEqual(redrawReport(plan({ added: [line('a')] }), { first: true, fileKnown: false }), [])
  assert.deepEqual(redrawReport(plan({ unchanged: 5 }), { first: false, fileKnown: true }), ['  redraw: 5 unchanged'])
})

test('redrawReport: a changed layout says how many items moved and how many kept their place', () => {
  const p = plan({ updated: [line('a', 'x, y'), line('b', 'y'), line('c', 'text')], keptMoved: [line('d', 'x, y')], unchanged: 3 })
  const out = redrawReport(p, { first: false, fileKnown: true, layoutBefore: '{"spacing":"roomy"}', layoutNow: '{"spacing":"compact"}' })
  assert.match(out[1], /layout: changed in the file \(\{"spacing":"roomy"\} → \{"spacing":"compact"\}\): 2 item\(s\) moved to the new layout, 1 kept their place/)
  assert.match(out[2], /1 item\(s\) keep the place the person gave them .*--relayout/)
})

test('redrawReport: a changed layout that moves nothing is said, not silent', () => {
  const out = redrawReport(plan({ updated: [line('frame', 'data')], unchanged: 58 }), { first: false, fileKnown: true, layoutBefore: '{"spacing":"roomy"}', layoutNow: '{"actors":"repeat","spacing":"roomy"}' })
  assert.match(out[1], /0 item\(s\) moved to the new layout — the new setting places everything where it already was/)
})

test('redrawReport: an unchanged layout adds no layout line; --relayout is acknowledged', () => {
  const same = redrawReport(plan({ unchanged: 2 }), { first: false, fileKnown: true, layoutBefore: '{"spacing":"roomy"}', layoutNow: '{"spacing":"roomy"}' })
  assert.equal(same.length, 1)
  const re = redrawReport(plan({ updated: [line('a', 'x, y')], keptLocked: [line('l')] }), { first: false, fileKnown: true, relayout: true })
  assert.match(re[1], /--relayout: the frame was laid out again from the file \(1 locked item\(s\) stayed\)/)
})

/** A canvas that records what it is asked: no boards at first, a board created on POST /api/boards. */
function fakeCanvas() {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
  const realFetch = globalThis.fetch
  const board = { id: 'b1', title: 'Hub', kind: 'freeform', items: {} as Record<string, unknown>, meta: {} }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const p = new URL(String(url)).pathname
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, path: p, ...(body ? { body } : {}) })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    if (p === '/api/boards' && method === 'GET') return json({ boards: [] })
    if (p === '/api/boards' && method === 'POST') return json({ board: { ...board, project: body?.project ?? 'personal' } }, 201)
    if (p === '/api/projects' && method === 'POST') return json({ project: { id: 'registered-repo' } })
    if (p === '/api/boards/b1' && method === 'GET') return json({ board })
    if (p === '/api/boards/b1/settings') return json({ you: 'agent', holders: [] })
    if (p === '/api/boards/b1/template') return json({ items: [] })
    if (p === '/api/boards/b1/redraw-inputs') return json({ placed: [], origins: [], removed: [] })
    if (p === '/api/boards/b1/ops') return json({ seq: 1 })
    if (p === '/api/boards/b1' && method === 'PATCH') return json({ board })
    return json({ error: `unexpected ${method} ${p}` }, 404)
  }) as typeof fetch
  return { calls, restore: () => void (globalThis.fetch = realFetch) }
}
const storyFile = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-draw-'))
  const file = path.join(dir, 'hub.domain-story.yaml')
  fs.writeFileSync(file, 'actors: [A, B]\nsentences:\n  - { actor: A, verb: sends, object: letter, to: B }\n')
  return { dir, file }
}

test('draw --project personal: the board is created in the personal space and the repo is not registered', async () => {
  const c = fakeCanvas()
  const f = storyFile()
  try {
    await drawDesign(f.file, { board: 'title:Hub', canvas: 'http://canvas.test', project: 'personal' })
    assert.equal(c.calls.filter((x) => x.path === '/api/projects').length, 0, 'no project registered')
    const made = c.calls.find((x) => x.method === 'POST' && x.path === '/api/boards')!
    assert.equal(made.body?.project, 'personal')
    assert.equal(made.body?.title, 'Hub')
  } finally {
    c.restore()
    fs.rmSync(f.dir, { recursive: true, force: true })
  }
})

test('draw without --project: the file’s repo is registered and the board goes there (unchanged)', async () => {
  const c = fakeCanvas()
  const f = storyFile()
  try {
    await drawDesign(f.file, { board: 'title:Hub', canvas: 'http://canvas.test' })
    assert.equal(c.calls.filter((x) => x.method === 'POST' && x.path === '/api/projects').length, 1)
    assert.equal(c.calls.find((x) => x.method === 'POST' && x.path === '/api/boards')!.body?.project, 'registered-repo')
  } finally {
    c.restore()
    fs.rmSync(f.dir, { recursive: true, force: true })
  }
})
