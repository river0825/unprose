// The change log is read through an index (adapters/boards/changeLog.ts): a read since N reads only the lines
// after N. Whatever happened to the file — appends from here or from another process, a replaced, rewritten
// or truncated file, a torn last line, a board moved between projects — a read says what reading the whole
// file and filtering it would.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileBoardRepository, MemoryBoardRepository, ProjectsBoardRepository } from '../src/adapters/boards/index.js'
import type { Change } from '../src/model.js'
import type { BoardRepository } from '../src/ports/boardRepository.js'

const tmp = (name = 'log') => fs.mkdtempSync(path.join(os.tmpdir(), `awd-${name}-`))
const sticky = (id: string, text = id) => ({ id, type: 'sticky' as const, x: 0, y: 0, w: 10, h: 10, text, createdBy: 'user' as const, updatedBy: 'user' as const, updatedAt: 't' })
const logOf = (dir: string, id: string) => path.join(dir, `${id}.changes.ndjson`)
/** A change as it comes back from the file (no undefined fields). */
const stored = (c: Change) => JSON.parse(JSON.stringify(c)) as Change
const line = (seq: number, boardId: string, note = '') => JSON.stringify({ seq, ts: '2026-10-15T00:00:00.000Z', author: 'user', boardId, ops: [], before: {}, note }) + '\n'

/** Read the whole log and filter: a torn last line (no newline) and lines that are not JSON are no changes. */
function fullRead(file: string, since = 0): Change[] {
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.pop() // '' after the last newline, or a torn line
  const out: Change[] = []
  for (const l of lines) {
    try {
      const c = JSON.parse(l) as Change
      if (c.seq > since) out.push(c)
    } catch {
      // garbage, e.g. a torn line a later append was put behind
    }
  }
  return out
}

function agreesForEverySince(repo: BoardRepository, id: string, file: string, msg = '') {
  const last = Math.max(0, ...fullRead(file).map((c) => c.seq))
  for (let since = -1; since <= last + 1; since++) assert.deepEqual(repo.changes(id, { since }), fullRead(file, since), `${msg} since ${since}`)
  assert.deepEqual(repo.changes(id), fullRead(file), `${msg} no since`)
}

/** Bytes read through fs.readSync while `fn` runs. */
function bytesRead<T>(fn: () => T): { value: T; bytes: number } {
  const real = fs.readSync
  let bytes = 0
  fs.readSync = function (...args: unknown[]) {
    const n = (real as (...a: unknown[]) => number).apply(fs, args)
    bytes += n
    return n
  } as typeof fs.readSync
  try {
    return { value: fn(), bytes }
  } finally {
    fs.readSync = real
  }
}

test('since-reads say what a full read says, for every since (file, projects and memory adapters)', () => {
  const file = new FileBoardRepository(tmp())
  const projects = new ProjectsBoardRepository(tmp())
  for (const [name, repo, dir] of [['file', file, file.dir], ['projects', projects, projects.dir]] as const) {
    const b = repo.create({ title: name, kind: 'freeform', items: [sticky('a')] })
    for (let i = 0; i < 25; i++) repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'x'.repeat(i * 37) } }], i % 2 ? 'user' : 'agent')
    agreesForEverySince(repo, b.id, logOf(dir, b.id), name)
    assert.equal(repo.changes(b.id, { since: 20, author: 'user' }).length, 3, name)
  }
  const mem = new MemoryBoardRepository()
  const b = mem.create({ title: 'memory', kind: 'freeform', items: [sticky('a')] })
  for (let i = 0; i < 5; i++) mem.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: `${i}` } }], 'user')
  for (let since = -1; since <= 7; since++) assert.deepEqual(mem.changes(b.id, { since }), mem.changes(b.id).filter((c) => c.seq > since), `memory since ${since}`)
})

