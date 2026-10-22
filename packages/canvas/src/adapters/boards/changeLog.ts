// The change log files of the file adapters: `<id>.changes.ndjson`, one JSON change per line, only ever
// appended to. Parsing a whole log on every read (each GET changes, each wake check of a wait) took ~260 ms
// on a 100 MB log and blocked the server, so each log keeps an index — where every line starts and ends,
// and its seq — built by one scan and extended as the file grows; a read since N reads only the lines after N.
//
// The file stays the truth: each use looks at it first. Grown (another process appended): only the new
// bytes are indexed. Shrunk, replaced or rewritten: indexed again. Gone: forgotten. A line counts once it
// ends in a newline — a torn last line (a crash mid-write, a writer not done yet) is never read or indexed.
//
// A line may have been written by hand (a board rebuilt after a loss): one without `before` once blanked the whole
// board (river0825/unprose#10). Each change is read as the canvas can use it (repairChange), and what was repaired is
// logged once, with its seq.

import fs from 'node:fs'
import path from 'node:path'
import type { Change } from '../../model.js'

interface Index {
  dev: number
  ino: number
  /** The file's size and mtime when last looked at. */
  size: number
  mtimeMs: number
  /** Just past the last newline indexed: scanning resumes here (a torn last line starts here). */
  end: number
  /** Per complete line: where it starts, where its newline is, its seq. */
  starts: number[]
  ends: number[]
  seqs: number[]
  /** Seqs never go down. Not a given: a board restored from an older snapshot writes lower seqs again. */
  ordered: boolean
}

const NL = 0x0a
const CHUNK = 1 << 20
/** Enough of a line to read its seq from. */
const HEAD = 64
/** `{"seq":12,` — JSON.stringify(change) writes seq first; other writers may put spaces in. */
const SEQ_HEAD = /^\{\s*"seq"\s*:\s*(\d+)\s*[,}]/

export class ChangeLogFiles {
  /** By absolute path. */
  private indexes = new Map<string, Index>()
  /** `<path>#<seq>` of the repaired changes already logged */
  private warned = new Set<string>()

  /** Append one change as a line (creating the file). */
  append(file: string, change: Change): void {
    const key = path.resolve(file)
    const line = Buffer.from(JSON.stringify(change) + '\n')
    const fd = fs.openSync(key, 'a+')
    try {
      const before = fs.fstatSync(fd)
      // a torn last line gets its newline first, so this change is never glued onto it (and lost with it)
      const torn = before.size > 0 && byteAt(fd, before.size - 1) !== NL
      const bytes = torn ? Buffer.concat([Buffer.from('\n'), line]) : line
      for (let off = 0; off < bytes.length; ) off += fs.writeSync(fd, bytes, off, bytes.length - off)
      const after = fs.fstatSync(fd)
      // extend the index only when it was current and nothing else wrote meanwhile; else the next read catches up
      const idx = this.indexes.get(key)
      if (idx && !torn && idx.end === idx.size && same(idx, before) && after.size === before.size + bytes.length) {
        add(idx, before.size, after.size - 1, change.seq)
        idx.end = idx.size = after.size
        idx.mtimeMs = after.mtimeMs
      }
    } finally {
      fs.closeSync(fd)
    }
  }

  /** The changes with seq > `since` (all of them without it), in file order. A missing file has none. */
  read(file: string, since?: number): Change[] {
    const key = path.resolve(file)
    let fd: number
    try {
      fd = fs.openSync(key, 'r')
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e
      this.indexes.delete(key)
      return []
    }
    try {
      const idx = this.refresh(key, fd)
      const n = idx.seqs.length
      const k = since === undefined ? 0 : firstAfter(idx, since)
      if (k >= n) return []
      const from = idx.starts[k]
      const buf = Buffer.allocUnsafe(idx.ends[n - 1] - from)
      const got = readAt(fd, buf, from)
      const out: Change[] = []
      for (let j = k; j < n && idx.ends[j] - from <= got; j++) {
        if (since !== undefined && idx.seqs[j] <= since) continue
        let c: Change
        try {
          c = JSON.parse(buf.toString('utf8', idx.starts[j] - from, idx.ends[j] - from)) as Change
        } catch {
          continue // a torn line a later append was put behind
        }
        if (typeof c?.seq !== 'number' || (since !== undefined && c.seq <= since)) continue
        const problems = repairChange(c)
        if (problems.length && !this.warned.has(`${key}#${c.seq}`)) {
          this.warned.add(`${key}#${c.seq}`)
          console.warn(`awd-canvas: ${key}: change ${c.seq}: ${problems.join('; ')} — written by hand? It is read repaired.`)
        }
        out.push(c)
      }
      return out
    } finally {
      fs.closeSync(fd)
    }
  }

  /** The file was moved or removed by its adapter. */
  forget(file: string): void {
    this.indexes.delete(path.resolve(file))
  }

