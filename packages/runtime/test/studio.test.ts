// awd studio: chat requests on a project's boards → one Claude session per board in herdr,
// a fork of it for a chat that arrives while it is busy (docs/diagrams.md §8, docs/studio.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Studio, FakeCanvas, FakeCanvasBoard, FakeAgentChannel, MemoryStudioStore, discussRequests, sessionName, renderBrief, promptFor, boardScope, boardSessionName, forkSessionName, inProject } from '../src/index.js'
import { describeProposal, proposalOf, editOf } from '../src/application/studio.js'

const ROOT = '/repo'

function board(id = 'b1', meta: Record<string, unknown> = { workflow: { file: `${ROOT}/dev/workflow.yaml` } }) {
  return new FakeCanvasBoard({
    id,
    title: 'awd-dev — workflow.yaml',
    kind: 'workflow',
    seq: 10,
    meta,
    items: {
      'wf.node.plan': { id: 'wf.node.plan', type: 'card', role: 'ai', text: 'plan', data: { nodeId: 'plan', kind: 'ai', config: {}, detail: { kind: 'ai', agent: 'planner', source: { workflow: 'dev/workflow.yaml', line: 40 }, file: 'dev/agents/planner.md' } } },
      'wf.agent.planner': { id: 'wf.agent.planner', type: 'card', role: 'agent', text: '@planner', data: { agent: 'planner' } },
      'note': { id: 'note', type: 'sticky', text: 'just a sticky' },
    },
  })
}

type Opts = { maxSessions?: number; idleCloseMs?: number; warm?: boolean; rescanEvery?: number }

function setup(canvas: FakeCanvasBoard | FakeCanvas = board(), channel = new FakeAgentChannel(), store = new MemoryStudioStore(), opts: Opts = {}) {
  const one = canvas as FakeCanvasBoard // most tests use one board
  const lines: string[] = []
  const clock = { t: 1_000_000 }
  let n = 0
  const studio = new Studio({
    canvas, channel, store, project: ROOT, projectName: 'awd', canvasUrl: 'http://localhost:4400',
    sleep: async () => {}, now: () => clock.t, newSessionId: () => `sid-${++n}`, log: (l) => lines.push(l), ...opts,
  })
  /** Let time pass: past the after-prompt grace, or the idle-close limit. */
  const later = (ms = 60_000) => { clock.t += ms }
  return { canvas: one, channel, store, studio, lines, later }
}

const SCOPE = boardScope({ id: 'b1', title: 'awd-dev — workflow.yaml' })
const MAIN = boardSessionName(SCOPE)
const agentComments = (c: FakeCanvasBoard) => Object.values(c.snapshot.items).filter((i) => i.type === 'comment' && i.createdBy === 'agent')
const starts = (ch: FakeAgentChannel) => ch.calls.filter((c) => c[0] === 'start')

test('names: a board scope is short and stable; board, generation and fork sessions fit herdr (≤ 32)', () => {
  assert.match(SCOPE, /^awd-dev-work-[0-9a-z]{4}$/)
  assert.equal(boardScope({ id: 'b1', title: 'awd-dev — workflow.yaml' }), SCOPE)
  for (const n of [MAIN, boardSessionName(SCOPE, 12), forkSessionName(SCOPE, 99)]) assert.ok(n.length <= 32, n)
  assert.equal(inProject({ project: { root: '/repo' } }, '/repo'), true)
  assert.equal(inProject({ workflow: { file: '/repo/dev/workflow.yaml' } }, '/repo/'), true)
  assert.equal(inProject({ workflow: { file: '/repository/x.yaml' } }, '/repo'), false, 'a sibling folder with the same prefix is not inside')
  assert.equal(inProject({ workflow: { file: 'dev/workflow.yaml' } }, '/repo'), false, 'relative paths never match')
  assert.equal(inProject(undefined, '/repo'), false)
})

