// Proposals by agents (docs/canvas.md "Proposals and saving"): an agent that cannot touch the repo's files —
// a remote one through /mcp, or any agent on the board — reads the files behind a board from the board's
// snapshot and proposes an edit as a unified diff. The canvas checks the diff against the snapshot and turns it
// into the same chat request the person's source-dialog edit makes (`data.discuss.edit`). Nothing here writes a
// file: whoever has the files (studio's session, the person's own agent) applies it after the person agrees.
// The canvas does not parse workflow yaml — a diff is text; an optional wire hint only marks the board.
import { createHash } from 'node:crypto'
import { autoPlaceComments } from './place.js'
import { applyUnifiedDiff, diffPath, diffStat, firstChange, unifiedDiff } from './patch.js'
import type { Author, Board, Item, Op } from './model.js'

/** sha-1 (hex) of a text as UTF-8 — what `base` means everywhere (the web's sha1(), `shasum -a 1 <file>`). */
export const sha1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('hex')

export interface BoardFile {
  path: string
  text: string
  sha: string
  /** cut on the board (meta.workflow.truncated): not the whole file, so no proposal can be checked against it */
  truncated: boolean
  /** where the snapshot comes from: the workflow, or a diagram frame's key */
  from: { workflow: true } | { diagram: string }
}

/** The files snapshot on a board: `meta.workflow.files` and every `meta.diagrams[key].files`. */
export function boardFiles(board: Board): BoardFile[] {
  const out = new Map<string, BoardFile>()
  const meta = board.meta ?? {}
  const wf = meta.workflow as { files?: unknown; truncated?: unknown } | undefined
  const truncated = new Set(Array.isArray(wf?.truncated) ? (wf.truncated as unknown[]).filter((t): t is string => typeof t === 'string') : [])
  const add = (files: unknown, from: BoardFile['from']) => {
    if (!files || typeof files !== 'object') return
    for (const [path, text] of Object.entries(files as Record<string, unknown>)) {
      if (typeof text !== 'string' || out.has(path)) continue
      out.set(path, { path, text, sha: sha1(text), truncated: truncated.has(path), from })
    }
  }
  add(wf?.files, { workflow: true })
  const diagrams = meta.diagrams as Record<string, { files?: unknown }> | undefined
  for (const [key, d] of Object.entries(diagrams && typeof diagrams === 'object' ? diagrams : {})) add(d?.files, { diagram: key })
  return [...out.values()]
}

export class ProposalError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** A visual hint on a workflow board: a wire the edit would add or remove, drawn dashed until a redraw explains it. */
export interface WireHint {
  /** workflow node ids (`plan`, or `wf.node.plan`) */
  from: string
  to: string
  event: string
  condition?: string
  /** propose removing this (existing) wire instead of adding one */
  remove?: boolean
}

export interface ProposalInput {
  file: string
  base: string
  diff?: string
  newText?: string
  note: string
  about?: string[]
  wires?: WireHint[]
}

export interface Proposal {
  ops: Op[]
  commentId: string
  file: string
  diff: string
  about: string[]
  added: number
  removed: number
  /** per hunk, how far it applied from where its header said */
  offsets: number[]
}

const MAX_DIFF = 60_000
const MAX_TEXT = 1_000_000
const MAX_NOTE = 4_000

const detailOf = (it: Item | undefined) => it?.data?.detail as { file?: unknown; source?: { workflow?: unknown }; yaml?: { start?: unknown; end?: unknown } } | undefined
const nodeIdOf = (it: Item | undefined) => (typeof it?.data?.nodeId === 'string' ? (it.data.nodeId as string) : undefined)
const node = (id: string) => id.replace(/^wf\.node\./, '')

/** The board item that draws workflow node `id`. */
export function itemOfNode(board: Board, id: string): Item | undefined {
  const want = node(id)
  return Object.values(board.items).find((it) => it.type !== 'arrow' && it.type !== 'comment' && nodeIdOf(it) === want)
}

