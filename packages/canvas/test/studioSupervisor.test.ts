// The canvas server starts `awd studio` only for projects it was configured with (docs/diagrams.md §8).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer, studioArgv, type RunningServer } from '../src/server.js'
import { FakeSupervisor } from '../src/adapters/process/fake.js'
import { createBoardRepository } from '../src/adapters/boards/index.js'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-studio-sup-')))
const root = path.join(tmp, 'repo')
const wfFile = path.join(root, 'dev', 'workflow.yaml')
fs.mkdirSync(path.dirname(wfFile), { recursive: true })
fs.writeFileSync(wfFile, 'name: t\n')
// a sibling folder whose name starts like the project's is not inside it
fs.mkdirSync(path.join(tmp, 'repository'), { recursive: true })

const supervisor = new FakeSupervisor()
let srv: RunningServer
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(srv.url + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}
const board = async (meta?: Record<string, unknown>, kind = 'workflow') => (await call('POST', '/api/boards', { title: 'b', kind, meta })).body.board.id as string

test.before(async () => {
  srv = await startServer({
    port: 0,
    store: createBoardRepository('memory'),
    webDist: '/nonexistent',
    studio: { projects: [{ root, name: 'repo' }], command: '/usr/bin/node /x/awd.js studio --project {project}', supervisor },
  })
})
after(() => srv.close())

test('the command is the configured template; {project} is the only substitution ({file} is its old spelling)', () => {
  assert.deepEqual(studioArgv('node awd.js studio --project {project} --model opus', '/r'), { command: 'node', args: ['awd.js', 'studio', '--project', '/r', '--model', 'opus'] })
  assert.deepEqual(studioArgv('node awd.js studio {file}', '/r').args, ['awd.js', 'studio', '/r'])
})

test('a board outside every configured project is not capable, and cannot start anything', async () => {
  const other = await board({ workflow: { file: '/etc/passwd' } })
  assert.deepEqual((await call('GET', `/api/boards/${other}/studio`)).body, { capable: false, running: false, log: [] })
  assert.equal((await call('POST', `/api/boards/${other}/studio`, { action: 'start' })).status, 403)
  const relative = await board({ workflow: { file: 'dev/workflow.yaml' } })
  assert.equal((await call('POST', `/api/boards/${relative}/studio`, { action: 'start' })).status, 403)
  const sibling = await board({ project: { root: path.join(tmp, 'repository') } }, 'freeform')
  assert.equal((await call('POST', `/api/boards/${sibling}/studio`, { action: 'start' })).status, 403)
  assert.equal(supervisor.started.length, 0)
})

test('any board of the project is capable — a workflow board or a design board — and they share one child', async () => {
  const wf = await board({ workflow: { file: wfFile, statusUrl: 'http://localhost:4313' } })
  const design = await board({ project: { root } }, 'freeform')
  assert.equal((await call('GET', `/api/boards/${design}/studio`)).body.capable, true)
  assert.equal((await call('GET', `/api/boards/${design}/studio`)).body.project, 'repo')

  const a = await call('POST', `/api/boards/${wf}/studio`, { action: 'start' })
  assert.equal(a.status, 200)
  assert.equal(a.body.running, true)
  const b = await call('POST', `/api/boards/${design}/studio`, { action: 'start' })
  assert.equal(b.body.pid, a.body.pid, 'one studio per project, whichever board pressed Start')
  assert.equal(supervisor.started.length, 1)
  const { spec } = supervisor.started[0]
  assert.equal(spec.command, '/usr/bin/node')
  assert.deepEqual(spec.args, ['/x/awd.js', 'studio', '--project', root])
  assert.equal(spec.cwd, root)
  assert.equal(spec.env?.AWD_CANVAS_URL, srv.url)

  const stopped = await call('POST', `/api/boards/${design}/studio`, { action: 'stop' })
  assert.equal(stopped.body.running, false)

  await call('POST', `/api/boards/${wf}/studio`, { action: 'start' })
  supervisor.emit(root, 'studio: watching')
  supervisor.exit(root, 1)
  const after = (await call('GET', `/api/boards/${wf}/studio`)).body
  assert.equal(after.running, false)
  assert.equal(after.exitCode, 1)
  assert.match(after.log.at(-1), /exited\] code 1/)
  assert.ok(after.log.includes('studio: watching'))
  assert.equal((await call('POST', `/api/boards/${wf}/studio`, { action: 'restart' })).status, 400)
})

test('"new session" stamps the board meta for studio to read; other meta is kept', async () => {
  const id = await board({ project: { root }, diagrams: { x: { source: 'design/x.yaml' } } }, 'freeform')
  const r = await call('POST', `/api/boards/${id}/studio`, { action: 'new-session' })
  assert.equal(r.status, 200)
  const meta = (await call('GET', `/api/boards/${id}`)).body.board.meta
  assert.match(meta.studio.newSessionAt, /^\d{4}-\d\d-\d\dT/)
  assert.deepEqual(meta.diagrams, { x: { source: 'design/x.yaml' } })
  assert.deepEqual(meta.project, { root })
})

test('sessions come from the project status.json (ignored when it names another project)', async () => {
  const id = await board({ project: { root } }, 'freeform')
  fs.mkdirSync(path.join(root, '.awd', 'studio'), { recursive: true })
  const write = (j: object) => fs.writeFileSync(path.join(root, '.awd', 'studio', 'status.json'), JSON.stringify(j))
  write({ project: '/elsewhere', boards: 1, open: 1, max: 3, queued: 0 })
  await call('POST', `/api/boards/${id}/studio`, { action: 'start' })
  assert.equal((await call('GET', `/api/boards/${id}/studio`)).body.sessions, undefined)
  write({ project: root, boards: 2, open: 2, max: 3, queued: 1, updatedAt: 'x' })
  assert.deepEqual((await call('GET', `/api/boards/${id}/studio`)).body.sessions, { open: 2, max: 3, queued: 1, boards: 2 })
  await call('POST', `/api/boards/${id}/studio`, { action: 'stop' })
})

test('closing the server stops every studio child', async () => {
  const id = await board({ workflow: { file: wfFile } })
  await call('POST', `/api/boards/${id}/studio`, { action: 'start' })
  assert.equal(supervisor.info(root)?.running, true)
  supervisor.stopAll()
  assert.equal(supervisor.info(root)?.running, false)
})