test('a new request opens the board session in the project tab, and prompts it once', async () => {
  const { canvas, channel, store, studio } = setup()
  await studio.tick() // the first look: the board joins at its current seq
  const req = canvas.userComment('wf.node.plan', 'Why does the planner need Opus?', { discuss: { model: 'sonnet' } })
  const done = await studio.tick()
  assert.deepEqual(done.map((d) => d.action), ['opened'])
  assert.deepEqual(channel.calls.find((c) => c[0] === 'openTab'), ['openTab', ROOT, 'studio: awd'], 'one tab per project')
  assert.deepEqual(starts(channel)[0], ['start', MAIN, 'claude', 'fake:p1', '--model', 'sonnet', '--permission-mode', 'auto', '--session-id', 'sid-1', '-n', SCOPE])
  const prompts = channel.calls.filter((c) => c[0] === 'prompt')
  assert.equal(prompts.length, 1)
  assert.ok(!prompts[0][2].includes('\n'), 'the prompt is one line')
  assert.ok(prompts[0][2].includes(`.awd/studio/${SCOPE}/plan.md`))
  const brief = store.briefs.get(`${SCOPE}/plan`)!
  assert.match(brief, /Why does the planner need Opus\?/)
  assert.match(brief, /Workflow: `dev\/workflow\.yaml`/, 'the workflow file comes from board meta, relative to the project')
  assert.match(brief, /the board's own conversation/)
  assert.match(brief, new RegExp(`target: "${req}"`))
  const acks = agentComments(canvas as FakeCanvasBoard)
  assert.equal(acks.length, 1)
  assert.equal(acks[0].target, req, 'the ack replies under the request')
  assert.match(acks[0].text!, /Opened Claude \(sonnet\) for this board in pane 1 of herdr tab "studio: awd"/)
  assert.deepEqual(store.status, { project: ROOT, boards: 1, open: 1, max: 3, queued: 0, updatedAt: store.status!.updatedAt })
})

test('another chat on the same board goes to the same board session', async () => {
  const { canvas, channel, studio, later } = setup()
  const b = canvas as FakeCanvasBoard
  await studio.tick()
  b.userComment('wf.node.plan', 'first', { discuss: { model: 'opus' } })
  await studio.tick()
  later()
  b.userComment('note', 'something else on this board', { discuss: { model: 'opus' } })
  const done = await studio.tick()
  assert.deepEqual(done.map((d) => d.action), ['prompted'])
  assert.equal(starts(channel).length, 1, 'no second claude')
  assert.equal(channel.calls.filter((c) => c[0] === 'prompt').length, 2)
  assert.match(agentComments(b).at(-1)!.text!, /Sent to this board's Claude session \(pane 1/)
})

test('a chat that arrives while the board session is busy runs in a fork of it; its follow-ups stay in the fork', async () => {
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'working' })
  const { canvas, studio, later } = setup(board(), channel, new MemoryStudioStore(), { idleCloseMs: 5 * 60_000 })
  const b = canvas as FakeCanvasBoard
  await studio.tick()
  b.userComment('wf.node.plan', 'first', { discuss: {} })
  await studio.tick()
  const second = b.userComment('note', 'meanwhile, this', { discuss: { model: 'sonnet' } })
  const done = await studio.tick()
  assert.deepEqual(done.map((d) => d.action), ['forked'])
  const fork = forkSessionName(SCOPE, 1)
  assert.deepEqual(starts(channel)[1], ['start', fork, 'claude', 'fake:p2', '--model', 'sonnet', '--permission-mode', 'auto', '--resume', 'sid-1', '--fork-session', '--session-id', 'sid-2', '-n', `${SCOPE} · fork`])
  assert.deepEqual(channel.calls.find((c) => c[0] === 'splitPane'), ['splitPane', 'fake:p1', ROOT], 'the fork is a pane in the same tab')
  assert.match(agentComments(b).at(-1)!.text!, /runs in a fork of it/)

  // the fork goes idle and its pane closes; a reply in its chat resumes the fork, not the board session
  channel.setState(fork, 'idle')
  later(10 * 60_000)
  await studio.tick()
  assert.ok(channel.calls.some((c) => c[0] === 'closePane' && c[1] === 'fake:p2'))
  b.userComment(second, 'and one more thing')
  const [again] = await studio.tick()
  assert.equal(again.action, 'resumed')
  assert.deepEqual(starts(channel).at(-1)!.slice(0, 2), ['start', fork])
  assert.ok(starts(channel).at(-1)!.includes('sid-2') && !starts(channel).at(-1)!.includes('--fork-session'), 'resumes the fork by its own id')
})

test('panes are shared by every board of the project: a full tab queues the next board until one frees', async () => {
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'working' })
  const a = board('b1')
  const b2 = board('b2', { project: { root: ROOT } })
  const { studio, later } = setup(new FakeCanvas(a, b2), channel, new MemoryStudioStore(), { maxSessions: 1 })
  await studio.tick()
  assert.deepEqual(studio.watching.sort(), ['b1', 'b2'])
  a.userComment('wf.node.plan', 'on board one', { discuss: {} })
  await studio.tick()
  const waiting = b2.userComment('note', 'on board two', { discuss: {} })
  assert.deepEqual((await studio.tick()).map((d) => d.action), ['queued'], 'the only pane is working: board two waits')
  assert.equal((b2.snapshot.items[waiting].data!.agentState as { state: string }).state, 'queued')
  channel.setState(MAIN, 'idle')
  later()
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  assert.equal(d.board, 'b2')
  assert.ok(channel.calls.some((c) => c[0] === 'closePane' && c[1] === 'fake:p1'), 'board one\'s idle pane made room')
  assert.equal(starts(channel).at(-1)![1], boardSessionName(boardScope({ id: 'b2', title: 'awd-dev — workflow.yaml' })))
})

test('only boards in the project are watched; one that joins the project later is picked up', async () => {
  const outside = board('bx', { workflow: { file: '/elsewhere/workflow.yaml' } })
  const canvas = new FakeCanvas(board('b1'), outside)
  const { studio } = setup(canvas, new FakeAgentChannel(), new MemoryStudioStore(), { rescanEvery: 1 })
  await studio.tick()
  assert.deepEqual(studio.watching, ['b1'])
  outside.snapshot.meta = { project: { root: ROOT } }
  await studio.tick()
  assert.deepEqual(studio.watching.sort(), ['b1', 'bx'])
})