test('reads between appends: each change this process writes is read back from the tail', () => {
  const dir = tmp()
  const repo = new FileBoardRepository(dir)
  const b = repo.create({ title: 't', kind: 'freeform', items: [sticky('a')] })
  for (let i = 0; i < 30; i++) {
    const c = repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'y'.repeat(i * 101) } }], 'user')
    assert.deepEqual(repo.changes(b.id, { since: c.seq - 1 }), [stored(c)])
    if (i % 10 === 9) agreesForEverySince(repo, b.id, logOf(dir, b.id), `after ${c.seq}`)
  }
})

test('another process appends: its lines are read too, in whatever JSON shape they come', () => {
  const dir = tmp()
  const repo = new FileBoardRepository(dir)
  const b = repo.create({ title: 't', kind: 'freeform', items: [sticky('a')] })
  for (let i = 0; i < 5; i++) repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: `${i}` } }], 'user')
  const file = logOf(dir, b.id)
  assert.equal(repo.changes(b.id, { since: 3 }).length, 3, 'the index is built')
  fs.appendFileSync(file, line(7, b.id, 'written elsewhere'))
  // spaces after the colons (another writer's JSON), seq not first, a blank line
  fs.appendFileSync(file, `{"seq": 8, "ts": "t", "author": "agent", "boardId": "${b.id}", "ops": [], "before": {}}\n`)
  fs.appendFileSync(file, '\n' + JSON.stringify({ ts: 't', seq: 9, author: 'user', boardId: b.id, ops: [], before: {} }) + '\n')
  assert.deepEqual(
    repo.changes(b.id, { since: 6 }).map((c) => c.seq),
    [7, 8, 9],
  )
  assert.deepEqual(
    repo.changes(b.id, { since: 8 }).map((c) => c.seq),
    [9],
  )
  agreesForEverySince(repo, b.id, file)
  // and this process writes after them (its own seq, 7 again: it never saw theirs)
  const c = repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'mine' } }], 'user')
  assert.deepEqual(repo.changes(b.id, { since: 6 }).at(-1), stored(c))
  agreesForEverySince(repo, b.id, file)
  // they append, then this process does before reading: both lines are found
  fs.appendFileSync(file, line(20, b.id, 'theirs'))
  const d = repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'mine again' } }], 'user')
  assert.deepEqual(
    repo.changes(b.id, { since: 7 }).map((x) => x.seq),
    [8, 9, 20, 8],
  )
  assert.deepEqual(repo.changes(b.id, { since: 7 }).at(-1), stored(d))
  agreesForEverySince(repo, b.id, file)
})

