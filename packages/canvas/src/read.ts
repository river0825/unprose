// Reading a board at agent scale (docs/canvas.md "Reading big boards"): filters (a frame, types, ids, a text),
// three formats (outline, json, summary), pages (`limit` / `cursor`) and a hard size cap that says what it left
// out and how to get it. Pure — the server, the MCP tool and the CLI all use it.
import { isAnnotationCard, isAnnotationDraft } from './annotations.js'
import { diagramSpecOf, type Board, type Item } from './model.js'
import { isTodo, todoCounts } from './todos.js'
import { containmentTree, frameKeys, isContainer, itemsInFrame, KIND_LABEL, outline, pendingTag, resolveFrame, rootOf, short, withThreads, byPos, descendants } from './outline.js'
import { contextOf, displayName, holdersOf, responderLabel, responderOf } from './routing.js'

export type ReadFormat = 'outline' | 'json' | 'summary'

/** Characters an answer may have unless the caller asks for more (≈ 10k tokens). */
export const DEFAULT_MAX_CHARS = 40_000
/** Never more than this in one answer, whatever is asked. */
export const HARD_MAX_CHARS = 200_000

export interface ReadOptions {
  /** a diagram key ('studio-es'), a frame or container id, or the board kind of a legacy board */
  frame?: string
  /** item types or roles: ['sticky', 'comment'], ['event', 'hotspot'] */
  types?: string[]
  /** exact item ids (their comment threads come along) */
  ids?: string[]
  /** case-insensitive substring of an item's text, label or id */
  text?: string
  /** json: which item fields to return (id is always there); default all but `data` heavy keys trimmed */
  fields?: string[]
  format?: ReadFormat
  /** items per page (json, default 200) or lines per page (outline, default: until the size cap) */
  limit?: number
  /** from the previous answer's "next cursor" */
  cursor?: string
  /** size cap in characters (default 40 000, at most 200 000) */
  maxChars?: number
}

export class ReadError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface ReadResult {
  format: ReadFormat
  /** the answer as text (outline, summary, or json text) */
  text: string
  /** items the filters matched */
  matched: number
  /** json: the items on this page */
  items?: Array<Partial<Item>>
  /** where the next page starts, when there is one */
  nextCursor?: string
  /** a sentence saying what was left out and how to get it */
  more?: string
  seq: number
}

const FILTER_KEYS = ['frame', 'types', 'ids', 'text'] as const

/** The ids the filters select (undefined = no filter: the whole board). */
export function selectIds(board: Board, o: Pick<ReadOptions, 'frame' | 'types' | 'ids' | 'text'>): Set<string> | undefined {
  if (!FILTER_KEYS.some((k) => o[k] !== undefined && (Array.isArray(o[k]) ? (o[k] as unknown[]).length : o[k] !== ''))) return undefined
  const tree = containmentTree(board)
  let set: Set<string> = new Set(Object.keys(board.items))
  if (o.frame) {
    const f = resolveFrame(board, o.frame)
    if (!f) throw new ReadError(404, `no frame "${o.frame}" on this board — diagram keys: ${frameKeys(board).join(', ') || '(none)'}; or pass a frame / lane item id`)
    set = itemsInFrame(board, f, tree)
  }
  if (o.ids?.length) {
    const missing = o.ids.filter((id) => !board.items[id])
    if (missing.length === o.ids.length) throw new ReadError(404, `no item ${missing.map((m) => `"${m}"`).join(', ')} on this board`)
    const want = new Set(o.ids.filter((id) => board.items[id]))
    // a container brings what it holds
    for (const id of [...want]) if (isContainer(board.items[id])) for (const d of descendants(tree, id)) want.add(d)
    set = new Set([...withThreads(board, want)].filter((id) => set.has(id)))
  }
  if (o.types?.length) {
    const t = new Set(o.types.map((x) => x.toLowerCase()))
    set = new Set([...set].filter((id) => {
      const it = board.items[id]
      const ui = (it.data?.ui as { type?: string } | undefined)?.type
      return t.has(it.type) || (it.role && t.has(it.role.toLowerCase())) || (ui && t.has(ui)) || (t.has('thread') && it.type === 'comment') || (t.has('annotation') && isAnnotationCard(it)) || (t.has('todo') && isTodo(it))
    }))
  }
  if (o.text) {
    const q = o.text.toLowerCase()
    set = new Set([...set].filter((id) => {
      const it = board.items[id]
      return (it.text ?? '').toLowerCase().includes(q) || (it.label ?? '').toLowerCase().includes(q) || id.toLowerCase().includes(q)
    }))
  }
  return set
}

const cap = (o: ReadOptions) => Math.min(HARD_MAX_CHARS, Math.max(2_000, o.maxChars ?? DEFAULT_MAX_CHARS))

/** `<seq>:<offset>` — a cursor from an older board state still works, it just says so. */
function parseCursor(c: string | undefined, seq: number): { offset: number; stale: boolean } {
  if (!c) return { offset: 0, stale: false }
  const m = /^(?:[a-z]+:)?(\d+):(\d+)$/.exec(c.trim())
  if (!m) throw new ReadError(400, `cursor "${c}" is not one this canvas gave out (it looks like "56:120")`)
  return { offset: Number(m[2]), stale: Number(m[1]) !== seq }
}

