// Line-based unified diffs, both ways (docs/canvas.md "Proposals"): make one from two texts, and apply one
// to a text. Pure and dependency-free — the web UI imports it too (the source dialog's "Ask AI to apply"), and
// the server uses it to check an agent's proposed edit against the board's snapshot of the file.

type Op = { kind: ' ' | '-' | '+'; text: string; a: number; b: number }

/** Line ops turning `a` into `b` (longest common subsequence after trimming the shared ends). */
function lineOps(a: string[], b: string[]): Op[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB), flattened
  const lcs = new Int32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[at(i, j)] = a[start + i] === b[start + j] ? lcs[at(i + 1, j + 1)] + 1 : Math.max(lcs[at(i + 1, j)], lcs[at(i, j + 1)])

  const ops: Op[] = []
  for (let k = 0; k < start; k++) ops.push({ kind: ' ', text: a[k], a: k, b: k })
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      ops.push({ kind: ' ', text: a[start + i], a: start + i, b: start + j })
      i++
      j++
    } else if (i < n && (j === m || lcs[at(i + 1, j)] >= lcs[at(i, j + 1)])) {
      // deletions before insertions, as diff(1) writes them
      ops.push({ kind: '-', text: a[start + i], a: start + i, b: start + j })
      i++
    } else {
      ops.push({ kind: '+', text: b[start + j], a: start + i, b: start + j })
      j++
    }
  }
  for (let k = 0; k < a.length - endA; k++) ops.push({ kind: ' ', text: a[endA + k], a: endA + k, b: endB + k })
  return ops
}

// A last line without a newline differs from the same line with one; the mark keeps them apart.
const NO_EOL = '\u0000'
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  else lines[lines.length - 1] += NO_EOL
  return lines
}
function joinLines(lines: string[]): string {
  return lines.map((l) => (l.endsWith(NO_EOL) ? l.slice(0, -1) : `${l}\n`)).join('')
}

/** Unified diff of `before` → `after` with `context` lines around each change; '' when equal. `patch -p1` / `git apply` apply it. */
export function unifiedDiff(before: string, after: string, path = 'file', context = 3): string {
  if (before === after) return ''
  const ops = lineOps(splitLines(before), splitLines(after))
  const changed = ops.map((o, k) => (o.kind !== ' ' ? k : -1)).filter((k) => k >= 0)
  const out = [`--- a/${path}`, `+++ b/${path}`]
  let k = 0
  while (k < changed.length) {
    // one hunk: changes closer than 2×context share it
    const lo = Math.max(0, changed[k] - context)
    let hiChange = changed[k]
    while (k + 1 < changed.length && changed[k + 1] - hiChange <= context * 2) hiChange = changed[++k]
    const hi = Math.min(ops.length - 1, hiChange + context)
    const slice = ops.slice(lo, hi + 1)
    const aStart = slice[0].a + 1
    const bStart = slice[0].b + 1
    const aLen = slice.filter((o) => o.kind !== '+').length
    const bLen = slice.filter((o) => o.kind !== '-').length
    out.push(`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`)
    for (const o of slice) {
      if (o.text.endsWith(NO_EOL)) out.push(`${o.kind}${o.text.slice(0, -1)}`, '\\ No newline at end of file')
      else out.push(`${o.kind}${o.text}`)
    }
    k++
  }
  return out.join('\n') + '\n'
}

/** The first changed line range of `before` (1-based), for anchoring a request on the text. */
export function firstChange(before: string, after: string): { line: number; endLine: number } | undefined {
  if (before === after) return undefined
  const a = splitLines(before)
  const ops = lineOps(a, splitLines(after))
  const k = ops.findIndex((o) => o.kind !== ' ')
  if (k < 0) return undefined
  let end = k
  while (end + 1 < ops.length && ops[end + 1].kind !== ' ') end++
  const removed = ops.slice(k, end + 1).filter((o) => o.kind === '-')
  const line = Math.max(1, Math.min(a.length, ops[k].a + 1))
  return { line, endLine: removed.length ? removed[removed.length - 1].a + 1 : line }
}

/** Lines added and removed by a unified diff (headers not counted). */
export function diffStat(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue
    if (l.startsWith('+')) added++
    else if (l.startsWith('-')) removed++
  }
  return { added, removed }
}

interface Hunk {
  header: string
  aStart: number
  aLen: number
  bStart: number
  bLen: number
  old: string[]
  new: string[]
}

export type ApplyResult = { ok: true; text: string; /** per hunk: how many lines away from its header it applied (0 = where it said) */ offsets: number[] } | { ok: false; error: string; hunk?: number }

