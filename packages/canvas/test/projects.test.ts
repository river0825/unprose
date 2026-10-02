// Boards live in the project they belong to (docs/canvas.md "Projects"): one server, many projects,
// each project's boards in <root>/.unprose/boards/, the personal space for the rest.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectsBoardRepository, projectSlug, PROJECT_GITIGNORE, REGISTRY_FILE } from '../src/adapters/boards/index.js'
import { PERSONAL_PROJECT, hasProjects } from '../src/ports/boardRepository.js'
import { startServer, type RunningServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { sessionProjectRoot } from '../src/mcp.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `awd-proj-${name}-`))
const project = (name: string) => {
  const root = path.join(tmp('root'), name)
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  return fs.realpathSync(root)
}

test('slugs are url-safe and never empty', () => {
  assert.equal(projectSlug('Email Automation!'), 'email-automation')
  assert.equal(projectSlug('中文'), 'project')
})

test('registry: register, dedupe, slug clash, persisted across restarts', () => {
  const personal = tmp('personal')
  const a = project('app')
  const b = project('app') // same name, different parent
  const repo = new ProjectsBoardRepository(personal)
  assert.ok(hasProjects(repo))
  const pa = repo.registerProject(a)
  assert.equal(pa.id, 'app')
  assert.equal(pa.boardsDir, path.join(a, '.unprose', 'boards'))
  assert.equal(repo.registerProject(a + '/').id, 'app', 'the same root is one project')
  assert.equal(repo.registerProject(b).id, 'app-2', 'a name clash gets a suffix')
  assert.deepEqual(
    repo.projects().map((p) => p.id),
    [PERSONAL_PROJECT, 'app', 'app-2'],
  )
  assert.ok(fs.existsSync(path.join(personal, REGISTRY_FILE)))
  const again = new ProjectsBoardRepository(personal)
  assert.deepEqual(
    again.projects().map((p) => [p.id, p.root]),
    [[PERSONAL_PROJECT, null], ['app', a], ['app-2', b]],
  )
  assert.throws(() => repo.registerProject(path.join(a, 'missing')), /not a directory/)
})

test('boards are stored in their project, found again after a restart, legacy boards stay personal', () => {
  const personal = tmp('personal')
  const legacy = new ProjectsBoardRepository(personal).create({ title: 'old board', kind: 'freeform' })
  const root = project('web')
  const repo = new ProjectsBoardRepository(personal)
  const p = repo.registerProject(root)
  const board = repo.create({ title: 'checkout ES', kind: 'freeform', project: p.id, items: [{ id: 's1', type: 'sticky', x: 0, y: 0, w: 10, h: 10, text: 'hi', createdBy: 'agent', updatedBy: 'agent', updatedAt: 't' }] })
  const dir = path.join(root, '.unprose', 'boards')
  assert.ok(fs.existsSync(path.join(dir, `${board.id}.json`)), 'snapshot in the project')
  assert.ok(fs.existsSync(path.join(dir, `${board.id}.changes.ndjson`)), 'log next to it')
  assert.ok(!fs.existsSync(path.join(personal, `${board.id}.json`)))
  assert.equal(fs.readFileSync(path.join(root, '.unprose', '.gitignore'), 'utf8'), PROJECT_GITIGNORE)
  assert.match(PROJECT_GITIGNORE, /boards\/\*\.changes\.ndjson/)
  assert.ok(fs.readFileSync(path.join(dir, `${board.id}.json`), 'utf8').endsWith('}\n'), 'pretty JSON with a final newline')
  assert.equal(repo.projectOf(board.id), p.id)
  assert.equal(repo.projectOf(legacy.id), PERSONAL_PROJECT)

  const restarted = new ProjectsBoardRepository(personal)
  assert.equal(restarted.get(board.id)?.title, 'checkout ES')
  assert.equal(restarted.projectOf(board.id), p.id)
  assert.equal(restarted.get(legacy.id)?.title, 'old board')
  // a cloned project: only the committed snapshot, no log — still loads and keeps working
  fs.unlinkSync(path.join(dir, `${board.id}.changes.ndjson`))
  const cloned = new ProjectsBoardRepository(personal)
  assert.equal(Object.keys(cloned.get(board.id)!.items).length, 1)
  const c = cloned.apply(board.id, [{ kind: 'update', id: 's1', patch: { text: 'edited' } }], 'user')
  assert.equal(c.seq, 2)
  assert.throws(() => repo.create({ title: 'x', kind: 'freeform', project: 'nope' }), /not registered/)
})

test('moveBoard copies snapshot and log into the project, then removes the old files', () => {
  const personal = tmp('personal')
  const repo = new ProjectsBoardRepository(personal)
  const b = repo.create({ title: 'to move', kind: 'freeform', items: [{ id: 'a', type: 'sticky', x: 0, y: 0, w: 1, h: 1, createdBy: 'agent', updatedBy: 'agent', updatedAt: 't' }] })
  repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'one' } }], 'user')
  const root = project('api')
  const p = repo.registerProject(root)
  repo.moveBoard(b.id, p.id)
  const dir = path.join(root, '.unprose', 'boards')
  assert.ok(fs.existsSync(path.join(dir, `${b.id}.json`)))
  assert.ok(fs.existsSync(path.join(dir, `${b.id}.changes.ndjson`)))
  assert.ok(!fs.existsSync(path.join(personal, `${b.id}.json`)))
  assert.ok(!fs.existsSync(path.join(personal, `${b.id}.changes.ndjson`)))
  assert.equal(repo.projectOf(b.id), p.id)
  assert.equal(repo.changes(b.id).length, 2, 'history travels with it')
  repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'two' } }], 'user')
  assert.equal(new ProjectsBoardRepository(personal).get(b.id)?.items.a.text, 'two', 'later writes land in the project')
  assert.throws(() => repo.moveBoard('b_missing', p.id), /not found/)
})

