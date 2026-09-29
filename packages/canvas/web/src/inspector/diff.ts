// A small line-based unified diff (docs/studio.md §9): what the person changed
// in the source dialog, as the text the AI session reviews and applies.
// Pure; no dependency. Good for the few-thousand-line files a workflow has.
import type { DiscussModel } from './detail'

/** What "Ask AI to apply" sends: `data.discuss.edit`. */
export interface EditRequest {
  file?: string
  doc?: 'prompt'
  /** sha-1 (hex) of the snapshot text the edit was made on; `fnv1a:<hex>` where crypto.subtle is missing */
  base: string
  diff: string
}

/** The optional last argument of `onAnchoredComment`: ask AI (with a model), optionally to apply an edit. */
export interface DiscussArg {
  model: DiscussModel
  edit?: EditRequest
}

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
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  else lines[lines.length - 1] += NO_EOL
  return lines
}

/** Unified diff of `before` → `after` with `context` lines around each change; '' when equal. `patch -p1` applies it. */
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

/** The first changed line range of `before` (1-based), for anchoring the request on the text. */
export function firstChange(before: string, after: string): { line: number; endLine: number } | undefined {
  if (before === after) return undefined
  const a = splitLines(before)
  const ops = lineOps(a, splitLines(after))
  const k = ops.findIndex((o) => o.kind !== ' ')
  if (k < 0) return undefined
  let end = k
  while (end + 1 < ops.length && ops[end + 1].kind !== ' ') end++
  const removed = ops.slice(k, end + 1).filter((o) => o.kind === '-')
  const line = Math.min(a.length, ops[k].a + 1)
  return { line, endLine: removed.length ? removed[removed.length - 1].a + 1 : line }
}

/** sha-1 hex of `text` (crypto.subtle needs a secure context: https or localhost). */
export async function sha1(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const buf = await subtle.digest('SHA-1', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')
  }
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return `fnv1a:${h.toString(16).padStart(8, '0')}`
}