test('a log replaced, rewritten in place, truncated or removed is indexed again', () => {
  const dir = tmp()
  const repo = new FileBoardRepository(dir)
  const b = repo.create({ title: 't', kind: 'freeform', items: [sticky('a')] })
  for (let i = 0; i < 9; i++) repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'z'.repeat(i * 50) } }], 'user')
  const file = logOf(dir, b.id)
  assert.equal(repo.changes(b.id, { since: 5 }).length, 5)

  // truncated after the 6th line
  const text = fs.readFileSync(file, 'utf8')
  let cut = 0
  for (let n = 0; n < 6; n++) cut = text.indexOf('\n', cut) + 1
  fs.truncateSync(file, Buffer.byteLength(text.slice(0, cut)))
  assert.deepEqual(
    repo.changes(b.id, { since: 4 }).map((c) => c.seq),
    [5, 6],
  )
  agreesForEverySince(repo, b.id, file, 'truncated')
  const c11 = repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'after the cut' } }], 'user')
  assert.deepEqual(repo.changes(b.id, { since: 6 }), [stored(c11)])
  agreesForEverySince(repo, b.id, file, 'truncated, then written')

  // rewritten in place (same file, bigger, other line lengths)
  const rewritten = line(1, b.id, 'q'.repeat(5000)) + [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => line(s, b.id, `${s}`)).join('')
  fs.writeFileSync(file, rewritten)
  assert.deepEqual(
    repo.changes(b.id, { since: 10 }).map((c) => c.seq),
    [11, 12],
  )
  agreesForEverySince(repo, b.id, file, 'rewritten')

  // rewritten in place to the same size (other seqs, as many digits)
  fs.writeFileSync(file, rewritten.replace(/"seq":1(\d),/g, '"seq":2$1,'))
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(file, later, later) // a coarse clock could otherwise give the same mtime
  assert.deepEqual(
    repo.changes(b.id, { since: 20 }).map((c) => c.seq),
    [21, 22],
  )
  agreesForEverySince(repo, b.id, file, 'rewritten, same size')

  // replaced by another file: the same lines with other seqs, and one more
  const other = `${file}.new`
  fs.writeFileSync(other, fs.readFileSync(file, 'utf8').replace(/"seq":2(\d),/g, '"seq":3$1,') + line(33, b.id))
  fs.renameSync(other, file)
  assert.deepEqual(
    repo.changes(b.id, { since: 25 }).map((c) => c.seq),
    [30, 31, 32, 33],
  )
  agreesForEverySince(repo, b.id, file, 'replaced, grown')

  // replaced by a smaller file
  fs.writeFileSync(other, [1, 2, 3].map((s) => line(s, b.id, `replaced ${s}`)).join(''))
  fs.renameSync(other, file)
  assert.deepEqual(
    repo.changes(b.id, { since: 1 }).map((c) => c.note),
    ['replaced 2', 'replaced 3'],
  )
  agreesForEverySince(repo, b.id, file, 'replaced')

  // removed, then written again
  fs.unlinkSync(file)
  assert.deepEqual(repo.changes(b.id), [])
  const c = repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'again' } }], 'user')
  assert.deepEqual(repo.changes(b.id), [stored(c)])
})

test('a torn last line is never read or indexed; the next change gets a line of its own', () => {
  const dir = tmp()
  const repo = new FileBoardRepository(dir)
  const b = repo.create({ title: 'torn', kind: 'freeform', items: [sticky('a')] })
  for (let i = 0; i < 2; i++) repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: `${i}` } }], 'user')
  const file = logOf(dir, b.id)
  assert.equal(repo.changes(b.id).length, 3)
  fs.appendFileSync(file, '{"seq":4,"ts":"2026-10-') // a crash mid-write
  assert.equal(repo.changes(b.id).length, 3, 'reads skip it (a full parse used to throw)')
  assert.deepEqual(repo.changes(b.id, { since: 3 }), [])
  // a restart with no snapshot rebuilds from the complete lines
  fs.unlinkSync(path.join(dir, `${b.id}.json`))
  assert.equal(new FileBoardRepository(dir).get(b.id)?.seq, 3)

  const c = repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'after the crash' } }], 'user')
  assert.equal(c.seq, 4)
  assert.deepEqual(repo.changes(b.id, { since: 3 }), [stored(c)], 'not glued onto the torn bytes')
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8').trimEnd().split('\n').at(-1)!), stored(c))
  agreesForEverySince(repo, b.id, file, 'after a torn line')
  assert.equal(new FileBoardRepository(dir).changes(b.id).length, 4, 'a fresh index agrees')

  // a writer not done yet: its line counts once its newline is there
  const whole = line(5, b.id, 'slow writer')
  fs.appendFileSync(file, whole.slice(0, 40))
  assert.deepEqual(repo.changes(b.id, { since: 4 }), [])
  fs.appendFileSync(file, whole.slice(40))
  assert.deepEqual(
    repo.changes(b.id, { since: 4 }).map((x) => x.note),
    ['slow writer'],
  )
  agreesForEverySince(repo, b.id, file, 'finished line')
})