/**
 * The item a line of a file belongs to (the same rule as the web's line comments, docs/studio.md §5): the
 * block whose own file it is (persona, prompt, script), else the step whose yaml range holds the line
 * (narrowest wins), else the diagram frame drawn from that file, else the board's title item.
 */
export function ownerOf(board: Board, file: string, line: number): string | undefined {
  let byFile: string | undefined
  let byRange: { id: string; size: number } | undefined
  let frame: string | undefined
  for (const it of Object.values(board.items)) {
    const d = detailOf(it)
    if (d) {
      if (d.file === file) byFile ??= it.id
      const y = d.yaml
      if (d.source?.workflow === file && typeof y?.start === 'number' && typeof y.end === 'number' && line >= y.start && line <= y.end && (!byRange || y.end - y.start < byRange.size)) byRange = { id: it.id, size: y.end - y.start }
    }
    const spec = it.type === 'frame' ? (it.data?.diagram as { source?: unknown } | undefined) : undefined
    if (spec?.source === file) frame ??= it.id
  }
  if (byFile) return byFile
  if (byRange) return byRange.id
  if (frame) return frame
  if (board.items['wf.title']) return 'wf.title'
  return Object.values(board.items).find((i) => i.role === 'title')?.id
}

/** The box between two items' centres. */
const spanOf = (a: Item, b: Item) => {
  const [ax, ay, bx, by] = [a.x + a.w / 2, a.y + a.h / 2, b.x + b.w / 2, b.y + b.h / 2]
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }
}
const isFlowWire = (it: Item) => it.type === 'arrow' && it.role !== 'owns' && it.role !== 'delegates' && it.role !== 'trace'
const wireEvent = (it: Item) => it.data?.event as { from?: string; to?: string; event?: string; condition?: string } | undefined

/**
 * Check a proposed edit against the board's snapshot and build the ops that put it on the board: a comment
 * (the chat request, `data.discuss.edit`) threaded on the affected item(s), plus the optional wire hints.
 * `who` is the caller as the server knows it — the name comes from its token, never from the request.
 */
