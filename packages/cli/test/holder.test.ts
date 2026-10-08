// The holder of the files (docs/canvas.md "Several agents on one board"): `awd design draw` records who drew a
// diagram from which repo; `--applied <thread>` answers in the proposal's thread and commits only when this machine
// set UNPROSE_APPLY_COMMIT=1; the CLI uses the token the MCP server got with a pairing code.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadWorkflow } from '@awd/runtime'
import { AccessService, MemoryAccessStore, MemoryBoardRepository, startServer, VERSION, type RunningServer } from '@awd/canvas'
import { drawDesign, previewDesign } from '../src/design.js'
import { pushGraphToCanvas } from '../src/graphCanvas.js'
import { afterApplied, appliedMessage } from '../src/applied.js'
import { canvasHeaders, holderInfo, type Api } from '../src/projects.js'

const ES = 'events:\n  - text: Order placed\n'
let srv: RunningServer
let repo: string
const store = new MemoryBoardRepository()
const access = new AccessService({ store: new MemoryAccessStore() })
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

before(async () => {
  srv = await startServer({ port: 0, store, webDist: '/nonexistent', access })
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'unprose-holder-')))
  git('init', '-q')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'T')
  git('remote', 'add', 'origin', 'https://river:secret@github.com/river/team-notes.git')
  fs.mkdirSync(path.join(repo, 'design'))
  fs.writeFileSync(path.join(repo, 'design', 'shop.es.yaml'), ES)
  git('add', '.')
  git('commit', '-qm', 'start')
})
after(() => srv.close())

const api: Api = async <T,>(method: string, p: string, body?: unknown): Promise<T> => {
  const res = await fetch(srv.url + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

test('holderInfo: this machine, the repo root and folder name, the git remote without credentials', () => {
  const h = holderInfo(repo)
  assert.equal(h.root, repo)
  assert.equal(h.repo, path.basename(repo))
  assert.equal(h.remote, 'https://github.com/river/team-notes.git')
  assert.equal(h.machine, os.hostname().replace(/\.local$/, ''))
})

test('awd design draw records the holder of the diagram (signed by the canvas, not by the CLI)', async () => {
  const r = await drawDesign(path.join(repo, 'design', 'shop.es.yaml'), { board: 'title:Holder test', canvas: srv.url })
  const b = store.get(r.boardId)!
  const h = (b.meta!.diagrams as Record<string, { holder: Record<string, string> }>)['shop-es'].holder
  assert.equal(h.agent, 'agent', 'the default local agent drew it')
  assert.equal(h.root, repo)
  assert.equal(h.repo, path.basename(repo))
  assert.ok(h.at)
})

test('--applied answers "Applied to <file>" in the thread; commits only with UNPROSE_APPLY_COMMIT=1', async () => {
  const r = await drawDesign(path.join(repo, 'design', 'shop.es.yaml'), { board: 'title:Apply test', canvas: srv.url })
  const thread = 'prop1'
  store.apply(r.boardId, [{ kind: 'add', item: { id: thread, type: 'comment', x: 0, y: 0, w: 100, h: 60, text: 'Rename the event\nbecause it is clearer', target: 'diagram.shop-es', data: { by: 'codex-b', discuss: { edit: { file: 'design/shop.es.yaml', base: 'x', diff: '@@', by: 'codex-b' } } }, createdBy: 'agent', updatedBy: 'agent', updatedAt: new Date().toISOString() } }], 'agent', undefined, 'codex-b')
  fs.writeFileSync(path.join(repo, 'design', 'shop.es.yaml'), ES.replace('placed', 'submitted'))
  const off = await afterApplied(api, { base: srv.url, boardId: r.boardId, thread, root: repo, fallbackFile: 'design/shop.es.yaml', env: {} })
  assert.equal(off.commit, undefined)
  assert.equal(git('status', '--porcelain'), 'M design/shop.es.yaml', 'nothing committed without the setting')
  const on = await afterApplied(api, { base: srv.url, boardId: r.boardId, thread, root: repo, fallbackFile: 'design/shop.es.yaml', env: { UNPROSE_APPLY_COMMIT: '1' } })
  assert.ok(on.commit)
  const msg = git('log', '-1', '--format=%B')
  assert.match(msg, /^Apply canvas proposal to design\/shop\.es\.yaml\n\nRename the event\n\nProposed by codex-b; agreed by the person in http:\/\/localhost:\d+\/b\/.+\?focus=prop1/)
  assert.equal(git('status', '--porcelain'), '')
  const replies = Object.values(store.get(r.boardId)!.items).filter((i) => i.type === 'comment' && i.target === thread)
  assert.equal(replies.length, 2)
  assert.match(replies.at(-1)!.text!, new RegExp(`Applied to design/shop.es.yaml — committed ${on.commit}`))
  // the push fails (the remote does not exist — a local path, no network): reported, not thrown
  git('remote', 'set-url', 'origin', path.join(repo, 'missing.git'))
  fs.writeFileSync(path.join(repo, 'design', 'shop.es.yaml'), ES)
  const push = await afterApplied(api, { base: srv.url, boardId: r.boardId, thread, root: repo, fallbackFile: 'design/shop.es.yaml', env: { UNPROSE_APPLY_COMMIT: '1', UNPROSE_APPLY_PUSH: '1' } })
  assert.equal(push.pushed, false)
  assert.ok(push.notes.some((n) => n.startsWith('push failed')))
  assert.match(appliedMessage({ file: 'f', link: 'L' }), /Proposed by the person; agreed by the person in L/)
})

test('canvasHeaders: UNPROSE_TOKEN, else the token saved for that canvas by a pairing code, else the agent name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unprose-tokens-'))
  const file = path.join(dir, 'tokens.json')
  fs.writeFileSync(file, JSON.stringify({ 'https://canvas.example.com': 'unp_saved' }))
  const ua = { 'user-agent': `unprose/${VERSION} (cli)` }
  assert.deepEqual(canvasHeaders({ UNPROSE_TOKEN: 'unp_env', UNPROSE_TOKENS_FILE: file }, 'https://canvas.example.com'), { ...ua, authorization: 'Bearer unp_env' })
  assert.deepEqual(canvasHeaders({ UNPROSE_TOKENS_FILE: file, UNPROSE_AGENT_NAME: 'codex-b' }, 'https://canvas.example.com/'), { ...ua, authorization: 'Bearer unp_saved' })
  assert.deepEqual(canvasHeaders({ UNPROSE_TOKENS_FILE: file, UNPROSE_AGENT_NAME: 'codex-b' }, 'https://canvas.example.com/b/b_123?focus=x'), { ...ua, authorization: 'Bearer unp_saved' }, 'a board link names the same canvas')
  assert.deepEqual(canvasHeaders({ UNPROSE_TOKENS_FILE: file, UNPROSE_AGENT_NAME: 'codex-b' }, 'http://localhost:4400'), { ...ua, 'x-unprose-agent': 'codex-b' })
})

