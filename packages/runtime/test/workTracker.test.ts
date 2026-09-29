// WorkTracker (docs/diagrams.md §6): a card groups stories; the canvas kanban and a text file are the first homes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TextFileTracker, parseTasks, renderTasks, CanvasKanbanTracker, FakeWorkTracker } from '../src/index.js'

const md = `# studio — tasks
<!-- columns: Backlog, Ready, Done -->

## Ask the AI about a selection
<!-- card: ask-ai · column: Ready · labels: web, studio -->
stories: studio-usm/select-items, studio-usm/ask-ai

The chat tab sends a discuss comment.
Second line.

## Plain heading, no comment
Just a description.
`

test('tasks.md: parse → render → parse is stable; a heading without a card comment still becomes a card', () => {
  const doc = parseTasks(md)
  assert.equal(doc.title, 'studio — tasks')
  assert.deepEqual(doc.columns, ['Backlog', 'Ready', 'Done'])
  assert.deepEqual(doc.cards[0], { id: 'ask-ai', title: 'Ask the AI about a selection', column: 'Ready', labels: ['web', 'studio'], stories: ['studio-usm/select-items', 'studio-usm/ask-ai'], description: 'The chat tab sends a discuss comment.\nSecond line.' })
  assert.deepEqual(doc.cards[1], { id: 'plain-heading-no-comment', title: 'Plain heading, no comment', column: 'Backlog', stories: [], description: 'Just a description.' })
  assert.deepEqual(parseTasks(renderTasks(doc)), doc)
})

test('TextFileTracker: upsert creates then updates, move checks the column, the file stays readable markdown', async () => {
  const files: Record<string, string> = {}
  const t = new TextFileTracker({ file: '/r/design/studio.tasks.md', title: 'studio — tasks', readFile: (f) => files[f], writeFile: (f, s) => { files[f] = s } })
  assert.deepEqual(await t.upsert({ id: 'ask-ai', title: 'Ask AI', stories: ['studio-usm/ask-ai'] }), { created: true })
  assert.deepEqual(await t.upsert({ id: 'ask-ai', title: 'Ask the AI', stories: ['studio-usm/ask-ai', 'studio-usm/see-reply'], labels: ['web'] }), { created: false })
  await t.move('ask-ai', 'Ready')
  await assert.rejects(t.move('ask-ai', 'Nowhere'), /unknown column "Nowhere"/)
  await assert.rejects(t.move('nope', 'Ready'), /no card "nope"/)
  const [card] = await t.list()
  assert.deepEqual(card, { id: 'ask-ai', title: 'Ask the AI', column: 'Ready', labels: ['web'], stories: ['studio-usm/ask-ai', 'studio-usm/see-reply'] })
  assert.match(files['/r/design/studio.tasks.md'], /^## Ask the AI\n<!-- card: ask-ai · column: Ready · labels: web -->\nstories: studio-usm\/ask-ai, studio-usm\/see-reply/m)
})

// A board with two kanban frames that both have "Backlog" / "Ready" columns.
function fakeCanvas() {
  const items: Record<string, Record<string, unknown>> = {
    fDev: { id: 'fDev', type: 'frame', data: { diagram: { kind: 'kanban', key: 'dev-kanban' } } },
    fOps: { id: 'fOps', type: 'frame', data: { diagram: { kind: 'kanban', key: 'ops-kanban' } } },
    devA: { id: 'devA', type: 'lane', role: 'column', text: 'Backlog', parent: 'fDev', x: 0 },
    devB: { id: 'devB', type: 'lane', role: 'column', text: 'Ready', parent: 'fDev', x: 300 },
    opsA: { id: 'opsA', type: 'lane', role: 'column', text: 'Backlog', parent: 'fOps', x: 900 },
    o1: { id: 'o1', type: 'card', text: 'ops card', parent: 'opsA' },
  }
  const calls: string[] = []
  const f: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${body?.column ? ` column=${body.column}` : ''}`)
    if (url.pathname === '/api/boards') return json({ boards: [{ id: 'b1', title: 'Design' }] })
    if (url.pathname === '/api/boards/b1') return json({ board: { id: 'b1', title: 'Design', kind: 'freeform', seq: 1, items } })
    if (url.pathname === '/api/boards/b1/cards') {
      const id = `kb.card.${body.id}`
      items[id] = { id, type: 'card', text: body.title, parent: body.column, data: body.labels ? { labels: body.labels } : {} }
      return json({ card: items[id] }, 201)
    }
    const move = url.pathname.match(/^\/api\/boards\/b1\/cards\/([^/]+)\/move$/)
    if (move) { items[decodeURIComponent(move[1])].parent = body.column; return json({}) }
    if (url.pathname === '/api/boards/b1/ops') {
      for (const op of body.ops) if (op.kind === 'update') Object.assign(items[op.id], op.patch)
      return json({ seq: 2 })
    }
    return json({ error: 'not found' }, 404)
  }
  return { items, calls, fetch: f }
}

test('CanvasKanbanTracker: columns are resolved inside the keyed kanban frame and passed by id; cards carry our id and story traces', async () => {
  const c = fakeCanvas()
  const t = new CanvasKanbanTracker({ board: 'title:Design', frame: 'dev-kanban', base: 'http://x', fetch: c.fetch })
  assert.deepEqual(await t.columns(), ['Backlog', 'Ready'])
  assert.deepEqual(await t.list(), []) // the ops card is in the other kanban
  assert.deepEqual(await t.upsert({ id: 'ask-ai', title: 'Ask AI', column: 'Backlog', stories: ['studio-usm/ask-ai'] }), { created: true })
  assert.ok(c.calls.includes('POST /api/boards/b1/cards column=devA'), c.calls.join('\n')) // not opsA
  await t.move('ask-ai', 'Ready')
  assert.ok(c.calls.includes('POST /api/boards/b1/cards/kb.card.ask-ai/move column=devB'))
  assert.deepEqual(await t.list(), [{ id: 'ask-ai', title: 'Ask AI', column: 'Ready', stories: ['studio-usm/ask-ai'] }])
  assert.deepEqual(await t.upsert({ id: 'ask-ai', title: 'Ask the AI', stories: ['studio-usm/ask-ai'] }), { created: false })
  assert.equal(c.items['kb.card.ask-ai'].text, 'Ask the AI')
  await assert.rejects(new CanvasKanbanTracker({ board: 'b1', base: 'http://x', fetch: c.fetch }).columns(), /2 kanban frames/)
})

test('FakeWorkTracker records calls', async () => {
  const t = new FakeWorkTracker()
  await t.upsert({ id: 'a', title: 'A', stories: [] })
  await t.move('a', 'Done')
  assert.deepEqual(t.calls, [['upsert', 'a'], ['move', 'a', 'Done']])
  assert.equal((await t.list())[0].column, 'Done')
})

test('CanvasKanbanTracker: a card drawn from a kanban file reports its element id, and can be moved by it', async () => {
  const c = fakeCanvas()
  c.items['dev-kanban.card.seed'] = { id: 'dev-kanban.card.seed', type: 'card', text: 'Seed', parent: 'devA' }
  const t = new CanvasKanbanTracker({ board: 'b1', frame: 'dev-kanban', base: 'http://x', fetch: c.fetch })
  assert.deepEqual((await t.list()).map((x) => x.id), ['seed'])
  await t.move('seed', 'Ready')
  assert.equal(c.items['dev-kanban.card.seed'].parent, 'devB')
})