test('"new session" retires the board session: the next chat starts fresh, old chats keep theirs', async () => {
  const { canvas, channel, studio, later } = setup()
  const b = canvas as FakeCanvasBoard
  b.snapshot.meta = { ...b.snapshot.meta, studio: { newSessionAt: 'old' } }
  await studio.tick()
  const first = b.userComment('wf.node.plan', 'first', { discuss: {} })
  await studio.tick()
  assert.equal(starts(channel).length, 1, 'a stamp from before studio ran is not a request')
  later()
  b.snapshot.meta = { ...b.snapshot.meta, studio: { newSessionAt: 'now' } }
  b.userComment('note', 'start over', { discuss: {} })
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  assert.deepEqual(starts(channel)[1].slice(0, 2), ['start', boardSessionName(SCOPE, 1)])
  assert.ok(starts(channel)[1].includes('sid-2') && starts(channel)[1].includes('--session-id'))
  // a reply in the first chat still belongs to the retired session; studio hands it over when it is idle
  b.userComment(first, 'about the first thing')
  later()
  const [r] = await studio.tick()
  assert.equal(r.action, 'prompted')
  assert.equal(channel.calls.filter((c) => c[0] === 'prompt').at(-1)![1], boardSessionName(SCOPE, 0))
})

test('--warm primes a board session with its design sources before any chat', async () => {
  const meta = { workflow: { file: `${ROOT}/dev/workflow.yaml` }, diagrams: { 'studio-es': { source: 'design/studio.es.yaml' } } }
  const { canvas, channel, studio, later } = setup(board('b1', meta), new FakeAgentChannel(), new MemoryStudioStore(), { warm: true })
  const [w] = await studio.tick()
  assert.equal(w.action, 'warmed')
  const prompt = channel.calls.find((c) => c[0] === 'prompt')![2]
  assert.match(prompt, /dev\/workflow\.yaml, design\/studio\.es\.yaml/)
  assert.ok(!prompt.includes('\n'))
  later()
  ;canvas.userComment('wf.node.plan', 'go', { discuss: {} })
  assert.deepEqual((await studio.tick()).map((d) => d.action), ['prompted'], 'the chat goes to the warmed session')
  assert.equal(starts(channel).length, 1)
})

test('after a restart, requests already handled are not reopened; another project\'s state is ignored', async () => {
  const canvas = board()
  const store = new MemoryStudioStore()
  const first = setup(canvas, new FakeAgentChannel(), store)
  await first.studio.tick()
  canvas.userComment('wf.node.plan', 'once', { discuss: {} })
  await first.studio.tick()
  const again = setup(canvas, new FakeAgentChannel(), store)
  assert.deepEqual(await again.studio.tick(), [])
  assert.equal(again.channel.calls.filter((c) => c[0] === 'openTab').length, 0)
  store.state = { ...store.state!, project: '/other' }
  const other = setup(canvas, new FakeAgentChannel(), store)
  await other.studio.tick()
  assert.equal(store.state!.project, ROOT)
})

test('a first run starts at the board, not its history', async () => {
  const canvas = board()
  canvas.userComment('wf.node.plan', 'from before studio ran', { discuss: {} })
  const { studio, channel } = setup(canvas)
  assert.deepEqual(await studio.tick(), [])
  assert.equal(channel.calls.length, 0)
})

test('plain comments are chats too; agent comments never; unknown models fall back', async () => {
  const b = board()
  b.userComment('wf.node.plan', 'just a remark') // no data.discuss: still a chat, with the default model
  await b.add('b1', [{ type: 'comment', target: 'wf.node.plan', text: 'agent speaking', data: { discuss: {} } }])
  b.userComment('wf.agent.planner', 'sharpen', { discuss: { model: 'gpt-9; rm -rf /' } })
  const snap = await b.board()
  const reqs = discussRequests(snap, (await b.changes('b1', 0)).changes, 0, 'sonnet')
  assert.equal(reqs.length, 2)
  assert.deepEqual([reqs[0].block, reqs[0].text, reqs[0].model], ['plan', 'just a remark', 'sonnet'])
  assert.equal(reqs[1].block, '@planner')
  assert.equal(reqs[1].kind, 'agent')
  assert.equal(reqs[1].model, 'sonnet', 'an unknown model falls back to the default, never passes through')
  assert.equal(sessionName('@planner'), 'awd-studio-agent-planner')
})

// ── diagrams: the frame an item is in, and its traces (docs/diagrams.md §8) ──

