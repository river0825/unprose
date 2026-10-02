// The holder of the files (docs/canvas.md "Several agents on one board"): `awd design draw` records who drew a
// diagram from which repo; `--applied <thread>` answers in the proposal's thread and commits only when this machine
// set UNPROSE_APPLY_COMMIT=1; the CLI uses the token the MCP server got with a pairing code.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AccessService, MemoryAccessStore, MemoryBoardRepository, startServer, type RunningServer } from '@awd/canvas'
import { drawDesign } from '../src/design.js'
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
  assert.deepEqual(canvasHeaders({ UNPROSE_TOKEN: 'unp_env', UNPROSE_TOKENS_FILE: file }, 'https://canvas.example.com'), { authorization: 'Bearer unp_env' })
  assert.deepEqual(canvasHeaders({ UNPROSE_TOKENS_FILE: file, UNPROSE_AGENT_NAME: 'codex-b' }, 'https://canvas.example.com/'), { authorization: 'Bearer unp_saved' })
  assert.deepEqual(canvasHeaders({ UNPROSE_TOKENS_FILE: file, UNPROSE_AGENT_NAME: 'codex-b' }, 'http://localhost:4400'), { 'x-unprose-agent': 'codex-b' })
})
