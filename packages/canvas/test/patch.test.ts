// Unified diffs both ways (src/patch.ts): what the source dialog sends and what the server checks agents' proposals with.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyUnifiedDiff, diffPath, diffStat, firstChange, unifiedDiff } from '../src/patch.js'

const FILE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
const edit = (text: string, n: number, to: string) => text.replace(`line ${n}\n`, `${to}\n`)

test('round trip: unifiedDiff then applyUnifiedDiff gives the new text back', () => {
  const cases: Array<[string, string]> = [
    [FILE, edit(edit(FILE, 3, 'three'), 15, 'fifteen')],
    [FILE, FILE.replace('line 10\n', '')],
    [FILE, FILE.replace('line 10\n', 'line 10\nline 10.5\n')],
    [FILE, `zero\n${FILE}`],
    [FILE, `${FILE}twenty-one\n`],
    ['a\nb', 'a\nb\n'], // the last line gets its newline
    ['a\nb\n', 'a\nc'], // and loses it
    ['', 'new file\n'],
    ['only\n', ''],
  ]
  for (const [before, after] of cases) {
    const d = unifiedDiff(before, after, 'x.yaml')
    const r = applyUnifiedDiff(before, d)
    assert.ok(r.ok, `${JSON.stringify(after)}: ${!r.ok && r.error}`)
    assert.equal(r.ok && r.text, after)
    assert.ok(r.ok && r.offsets.every((o) => o === 0))
  }
})

test('a hunk whose header is off by some lines still applies (an offset), and says how far', () => {
  const after = edit(FILE, 12, 'twelve')
  const d = unifiedDiff(FILE, after, 'x.yaml').replace(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/, (_m, a, b, c, e) => `@@ -${Number(a) - 4},${b} +${Number(c) - 4},${e} @@`)
  const r = applyUnifiedDiff(FILE, d)
  assert.ok(r.ok, !r.ok ? r.error : '')
  assert.equal(r.ok && r.text, after)
  assert.deepEqual(r.ok && r.offsets, [4])
  // the same diff against a file that grew above the change
  const grown = `new 1\nnew 2\n${FILE}`
  const r2 = applyUnifiedDiff(grown, unifiedDiff(FILE, after, 'x.yaml'))
  assert.ok(r2.ok)
  assert.equal(r2.ok && r2.text, `new 1\nnew 2\n${after}`)
  assert.deepEqual(r2.ok && r2.offsets, [2])
})

test('a conflict: a context or removed line that is not in the file refuses the whole diff, naming the hunk', () => {
  const d = unifiedDiff(FILE, edit(edit(FILE, 3, 'three'), 15, 'fifteen'), 'x.yaml')
  const changed = FILE.replace('line 16\n', 'line sixteen\n') // context of hunk 2
  const r = applyUnifiedDiff(changed, d)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.hunk, 2)
  assert.match(!r.ok ? r.error : '', /hunk 2 .* does not apply/)
})

test('malformed diffs are refused with a reason', () => {
  assert.match((applyUnifiedDiff(FILE, 'just words') as { error: string }).error, /no hunks/)
  assert.match((applyUnifiedDiff(FILE, '@@ -1,2 +1,2 @@\n-line 1\n+one\n') as { error: string }).error, /says 2 old \/ 2 new lines but has 1 \/ 1/)
  const two = `${unifiedDiff('a\n', 'b\n', 'a.txt')}${unifiedDiff('c\n', 'd\n', 'c.txt')}`
  assert.match((applyUnifiedDiff('a\n', two) as { error: string }).error, /more than one file/)
  assert.match((applyUnifiedDiff(FILE, '@@ -1,1 +1,1 @@\n*line 1\n') as { error: string }).error, /not part of a hunk/)
})

test('an editor that ate the space of an empty context line does not break the hunk', () => {
  const text = 'a\n\nb\nc\n'
  const d = unifiedDiff(text, 'a\n\nb\nC\n', 'f').replace('\n \n', '\n\n')
  const r = applyUnifiedDiff(text, d)
  assert.ok(r.ok, !r.ok ? r.error : '')
  assert.equal(r.ok && r.text, 'a\n\nb\nC\n')
})

test('helpers: path, stat, first change', () => {
  const d = unifiedDiff(FILE, edit(FILE, 5, 'five'), 'examples/w/workflow.yaml')
  assert.equal(diffPath(d), 'examples/w/workflow.yaml')
  assert.deepEqual(diffStat(d), { added: 1, removed: 1 })
  assert.deepEqual(firstChange(FILE, edit(FILE, 5, 'five')), { line: 5, endLine: 5 })
  assert.equal(diffPath('@@ -1 +1 @@\n-a\n+b\n'), undefined)
})