/** Run `fn` with these environment variables (restored after). */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const was = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]
  else process.env[k] = v
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

test('one credential: awd design draw picks up the token a pairing code saved for this canvas (no UNPROSE_TOKEN)', async () => {
  const { token } = access.createToken({ name: 'codex-paired' }, 't')
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unprose-tokens-')), 'tokens.json')
  // the MCP server saved it under the canvas origin; the CLI is given a board link
  fs.writeFileSync(file, JSON.stringify({ [srv.url.replace('localhost', '127.0.0.1')]: token }))
  const r = await withEnv({ UNPROSE_TOKENS_FILE: file, UNPROSE_TOKEN: undefined, UNPROSE_AGENT_NAME: undefined }, () =>
    drawDesign(path.join(repo, 'design', 'shop.es.yaml'), { board: 'title:Paired draw', canvas: `${srv.url.replace('localhost', '127.0.0.1')}/b/anything` }),
  )
  const h = (store.get(r.boardId)!.meta!.diagrams as Record<string, { holder: Record<string, string> }>)['shop-es'].holder
  assert.equal(h.agent, 'codex-paired', 'signed with the paired token, not as the local default agent')
  assert.equal(access.list().find((a) => a.name === 'codex-paired')!.lastUserAgent, `unprose/${VERSION} (cli)`)
})

test('the token the MCP server adopted (UNPROSE_TOKEN in its environment) is what design_draw sends', async () => {
  const { token } = access.createToken({ name: 'codex-adopted' }, 't')
  const r = await withEnv({ UNPROSE_TOKEN: token, UNPROSE_TOKENS_FILE: path.join(os.tmpdir(), 'unprose-no-such-tokens.json') }, () => drawDesign(path.join(repo, 'design', 'shop.es.yaml'), { board: 'title:Adopted draw', canvas: srv.url }))
  const h = (store.get(r.boardId)!.meta!.diagrams as Record<string, { holder: Record<string, string> }>)['shop-es'].holder
  assert.equal(h.agent, 'codex-adopted')
})