test('seqs that go down again (a board restored from an older snapshot) still read like a full read', () => {
  const dir = tmp()
  const repo = new FileBoardRepository(dir)
  const b = repo.create({ title: 'restored', kind: 'freeform', items: [sticky('a')] })
  for (let i = 0; i < 9; i++) repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: `${i}` } }], 'user')
  const file = logOf(dir, b.id)
  assert.equal(repo.changes(b.id, { since: 8 }).length, 2, 'the index is built')
  const snap = path.join(dir, `${b.id}.json`)
  fs.writeFileSync(snap, JSON.stringify({ ...JSON.parse(fs.readFileSync(snap, 'utf8')), seq: 4 }))
  const restored = new FileBoardRepository(dir)
  for (let i = 0; i < 3; i++) restored.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: `r${i}` } }], 'user')
  assert.deepEqual(
    fullRead(file).map((c) => c.seq),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 5, 6, 7],
  )
  assert.deepEqual(
    restored.changes(b.id, { since: 5 }).map((c) => c.seq),
    [6, 7, 8, 9, 10, 6, 7],
  )
  agreesForEverySince(restored, b.id, file, 'fresh index')
  agreesForEverySince(repo, b.id, file, 'extended index')
})

test('moveBoard between project dirs: reads follow the log; delete then create under the same id starts a new log', () => {
  const personal = tmp('personal')
  const projectRoot = (name: string) => {
    const root = path.join(tmp('root'), name)
    fs.mkdirSync(root, { recursive: true })
    return fs.realpathSync(root)
  }
  const repo = new ProjectsBoardRepository(personal)
  const p1 = repo.registerProject(projectRoot('one'))
  const p2 = repo.registerProject(projectRoot('two'))
  const b = repo.create({ title: 'moving', kind: 'freeform', items: [sticky('a')] })
  for (let i = 0; i < 4; i++) repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: `${i}` } }], 'user')
  assert.equal(repo.changes(b.id, { since: 2 }).length, 3, 'the index is built')
  let seq = 5
  for (const [project, dir] of [[p1.id, p1.boardsDir!], [p2.id, p2.boardsDir!], ['personal', personal], [p1.id, p1.boardsDir!]] as const) {
    repo.moveBoard(b.id, project)
    const file = logOf(dir, b.id)
    agreesForEverySince(repo, b.id, file, `moved to ${project}`)
    const c = repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: `in ${project}` } }], 'user')
    assert.equal(c.seq, ++seq)
    assert.deepEqual(repo.changes(b.id, { since: seq - 1 }), [stored(c)], project)
    agreesForEverySince(repo, b.id, file, `written in ${project}`)
  }
  assert.ok(repo.delete(b.id))
  const again = repo.create({ id: b.id, title: 'new board, same id', kind: 'freeform', project: p1.id, items: [sticky('n')] })
  assert.deepEqual(
    repo.changes(again.id).map((c) => c.note),
    ['create: new board, same id'],
  )
})