  /** The index of the open file, brought up to date with what is in it now. */
  private refresh(key: string, fd: number): Index {
    const st = fs.fstatSync(fd)
    let idx = this.indexes.get(key)
    if (idx && (st.ino !== idx.ino || st.dev !== idx.dev || st.size < idx.size || (st.size === idx.size && st.mtimeMs !== idx.mtimeMs) || (st.size > idx.size && idx.end > 0 && byteAt(fd, idx.end - 1) !== NL))) {
      idx = undefined // another file now, shrunk, or rewritten in place: what was indexed may not be there any more
    }
    if (!idx) {
      idx = { dev: st.dev, ino: st.ino, size: 0, mtimeMs: st.mtimeMs, end: 0, starts: [], ends: [], seqs: [], ordered: true }
      this.indexes.set(key, idx)
    }
    if (st.size !== idx.size) scan(fd, idx, st.size)
    idx.size = st.size
    idx.mtimeMs = st.mtimeMs
    return idx
  }
}

/**
 * A change read from a line, repaired in place so the canvas can use it: `before` missing (or not an object) reads as
 * {} — nothing known of the items before —, `ops` not a list as none, an op that is not an add / update / remove with
 * its fields is left out, an author that is neither as the agent. Returns what was repaired (none: as written).
 */
export function repairChange(c: Change): string[] {
  const problems: string[] = []
  const raw = c as unknown as Record<string, unknown>
  if (!isObject(raw.before)) {
    problems.push('no "before" (read as {})')
    c.before = {}
  }
  if (!Array.isArray(raw.ops)) {
    problems.push('no "ops" list (read as none)')
    c.ops = []
  }
  const ops = c.ops.filter(isOp)
  if (ops.length !== c.ops.length) {
    problems.push(`${c.ops.length - ops.length} malformed op(s) left out`)
    c.ops = ops
  }
  if (c.author !== 'user' && c.author !== 'agent') {
    problems.push(`author ${JSON.stringify(c.author ?? null)} (read as the agent)`)
    c.author = 'agent'
  }
  return problems
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function isOp(op: unknown): boolean {
  if (!isObject(op)) return false
  if (op.kind === 'add') return isObject(op.item) && typeof op.item.id === 'string'
  if (op.kind === 'update') return typeof op.id === 'string' && isObject(op.patch)
  return op.kind === 'remove' && typeof op.id === 'string'
}

function same(idx: Index, st: fs.Stats): boolean {
  return st.ino === idx.ino && st.dev === idx.dev && st.size === idx.size && st.mtimeMs === idx.mtimeMs
}

function add(idx: Index, start: number, end: number, seq: number) {
  if (idx.seqs.length && seq < idx.seqs[idx.seqs.length - 1]) idx.ordered = false
  idx.starts.push(start)
  idx.ends.push(end)
  idx.seqs.push(seq)
}

/** The first indexed line with seq > since (binary search while the seqs are ordered). */
function firstAfter(idx: Index, since: number): number {
  const s = idx.seqs
  if (!idx.ordered) {
    const k = s.findIndex((q) => q > since)
    return k === -1 ? s.length : k
  }
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (s[mid] > since) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Index the complete lines from `idx.end` up to `to`. */
function scan(fd: number, idx: Index, to: number) {
  const buf = Buffer.allocUnsafe(Math.max(1, Math.min(CHUNK, to - idx.end)))
  let pos = idx.end // the file offset of buf[0]
  let start = idx.end // where the current line starts
  while (pos < to) {
    const n = fs.readSync(fd, buf, 0, Math.min(buf.length, to - pos), pos)
    if (n <= 0) break // shrunk meanwhile: the next look sees it and starts over
    const view = n === buf.length ? buf : buf.subarray(0, n)
    for (let nl = view.indexOf(NL); nl !== -1; nl = view.indexOf(NL, nl + 1)) {
      const end = pos + nl
      if (end > start) indexLine(fd, idx, start, end, start >= pos ? view.subarray(start - pos, Math.min(nl, start - pos + HEAD)) : undefined)
      start = end + 1
    }
    pos += n
  }
  idx.end = start
}

/** Learn a complete line's seq from its head, or by parsing it when it does not start with one. */
function indexLine(fd: number, idx: Index, start: number, end: number, head?: Buffer) {
  if (!head) {
    head = Buffer.allocUnsafe(Math.min(HEAD, end - start))
    head = head.subarray(0, readAt(fd, head, start))
  }
  const m = SEQ_HEAD.exec(head.toString('latin1'))
  let seq = m ? Number(m[1]) : undefined
  if (seq === undefined) {
    const line = Buffer.allocUnsafe(end - start)
    try {
      const c = JSON.parse(line.toString('utf8', 0, readAt(fd, line, start))) as Partial<Change> | null
      if (typeof c?.seq === 'number') seq = c.seq
    } catch {
      // not a change (a torn line a later append was put behind, a blank line): never read
    }
  }
  if (seq !== undefined) add(idx, start, end, seq)
}

function byteAt(fd: number, pos: number): number {
  const b = Buffer.alloc(1)
  return fs.readSync(fd, b, 0, 1, pos) === 1 ? b[0] : -1
}

/** Fill `buf` from `pos`; fewer bytes only when the file ends sooner. */
function readAt(fd: number, buf: Buffer, pos: number): number {
  let got = 0
  while (got < buf.length) {
    const n = fs.readSync(fd, buf, got, buf.length - got, pos + got)
    if (n <= 0) break
    got += n
  }
  return got
}