export function buildProposal(board: Board, input: ProposalInput, who: { author: Author; by?: string }, now: string, newId: () => string): Proposal {
  if (!input || typeof input !== 'object') throw new ProposalError(400, 'body must be an object')
  const files = boardFiles(board)
  const list = () => (files.length ? files.map((f) => f.path).join(', ') : 'none — this board was drawn without files; propose on a board that `awd graph --canvas` or `awd design draw` drew')
  if (typeof input.file !== 'string' || !input.file) throw new ProposalError(400, `file is required (one of: ${list()})`)
  const f = files.find((x) => x.path === input.file)
  if (!f) throw new ProposalError(404, `"${input.file}" is not among the files behind this board (${list()}); canvas_files lists them with their base`)
  if (f.truncated) throw new ProposalError(422, `${f.path} is cut short on the board (over 100 000 characters), so an edit cannot be checked against it; ask the person to have their local agent make this change`)
  if (typeof input.base !== 'string' || !input.base) throw new ProposalError(400, `base is required: the sha-1 of the text you edited (canvas_files gives it; now ${f.sha})`)
  if (input.base !== f.sha) throw new ProposalError(409, `base ${input.base.slice(0, 12)} is not the board's snapshot of ${f.path} (now ${f.sha}): the file was redrawn since you read it. Read it again (canvas_files) and redo your edit on the new text.`)
  if (typeof input.note !== 'string' || !input.note.trim()) throw new ProposalError(400, 'note is required: say in a sentence or two what the edit does and why — it opens the thread the person answers in')
  if (input.note.length > MAX_NOTE) throw new ProposalError(400, `note is longer than ${MAX_NOTE} characters`)
  const hasDiff = typeof input.diff === 'string' && input.diff.trim() !== ''
  const hasText = typeof input.newText === 'string'
  if (hasDiff === hasText) throw new ProposalError(400, 'give exactly one of diff (a unified diff against the snapshot) or newText (the whole new file)')

  let after: string
  let offsets: number[] = []
  if (hasDiff) {
    if (input.diff!.length > MAX_DIFF) throw new ProposalError(413, `diff is larger than ${MAX_DIFF} characters; split the change`)
    const named = diffPath(input.diff!)
    if (named && named !== f.path) throw new ProposalError(400, `the diff is for ${named}, not ${f.path}`)
    const r = applyUnifiedDiff(f.text, input.diff!)
    if (!r.ok) throw new ProposalError(422, `the diff does not apply to ${f.path} at base ${f.sha.slice(0, 12)}: ${r.error}. Make the diff against the text canvas_files returns, or send newText instead.`)
    after = r.text
    offsets = r.offsets
  } else {
    if (input.newText!.length > MAX_TEXT) throw new ProposalError(413, `newText is larger than ${MAX_TEXT} characters`)
    after = input.newText!
  }
  if (after === f.text) throw new ProposalError(400, `the edit leaves ${f.path} unchanged`)
  // the diff as the canvas shows it and studio quotes it: normalised against the snapshot
  const diff = unifiedDiff(f.text, after, f.path)
  if (diff.length > MAX_DIFF) throw new ProposalError(413, `the change is larger than ${MAX_DIFF} characters as a diff; split it`)
  const at = firstChange(f.text, after) ?? { line: 1, endLine: 1 }
  const quote = f.text.split('\n').slice(at.line - 1, at.endLine).join('\n')

  // what the chat is about: the items asked for, else the owner of the first changed line
  const ids = Array.isArray(input.about) ? [...new Set(input.about)] : []
  if (ids.some((id) => typeof id !== 'string')) throw new ProposalError(400, 'about must be item ids')
  const missing = ids.filter((id) => !board.items[id])
  if (missing.length) throw new ProposalError(404, `no item ${missing.map((m) => `"${m}"`).join(', ')} on this board`)
  if (ids.some((id) => board.items[id].type === 'comment')) throw new ProposalError(400, 'about lists items to talk about, not comments')
  const owner = ownerOf(board, f.path, at.line)
  const about = ids.length ? ids : owner ? [owner] : []

  const commentId = newId()
  const author = who.author
  const ops: Op[] = []
  const hintIds: string[] = []
  const pendingBy = who.by ?? author
  for (const [k, w] of (input.wires ?? []).entries()) {
    if (!w || typeof w.from !== 'string' || typeof w.to !== 'string' || typeof w.event !== 'string' || !w.event.trim()) throw new ProposalError(400, `wires[${k}] needs from, to (workflow node ids) and event`)
    const from = itemOfNode(board, w.from)
    const to = itemOfNode(board, w.to)
    if (!from || !to) throw new ProposalError(404, `wires[${k}]: no block ${!from ? `"${w.from}"` : `"${w.to}"`} on this board (a hint can only join blocks that are drawn; a new step shows up when the file is applied and redrawn)`)
    const ends = { from: node(w.from), to: node(w.to), event: w.event.trim(), ...(w.condition?.trim() ? { condition: w.condition.trim() } : {}) }
    const label = `${ends.event}${ends.condition ? ` if ${ends.condition}` : ''}`
    if (w.remove) {
      const wire = Object.values(board.items).find((it) => {
        const e = wireEvent(it)
        return isFlowWire(it) && e && node(e.from ?? '') === ends.from && node(e.to ?? '') === ends.to && e.event === ends.event
      })
      if (!wire) throw new ProposalError(404, `wires[${k}]: no wire ${ends.from} → ${ends.to} on ${ends.event} to remove`)
      if (wire.data?.pending) throw new ProposalError(409, `wires[${k}]: the wire ${wire.id} already holds a proposal`)
      ops.push({ kind: 'update', id: wire.id, patch: { data: { ...wire.data, pending: { kind: 'remove', before: { ...ends, ...(wireEvent(wire)?.condition ? { condition: wireEvent(wire)!.condition } : {}) }, by: pendingBy, at: now, proposal: commentId } } } })
      hintIds.push(wire.id)
    } else {
      const id = `${commentId}.wire${k + 1}`
      ops.push({
        kind: 'add',
        // the box spanning both ends, so a link to the wire (?focus=) centres on it
        item: { id, type: 'arrow', ...spanOf(from, to), from: from.id, to: to.id, role: 'flow', label, data: { pending: { kind: 'add', after: ends, by: pendingBy, at: now, proposal: commentId } }, createdBy: author, updatedBy: author, updatedAt: now },
      })
      hintIds.push(id)
    }
    for (const it of [from.id, to.id]) if (!about.includes(it) && !hintIds.includes(it)) hintIds.push(it)
  }
  const allAbout = [...about, ...hintIds.filter((id) => !about.includes(id))]
  const target = allAbout[0]
  const { added, removed } = diffStat(diff)
  const data: Record<string, unknown> = {
    anchor: { file: f.path, line: at.line, ...(at.endLine > at.line ? { endLine: at.endLine } : {}), quote },
    discuss: { about: allAbout, edit: { file: f.path, base: f.sha, diff, ...(who.by ? { by: who.by } : {}) } },
    ...(who.by ? { by: who.by } : {}),
  }
  const text = input.note.trim()
  let geo = { x: 0, y: 0, w: 260, h: 90 }
  if (target) {
    const placed = autoPlaceComments(board, { items: [{ type: 'comment', target, w: 260, h: 90 }] }) as { items: Array<{ x: number; y: number; w: number; h: number }> }
    geo = { x: placed.items[0].x ?? 0, y: placed.items[0].y ?? 0, w: 260, h: 90 }
  } else {
    // a loose comment (a board chat): near the top-left of what is drawn
    const all = Object.values(board.items)
    geo = { x: Math.min(0, ...all.map((i) => i.x)) , y: Math.min(0, ...all.map((i) => i.y)) - 110, w: 260, h: 90 }
  }
  const comment: Item = { id: commentId, type: 'comment', ...geo, text, ...(target ? { target } : {}), data, createdBy: author, updatedBy: author, updatedAt: now }
  return { ops: [{ kind: 'add', item: comment }, ...ops], commentId, file: f.path, diff, about: allAbout, added, removed, offsets }
}