test('a large log: a read since near the end reads only the tail', () => {
  const dir = tmp()
  const id = 'b_large'
  const n = 300
  const note = 'x'.repeat(40_000)
  fs.writeFileSync(logOf(dir, id), Array.from({ length: n }, (_, i) => line(i + 1, id, note)).join(''))
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, title: 'large', kind: 'freeform', seq: n, createdAt: 't', updatedAt: 't', items: {} }))
  const size = fs.statSync(logOf(dir, id)).size
  const lineBytes = Buffer.byteLength(line(n, id, note))
  const repo = new FileBoardRepository(dir)

  const first = bytesRead(() => repo.changes(id, { since: n - 2 }))
  assert.deepEqual(
    first.value.map((c) => c.seq),
    [n - 1, n],
  )
  assert.ok(first.bytes >= size, 'the first read indexes the whole file once')
  const tail = bytesRead(() => repo.changes(id, { since: n - 2 }))
  assert.deepEqual(tail.value, first.value)
  assert.ok(tail.bytes <= 2 * lineBytes, `read ${tail.bytes} bytes for 2 lines of ${lineBytes}`)
  assert.equal(bytesRead(() => repo.changes(id, { since: n })).bytes, 0, 'nothing after the last seq: nothing read')

  const mine = bytesRead(() => repo.apply(id, [], 'user', 'mine'))
  assert.ok(mine.bytes <= 1, 'an append extends the index without reading the log back')
  const afterMine = bytesRead(() => repo.changes(id, { since: n }))
  assert.deepEqual(
    afterMine.value.map((c) => c.note),
    ['mine'],
  )
  assert.ok(afterMine.bytes < 1000, `read ${afterMine.bytes} bytes for one short line`)

  fs.appendFileSync(logOf(dir, id), line(n + 2, id, note))
  const theirs = bytesRead(() => repo.changes(id, { since: n + 1 }))
  assert.deepEqual(
    theirs.value.map((c) => c.seq),
    [n + 2],
  )
  assert.ok(theirs.bytes <= 2 * lineBytes + 1, `read ${theirs.bytes} bytes: the new line indexed, then read`)

  // a line still being written is looked at again once it is done — not the whole log
  const slow = line(n + 3, id, note)
  fs.appendFileSync(logOf(dir, id), slow.slice(0, 1000))
  assert.deepEqual(repo.changes(id, { since: n + 2 }), [])
  fs.appendFileSync(logOf(dir, id), slow.slice(1000))
  const done = bytesRead(() => repo.changes(id, { since: n + 2 }))
  assert.deepEqual(
    done.value.map((c) => c.seq),
    [n + 3],
  )
  assert.ok(done.bytes <= 2 * lineBytes + 1, `read ${done.bytes} bytes for the finished line`)
  assert.deepEqual(repo.changes(id, { since: 0 }), fullRead(logOf(dir, id)))
})

test('a change written by hand without before, ops or author is read repaired, and said once (river0825/unprose#10)', () => {
  const dir = tmp()
  const repo = new FileBoardRepository(dir)
  const b = repo.create({ title: 't', kind: 'freeform', items: [sticky('a')] })
  repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: '1' } }], 'user')
  const file = logOf(dir, b.id)
  const last = Math.max(...fullRead(file).map((c) => c.seq))
  // the line that blanked a board: no `before`
  fs.appendFileSync(file, JSON.stringify({ seq: last + 1, ts: 't', author: 'user', boardId: b.id, ops: [{ kind: 'update', id: 'a', patch: { text: 'by hand' } }] }) + '\n')
  // worse: `before` a list, an op of no known kind, an op that is not an object, no author
  fs.appendFileSync(file, JSON.stringify({ seq: last + 2, ts: 't', boardId: b.id, ops: [{ kind: 'update', id: 'a', patch: { text: 'x' } }, { kind: 'teleport', id: 'a' }, 'nonsense'], before: [] }) + '\n')
  const warned: string[] = []
  const warn = console.warn
  console.warn = (m: string) => void warned.push(m)
  try {
    const got = repo.changes(b.id, { since: last })
    assert.deepEqual(got.map((c) => c.before), [{}, {}])
    assert.deepEqual(got[0].ops, [{ kind: 'update', id: 'a', patch: { text: 'by hand' } }])
    assert.deepEqual(got[1].ops, [{ kind: 'update', id: 'a', patch: { text: 'x' } }])
    assert.equal(got[1].author, 'agent')
    repo.changes(b.id) // read again: nothing said twice
  } finally {
    console.warn = warn
  }
  assert.equal(warned.length, 2)
  assert.match(warned[0], new RegExp(`change ${last + 1}: no "before" \\(read as \\{\\}\\) — written by hand\\?`))
  assert.match(warned[1], new RegExp(`change ${last + 2}: no "before" \\(read as \\{\\}\\); 2 malformed op\\(s\\) left out; author null \\(read as the agent\\)`))
  // a well-formed change is read as written, and says nothing
  const c = repo.apply(b.id, [{ kind: 'update', id: 'a', patch: { text: 'fine' } }], 'user')
  assert.deepEqual(repo.changes(b.id).at(-1), stored(c))
  assert.equal(warned.length, 2)
})