const strip = (p: string) => p.replace(/^[ab]\//, '').replace(/\t.*$/, '').trim()

/** The file a diff names in its `+++` (else `---`) header, without the `a/` / `b/` prefix; undefined without headers. */
export function diffPath(diff: string): string | undefined {
  const plus = diff.split('\n').find((l) => l.startsWith('+++ '))
  const minus = diff.split('\n').find((l) => l.startsWith('--- '))
  const p = plus ? strip(plus.slice(4)) : minus ? strip(minus.slice(4)) : undefined
  return p && p !== '/dev/null' ? p : undefined
}

function parseHunks(diff: string): Hunk[] | string {
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const hunks: Hunk[] = []
  let files = 0
  let cur: Hunk | undefined
  let last: ' ' | '-' | '+' | undefined
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const m = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (m) {
      cur = { header: m[0], aStart: Number(m[1]), aLen: m[2] === undefined ? 1 : Number(m[2]), bStart: Number(m[3]), bLen: m[4] === undefined ? 1 : Number(m[4]), old: [], new: [] }
      hunks.push(cur)
      last = undefined
      continue
    }
    const inBody = cur && (cur.old.length < cur.aLen || cur.new.length < cur.bLen)
    if (!inBody) {
      if (l.startsWith('--- ')) {
        files++
        if (files > 1) return 'the diff touches more than one file: propose one file at a time'
      }
      if (l.startsWith('\\') && cur && last) {
        // "\ No newline at end of file" after the hunk's last line
        if (last !== '+') cur.old[cur.old.length - 1] += NO_EOL
        if (last !== '-') cur.new[cur.new.length - 1] += NO_EOL
      }
      // headers (diff --git, index, ---, +++) and anything between hunks
      continue
    }
    if (l.startsWith('\\')) {
      if (last && last !== '+') cur!.old[cur!.old.length - 1] += NO_EOL
      if (last && last !== '-') cur!.new[cur!.new.length - 1] += NO_EOL
      continue
    }
    // an empty line in a hunk is a context line whose trailing space an editor ate
    const kind = (l === '' ? ' ' : l[0]) as ' ' | '-' | '+'
    const body = l.slice(1)
    if (kind === ' ') {
      cur!.old.push(body)
      cur!.new.push(body)
    } else if (kind === '-') cur!.old.push(body)
    else if (kind === '+') cur!.new.push(body)
    else return `line ${i + 1} of the diff is not part of a hunk (it should start with " ", "-" or "+"): ${JSON.stringify(l.slice(0, 80))}`
    last = kind
  }
  if (!hunks.length) return 'no hunks (@@ -a,b +c,d @@) in the diff'
  for (const [k, h] of hunks.entries()) {
    if (h.old.length !== h.aLen || h.new.length !== h.bLen) return `hunk ${k + 1} (${h.header}) says ${h.aLen} old / ${h.bLen} new lines but has ${h.old.length} / ${h.new.length}`
  }
  return hunks
}

/**
 * Apply a unified diff to `text`. Each hunk's old lines (context and removals) must match exactly; a hunk may
 * sit some lines away from where its header says (an offset, like `patch`), but never overlap the previous
 * hunk. No fuzz: a context line that differs is a conflict.
 */
export function applyUnifiedDiff(text: string, diff: string): ApplyResult {
  const parsed = parseHunks(diff)
  if (typeof parsed === 'string') return { ok: false, error: parsed }
  const lines = splitLines(text)
  const out: string[] = []
  let cursor = 0 // lines of `text` consumed so far
  let delta = 0 // how far the previous hunks moved from their headers
  const offsets: number[] = []
  for (const [k, h] of parsed.entries()) {
    // where the header says the old lines start (0-based); a pure insertion (aLen 0) goes after line aStart
    const want = (h.aLen === 0 ? h.aStart : h.aStart - 1) + delta
    const fits = (at: number) => at >= cursor && at + h.old.length <= lines.length && h.old.every((l, i) => lines[at + i] === l)
    let at = -1
    if (h.old.length === 0) at = Math.min(Math.max(want, cursor), lines.length)
    else
      for (let d = 0; d <= lines.length; d++) {
        if (fits(want - d)) {
          at = want - d
          break
        }
        if (d && fits(want + d)) {
          at = want + d
          break
        }
      }
    if (at < 0) {
      const near = lines.slice(Math.max(0, want - 1), want + Math.max(3, h.old.length + 1)).map((l) => l.replace(NO_EOL, ''))
      return { ok: false, hunk: k + 1, error: `hunk ${k + 1} (${h.header}) does not apply: its context and removed lines are not in the file${near.length ? ` (around line ${Math.max(1, want)} the file says: ${JSON.stringify(near.join('\n').slice(0, 200))})` : ''}` }
    }
    // the hunk's own offset from its header; later hunks start looking that far away too
    delta = at - (h.aLen === 0 ? h.aStart : h.aStart - 1)
    offsets.push(delta)
    out.push(...lines.slice(cursor, at), ...h.new)
    cursor = at + h.old.length
  }
  out.push(...lines.slice(cursor))
  // a line that lost its "no newline" mark in the middle of the file gets its newline back
  const fixed = out.map((l, i) => (i < out.length - 1 && l.endsWith(NO_EOL) ? l.slice(0, -1) : l))
  return { ok: true, text: joinLines(fixed), offsets }
}
