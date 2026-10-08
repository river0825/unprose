// The person's side of a handover of the files (web/src/inspector/handover.ts): what the dialog lists and pre-selects,
// which agent it suggests, the request bodies, how an open handover reads (per diagram, the accept, "Hand over
// anyway"), the holder line after it — and that a finished handover thread folds like an applied proposal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import {
  acceptLine,
  allReady,
  AWAY_MS,
  cancelBody,
  canHandOver,
  checkedKeys,
  defaultTarget,
  forceBody,
  forceQuestion,
  frameNotice,
  handoverOf,
  handoverStamp,
  heldDiagrams,
  holderNames,
  holderWhen,
  initialUnchecked,
  involvedAgents,
  isAgentHere,
  keyText,
  planSentence,
  presenceText,
  startBody,
  statusRows,
  takeable,
  targetsOf,
  unreadyKeys,
  type AgentLike,
} from '../web/src/inspector/handover.js'
import { isSettled } from '../web/src/flow/notesView.js'

const now = Date.now()
const ago = (ms: number) => new Date(now - ms).toISOString()
const H = 3600_000
const item = (id: string, p: Partial<Item> = {}): Item => ({ id, type: 'frame', x: 0, y: 0, w: 400, h: 300, createdBy: 'agent', updatedBy: 'agent', updatedAt: ago(0), ...p })
const frame = (key: string, kind: string, text: string, source: string) => item(`diagram.${key}`, { text, data: { diagram: { kind, key, source } } })

const asis = frame('ds-asis', 'domain-story', '借書與還書 · 現況（as-is）\nsecond line', 'library.domain-story.yaml')
const tobe = frame('ds-tobe', 'domain-story', '借書與還書 · 未來（to-be）', 'library-app.domain-story.yaml')
const map = frame('map', 'user-story-map', '借閱 App · Story map', 'library-app.story-map.yaml')

function board(meta: Record<string, unknown>, ...items: Item[]): Board {
  return { id: 'b', title: 'Library', kind: 'freeform', seq: 1, createdAt: ago(0), updatedAt: ago(0), items: Object.fromEntries([asis, tobe, map, ...items].map((i) => [i.id, i])), meta } as Board
}
const diagrams = (holders: Record<string, Record<string, unknown> | undefined>) => ({
  diagrams: Object.fromEntries(
    [
      ['ds-asis', 'domain-story', 'library.domain-story.yaml'],
      ['ds-tobe', 'domain-story', 'library-app.domain-story.yaml'],
      ['map', 'user-story-map', 'library-app.story-map.yaml'],
    ].map(([key, kind, source]) => [key, { kind, source, ...(holders[key] ? { holder: holders[key] } : {}) }]),
  ),
})

// agent-a drew two of the three diagrams from its meeting notes; agent-b reads the code and is here
const twoByA = board(diagrams({ 'ds-asis': { agent: 'agent-a', at: ago(3 * H) }, map: { agent: 'agent-a', at: ago(1 * H) } }))
const agents: AgentLike[] = [
  { name: 'agent', handle: 'studio', watching: false },
  { name: 'agent-a', handle: 'agent-a', watching: false, seen: ago(20 * 60_000), holder: true },
  { name: 'agent-b', handle: 'agent-b', watching: true },
]

const open = (keys: unknown[], extra: Record<string, unknown> = {}) => ({ handover: { id: 'h1', to: 'agent-b', answeredBy: true, thread: 'c_h1', by: 'river', at: ago(2 * 60_000), keys, ...extra } })

