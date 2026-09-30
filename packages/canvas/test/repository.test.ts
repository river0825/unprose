// The BoardRepository seam is real: the same server and the same behaviour
// on the memory adapter, and both adapters agree on the log-first contract.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer } from '../src/server.js'
import { CanvasClient } from '../src/client.js'
import { demoBoards } from '../src/demo.js'
import { FileBoardRepository, MemoryBoardRepository, ProjectsBoardRepository, createBoardRepository } from '../src/adapters/boards/index.js'
import { HANDOFF_NOTE, type BoardRepository } from '../src/ports/boardRepository.js'
import { render } from '../src/templates/index.js'

function eachRepo(): Array<[string, BoardRepository]> {
  return [
    ['file', new FileBoardRepository(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-repo-')))],
    ['projects', new ProjectsBoardRepository(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-repo-')))],
    ['memory', new MemoryBoardRepository()],
  ]
}

test('both adapters: create → apply → changes → waitFor(handoff) → delete', async () => {
  for (const [name, repo] of eachRepo()) {
    const items = render('event-storming', demoBoards[1].content)
    const b = repo.create({ title: name, kind: 'event-storming', items })
    assert.equal(b.seq, 1, name)
    const ev = Object.values(b.items).find((i) => i.role === 'event')!
    const ch = repo.apply(b.id, [{ kind: 'update', id: ev.id, patch: { text: 'renamed' } }], 'user', 'rename')
    assert.equal(ch.seq, 2, name)
    assert.equal(repo.get(b.id)!.items[ev.id].text, 'renamed', name)
    assert.equal(repo.changes(b.id, { since: 1 }).length, 1, name)
    assert.equal(repo.changes(b.id, { since: 1, author: 'agent' }).length, 0, name)
    const p = repo.waitFor(b.id, 2, 2000, 'user', { quietMs: 5000 })
    assert.equal(repo.watchers(b.id), 1, name)
    setTimeout(() => repo.apply(b.id, [], 'user', HANDOFF_NOTE), 5)
    const got = await p
    assert.equal(got.length, 1, name)
    assert.equal(repo.watchers(b.id), 0, name)
    assert.equal(repo.updateBoard(b.id, { title: 'T2' }).title, 'T2', name)
    assert.ok(repo.delete(b.id), name)
    assert.equal(repo.get(b.id), undefined, name)
  }
})

test('createBoardRepository picks the adapter by name', () => {
  assert.ok(createBoardRepository('memory') instanceof MemoryBoardRepository)
  // files: the personal boards in the dir, each registered project's boards in <root>/.unprose/boards/
  assert.ok(createBoardRepository(undefined, fs.mkdtempSync(path.join(os.tmpdir(), 'awd-repo-'))) instanceof ProjectsBoardRepository)
})

test('the HTTP server runs unchanged on the memory repository', async () => {
  const srv = await startServer({ port: 0, store: new MemoryBoardRepository(), webDist: '/nonexistent' })
  try {
    const client = new CanvasClient(srv.url)
    const board = await client.createBoard({ title: 'mem', kind: 'workflow', content: demoBoards[5].content })
    assert.ok(Object.keys(board.items).length > 3)
    const node = Object.values(board.items).find((i) => i.type === 'card')!
    await client.apply(board.id, [{ kind: 'update', id: node.id, patch: { x: node.x + 40 } }], 'user', 'moved')
    const diff = await client.diff(board.id, 1, 'user')
    assert.equal(diff.count, 1)
    const list = await client.listBoards()
    assert.equal(list.length, 1)
    assert.ok(srv.store instanceof MemoryBoardRepository)
  } finally {
    await srv.close()
  }
})