test('two machines drawing on one board in turn: each keeps its diagram, the board-level root stays the first one\'s', async () => {
  // machine B: another repo with another diagram
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'unprose-holder-b-')))
  execFileSync('git', ['-C', other, 'init', '-q'])
  fs.mkdirSync(path.join(other, 'design'))
  fs.writeFileSync(path.join(other, 'design', 'scope.story-map.yaml'), 'activities:\n  - text: Sign up\n    steps:\n      - text: Enter e-mail\n        stories:\n          - text: As a visitor I sign up\n')
  const a = await drawDesign(path.join(repo, 'design', 'shop.es.yaml'), { board: 'title:Two machines', canvas: srv.url })
  const b = await drawDesign(path.join(other, 'design', 'scope.story-map.yaml'), { board: 'title:Two machines', canvas: srv.url })
  assert.equal(a.boardId, b.boardId, 'the same board, found by title')
  const meta = store.get(a.boardId)!.meta as { project: { root: string }; diagrams: Record<string, { holder: { root: string } }> }
  assert.equal(meta.project.root, repo, 'the board-level default is not overwritten by the second machine')
  assert.equal(meta.diagrams['shop-es'].holder.root, repo)
  assert.equal(meta.diagrams[b.key].holder.root, other, 'each diagram knows its own project root')
  // A redraws: B's diagram stays
  await drawDesign(path.join(repo, 'design', 'shop.es.yaml'), { board: a.boardId, canvas: srv.url })
  assert.ok((store.get(a.boardId)!.meta as { diagrams: Record<string, unknown> }).diagrams[b.key])
})

test('awd design draw and awd graph --canvas refuse — before drawing anything — a diagram whose files another agent holds', async () => {
  const file = path.join(repo, 'design', 'shop.es.yaml')
  // the default local agent (studio) drew it, so it holds the files
  const r = await withEnv({ UNPROSE_TOKEN: undefined, UNPROSE_AGENT_NAME: undefined, UNPROSE_TOKENS_FILE: path.join(os.tmpdir(), 'unprose-no-such-tokens.json') }, () => drawDesign(file, { board: 'title:Held by studio', canvas: srv.url }))
  const seq = store.get(r.boardId)!.seq
  const want = 'the files of "shop-es" (design/shop.es.yaml) are held by studio: you cannot redraw them. Propose instead (canvas_files → canvas_propose_edit), or ask the person to hand them over to you (board panel → Hand over files).'
  await assert.rejects(withEnv({ UNPROSE_TOKEN: undefined, UNPROSE_AGENT_NAME: 'claude-x', UNPROSE_TOKENS_FILE: path.join(os.tmpdir(), 'unprose-no-such-tokens.json') }, () => drawDesign(file, { board: r.boardId, canvas: srv.url })), (e: Error) => e.message === want)
  assert.equal(store.get(r.boardId)!.seq, seq, 'nothing drawn')
  // the dry run says so too
  const p = await withEnv({ UNPROSE_TOKEN: undefined, UNPROSE_AGENT_NAME: 'claude-x', UNPROSE_TOKENS_FILE: path.join(os.tmpdir(), 'unprose-no-such-tokens.json') }, () => previewDesign(file, { board: r.boardId, canvas: srv.url }))
  assert.ok(p.lines.at(-1)!.includes(`✖ a real draw is refused: ${want}`))
  // the holder itself redraws as before
  await withEnv({ UNPROSE_TOKEN: undefined, UNPROSE_AGENT_NAME: undefined, UNPROSE_TOKENS_FILE: path.join(os.tmpdir(), 'unprose-no-such-tokens.json') }, () => drawDesign(file, { board: r.boardId, canvas: srv.url }))
  // a workflow board the same way
  const wfFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples', 'herdr-smoke', 'workflow.yaml')
  const def = loadWorkflow(wfFile).def
  const w = await withEnv({ UNPROSE_TOKEN: undefined, UNPROSE_AGENT_NAME: undefined, UNPROSE_TOKENS_FILE: path.join(os.tmpdir(), 'unprose-no-such-tokens.json') }, () => pushGraphToCanvas(def, { canvas: srv.url, file: wfFile }))
  const wseq = store.get(w.boardId)!.seq
  await assert.rejects(withEnv({ UNPROSE_TOKEN: undefined, UNPROSE_AGENT_NAME: 'claude-x', UNPROSE_TOKENS_FILE: path.join(os.tmpdir(), 'unprose-no-such-tokens.json') }, () => pushGraphToCanvas(def, { canvas: srv.url, file: wfFile })), (e: Error) => /^the files of "workflow" \(.*herdr-smoke\/workflow\.yaml\) are held by studio: you cannot redraw them\./.test(e.message))
  assert.equal(store.get(w.boardId)!.seq, wseq, 'nothing drawn')
})