test('handoverOf: the open handover, defensively — malformed ones and keys are dropped', () => {
  const h = handoverOf(open([{ key: 'map', from: 'agent-a', title: 'Map', source: 'm.yaml', ready: { by: 'agent-a', at: ago(0), files: { 'm.yaml': 'abc', bad: 3 } } }, { key: 'ds-asis', from: 'agent-a' }, { key: '', from: 'x' }, { from: 'agent-a' }, 'nope']))
  assert.ok(h)
  assert.equal(h.id, 'h1')
  assert.equal(h.to, 'agent-b')
  assert.equal(h.answeredBy, true)
  assert.equal(h.thread, 'c_h1')
  assert.deepEqual(h.keys.map((k) => k.key), ['map', 'ds-asis'])
  assert.deepEqual(h.keys[0].ready?.files, { 'm.yaml': 'abc' }, 'only file → sha strings')
  assert.equal(h.keys[0].title, 'Map')
  assert.equal(h.keys[1].ready, undefined)
  const forced = handoverOf(open([{ key: 'map', from: 'agent-a', ready: { by: 'river', at: ago(0), files: {}, forced: true } }]))
  assert.equal(forced?.keys[0].ready?.forced, true)
  assert.equal(handoverOf(open([{ key: 'map', from: 'agent-a' }], { answeredBy: undefined }))?.answeredBy, false, 'answeredBy only when true')
  assert.equal(handoverOf(undefined), undefined)
  assert.equal(handoverOf({}), undefined)
  assert.equal(handoverOf({ handover: 'x' }), undefined)
  assert.equal(handoverOf({ handover: { id: 'h', to: 'b', keys: 'map' } }), undefined)
  assert.equal(handoverOf({ handover: { to: 'b', keys: [{ key: 'map', from: 'a' }] } }), undefined, 'no id')
  assert.equal(handoverOf(open([{ key: 'map' }])), undefined, 'no usable key')
})

test('handoverStamp: changes with the handover and with "Answered by" (the panel re-reads its meta then)', () => {
  const a = handoverStamp(open([{ key: 'map', from: 'agent-a' }]))
  assert.notEqual(a, handoverStamp(open([{ key: 'map', from: 'agent-a', ready: { by: 'agent-a', at: ago(0), files: {} } }])))
  assert.notEqual(handoverStamp({}), handoverStamp({ responder: { mode: 'agent', agent: 'agent-b' } }))
  assert.equal(handoverStamp({ diagrams: {} }), handoverStamp({}), 'a redraw alone does not')
})

test('heldDiagrams: each diagram with a holder, titled by its frame, with its kind, file and holder', () => {
  const held = heldDiagrams(twoByA)
  assert.deepEqual(
    held.map((d) => [d.key, d.title, d.kindName, d.source, d.holder.agent, d.frameId]),
    [
      ['ds-asis', '借書與還書 · 現況（as-is）', 'Domain story', 'library.domain-story.yaml', 'agent-a', 'diagram.ds-asis'],
      ['map', '借閱 App · Story map', 'Story map', 'library-app.story-map.yaml', 'agent-a', 'diagram.map'],
    ],
  )
  const wf = heldDiagrams({ title: 'Card pipeline', items: {}, meta: { workflow: { file: 'examples/x/workflow.yaml', holder: { agent: 'agent-a' } } } })
  assert.deepEqual(wf.map((d) => [d.key, d.kindName, d.title, d.source]), [['workflow', 'Workflow', 'Card pipeline', 'examples/x/workflow.yaml']])
  const handed = heldDiagrams(board(diagrams({ map: { agent: 'agent-b', at: ago(0), from: 'agent-a', handover: 'c_h1' } })))
  assert.equal(handed[0].holder.from, 'agent-a', 'from and handover come along although FileHolder does not name them')
  assert.equal(handed[0].holder.handover, 'c_h1')
  assert.equal(holderNames(heldDiagrams(board(diagrams({ map: { agent: 'agent-a' }, 'ds-tobe': { agent: 'agent' }, 'ds-asis': { agent: 'agent-a' } })))), 'agent-a and studio')
})

test('targets: an agent holding every diagram is no target; studio comes last; with nobody else there is nothing to offer', () => {
  const held = heldDiagrams(twoByA)
  assert.deepEqual(targetsOf(held, agents).map((a) => a.name), ['agent-b', 'agent'])
  assert.ok(canHandOver(held, agents))
  assert.ok(!canHandOver(held, [agents[1]]), 'only the holder itself')
  assert.ok(!canHandOver([], agents), 'no holder at all')
  assert.deepEqual(takeable(held, 'agent-b').map((d) => d.key), ['ds-asis', 'map'])
  assert.deepEqual(takeable(held, 'Agent A'), [], 'names compare by handle')
})

