// Boards belong to the project their file comes from (docs/canvas.md "Projects").
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer, ProjectsBoardRepository, type RunningServer } from '@awd/canvas'
import { boardByTitle, registerProject, cmdBoards, type Api } from '../src/projects.js'

const tmp = (n: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `awd-cli-proj-${n}-`)))

/** A fake canvas API: boards with projects, records creations. */
function fakeApi(boards: Array<{ id: string; title: string; kind: string; project?: string }>) {
  const created: unknown[] = []
  const api: Api = async <T,>(method: string, p: string, body?: unknown): Promise<T> => {
    if (method === 'GET' && p === '/api/boards') return { boards } as T
    if (method === 'POST' && p === '/api/boards') {
      created.push(body)
      return { board: { id: 'b_new', ...(body as object) } } as T
    }
    if (method === 'POST' && p === '/api/projects') throw new Error('403 projects can only be registered from this machine')
    throw new Error(`unexpected ${method} ${p}`)
  }
  return { api, created }
}

test('a title is found in the project first, else anywhere (older boards), else created in the project', async () => {
  const boards = [
    { id: 'b_old', title: 'Plan', kind: 'freeform', project: 'personal' },
    { id: 'b_proj', title: 'Plan', kind: 'freeform', project: 'shop' },
  ]
  const f = fakeApi(boards)
  assert.equal((await boardByTitle(f.api, 'Plan', 'freeform', 'shop')).id, 'b_proj')
  assert.equal((await boardByTitle(f.api, 'Plan', 'freeform', 'other')).id, 'b_old', 'a board made before projects keeps being used')
  assert.equal((await boardByTitle(f.api, 'New', 'freeform', 'shop')).id, 'b_new')
  assert.deepEqual(f.created, [{ title: 'New', kind: 'freeform', project: 'shop' }])
  assert.equal(await registerProject(f.api, '/x'), undefined, 'a canvas that refuses (remote) leaves boards personal')
})

let srv: RunningServer
const personal = tmp('personal')
test.before(async () => {
  srv = await startServer({ port: 0, store: new ProjectsBoardRepository(personal), webDist: '/nonexistent' })
})
after(() => srv.close())

test('awd boards move: a personal board moves into <project>/.unprose/boards, URL unchanged', async () => {
  const b = (await (await fetch(`${srv.url}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Legacy map', kind: 'freeform' }) })).json()).board
  const root = tmp('project')
  const out: string[] = []
  const log = console.log
  console.log = (...a: unknown[]) => void out.push(a.join(' '))
  try {
    assert.equal(await cmdBoards(['move', 'title:Legacy map'], { to: root, canvas: srv.url }), true)
  } finally {
    console.log = log
  }
  assert.ok(fs.existsSync(path.join(root, '.unprose', 'boards', `${b.id}.json`)))
  assert.ok(fs.existsSync(path.join(root, '.unprose', '.gitignore')))
  assert.ok(!fs.existsSync(path.join(personal, `${b.id}.json`)))
  assert.match(out.join('\n'), new RegExp(`/b/${b.id}`))
  const listed = (await (await fetch(`${srv.url}/api/boards`)).json()).boards.find((x: { id: string }) => x.id === b.id)
  assert.equal(listed.project, path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
  assert.equal(await cmdBoards(['move', 'title:nothing'], { to: root, canvas: srv.url }), false)
})