type Data = Record<string, unknown>
const discussEdit = (data: Data | undefined) => ((data?.discuss as Data | undefined)?.edit as Data | undefined)

/**
 * Who wrote a comment, as the server knows it (docs/canvas.md "Identity"): a new comment gets `data.by` (and an
 * edit request `data.discuss.edit.by`) set to the caller's name — or removed, for the person on this machine and
 * the default local agent — so nobody can sign a comment with another's name. An update keeps what the comment
 * already says.
 */
export function stampAttribution(board: Board, ops: Op[], by: string | undefined): Op[] {
  const sign = (data: Data | undefined, name: string | undefined): Data | undefined => {
    if (!data) return data
    const out: Data = { ...data }
    if (name) out.by = name
    else delete out.by
    const edit = discussEdit(data)
    if (edit) {
      const e: Data = { ...edit }
      if (name) e.by = name
      else delete e.by
      out.discuss = { ...(data.discuss as Data), edit: e }
    }
    return out
  }
  return ops.map((op) => {
    if (op.kind === 'add' && op.item.type === 'comment') {
      if (!op.item.data && !by) return op
      return { ...op, item: { ...op.item, data: sign(op.item.data ?? {}, by) } }
    }
    if (op.kind === 'update' && op.patch.data && typeof op.patch.data === 'object') {
      const cur = board.items[op.id]
      if (cur?.type !== 'comment') return op
      const was = cur.data as Data | undefined
      const data = sign(op.patch.data as Data, typeof was?.by === 'string' ? was.by : undefined)!
      const wasEdit = discussEdit(was)
      const edit = discussEdit(data)
      if (edit) {
        if (typeof wasEdit?.by === 'string') edit.by = wasEdit.by
        else delete edit.by
      }
      return { ...op, patch: { ...op.patch, data } }
    }
    return op
  })
}