test('defaultTarget: the responder if it has something to take, else the first agent that holds nothing', () => {
  const held = heldDiagrams(twoByA)
  assert.equal(defaultTarget(held, agents, 'agent-b'), 'agent-b')
  assert.equal(defaultTarget(held, agents, 'agent-a'), 'agent-b', 'the responder is the only holder')
  assert.equal(defaultTarget(held, agents), 'agent-b', 'named agents before studio')
  assert.equal(defaultTarget(held, agents, 'agent'), 'agent', 'studio when it answers the board')
  // agent-b holds one diagram already, agent-c nothing: agent-c is suggested, unless agent-b answers the board
  const mixed = heldDiagrams(board(diagrams({ 'ds-asis': { agent: 'agent-a' }, map: { agent: 'agent-b' } })))
  const three = [...agents, { name: 'agent-c', watching: false }]
  assert.equal(defaultTarget(mixed, three), 'agent-c')
  assert.equal(defaultTarget(mixed, three, 'agent-b'), 'agent-b')
  assert.equal(defaultTarget(mixed, agents.slice(1)), 'agent-a', 'no free agent: the first that can take something')
  assert.equal(defaultTarget(held, [agents[1]]), undefined)
})

test('pre-selection: every diagram checked; a frame\'s "Hand over…" checks only its own; the target\'s own rows never', () => {
  const held = heldDiagrams(twoByA)
  assert.deepEqual(checkedKeys(held, 'agent-b', initialUnchecked(held)), ['ds-asis', 'map'])
  assert.deepEqual(checkedKeys(held, 'agent-b', initialUnchecked(held, 'map')), ['map'])
  assert.deepEqual(checkedKeys(held, 'agent-b', new Set(['ds-asis'])), ['map'], 'the person unchecked one')
  const mixed = heldDiagrams(board(diagrams({ 'ds-asis': { agent: 'agent-a' }, map: { agent: 'agent-b' } })))
  assert.deepEqual(checkedKeys(mixed, 'agent-b', initialUnchecked(mixed)), ['ds-asis'], 'agent-b holds the map already')
  assert.deepEqual(checkedKeys(mixed, undefined, new Set()), [])
})

test('planSentence: who confirms, who takes them, and nothing changes until then', () => {
  const held = heldDiagrams(twoByA)
  assert.equal(planSentence(held, 'agent-b', false), 'agent-a confirms its files are current, then agent-b takes them; until then nothing changes.')
  assert.equal(planSentence(held, 'agent-b', true), 'agent-a confirms its files are current, then agent-b takes them; until then nothing changes. After that agent-b also answers your comments on this board.')
  const two = heldDiagrams(board(diagrams({ 'ds-asis': { agent: 'agent-a' }, map: { agent: 'agent' } })))
  assert.equal(planSentence(two, 'agent-b', false), 'agent-a and studio confirm their files are current, then agent-b takes them; until then nothing changes.')
  assert.equal(planSentence([], 'agent-b', true), '')
  assert.equal(planSentence(held, undefined, true), '')
})

test('request bodies: always as the person', () => {
  assert.deepEqual(startBody('agent-b', ['ds-asis', 'map'], true), { to: 'agent-b', keys: ['ds-asis', 'map'], answeredBy: true, author: 'user' })
  assert.deepEqual(forceBody(['map']), { force: true, keys: ['map'], author: 'user' })
  assert.deepEqual(cancelBody(), { author: 'user' })
})