test('the brief names the diagram the selection is in, its grammar and source, and the traces to other diagrams', async () => {
  const b = new FakeCanvasBoard({
    id: 'd1', title: 'studio design', kind: 'freeform', seq: 1, meta: { project: { root: ROOT } },
    items: {
      'es': { id: 'es', type: 'frame', text: 'EventStorming', data: { diagram: { kind: 'event-storming', key: 'studio-es', source: 'design/studio.es.yaml', level: 'process' } } },
      'studio-es.command.ask': { id: 'studio-es.command.ask', type: 'sticky', role: 'command', text: 'Ask AI', parent: 'es' },
      'usm': { id: 'usm', type: 'frame', text: 'Story map', data: { diagram: { kind: 'user-story-map', key: 'studio-usm', source: 'design/studio.story-map.yaml' } } },
      'studio-usm.story.ask': { id: 'studio-usm.story.ask', type: 'card', role: 'story', text: 'As a person I ask the AI about a block', parent: 'usm' },
      't1': { id: 't1', type: 'arrow', role: 'trace', from: 'studio-usm.story.ask', to: 'studio-es.command.ask', label: '來自' },
    },
  })
  const { store, studio } = setup(b)
  await studio.tick()
  b.userComment('studio-es.command.ask', 'is this the right command?', { discuss: {} })
  await studio.tick()
  const brief = [...store.briefs.values()][0]
  assert.match(brief, /## Diagram\n\n- `studio-es` — event-storming \(process\) · source `design\/studio\.es\.yaml`/)
  assert.match(brief, /a system between a command and an event/)
  assert.match(brief, /## Traced to \/ from other diagrams\n\n- As a person I ask the AI about a block \(in `studio-usm`\) —來自→ Ask AI \(in `studio-es`\)/)
  assert.match(brief, /awd design draw design\/studio\.es\.yaml --board d1/)
  assert.ok(!brief.includes('Workflow:'), 'no workflow line on a board that is not drawn from one')
})

test('the brief works without a detail snapshot, and the prompt stays one line', () => {
  const snap = { id: 'b1', title: 't', seq: 1, items: { s: { id: 's', type: 'card', data: { nodeId: 'card-info', kind: 'script', config: { run: 'bash scripts/card_info.sh' } } } } }
  const req = { seq: 1, commentId: 'u1', blockItemId: 's', block: 'card-info', kind: 'script', text: 'line one\nline two', model: 'opus' as const, about: [{ itemId: 's', block: 'card-info', kind: 'script', text: '' }], session: 'awd-studio-card-info' }
  const brief = renderBrief({ req, board: snap, workflow: 'dev/workflow.yaml', canvasUrl: 'http://x' })
  assert.match(brief, /No `detail`/)
  assert.match(brief, /scripts\/card_info\.sh/)
  assert.match(brief, /> line two/)
  assert.ok(!promptFor(req, '/r/.awd/studio/card-info.md').includes('\n'))
})

// ── §2b: chat with the selection ────────────────────────────────────────

function selectionBoard() {
  const b = board()
  const items = b.snapshot.items
  items['wf.node.move-planned'] = { id: 'wf.node.move-planned', type: 'card', role: 'script', text: 'move-planned', data: { nodeId: 'move-planned', kind: 'script', detail: { kind: 'script', run: 'bash scripts/board_move.sh', file: 'dev/scripts/board_move.sh', code: 'SECRET-LONG-CODE', source: { workflow: 'dev/workflow.yaml', line: 58 } } } }
  items['wf.arrow.plan-move'] = { id: 'wf.arrow.plan-move', type: 'arrow', from: 'wf.node.plan', to: 'wf.node.move-planned', text: 'ready' }
  items['wf.arrow.elsewhere'] = { id: 'wf.arrow.elsewhere', type: 'arrow', from: 'wf.node.plan', to: 'wf.node.other' }
  return b
}

test('a multi-select chat gets a selection session, and its brief lists every item and the arrows between them', async () => {
  const { canvas, channel, store, studio } = setup(selectionBoard())
  await studio.tick()
  const root = canvas.userComment('wf.node.plan', 'Do these three fit together?', { discuss: { model: 'opus', about: ['wf.node.plan', 'wf.node.move-planned', 'note'] } })
  const done = await studio.tick()
  assert.deepEqual(done.map((d) => d.action), ['opened'])
  const req = done[0].req
  assert.match(req.session, /^awd-studio-sel-[0-9a-z]{6}$/)
  assert.equal(req.block, 'plan +2')
  assert.deepEqual(req.about.map((a) => a.itemId), ['wf.node.plan', 'wf.node.move-planned', 'note'])
  assert.deepEqual(channel.calls.find((c) => c[0] === 'openTab'), ['openTab', ROOT, 'studio: awd'])
  assert.deepEqual(channel.calls.find((c) => c[0] === 'start')!.slice(-2), ['-n', SCOPE], 'the session is the board\'s, whatever the selection')
  const brief = store.briefs.get(`${SCOPE}/${req.key}`)!
  assert.match(brief, /3 selected items/)
  assert.match(brief, /`plan`/)
  assert.match(brief, /`move-planned`/)
  assert.match(brief, /just a sticky/)
  assert.match(brief, /- plan → move-planned \(ready\)/)
  assert.ok(!brief.includes('wf.node.other'), 'arrows leaving the selection are not listed')
  assert.ok(!brief.includes('SECRET-LONG-CODE'), 'script code is left for the session to read')
  assert.match(brief, /dev\/scripts\/board_move\.sh/)
  assert.match(brief, new RegExp(`target: "${root}"`))
  assert.ok(!channel.calls.filter((c) => c[0] === 'prompt')[0][2].includes('\n'))
})

test('the same selection in another order reuses its session', async () => {
  const { canvas, channel, studio, later } = setup(selectionBoard())
  await studio.tick()
  canvas.userComment('wf.node.plan', 'first', { discuss: { about: ['wf.node.plan', 'note'] } })
  const [a] = await studio.tick()
  later()
  canvas.userComment('note', 'again', { discuss: { about: ['note', 'wf.node.plan'] } })
  const [b] = await studio.tick()
  assert.equal(a.req.session, b.req.session)
  assert.equal(b.action, 'prompted')
  assert.equal(channel.calls.filter((c) => c[0] === 'openTab').length, 1)
})

test('a sticky on its own can be chatted with', async () => {
  const { canvas, channel, store, studio } = setup()
  await studio.tick()
  canvas.userComment('note', 'what should this become?', { discuss: {} })
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  assert.equal(d.req.session, 'awd-studio-just-a-sticky')
  assert.equal(d.req.kind, 'sticky')
  assert.deepEqual(channel.calls.find((c) => c[0] === 'openTab'), ['openTab', ROOT, 'studio: awd'])
  assert.match(store.briefs.get(`${SCOPE}/just-a-sticky`)!, /Text: just a sticky/)
  assert.match(channel.calls.find((c) => c[0] === 'prompt')![2], /board item "just-a-sticky" \(sticky\)/)
})

test('selection ids that are gone (or are comments) are dropped; none left means the anchor alone', async () => {
  const b = selectionBoard()
  b.userComment('wf.node.plan', 'x', { discuss: { about: ['wf.node.plan', 'gone', 'wf.node.move-planned'] } })
  const c1 = b.userComment('wf.node.plan', 'y', { discuss: { about: ['gone'] } })
  b.userComment('wf.node.plan', 'z', { discuss: { about: ['wf.node.plan', c1] } })
  const reqs = discussRequests(await b.board(), (await b.changes('b1', 0)).changes, 0)
  assert.deepEqual(reqs.map((r) => r.about.map((a) => a.itemId)), [['wf.node.plan', 'wf.node.move-planned'], ['wf.node.plan'], ['wf.node.plan']])
  assert.equal(reqs[1].key, 'plan', 'a one-item chat is keyed by its block (its brief file name)')
})

// ── §5: line comments ───────────────────────────────────────────────────

test('an anchored request carries its anchor, and the brief quotes it first', async () => {
  const { canvas, store, studio } = setup()
  await studio.tick()
  canvas.userComment('wf.node.plan', 'Too vague?', { anchor: { file: 'dev/agents/planner.md', line: 12, endLine: 14, quote: 'Keep to the card; do not widen it.' }, discuss: { model: 'opus', about: ['wf.node.plan'] } })
  const [{ req }] = await studio.tick()
  assert.deepEqual(req.anchor, { file: 'dev/agents/planner.md', line: 12, endLine: 14, quote: 'Keep to the card; do not widen it.' })
  const brief = store.briefs.get(`${SCOPE}/plan`)!
  assert.match(brief, /## Look here\n\n`dev\/agents\/planner\.md:12–14`/)
  assert.ok(brief.indexOf('## Look here') < brief.indexOf('## The item'))
  assert.match(brief, /Keep to the card; do not widen it\./)
})

test('the brief lists open line notes on the files behind the selection, not answered or unrelated ones', async () => {
  const canvas = board()
  canvas.snapshot.items['wf.node.plan'].data!.detail = { ...(canvas.snapshot.items['wf.node.plan'].data!.detail as object), yaml: { start: 40, end: 60 } }
  const { store, studio } = setup(canvas)
  // notes left before studio ran are history, not chats: they are the open notes a brief lists
  const open = canvas.userComment('wf.node.other', 'persona line is odd', { anchor: { file: 'dev/agents/planner.md', line: 3, quote: 'You are the planner' } })
  const inRange = canvas.userComment('wf.title', 'timeout too short', { anchor: { file: 'dev/workflow.yaml', line: 60, quote: 'timeout: 1h' } })
  const outOfRange = canvas.userComment('wf.title', 'about another step', { anchor: { file: 'dev/workflow.yaml', line: 90, quote: 'x' } })
  const answered = canvas.userComment('wf.node.plan', 'answered already', { anchor: { doc: 'prompt', line: 2, quote: 'y' } })
  await canvas.add('b1', [{ type: 'comment', target: answered, text: 'done' }])
  const onPrompt = canvas.userComment('wf.node.plan', 'prompt wording', { anchor: { doc: 'prompt', line: 5, quote: '## Output' } })
  await studio.tick()
  canvas.userComment('wf.node.plan', 'go', { discuss: {} })
  await studio.tick()
  const brief = store.briefs.get(`${SCOPE}/plan`)!
  const notes = brief.slice(brief.indexOf('## Open notes'))
  assert.match(notes, new RegExp(`\`${open}\` · dev/agents/planner\\.md:3`))
  assert.match(notes, new RegExp(`\`${inRange}\` · dev/workflow\\.yaml:60`))
  assert.match(notes, new RegExp(`\`${onPrompt}\` · prompt of plan:5`))
  assert.ok(!notes.includes(outOfRange) && !notes.includes(answered))
})

// ── §6: receipts on the chat root ───────────────────────────────────────

const stateOf = (c: FakeCanvasBoard, id: string) => (c.snapshot.items[id].data?.agentState as { state: string } | undefined)?.state

test('pickup marks the request seen and starting, then working; anchor and discuss survive', async () => {
  const { canvas, studio } = setup(board(), new FakeAgentChannel({ stateAfterPrompt: 'working' }))
  await studio.tick()
  const root = canvas.userComment('wf.node.plan', 'go', { discuss: { model: 'opus' }, anchor: { doc: 'prompt', line: 1, quote: 'q' } })
  await studio.tick()
  const states = canvas.log.flatMap((c) => c.ops).filter((o) => o.kind === 'update' && o.id === root).map((o) => (o.patch!.data!.agentState as { state: string }).state)
  assert.deepEqual(states, ['starting', 'working'])
  const data = canvas.snapshot.items[root].data!
  assert.deepEqual(data.seenBy, ['agent'])
  assert.deepEqual(data.discuss, { model: 'opus' })
  assert.deepEqual(data.anchor, { doc: 'prompt', line: 1, quote: 'q' })
  assert.deepEqual([(data.agentState as { tab: string }).tab, (data.agentState as { pane: number }).pane], ['studio: awd', 1])
})

test('later ticks mirror the session: idle, blocked; nothing is written when it did not change', async () => {
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'working' })
  const { canvas, studio, later } = setup(board(), channel)
  await studio.tick()
  const root = canvas.userComment('wf.node.plan', 'go', { discuss: {} })
  await studio.tick()
  assert.equal(stateOf(canvas, root), 'working')
  const seq = canvas.snapshot.seq
  await studio.tick()
  assert.equal(canvas.snapshot.seq, seq, 'unchanged → no op')

  channel.setState(MAIN, 'done')
  await studio.tick()
  assert.equal(stateOf(canvas, root), 'working', 'within the grace after a prompt, idle is not shown yet')
  later()
  await studio.tick()
  assert.equal(stateOf(canvas, root), 'idle')
  channel.setState(MAIN, 'blocked')
  await studio.tick()
  assert.equal(stateOf(canvas, root), 'blocked')
  const again = canvas.snapshot.seq
  await studio.tick()
  assert.equal(canvas.snapshot.seq, again)
})

// ── §7: a wire edited on the board, then handed to the AI to review ──

function wireBoard() {
  const b = board()
  const snap = b.snapshot
  snap.items['wf.node.card-info'] = { id: 'wf.node.card-info', type: 'card', role: 'script', text: 'card-info', data: { nodeId: 'card-info', detail: { kind: 'script', emits: ['card-info.done', 'card-info.failed'] } } }
  snap.items['wf.node.review'] = { id: 'wf.node.review', type: 'card', role: 'ai', text: 'review', data: { nodeId: 'review', detail: { kind: 'ai', emits: ['review.approved', 'review.changes'] } } }
  snap.items['wf.arrow.w1'] = {
    id: 'wf.arrow.w1', type: 'arrow', role: 'flow', from: 'wf.node.review', to: 'wf.node.plan', text: 'card-info.done',
    data: { event: { event: 'card-info.done', from: 'card-info', to: 'plan' }, pending: { kind: 'rewire', before: { from: 'card-info', to: 'plan', event: 'card-info.done' }, after: { from: 'review', to: 'plan' }, by: 'user', at: 't' } },
  }
  return b
}

test('a wire proposal leads the brief, in words and as the yaml edit, and asks for review before editing', async () => {
  const { canvas, store, studio } = setup(wireBoard())
  await studio.tick()
  const pending = (canvas.snapshot.items['wf.arrow.w1'].data as { pending: unknown }).pending
  canvas.userComment('wf.arrow.w1', 'Should plan wait for review instead?', { discuss: { model: 'opus', about: ['wf.arrow.w1', 'wf.node.review', 'wf.node.plan', 'wf.node.card-info'], proposal: pending } })
  const [{ req }] = await studio.tick()
  assert.deepEqual(req.proposal, { kind: 'rewire', before: { from: 'card-info', to: 'plan', event: 'card-info.done' }, after: { from: 'review', to: 'plan' } })
  const brief = [...store.briefs.values()][0]
  assert.ok(brief.indexOf('## Proposed wire change') < brief.indexOf('## The request'), 'the proposal comes first')
  assert.match(brief, /`plan` would run on an event of `review` \(not picked yet — it emits `review\.approved`, `review\.changes`\) from `review` instead of `card-info\.done` from `card-info`/)
  assert.match(brief, /Yaml intent: in `plan\.on`, replace `card-info\.done` with an event of `review`/)
  assert.match(brief, /\*\*before\*\* editing/)
  assert.match(brief, /redraw clears the proposal/)
})

test('describeProposal: remove, add, relabel, a moved target, and a human resume_on', () => {
  assert.deepEqual(describeProposal({ kind: 'remove', before: { from: 'a', to: 'b', event: 'a.done' } })[1], 'Yaml intent: remove `a.done` from `b.on`.')
  assert.deepEqual(describeProposal({ kind: 'add', after: { from: 'a', to: 'c', event: 'a.skip', condition: 'x > 1' } })[1], 'Yaml intent: add `a.skip` if `x > 1` to `c.on`.')
  assert.deepEqual(describeProposal({ kind: 'relabel', before: { from: 'a', to: 'b', event: 'a.done' }, after: { from: 'a', to: 'b', condition: 'ok' } })[1], 'Yaml intent: in `b.on`, replace `a.done` with `a.done` if `ok`.')
  assert.deepEqual(describeProposal({ kind: 'rewire', before: { from: 'a', to: 'b', event: 'a.done' }, after: { from: 'a', to: 'c' } }), [
    '`c` would run on `a.done` instead of `b`.',
    'Yaml intent: remove `a.done` from `b.on` and add `a.done` to `c.on`.',
  ])
  assert.match(describeProposal({ kind: 'remove', before: { from: 'a', to: 'gate', event: 'card.moved' } }, { resume: true })[1], /`gate\.human\.resume_on`/)
})

test('a malformed proposal is ignored; wf.node. prefixes are normalised', () => {
  assert.equal(proposalOf({ proposal: { kind: 'rewire', before: { from: 'a', to: 'b' } } }), undefined, 'rewire needs before and after')
  assert.equal(proposalOf({ proposal: { kind: 'explode' } }), undefined)
  assert.deepEqual(proposalOf({ proposal: { kind: 'add', after: { from: 'wf.node.a', to: 'wf.node.b', event: '' } } }), { kind: 'add', after: { from: 'a', to: 'b' } })
})

// ── §9: an edit made in the source dialog ──────────────────────────────

test('a source-dialog edit is read from discuss.edit and shown first in the brief as a diff to review', () => {
  assert.equal(editOf({ edit: { file: 'x', diff: '   ' } }), undefined)
  assert.equal(editOf({ edit: { file: 'x' } }), undefined)
  const edit = editOf({ edit: { file: 'dev/scripts/card_info.sh', base: 'abc123', diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n' } })!
  assert.equal(edit.file, 'dev/scripts/card_info.sh')
  const snap = { id: 'b1', title: 't', seq: 1, items: { s: { id: 's', type: 'card', data: { nodeId: 'card-info', kind: 'script' } } } }
  const req = { seq: 1, commentId: 'u1', blockItemId: 's', block: 'card-info', kind: 'script', text: 'please apply', model: 'opus' as const, about: [{ itemId: 's', block: 'card-info', kind: 'script', text: '' }], session: 'awd-studio-card-info', edit }
  const brief = renderBrief({ req, board: snap, workflow: 'dev/workflow.yaml', canvasUrl: 'http://x' })
  assert.ok(brief.indexOf('## Proposed edit') < brief.indexOf('## The request'))
  assert.match(brief, /```diff\n--- a\n\+\+\+ b[\s\S]*\+new\n```/)
  assert.match(brief, /abc123/)
  assert.match(brief, /\*\*before\*\* applying/)
})

// ── every comment reaches the agent while studio runs (docs/studio.md §2) ──

const prompts = (ch: FakeAgentChannel) => ch.calls.filter((c) => c[0] === 'prompt')

test('a plain root comment opens the board session and is prompted, with seen + a receipt', async () => {
  const { canvas, channel, studio } = setup(board(), new FakeAgentChannel({ stateAfterPrompt: 'working' }))
  await studio.tick()
  const c = canvas.userComment('wf.node.plan', 'what is this ?')
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  assert.equal(starts(channel).length, 1)
  assert.equal(prompts(channel).length, 1)
  const data = canvas.snapshot.items[c].data!
  assert.deepEqual(data.seenBy, ['agent'])
  assert.equal((data.agentState as { state: string }).state, 'working')
})

test('a reply goes to its chat session: prompted when idle, held while busy — never a fork', async () => {
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'working' })
  const { canvas, studio, later } = setup(board(), channel)
  await studio.tick()
  const root = canvas.userComment('wf.node.plan', 'first question')
  await studio.tick()
  const reply = canvas.userComment(root, 'and a follow-up')
  assert.deepEqual(await studio.tick(), [], 'the session is working: the reply waits for it')
  assert.deepEqual(canvas.snapshot.items[reply].data?.seenBy, ['agent'], 'but it is marked read at once')
  assert.equal(starts(channel).length, 1, 'no fork for a follow-up')
  later()
  channel.setState(MAIN, 'idle')
  const [d] = await studio.tick()
  assert.equal(d.action, 'prompted')
  assert.equal(prompts(channel).length, 2)
  assert.equal(prompts(channel)[1][1], MAIN)
  assert.match(prompts(channel)[1][2], /added a message to the chat/)
  assert.equal(starts(channel).length, 1)
})

test('a reply to a reply finds the chat root; a reply on a thread that was never a chat opens one on its root', async () => {
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'idle' })
  const canvas = board()
  const old = canvas.userComment('wf.node.plan', 'a note from before studio ran')
  const { store, studio, later } = setup(canvas, channel)
  await studio.tick()
  const reply = canvas.userComment(old, 'can you look at this now?')
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  assert.equal(d.req!.commentId, old, 'the old thread becomes the chat: replies go under its root')
  assert.equal(d.req!.text, 'can you look at this now?')
  assert.match(store.briefs.get(`${SCOPE}/plan`)!, /## New message in this chat/)
  later()
  canvas.userComment(reply, 'one more')
  const [e] = await studio.tick()
  assert.equal(e.action, 'prompted')
  assert.equal(e.req!.commentId, old)
})

test('empty comments wait for text; a later edit is not a new request; studio acks are not requests', async () => {
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'idle' })
  const { canvas, studio, later } = setup(board(), channel)
  await studio.tick()
  const c = canvas.userComment('wf.node.plan', '')
  assert.deepEqual(await studio.tick(), [])
  // the person types into it: the first seq with text is the request
  const typed = (text: string, before: string) => {
    const seq = ++canvas.snapshot.seq
    const was = { ...canvas.snapshot.items[c], text: before }
    canvas.snapshot.items[c] = { ...canvas.snapshot.items[c], text }
    canvas.log.push({ seq, author: 'user', ops: [{ kind: 'update', id: c, patch: { text } }], before: { [c]: was } } as never)
  }
  typed('now with words', '')
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  later()
  typed('now with better words', 'now with words')
  assert.deepEqual(await studio.tick(), [], 'editing a comment that already had text is not a new request')
  assert.equal(prompts(channel).length, 1, 'and studio never answered its own ack')
})

