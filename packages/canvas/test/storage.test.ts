import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileBoardRepository, defaultBoardsDir, isInsidePluginCache } from '../src/adapters/boards/index.js'
import type { StorageEvent } from '../src/ports/boardRepository.js'

const item = (id: string) => ({ id, type: 'sticky' as const, x: 0, y: 0, w: 10, h: 10, text: id, createdBy: 'user' as const, updatedBy: 'user' as const, updatedAt: 't' })

test('boards default outside any checkout or plugin install (unprose#1)', () => {
  assert.equal(defaultBoardsDir({ AWD_BOARDS_DIR: '/data/b' }, '/home/u'), '/data/b')
  assert.equal(defaultBoardsDir({ AWD_CANVAS_DIR: '/old' }, '/home/u'), '/old', 'the older variable still works')
  assert.equal(defaultBoardsDir({ XDG_DATA_HOME: '/home/u/.local/share' }, '/home/u'), '/home/u/.local/share/awd/boards')
  assert.equal(defaultBoardsDir({}, '/home/u'), '/home/u/.awd/boards')
  assert.equal(isInsidePluginCache('/home/u/.claude/plugins/cache/unprose/unprose/0.1.0/boards'), true)
  assert.equal(isInsidePluginCache('/home/u/.awd/boards'), false)
})

test('the boards directory deleted while the server runs: the next save recreates it and says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-store-'))
  const repo = new FileBoardRepository(dir)
  const events: StorageEvent[] = []
  repo.onStorage((e) => events.push(e))
  const b = repo.create({ title: 't', kind: 'freeform' })
  repo.apply(b.id, [{ kind: 'add', item: item('a') }], 'user')
  fs.rmSync(dir, { recursive: true, force: true }) // e.g. `claude plugin uninstall`
  const c = repo.apply(b.id, [{ kind: 'add', item: item('b') }], 'user')
  assert.equal(c.seq, 2)
  assert.ok(fs.existsSync(path.join(dir, `${b.id}.json`)), 'snapshot written again')
  const saved = JSON.parse(fs.readFileSync(path.join(dir, `${b.id}.json`), 'utf8'))
  assert.deepEqual(Object.keys(saved.items).sort(), ['a', 'b'], 'the whole current board is saved, not just the new change')
  assert.equal(events.length, 1)
  assert.equal(events[0].ok, true)
  assert.match(events[0].message, /repaired/)
})

test('a save that cannot be repaired is announced and rethrown; the board is not changed in memory', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-store-'))
  const dir = path.join(parent, 'boards')
  const repo = new FileBoardRepository(dir)
  const events: StorageEvent[] = []
  repo.onStorage((e) => events.push(e))
  const b = repo.create({ title: 't', kind: 'freeform' })
  fs.rmSync(dir, { recursive: true, force: true })
  fs.writeFileSync(dir, 'not a directory') // recreating the directory fails too
  assert.throws(() => repo.apply(b.id, [{ kind: 'add', item: item('x') }], 'user'))
  assert.equal(repo.get(b.id)!.seq, 0, 'a change that was not saved is not applied')
  assert.equal(events.at(-1)!.ok, false)
  fs.rmSync(dir)
  repo.apply(b.id, [{ kind: 'add', item: item('y') }], 'user')
  assert.equal(events.at(-1)!.ok, true, 'the next good save says saving works again')
})