test('an open handover: per diagram waiting / ready / ready without the confirmation, then the accept', () => {
  const meta = { ...diagrams({ 'ds-asis': { agent: 'agent-a', at: ago(3 * H) }, map: { agent: 'agent-a', at: ago(1 * H) } }), ...open([{ key: 'ds-asis', from: 'agent-a' }, { key: 'map', from: 'agent-a', ready: { by: 'agent-a', at: ago(60_000), files: { 'library-app.story-map.yaml': 'f00' } } }]) }
  const b = board(meta)
  const h = handoverOf(b.meta)!
  const rows = statusRows(h, b)
  assert.deepEqual(rows.map((r) => [r.key, r.title, r.state, r.text]), [
    ['ds-asis', '借書與還書 · 現況（as-is）', 'waiting', 'waiting for agent-a to confirm'],
    ['map', '借閱 App · Story map', 'ready', 'ready'],
  ])
  assert.equal(rows[1].detail, 'agent-a confirmed 1 file 1 min ago')
  assert.ok(!allReady(h))
  assert.deepEqual(unreadyKeys(h), ['ds-asis'])
  assert.equal(acceptLine(h), 'then waiting for agent-b to accept')
  assert.deepEqual(involvedAgents(h), ['agent-a', 'agent-b'])
  assert.equal(forceQuestion(h, b), "Use the files as the board has them from agent-a's last draw, 3 h ago?")
  assert.equal(frameNotice(h, 'ds-asis'), 'Handing over to agent-b: waiting for agent-a to confirm')
  assert.equal(frameNotice(h, 'ds-tobe'), undefined, 'not part of it')
  assert.equal(frameNotice(undefined, 'map'), undefined)

  const done = handoverOf(open([{ key: 'ds-asis', from: 'agent-a', ready: { by: 'river', at: ago(0), files: {}, forced: true } }, { key: 'map', from: 'agent-a', ready: { by: 'agent-a', at: ago(0), files: {} } }]))!
  assert.equal(keyText(done.keys[0]), "ready (without agent-a's confirmation)")
  assert.ok(allReady(done))
  assert.deepEqual(unreadyKeys(done), [])
  assert.equal(acceptLine(done), 'waiting for agent-b to accept')
  assert.equal(frameNotice(done, 'map'), 'Handing over to agent-b: ready; waiting for agent-b to accept')
  assert.equal(statusRows(handoverOf(open([{ key: 'gone', from: 'agent', title: 'Old map' }]))!, b)[0].text, 'waiting for studio to confirm')
  assert.equal(statusRows(handoverOf(open([{ key: 'gone', from: 'agent', title: 'Old map' }]))!, b)[0].title, 'Old map', "the handover's own title")
})

test('forceQuestion: one clause per old holder, with its oldest draw', () => {
  const b = board(diagrams({ 'ds-asis': { agent: 'agent-a', at: ago(5 * H) }, map: { agent: 'agent-a', at: ago(1 * H) }, 'ds-tobe': { agent: 'agent-c' } }))
  const h = handoverOf(open([{ key: 'map', from: 'agent-a' }, { key: 'ds-asis', from: 'agent-a' }, { key: 'ds-tobe', from: 'agent-c' }]))!
  assert.equal(forceQuestion(h, b), "Use the files as the board has them from agent-a's last draw, 5 h ago, and agent-c's last draw?")
})

test('holderWhen: last applied, handed over (with from), or drawn', () => {
  assert.equal(holderWhen({ agent: 'agent-b', at: ago(3 * 60_000), from: 'agent-a', handover: 'c_h1' }), 'handed over 3 min ago')
  assert.equal(holderWhen({ agent: 'agent-b', at: ago(3 * 60_000) }), 'drawn 3 min ago')
  assert.equal(holderWhen({ agent: 'agent-b', at: ago(H), from: 'agent-a', appliedAt: ago(60_000) }), 'last applied 1 min ago')
  assert.equal(holderWhen({ agent: 'agent-b' }), '')
})

test('presence: watching, or seen within the last minute, is here', () => {
  assert.ok(isAgentHere({ name: 'a', watching: true }))
  assert.ok(isAgentHere({ name: 'a', watching: false, seen: ago(AWAY_MS / 2) }))
  assert.ok(!isAgentHere({ name: 'a', watching: false, seen: ago(AWAY_MS * 2) }))
  assert.ok(!isAgentHere(undefined))
  assert.equal(presenceText({ name: 'a', watching: true }), 'here')
  assert.equal(presenceText({ name: 'a', watching: false, seen: ago(20 * 60_000) }), 'away · seen 20 min ago')
  assert.equal(presenceText({ name: 'a', watching: false }), 'away')
})

test('isSettled: a handover thread that is done or cancelled folds like an applied proposal; an open one does not', () => {
  const c = (id: string, p: Partial<Item> = {}): Item => ({ id, type: 'comment', x: 0, y: 0, w: 160, h: 64, text: id, createdBy: 'agent', updatedBy: 'agent', updatedAt: ago(0), ...p })
  const thread = (state: string) => [c('c_h1', { createdBy: 'user', data: { handover: { id: 'h1', state } } }), c('c_r', { target: 'c_h1', text: 'ready' })]
  assert.ok(isSettled(thread('done')))
  assert.ok(isSettled(thread('cancelled')))
  assert.ok(!isSettled(thread('open')))
  assert.ok(!isSettled([c('c_x', { data: { handover: 'done' } })]))
  assert.ok(!isSettled([item('f', { data: { handover: { state: 'done' } } })]), 'only a comment thread')
  assert.ok(!isSettled([]))
})
