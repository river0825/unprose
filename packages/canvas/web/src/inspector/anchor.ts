// Comments on lines of text (docs/studio.md §5), the pure half: where an
// anchored comment sits after the text changed, which block owns a line of a
// file, and which comments belong to which text.
import type { Board, Item } from '../../../src/model'
import { detailOf } from './detail'

/** `data.anchor` of a comment: lines of a file, or of a derived text such as an ai step's prompt. */
export interface Anchor {
  file?: string
  doc?: 'prompt'
  line: number
  endLine?: number
  quote: string
}

/** The text a view shows: a file of the snapshot, or the prompt of one block. */
export type TextSource = { file: string } | { doc: 'prompt'; block: string }

export function anchorOf(item: Item): Anchor | undefined {
  const a = item.data?.anchor as Partial<Anchor> | undefined
  if (!a || typeof a !== 'object' || typeof a.line !== 'number' || typeof a.quote !== 'string') return undefined
  return a as Anchor
}

/** The files behind the workflow, as the last redraw put them on the board. */
/** The files snapshot on the board: the workflow's, plus every diagram frame's (docs/diagrams.md §2). */
export function filesOf(board: Board): Record<string, string> {
  const asFiles = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, string>) : {})
  const wf = board.meta?.workflow as { files?: unknown } | undefined
  const diagrams = board.meta?.diagrams as Record<string, { files?: unknown }> | undefined
  const out: Record<string, string> = { ...asFiles(wf?.files) }
  for (const d of Object.values(diagrams && typeof diagrams === 'object' ? diagrams : {})) Object.assign(out, asFiles(d?.files))
  return out
}

export function truncatedOf(board: Board): string[] {
  const wf = board.meta?.workflow as { truncated?: unknown } | undefined
  return Array.isArray(wf?.truncated) ? (wf.truncated as string[]) : []
}

/** The quote for lines `line..endLine` (1-based) of `text`. */
export function quoteOf(text: string, line: number, endLine = line): string {
  return text.split('\n').slice(line - 1, endLine).join('\n')
}

/**
 * Where the anchor's quote is now: the match nearest to the line it was written
 * on, or null when the quote is gone (the comment is outdated, never lost).
 */
export function relocate(lines: string[], a: Anchor): { line: number; endLine: number } | null {
  const want = a.quote.split('\n').map((l) => l.trimEnd())
  const n = want.length
  const span = (a.endLine ?? a.line) - a.line
  if (!a.quote.trim()) return a.line <= lines.length ? { line: a.line, endLine: Math.min(lines.length, a.line + span) } : null
  let best: number | null = null
  for (let i = 0; i + n <= lines.length; i++) {
    if (lines[i].trimEnd() !== want[0]) continue
    let ok = true
    for (let k = 1; k < n && ok; k++) ok = lines[i + k].trimEnd() === want[k]
    if (ok && (best === null || Math.abs(i + 1 - a.line) < Math.abs(best - a.line))) best = i + 1
  }
  return best === null ? null : { line: best, endLine: best + n - 1 }
}

/** Does this anchored comment belong to the text `src`? */
export function isOn(item: Item, a: Anchor, src: TextSource): boolean {
  return 'file' in src ? a.file === src.file : a.doc === 'prompt' && item.target === src.block
}

/** Root comments (not replies) anchored on `src`, oldest first. */
export function anchoredOn(board: Board, src: TextSource): Array<{ item: Item; anchor: Anchor }> {
  const out: Array<{ item: Item; anchor: Anchor }> = []
  for (const it of Object.values(board.items)) {
    if (it.type !== 'comment') continue
    const a = anchorOf(it)
    if (!a || !isOn(it, a, src)) continue
    if (it.target && board.items[it.target]?.type === 'comment') continue
    out.push({ item: it, anchor: a })
  }
  return out.sort((x, y) => x.item.updatedAt.localeCompare(y.item.updatedAt))
}

/**
 * The block a line of a file belongs to: the block whose own file it is
 * (persona, prompt, script), else the step/agent/trigger whose yaml range holds
 * the line (narrowest wins), else the board's title item.
 */
export function ownerOf(board: Board, file: string, line: number): string | undefined {
  let byFile: string | undefined
  let byRange: { id: string; size: number } | undefined
  for (const it of Object.values(board.items)) {
    const d = detailOf(it)
    if (!d) continue
    if ('file' in d && d.file === file) byFile ??= it.id
    const r = yamlRange(it)
    if (r && d.source?.workflow === file && line >= r.start && line <= r.end && (!byRange || r.end - r.start < byRange.size)) byRange = { id: it.id, size: r.end - r.start }
  }
  if (byFile) return byFile
  if (byRange) return byRange.id
  if (board.items['wf.title']) return 'wf.title'
  return Object.values(board.items).find((i) => i.role === 'title')?.id
}

/** `detail.yaml`: the block's line range in the workflow file. */
export function yamlRange(item: Item | undefined): { start: number; end: number } | undefined {
  const y = (item?.data?.detail as { yaml?: { start?: unknown; end?: unknown } } | undefined)?.yaml
  return y && typeof y.start === 'number' && typeof y.end === 'number' ? { start: y.start, end: y.end } : undefined
}

/** `planner.md:12–14 "You are the planner…"` */
export function anchorLabel(a: Anchor, max = 28): string {
  const where = a.file ? a.file.split('/').pop() : 'prompt'
  const lines = a.endLine && a.endLine !== a.line ? `${a.line}–${a.endLine}` : `${a.line}`
  const q = a.quote.split('\n').find((l) => l.trim())?.trim() ?? ''
  return `${where}:${lines}${q ? ` "${q.length > max ? `${q.slice(0, max - 1)}…` : q}"` : ''}`
}