/** Keys of `data` that are large and rarely needed to reason about the board. */
const HEAVY_DATA = new Set(['detail', 'ui', 'discuss'])

function pick(it: Item, fields: string[] | undefined): Partial<Item> {
  if (fields?.length) {
    const out: Record<string, unknown> = { id: it.id }
    for (const f of fields) {
      if (f.startsWith('data.')) {
        const k = f.slice(5)
        if (it.data && k in it.data) out[f] = it.data[k]
      } else if (f in it) out[f] = (it as unknown as Record<string, unknown>)[f]
    }
    return out as Partial<Item>
  }
  // default: everything, with the bulky data keys summarised (ask for them with fields: ['data'] or ['data.ui'])
  if (!it.data) return it
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(it.data)) {
    const s = JSON.stringify(v) ?? ''
    data[k] = HEAVY_DATA.has(k) && s.length > 300 ? `(${s.length} chars — fields: ["data.${k}"])` : v
  }
  return { ...it, data }
}

/** Read a board: see ReadOptions. Throws ReadError for an unknown frame / ids or a bad cursor. */
export function readBoard(board: Board, o: ReadOptions = {}): ReadResult {
  const format = o.format ?? 'outline'
  const only = selectIds(board, o)
  const matched = only ? only.size : Object.keys(board.items).length
  if (format === 'summary') return { format, text: summaryText(board, only, o), matched, seq: board.seq }
  const max = cap(o)
  const { offset, stale } = parseCursor(o.cursor, board.seq)
  const staleNote = stale ? ` (the board changed since that cursor — seq ${board.seq} now; re-read from the start if things look off)` : ''
  const filters = FILTER_KEYS.filter((k) => o[k] !== undefined).map((k) => `${k}: ${JSON.stringify(o[k])}`)
  const again = (next: string) => `canvas_read_board({ id: "${board.id}", format: "${format}"${filters.length ? `, ${filters.join(', ')}` : ''}, cursor: "${next}" })`

  if (format === 'json') {
    const order = Object.values(board.items).filter((i) => !only || only.has(i.id)).sort((a, b) => byPos(a, b) || a.id.localeCompare(b.id))
    const limit = Math.max(1, Math.min(1000, o.limit ?? 200))
    const page: Array<Partial<Item>> = []
    let size = 200
    let i = offset
    for (; i < order.length && page.length < limit; i++) {
      const p = pick(order[i], o.fields)
      const s = JSON.stringify(p).length + 2
      if (page.length && size + s > max) break
      page.push(p)
      size += s
    }
    const left = order.length - i
    const nextCursor = left > 0 ? `${board.seq}:${i}` : undefined
    const more = left > 0 ? `${left} more item(s) of ${order.length} not shown${size > max * 0.9 ? ` (size cap ${max} characters)` : ''} — next page: ${again(nextCursor!)}; narrow with frame / types / ids / text, or fewer fields (fields: ["id","type","role","text","x","y","w","h","parent"])${staleNote}` : stale ? `last page${staleNote}` : undefined
    const metaKeys = Object.keys(board.meta ?? {})
    const head = { id: board.id, title: board.title, kind: board.kind, seq: board.seq, matched: order.length, from: offset, shown: page.length, ...(nextCursor ? { nextCursor } : {}), ...(metaKeys.length ? { meta: `keys ${metaKeys.join(', ')} — canvas_context for the context and holders, canvas_files for the files` } : {}) }
    const text = `${JSON.stringify(head)}\n${page.map((p) => JSON.stringify(p)).join('\n')}${more ? `\n${more}` : ''}`
    return { format, text, matched: order.length, items: page, ...(nextCursor ? { nextCursor } : {}), ...(more ? { more } : {}), seq: board.seq }
  }

  // outline: lines, paged by line offset and the size cap
  const full = outline(board, only ? { only, bare: false } : {}).split('\n')
  const limit = o.limit && o.limit > 0 ? o.limit : Infinity
  const lines: string[] = []
  let size = 0
  let i = offset
  for (; i < full.length && lines.length < limit; i++) {
    const s = full[i].length + 1
    if (lines.length && size + s > max) break
    lines.push(full[i])
    size += s
  }
  const left = full.length - i
  const nextCursor = left > 0 ? `${board.seq}:${i}` : undefined
  const more = left > 0 ? `… ${left} more line(s) of ${full.length} not shown (size cap ${max} characters) — next page: ${again(nextCursor!)}; or read one diagram (frame: ${frameKeys(board).slice(0, 4).map((k) => `"${k}"`).join(' | ') || '…'}), format: "summary" for counts, or types / text to narrow${staleNote}` : stale ? `(last page${staleNote})` : undefined
  if (only && !only.size) return { format, text: `no items match ${filters.join(', ')} on board ${board.id} (seq ${board.seq})`, matched: 0, seq: board.seq }
  return { format, text: lines.join('\n') + (more ? `\n${more}` : ''), matched, ...(nextCursor ? { nextCursor } : {}), ...(more ? { more } : {}), seq: board.seq }
}

