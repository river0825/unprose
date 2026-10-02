// Studio with several agents on one board (docs/canvas.md "Several agents on one board", docs/studio.md §11):
// comments the canvas routed to another agent are not studio's; another agent asking @studio is a chat; the board
// context opens every brief; proposals for files another agent holds are left to it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Studio, FakeCanvasBoard, FakeAgentChannel, MemoryStudioStore, discussRequests, renderBrief } from '../src/index.js'
import { forStudio, contextSection } from '../src/application/studio.js'

const ROOT = '/repo'
const DIFF = '--- a/dev/workflow.yaml\n+++ b/dev/workflow.yaml\n@@ -1 +1 @@\n-a\n+b\n'

function board(meta: Record<string, unknown> = {}) {
  return new FakeCanvasBoard({
    id: 'b1',
    title: 'Shop',
    kind: 'workflow',
    seq: 10,
    meta: { workflow: { file: `${ROOT}/dev/workflow.yaml` }, ...meta },
    items: { 'wf.node.plan': { id: 'wf.node.plan', type: 'card', role: 'ai', text: 'plan', data: { nodeId: 'plan', detail: { kind: 'ai', source: { workflow: 'dev/workflow.yaml', line: 4 } } } } },
  })
}

function setup(canvas: FakeCanvasBoard) {
  const channel = new FakeAgentChannel({ stateAfterPrompt: 'working' })
  const store = new MemoryStudioStore()
  let n = 0
  const studio = new Studio({ canvas, channel, store, project: ROOT, projectName: 'shop', canvasUrl: 'http://localhost:4400', sleep: async () => {}, now: () => 1_000_000, newSessionId: () => `sid-${++n}` })
  return { channel, store, studio }
}

test('forStudio: no `to` is anyone; `to` must name the default local agent (or studio)', () => {
  assert.equal(forStudio({ id: 'c', type: 'comment' }), true)
  assert.equal(forStudio({ id: 'c', type: 'comment', data: { to: ['agent'] } }), true)
  assert.equal(forStudio({ id: 'c', type: 'comment', data: { to: ['Studio'] } }), true)
  assert.equal(forStudio({ id: 'c', type: 'comment', data: { to: ['codex-b'] } }), false)
  assert.equal(forStudio({ id: 'c', type: 'comment', data: { to: [] } }), false, 'a paused thread wakes nobody')
})

test('a comment answered by another agent (responder or @mention) is not a studio request, nor its follow-ups', async () => {
  const b = board()
  const { studio, channel } = setup(b)
  await studio.tick()
  const root = b.userComment('wf.node.plan', '@codex-b why?', { to: ['codex-b'], route: 'mention', mention: 'codex-b' })
  b.userComment(root, 'and?', { to: ['codex-b'], route: 'mention' })
  assert.deepEqual(await studio.tick(), [])
  assert.equal(channel.calls.filter((c) => c[0] === 'prompt').length, 0)
  b.userComment('wf.node.plan', 'studio, look here', { to: ['agent'], route: 'responder' })
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
})

test('another agent asking @studio opens a chat marked as its; the brief says it is not the person', async () => {
  const b = board()
  const { studio, store, channel } = setup(b)
  await studio.tick()
  const q = b.agentComment('wf.node.plan', '@studio what was hard on this board?', 'codex-b', { to: ['agent'], route: 'mention', mention: 'agent' })
  const [d] = await studio.tick()
  assert.equal(d.action, 'opened')
  assert.equal(d.req?.askedBy, 'codex-b')
  const prompt = String(channel.calls.filter((c) => c[0] === 'prompt')[0].at(-1))
  assert.match(prompt, /the agent codex-b asks you something/)
  const brief = [...store.briefs.values()].at(-1)!
  assert.match(brief, /## codex-b asks you \(another agent, not the person\)/)
  assert.match(brief, /never the person's consent/)
  assert.match(brief, new RegExp(`target: "${q}"`))
  // an agent comment the canvas did not route to studio is not a request
  b.agentComment('wf.node.plan', 'a note for the person', 'codex-b', { to: [], route: 'responder' })
  assert.deepEqual(await studio.tick(), [])
})

test('a proposal for files another agent holds is left to it; one for studio\'s files is studio\'s', async () => {
  const b = board()
  const p1 = b.agentProposal('wf.node.plan', 'rename', { file: 'dev/workflow.yaml', diff: DIFF }, 'codex-b')
  b.snapshot.items[p1].data = { ...b.snapshot.items[p1].data, to: ['claude-a'], route: 'proposal' }
  const p2 = b.agentProposal('wf.node.plan', 'rename again', { file: 'dev/workflow.yaml', diff: DIFF }, 'codex-b')
  b.snapshot.items[p2].data = { ...b.snapshot.items[p2].data, to: ['agent'], route: 'proposal' }
  const reqs = discussRequests(await b.board(), (await b.changes('b1', 0)).changes, 0)
  assert.deepEqual(reqs.map((r) => r.commentId), [p2])
})

test('the board context opens every brief; applying says --applied and leaves commits to UNPROSE_APPLY_COMMIT', async () => {
  const b = board({ context: { text: 'Meeting 2026-10-02: the shop flow.\nSee docs/meetings/2026-10-02.md', by: 'codex-b', at: '2026-10-02T09:00:00Z' } })
  const snap = await b.board()
  assert.match(contextSection(snap).join('\n'), /## Board context[\s\S]*written by codex-b, 2026-10-02[\s\S]*> Meeting 2026-10-02/)
  const id = b.agentProposal('wf.node.plan', 'rename', { file: 'dev/workflow.yaml', base: 'f00d', diff: DIFF }, 'codex-b')
  const [req] = discussRequests(await b.board(), (await b.changes('b1', 0)).changes, 0)
  const brief = renderBrief({ req, board: await b.board(), workflow: 'dev/workflow.yaml', canvasUrl: 'http://localhost:4400' })
  assert.ok(brief.indexOf('## Board context') < brief.indexOf('## Proposed edit'))
  assert.match(brief, new RegExp(`--applied ${id}`))
  assert.match(brief, /UNPROSE_APPLY_COMMIT=1/)
  assert.match(brief, /never commit by hand/)
  const boardChat = renderBrief({ req: { ...req, kind: 'board', about: [], edit: undefined, proposedBy: undefined }, board: snap, canvasUrl: 'http://localhost:4400' })
  assert.match(boardChat, /## Board context/)
})