// ── board chats: a loose comment is about the whole board ────────────────

test('a loose user comment is a board chat; a loose agent comment is not; a reply to it is a follow-up', async () => {
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'working' })
  const { canvas, studio, later } = setup(board(), channel)
  await studio.tick()
  const snap = canvas.snapshot
  const reqs = discussRequests({ ...snap, items: { ...snap.items, loose: { id: 'loose', type: 'comment', text: 'what is this board about?', createdBy: 'user', data: { discuss: { model: 'sonnet', about: [] } } }, bot: { id: 'bot', type: 'comment', text: 'noise', createdBy: 'agent' } } }, [{ seq: snap.seq + 1, author: 'user', ops: [{ kind: 'add', item: { id: 'loose', type: 'comment', text: 'what is this board about?', createdBy: 'user' } }, { kind: 'add', item: { id: 'bot', type: 'comment', text: 'noise', createdBy: 'agent' } }] }], snap.seq)
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].kind, 'board')
  assert.deepEqual(reqs[0].about, [])
  assert.equal(reqs[0].model, 'sonnet')

  const root = canvas.userComment('', 'what is this board about?')
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  assert.match(prompts(channel)[0][2], /whole board/)
  const reply = canvas.userComment(root, 'and what next?')
  later()
  channel.setState(MAIN, 'idle')
  const [f] = await studio.tick()
  assert.equal(f.action, 'prompted')
  assert.deepEqual(canvas.snapshot.items[reply].data?.seenBy, ['agent'])
})

