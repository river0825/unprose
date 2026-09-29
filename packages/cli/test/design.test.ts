// `awd design` (docs/diagrams.md §2, §4): files → frames, lint, story proposals as pending cards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDesignFile, lintDesign, proposalOps, frameOf, KIND_ALIASES } from '../src/design.js'
import { proposeStories } from '@awd/canvas/diagrams'
import { planRedraw } from '../src/graphCanvas.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'design')
const read = (f: string) => parseDesignFile(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8'))

test('the filename names the diagram: <name>.<kind>.yaml → key <name>-<kind>, kind; the file can override', () => {
  const es = read('studio.es.yaml')
  assert.equal(es.key, 'studio-es')
  assert.equal(es.kind, 'event-storming')
  assert.equal(es.level, 'process')
  const usm = read('studio.story-map.yaml')
  assert.deepEqual([usm.key, usm.kind, usm.title], ['studio-story-map', 'user-story-map', 'Studio — story map'])
  assert.equal('title' in usm.content, false) // not template content
  assert.equal(parseDesignFile('design/studio-es.es.yaml', 'events: [{ text: A }]').key, 'studio-es') // no doubled suffix
  assert.deepEqual(parseDesignFile('x.yaml', 'kind: kanban\nkey: dev-kanban\ncolumns: []'), { key: 'dev-kanban', kind: 'kanban', title: undefined, level: undefined, content: { columns: [] } })
  assert.throws(() => parseDesignFile('notes.yaml', 'a: 1'), /name it <name>\.<kind>\.yaml/)
  assert.throws(() => parseDesignFile('x.es.yaml', 'key: Bad Key\nevents: []'), /diagram key "Bad Key"/)
  assert.equal(KIND_ALIASES.es, 'event-storming')
})

test('lint: schema errors stop a draw; the EventStorming grammar comes back as notes with book pages', () => {
  const es = read('studio.es.yaml')
  const notes = lintDesign(es)
  assert.ok(!notes.some((f) => f.severity === 'error'), JSON.stringify(notes))
  assert.ok(notes.some((f) => /open hotspot/.test(f.message) && f.page?.includes('p.199')))
  const broken = lintDesign({ ...es, content: { level: 'process', events: 'nope' } })
  assert.ok(broken.some((f) => f.severity === 'error' && f.message.startsWith('events')))
  // every kind with a schema is checked offline now (river0825/unprose#9): an empty wireframe is an error
  assert.ok(lintDesign({ key: 'k', kind: 'wireframe', content: {} }).some((f) => f.severity === 'error' && f.message.startsWith('screens')))
  assert.equal(lintDesign({ key: 'k', kind: 'domain-story', content: {} })[0].severity, 'info', 'a kind without a schema still says so')
})

// A board after `awd design draw` of both files (the parts the proposal needs).
function drawnBoard() {
  return {
    items: {
      'studio-es': { id: 'studio-es', type: 'frame', data: { diagram: { kind: 'event-storming', key: 'studio-es' } } },
      'studio-es.command.open-session': { id: 'studio-es.command.open-session', type: 'sticky', parent: 'studio-es', data: { element: 'open-session' } },
      'studio-es.command.ask-ai': { id: 'studio-es.command.ask-ai', type: 'sticky', parent: 'studio-es', data: { element: 'ask-ai' } },
      'studio-story-map': { id: 'studio-story-map', type: 'frame', x: 1000, y: 0, w: 400, h: 300, data: { diagram: { kind: 'user-story-map', key: 'studio-story-map' } } },
      'studio-story-map.story.ask-about-selection': { id: 'studio-story-map.story.ask-about-selection', type: 'card', parent: 'studio-story-map', x: 1024, y: 180, w: 150, h: 90 },
    } as Record<string, { id: string; type: string; parent?: string; x?: number; y?: number; w?: number; h?: number; data?: Record<string, unknown> }>,
  }
}

test('propose-stories: each command becomes a pending card in the story-map frame with a pending 來自 wire; nothing twice', () => {
  const es = read('studio.es.yaml')
  const usm = read('studio.story-map.yaml')
  const { candidates } = proposeStories(es.content as never, { esKey: es.key, existing: usm.content as never })
  assert.ok(candidates.length >= 2)
  const board = drawnBoard()
  const { ops, proposed } = proposalOps(board, candidates, 'studio-story-map', 'studio-es', 't')
  assert.equal(proposed, candidates.length)
  const cards = ops.filter((o) => o.kind === 'add' && (o.item as { type: string }).type === 'card').map((o) => o.item as { id: string; parent: string; y: number; data: { pending: { kind: string; trace: { from: string } } } })
  assert.ok(cards.every((c) => c.parent === 'studio-story-map' && c.data.pending.kind === 'add'))
  assert.ok(cards.every((c) => c.y > 180 + 90)) // below what is already there, inside the frame
  assert.ok(cards.some((c) => c.data.pending.trace.from === 'studio-es/ask-ai'))
  const wires = ops.filter((o) => o.kind === 'add' && (o.item as { type: string }).type === 'arrow').map((o) => o.item as { from: string; label: string; role: string })
  assert.ok(wires.some((w) => w.from === 'studio-es.command.ask-ai' && w.label === '來自' && w.role === 'trace'))
  assert.ok(ops.some((o) => o.kind === 'update' && o.id === 'studio-story-map')) // the frame grows to hold them
  // applied → proposing again adds nothing
  for (const o of ops) if (o.kind === 'add') { const it = o.item as { id: string }; (board.items as Record<string, unknown>)[it.id] = it }
  assert.equal(proposalOps(board, candidates, 'studio-story-map', 'studio-es').proposed, 0)
  assert.throws(() => proposalOps({ items: {} }, candidates, 'nope', 'studio-es'), /no story-map frame keyed "nope"/)
  assert.equal(frameOf(board, 'studio-es')?.id, 'studio-es')
})

test('a story-map redraw keeps proposals until the file has a story with the same trace', () => {
  const es = read('studio.es.yaml')
  const { candidates } = proposeStories(es.content as never, { esKey: es.key })
  const board = drawnBoard()
  for (const o of proposalOps(board, candidates, 'studio-story-map', 'studio-es').ops) if (o.kind === 'add') { const it = o.item as { id: string }; (board.items as Record<string, unknown>)[it.id] = it }
  const scope = { prefix: 'studio-story-map.', keep: new Set(['studio-story-map']) }
  const frame = board.items['studio-story-map']
  const untouched = planRedraw(board.items as never, [frame], new Set(), scope)
  assert.ok(!untouched.some((o) => o.kind === 'remove' && String(o.id).includes('.proposed.')))
  const accepted = { id: 'studio-story-map.story.from-ask-ai', type: 'card', data: { traces: [{ from: 'studio-es/ask-ai', rel: 'derived-from' }] } }
  const settled = planRedraw(board.items as never, [frame, accepted], new Set(), scope)
  const removed = settled.filter((o) => o.kind === 'remove').map((o) => o.id)
  assert.ok(removed.includes('studio-story-map.proposed.from-ask-ai'))
  assert.ok(removed.includes('studio-story-map.proposed.from-ask-ai.trace'))
})

test('a redraw grows a frame the person never resized, never shrinks it, and leaves a resized one alone', async () => {
  const { growFrame } = await import('../src/design.js')
  const frame = { id: 'diagram.k', type: 'frame', x: 100, y: 0, w: 500, h: 400 }
  const drawn = [
    { id: 'k.a', type: 'sticky', parent: 'diagram.k', x: 150, y: 50, w: 100, h: 80 },
    { id: 'k.b', type: 'sticky', parent: 'diagram.k', x: 1300, y: 60, w: 100, h: 80 },
    { id: 'k.w', type: 'arrow', from: 'k.a', to: 'k.b' },
  ]
  assert.deepEqual(growFrame(frame, drawn, new Set()), { kind: 'update', id: 'diagram.k', patch: { w: 1320, h: 400 } })
  assert.equal(growFrame(frame, drawn.slice(0, 1), new Set()), undefined, 'already big enough: no op')
  assert.equal(growFrame(frame, drawn, new Set(['diagram.k'])), undefined, 'the person resized it: keep theirs')
})

test('a workflow file is a workflow diagram: key from the filename, not the run-key template', () => {
  const text = 'name: issue-triage\nkey: "{{ event.data.issue }}"\ntriggers: { t: { on: manual } }\nsteps: { a: { on: t, run: "true" } }\n'
  const d = parseDesignFile('/x/design/runner-example.workflow.yaml', text)
  assert.equal(d.kind, 'workflow')
  assert.equal(d.key, 'runner-example-workflow')
  assert.equal(d.title, 'issue-triage')
  const plain = parseDesignFile('/x/design/triage.yaml', text)
  assert.equal(plain.kind, 'workflow', 'top-level steps: is enough')
  assert.equal(plain.key, 'triage-workflow')
})

test('lintDesign runs the workflow linter on workflow files', async () => {
  const { lintDesign } = await import('../src/design.js')
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../design/runner-example.workflow.yaml')
  const d = parseDesignFile(file, fs.readFileSync(file, 'utf8'))
  assert.deepEqual(lintDesign(d, file).filter((f) => f.severity === 'error'), [])
})

// ── river0825/unprose#6 #8 #9 ────────────────────────────────────────────────

test('#9: kanban (and every kind with a schema) is linted offline', async () => {
  const { lintDesign, parseDesignFile } = await import('../src/design.js')
  const ok = parseDesignFile('/r/design/work.kanban.yaml', 'columns:\n  - { name: Backlog }\ncards:\n  - { title: A, column: Backlog }\n')
  assert.deepEqual(lintDesign(ok), [])
  const bad = parseDesignFile('/r/design/work.kanban.yaml', 'columns: []\ncards:\n  - { column: Backlog }\n')
  const errors = lintDesign(bad).filter((f) => f.severity === 'error').map((f) => f.message)
  assert.ok(errors.some((m) => m.startsWith('columns:')), errors.join(' | '))
  assert.ok(errors.some((m) => m.startsWith('cards[0].title:')), errors.join(' | '))
  assert.ok(!lintDesign(ok).some((f) => /no offline check/.test(f.message)))
})

test('#9: an unquoted # inside [ ] gets a hint instead of only a caret', async () => {
  const { parseDesignFile, yamlCommentHint } = await import('../src/design.js')
  const text = 'columns:\n  - { name: Backlog }\ncards:\n  - title: Fix\n    column: Backlog\n    labels: [PR #1113, issue #1112]\n'
  assert.throws(() => parseDesignFile('/r/design/w.kanban.yaml', text), /line 6 has an unquoted "#" inside \[ … \].*Quote values containing #/s)
  assert.equal(yamlCommentHint('labels: ["PR #1113", "issue #1112"]\n'), undefined, 'quoted values are fine')
})

test('#8: fields the schema does not know are warnings, not silence', async () => {
  const { lintDesign, parseDesignFile } = await import('../src/design.js')
  const d = parseDesignFile('/r/design/w.kanban.yaml', 'columns:\n  - { name: A }\ncards:\n  - { title: x, column: A }\n  - { title: y, column: A, link: "https://x" }\n')
  const w = lintDesign(d).filter((f) => f.severity === 'warning').map((f) => f.message)
  assert.deepEqual(w, ['unknown field `link` at cards[1] — it is not part of kanban and will be ignored'])
})

test('#6: a draw lists the traces it could not draw', async () => {
  const { unresolvedReport } = await import('../src/design.js')
  assert.deepEqual(unresolvedReport([]), [])
  assert.deepEqual(unresolvedReport([{ item: 'kb.card.c', trace: { from: 'old/x', rel: 'groups' }, reason: 'not-found' }]), [
    '⚠ 1 trace(s) not drawn:',
    '  kb.card.c —groups→ old/x: target not found on the board',
  ])
})