test('MCP: the session project is CLAUDE_PROJECT_DIR or the cwd, lifted to its repo; none for home', () => {
  const root = project('svc')
  const sub = path.join(root, 'packages', 'x')
  fs.mkdirSync(sub, { recursive: true })
  assert.equal(sessionProjectRoot({ CLAUDE_PROJECT_DIR: sub }, '/', '/home/none'), root)
  assert.equal(sessionProjectRoot({}, sub, '/home/none'), root)
  const home = tmp('home')
  assert.equal(sessionProjectRoot({}, home, home), undefined)
  const plain = tmp('plain')
  assert.equal(sessionProjectRoot({}, plain, '/home/none'), plain, 'a directory without git is still a project')
})

// ---- HTTP ----
let srv: RunningServer
let client: CanvasClient
const personalDir = tmp('srv')
const access = new AccessService({ store: new MemoryAccessStore() })
test.before(async () => {
  srv = await startServer({ port: 0, store: new ProjectsBoardRepository(personalDir), webDist: '/nonexistent', access })
  client = new CanvasClient(srv.url)
})
after(() => srv.close())

test('API: register a project, create a board in it, list by project, move a board', async () => {
  const root = project('shop')
  const reg = await client.registerProject(root)
  assert.equal(reg.id, 'shop')
  const listed = await client.projects()
  assert.deepEqual(
    listed.map((p) => p.id),
    ['personal', 'shop'],
  )
  assert.equal(listed[1].root, root, 'a local caller sees the root')

  const inShop = await client.createBoard({ title: 'shop board', kind: 'freeform', project: 'shop' })
  const personal = await client.createBoard({ title: 'mine', kind: 'freeform' })
  assert.ok(fs.existsSync(path.join(root, '.unprose', 'boards', `${inShop.id}.json`)))
  const shopOnly = await client.listBoards('shop')
  assert.deepEqual(
    shopOnly.map((b) => b.id),
    [inShop.id],
  )
  assert.equal((await client.listBoards()).find((b) => b.id === personal.id)?.project, 'personal')
  await assert.rejects(client.createBoard({ title: 'x', kind: 'freeform', project: 'nope' }), /not registered/)
  await assert.rejects(client.listBoards('nope'), /not registered/)

  const moved = await client.moveBoard(personal.id, { project: 'shop' })
  assert.equal(moved.project, 'shop')
  assert.ok(fs.existsSync(path.join(root, '.unprose', 'boards', `${personal.id}.json`)))
  assert.equal((await client.getBoard(personal.id)).title, 'mine', 'the board URL / id is unchanged')
})

test('API: directories are only named from this machine (no proxy/tunnel headers)', async () => {
  const root = project('secret')
  // without credentials a tunnel gets nothing at all (docs/canvas.md "Remote agents"); with a token it is an agent — still not this machine
  const anonymous = await fetch(srv.url + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ root }) })
  assert.equal(anonymous.status, 401)
  const { token } = access.createToken({ name: 'tunnel-agent' }, 'test')
  const viaTunnel = (p: string, body: unknown) =>
    fetch(srv.url + p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  assert.equal((await viaTunnel('/api/projects', { root })).status, 403)
  assert.equal((await viaTunnel('/api/boards', { title: 't', kind: 'freeform', projectRoot: root })).status, 403)
  const b = await client.createBoard({ title: 'stay', kind: 'freeform' })
  assert.equal((await viaTunnel(`/api/boards/${b.id}/move`, { projectRoot: root })).status, 403)
  const listed = await (await fetch(srv.url + '/api/projects', { headers: { 'x-forwarded-for': '203.0.113.9', authorization: `Bearer ${token}` } })).json()
  assert.ok(listed.projects.every((p: { root?: string }) => p.root === undefined), 'remote callers do not see local paths')
  // reading and creating in an already registered project by id works from anywhere (like every other board op)
  assert.equal((await viaTunnel('/api/boards', { title: 'remote', kind: 'freeform', project: 'shop' })).status, 201)
})