/** A short overview: per diagram frame its kind, file, holder, how many of each element, threads and proposals. */
function summaryText(board: Board, only: Set<string> | undefined, o: ReadOptions): string {
  const tree = containmentTree(board)
  const items = Object.values(board.items).filter((i) => !only || only.has(i.id))
  const out: string[] = [`# ${board.title} (${board.kind}, seq ${board.seq}, ${Object.keys(board.items).length} items${only ? `, ${items.length} matched` : ''})`]
  const ctx = contextOf(board.meta)
  if (ctx) out.push(`Board context${ctx.by ? ` (from ${displayName(ctx.by)})` : ''}: ${short(ctx.text, 300)}`)
  const r = responderOf(board.meta)
  out.push(`Answered by: ${responderLabel(r)}`)
  const threadsOf = (set: Item[]) => {
    // annotation cards and TODOs are not conversations: counted apart
    const roots = set.filter((c) => c.type === 'comment' && rootOf(board, c).id === c.id && !isAnnotationCard(c) && !isTodo(c))
    const all = Object.values(board.items).filter((c) => c.type === 'comment')
    let waiting = 0
    for (const root of roots) {
      const msgs = all.filter((c) => rootOf(board, c).id === root.id).sort((a, b) => String(a.data?.postedAt ?? a.updatedAt).localeCompare(String(b.data?.postedAt ?? b.updatedAt)))
      if (msgs[msgs.length - 1]?.createdBy === 'user') waiting++
    }
    const proposals = roots.filter((c) => (c.data?.discuss as { edit?: unknown } | undefined)?.edit || isAnnotationDraft(c)).length
    return { threads: roots.length, waiting, proposals, annotations: set.filter((c) => isAnnotationCard(c)).length }
  }
  const notes = (t: { annotations: number }) => (t.annotations ? ` · ${t.annotations} annotation(s)` : '')
  const counts = (set: Item[]) => {
    const m = new Map<string, number>()
    for (const i of set) {
      if (i.type === 'comment') continue
      const k = i.type === 'arrow' ? 'arrow' : i.type === 'ui' ? String((i.data?.ui as { type?: string } | undefined)?.type ?? 'ui') : (i.role ?? i.type)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')
  }
  const frames = Object.values(board.items).filter((i) => diagramSpecOf(i)).sort(byPos)
  const seen = new Set<string>()
  for (const f of frames) {
    const spec = diagramSpecOf(f)!
    const inside = [...itemsInFrame(board, f, tree)].map((id) => board.items[id]).filter((i) => i.id !== f.id && (!only || only.has(i.id)))
    if (only && !inside.length) continue
    for (const i of inside) seen.add(i.id)
    const holder = holdersOf(board.meta).find((h) => h.key === spec.key)
    const t = threadsOf(inside)
    const pend = inside.filter((i) => i.type !== 'comment' && pendingTag(i)).length
    out.push('', `## ${KIND_LABEL[spec.kind] ?? spec.kind} "${short(f.text, 60)}" — frame: "${spec.key}"${spec.source ? ` · ${spec.source}` : ''}${holder ? ` · files held by ${displayName(holder.holder.agent)}` : ''}  #${f.id}`)
    out.push(`  ${inside.length} items: ${counts(inside) || '—'}`)
    const lanes = (tree.children.get(f.id) ?? []).filter(isContainer).sort(byPos)
    if (lanes.length) out.push(`  ${lanes.length} ${lanes[0].role === 'column' ? 'columns' : 'lanes / groups'}: ${lanes.slice(0, 12).map((l) => `${short(l.text, 24) || l.id}${l.role === 'column' ? ` (${(tree.children.get(l.id) ?? []).length})` : ''}`).join(' · ')}${lanes.length > 12 ? ' · …' : ''}`)
    out.push(`  ${t.threads} comment thread(s)${t.waiting ? `, ${t.waiting} waiting for an answer` : ''}${t.proposals ? `, ${t.proposals} edit proposal(s)` : ''}${pend ? ` · ${pend} proposed element(s)` : ''}${notes(t)}`)
  }
  const rest = items.filter((i) => !seen.has(i.id))
  if (rest.length) {
    const t = threadsOf(rest)
    out.push('', `## ${frames.length ? 'outside the diagram frames' : 'the board'}`, `  ${rest.length} items: ${counts(rest) || '—'}`, `  ${t.threads} comment thread(s)${t.waiting ? `, ${t.waiting} waiting for an answer` : ''}${t.proposals ? `, ${t.proposals} edit proposal(s)` : ''}${notes(t)}`)
  }
  const todos = todoCounts(board)
  if (todos.open || todos.done) out.push('', `TODOs: ${todos.open} open, ${todos.done} done — to confirm with someone else, not questions to you (canvas_todo lists them)`)
  out.push('', `Next: canvas_read_board with frame: "<key>" (outline of one diagram), types / text / ids to narrow, format: "json" with fields for geometry; canvas_snapshot to see it; canvas_check_layout for overlaps and clipped text.`)
  void o
  return out.join('\n')
}