test('the board brief lists every diagram frame with its source and grammar, loose items, and the files behind it', () => {
  const b = {
    id: 'b9', title: 'design', seq: 3, kind: 'freeform',
    meta: { diagrams: { 'studio-es': { source: 'design/studio.es.yaml' } } },
    items: {
      'diagram.studio-es': { id: 'diagram.studio-es', type: 'frame', text: 'Studio · Ask AI', data: { diagram: { kind: 'event-storming', key: 'studio-es', source: 'design/studio.es.yaml', level: 'process' } } },
      'studio-es.event.asked': { id: 'studio-es.event.asked', type: 'sticky', parent: 'diagram.studio-es', text: '提問已送出' },
      note: { id: 'note', type: 'sticky', text: 'a loose idea' },
      q: { id: 'q', type: 'comment', text: 'what next?', createdBy: 'user' },
    },
  }
  const [req] = discussRequests(b, [{ seq: 3, author: 'user', ops: [{ kind: 'add', item: b.items.q }] }], 0)
  const brief = renderBrief({ req, board: b, canvasUrl: 'http://x' })
  assert.match(brief, /# Studio — the whole board/)
  assert.match(brief, /`studio-es` — event-storming \(process\) · "Studio · Ask AI" · source `design\/studio.es.yaml`/)
  assert.match(brief, /EventStorming \(Brandolini\)/)
  assert.match(brief, /a loose idea/)
  assert.match(brief, /- `design\/studio.es.yaml`/)
  assert.match(brief, /target: "q"/)
  assert.doesNotMatch(brief, /## The selection/)
})
