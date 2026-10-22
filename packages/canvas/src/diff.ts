// Human-readable diffs and outlines — what the agent reads instead of raw JSON.
import { calloutOf, isAnnotationCard, isAnnotationDraft, todoOf } from './annotations.js'
import { circled } from './diagrams/domainStory.js'
import { diffStat } from './patch.js'
import { displayName } from './routing.js'
import { diagramSpecOf, isBookkeeping, isLayoutOnly, isSeenOnly, markSeen, meaningOf, type Author, type Board, type Change, type Item, type Op } from './model.js'
import { containmentTree, frameKeys, itemsInFrame, resolveFrame } from './outline.js'

const short = (s: string | undefined, n = 60) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function nameOf(item: Item | null | undefined, board?: Board): string {
  if (!item) return '(unknown)'
  if (item.type === 'arrow') {
    const from = board?.items[item.from ?? '']
    const to = board?.items[item.to ?? '']
    return `arrow ${short(from?.text, 30) || item.from} → ${short(to?.text, 30) || item.to}`
  }
  const threaded = item.type === 'comment' && board?.items[item.target ?? '']?.type !== 'comment' && Object.values(board?.items ?? {}).some((o) => o.type === 'comment' && o.target === item.id)
  const role = todoOf(item) ? 'TODO' : isAnnotationDraft(item) ? 'draft annotation' : isAnnotationCard(item) ? 'annotation' : threaded ? 'comment thread' : (item.role ?? item.type)
  const text = short(item.text)
  // The id rides along so the agent can target the item precisely when it replies.
  return text ? `${role} "${text}" [${item.id}]` : `${role} [${item.id}]`
}

type Lookup = (id: string | undefined) => Item | null | undefined

/** A reply's thread root: follow `target` through comments. A cycle makes each comment its own root. */
function rootOf(it: Item, find: Lookup): Item {
  const seen = new Set<string>()
  let cur = it
  while (!seen.has(cur.id)) {
    seen.add(cur.id)
    const next = find(cur.target)
    if (next?.type !== 'comment') return cur
    cur = next
  }
  return it
}

/** An item by id: as it is now, or as it was before it was removed within `changes`. */
function finder(board: Board, changes: Change[]): Lookup {
  return (id) => {
    if (!id) return undefined
    if (board.items[id]) return board.items[id]
    for (const c of changes) if (c.before[id]) return c.before[id]
    return undefined
  }
}

function containerName(id: string | undefined, board: Board, changes: Change[]): string | undefined {
  if (!id) return undefined
  const cur = board.items[id]
  if (cur) return short(cur.text, 40) || id
  // Container may have been removed in this window; look it up in `before`.
  for (const c of changes) {
    const b = c.before[id]
    if (b) return short(b.text, 40) || id
  }
  return id
}

/** A UI mock screen, card, section or navbar: holds other elements (docs/diagrams.md §6c). */
const isUiBox = (i: Item) => i.type === 'ui' && Boolean((i.data?.ui as { container?: boolean } | undefined)?.container)

/** Which lane/frame geometrically contains the centre of `item` (fallback when `parent` is unset). */
export function containerOf(board: Board, item: Item): Item | undefined {
  if (item.parent && board.items[item.parent]) return board.items[item.parent]
  const cx = item.x + item.w / 2
  const cy = item.y + item.h / 2
  let best: Item | undefined
  for (const c of Object.values(board.items)) {
    if (c.id === item.id || (c.type !== 'lane' && c.type !== 'frame' && c.type !== 'wireframe' && !isUiBox(c))) continue
    if (cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h) {
      if (!best || c.w * c.h < best.w * best.h) best = c
    }
  }
  return best
}

/**
 * One line per meaningful op, oldest first. With `collapseMoves`, moves and resizes that stay in
 * their lane/frame fold into one closing line ("moved 7 items: review, fix, …").
 */
export function summarize(board: Board, changes: Change[], opts: { collapseMoves?: boolean } = {}): string[] {
  const lines: string[] = []
  const folded = new Map<string, { seq: number; author: string; resized: boolean }>()
  const find = finder(board, changes)
  for (const ch of changes) {
    if (isBookkeeping(ch)) continue
    // a named agent or person signs its lines: "[7 codex-laptop] …"
    const who = ch.by ?? ch.author
    const prefix = `[${ch.seq} ${who}]`
    const removed = new Set(ch.ops.flatMap((op) => (op.kind === 'remove' ? [op.id] : [])))
    const removedRoot = (it: Item | null | undefined) => {
      const root = it?.type === 'comment' ? rootOf(it, find) : undefined
      return root && root.id !== it?.id && removed.has(root.id) ? root.id : undefined
    }
    for (const op of ch.ops) {
      if (op.kind === 'add') {
        const it = op.item
        if (it.type === 'comment') {
          const root = rootOf(it, find)
          const on = find(root.target)
          const text = short(it.text, 200)
          const to = Array.isArray(it.data?.to) ? (it.data.to as unknown[]).filter((x): x is string => typeof x === 'string') : []
          if (root.id !== it.id) {
            // the answer to a TODO (docs/canvas.md "TODOs"): what was confirmed — decide whether the design changes
            if (todoOf(root) && it.data?.todoAnswer === true) lines.push(`${prefix} answered the TODO "${short(root.text, 120)}": "${text}" — decide whether the design changes [thread ${root.id}]`)
            else lines.push(`${prefix} replied in thread on ${nameOf(on ?? root, board)}: "${text}" [thread ${root.id}]`)
          } else if (todoOf(it)) {
            const ask = todoOf(it)!.ask
            lines.push(`${prefix} added a TODO${on ? ` on ${nameOf(on, board)}` : ''}: "${text}"${ask ? ` (ask ${ask})` : ''} — to confirm with someone else, not a question to you [todo ${it.id}]`)
          } else if (isAnnotationDraft(it)) {
            // the person's annotation, a proposal to the holder of the files (docs/canvas.md "Annotations")
            lines.push(`${prefix} drafted an annotation${on ? ` on ${nameOf(on, board)}` : ''}: "${text}" — a proposal to ${to.length ? to.map(displayName).join(', ') : 'the holder of the files'}: judge it, then apply it or say why not [thread ${it.id}]`)
          } else if (isAnnotationCard(it)) {
            lines.push(`${prefix} drew annotation ${calloutOf(it) !== undefined ? `${circled(calloutOf(it)!)} ` : ''}${on ? `on ${nameOf(on, board)}` : ''}: "${text}"`)
          } else {
            // an edit proposal (a person's source-dialog edit, or another agent's canvas_propose_edit)
            const edit = (it.data?.discuss as { edit?: { file?: unknown; diff?: unknown } } | undefined)?.edit
            const what = edit && typeof edit.diff === 'string' ? `proposed an edit to ${typeof edit.file === 'string' ? edit.file : 'a text'} (${diffCount(edit.diff)})` : 'added comment'
            lines.push(`${prefix} ${what}${on ? ` on ${nameOf(on, board)}` : ''}: "${text}" [thread ${it.id}]`)
          }
        } else if (it.type === 'arrow') {
          lines.push(`${prefix} connected ${nameOf(board.items[it.from ?? ''] ?? ch.before[it.from ?? ''], board)} → ${nameOf(board.items[it.to ?? ''] ?? ch.before[it.to ?? ''], board)}${it.label ? ` ("${short(it.label)}")` : ''}`)
        } else {
          const parent = containerName(it.parent, board, changes)
          lines.push(`${prefix} added ${nameOf(it, board)}${parent ? ` in ${parent}` : ''}`)
        }
        continue
      }
      if (op.kind === 'remove') {
        const was = ch.before[op.id]
        if (removedRoot(was)) continue
        const replies = ch.ops.filter((o) => o.kind === 'remove' && removedRoot(ch.before[o.id]) === op.id).length
        lines.push(`${prefix} removed ${nameOf(was, board)}${replies ? ` and its ${replies} repl${replies === 1 ? 'y' : 'ies'}` : ''}`)
        continue
      }
      // update
      const was = ch.before[op.id]
      if (isSeenOnly(op, was)) continue
      if (!was && !board.items[op.id]) continue // update of an item that never existed: the store ignored it
      const now = board.items[op.id] ?? (was ? { ...was, ...op.patch } : undefined)
      const patch = op.patch
      const name = nameOf(was ?? now, board)
      const parts: string[] = []
      if (patch.text !== undefined && patch.text !== was?.text) {
        if (was?.type === 'comment') parts.push(`edited comment to "${short(patch.text, 200)}"`)
        else parts.push(`renamed "${short(was?.text)}" → "${short(patch.text)}"`)
      }
      const parentChanged = patch.parent !== undefined && patch.parent !== was?.parent
      const moved = (patch.x !== undefined && patch.x !== was?.x) || (patch.y !== undefined && patch.y !== was?.y)
      const resized = (patch.w !== undefined && patch.w !== was?.w) || (patch.h !== undefined && patch.h !== was?.h)
      if (parentChanged) {
        parts.push(`moved from ${containerName(was?.parent, board, changes) ?? 'nowhere'} → ${containerName(patch.parent ?? undefined, board, changes) ?? 'nowhere'}`)
      } else if (moved && was) {
        // Containment may have changed geometrically without `parent` being set.
        const beforeC = containerOf({ ...board, items: { ...board.items, [was.id]: was } }, was)
        const afterC = now ? containerOf(board, now) : undefined
        if (beforeC?.id !== afterC?.id && (beforeC || afterC)) {
          parts.push(`moved from ${beforeC ? short(beforeC.text, 40) : 'nowhere'} → ${afterC ? short(afterC.text, 40) : 'nowhere'}`)
        } else if (!resized) {
          const dx = (patch.x ?? was.x) - was.x
          const dy = (patch.y ?? was.y) - was.y
          const sib = neighbourBefore(board, now)
          parts.push(`moved by (${dx >= 0 ? '+' : ''}${Math.round(dx)}, ${dy >= 0 ? '+' : ''}${Math.round(dy)})${sib ? `, now before ${nameOf(sib, board)}` : ''}`)
        }
      }
      if (patch.color !== undefined && patch.color !== was?.color) parts.push(`recoloured ${was?.color ?? '?'} → ${patch.color}`)
      if (patch.role !== undefined && patch.role !== was?.role) parts.push(`role ${was?.role ?? '?'} → ${patch.role}`)
      if (resized) parts.push(`resized ${was?.w}×${was?.h} → ${patch.w ?? was?.w}×${patch.h ?? was?.h}`)
      if (patch.label !== undefined && patch.label !== was?.label) parts.push(`relabelled "${short(was?.label)}" → "${short(patch.label)}"`)
      if ((patch.from !== undefined && patch.from !== was?.from) || (patch.to !== undefined && patch.to !== was?.to)) {
        const end = (id: string | undefined) => nameOf(board.items[id ?? ''] ?? ch.before[id ?? ''], board)
        parts.push(`reconnected to ${end(patch.from ?? was?.from)} → ${end(patch.to ?? was?.to)}`)
      }
      if (patch.data !== undefined && JSON.stringify(patch.data.bend) !== JSON.stringify(was?.data?.bend)) parts.push('rerouted')
      // a TODO checked off or reopened says so, instead of its data
      const [tWas, tNow] = [todoOf(was ?? undefined), patch.data !== undefined ? todoOf({ ...(was ?? now)!, data: patch.data }) : undefined]
      const todoMoved = !!tWas && !!tNow && tWas.state !== tNow.state
      if (todoMoved) parts.push(tNow!.state === 'done' ? `checked off${tNow!.doneBy ? ` by ${tNow!.doneBy === 'person' ? 'the person' : displayName(tNow!.doneBy)}` : ''}${tNow!.answer ? ` — answer: "${short(tNow!.answer, 160)}"` : ' without an answer (nobody is notified)'}` : 'reopened')
      // hiding a frame's contents (docs/canvas.md "Hiding a frame"), or showing them again, says so — not as its data
      const [hidWas, hidNow] = [was?.data?.hidden === true, patch.data !== undefined ? patch.data.hidden === true : was?.data?.hidden === true]
      if (was?.type === 'frame' && hidWas !== hidNow) parts.push(hidNow ? 'hid its contents (not drawn for anyone; canvas_read_board includeHidden: true lists them)' : 'showed its contents again')
      const meaning = (d: Record<string, unknown> | undefined) => JSON.stringify({ ...meaningOf(d), ...(todoMoved ? { todo: undefined } : {}), ...(hidWas !== hidNow ? { hidden: undefined } : {}) })
      if (patch.data !== undefined && meaning(patch.data) !== meaning(was?.data)) parts.push(`data changed: ${short(JSON.stringify(meaningOf(patch.data)), 120)}`)
      if (opts.collapseMoves && isLayoutOnly(op, was) && !parts.some((p) => p.startsWith('moved from'))) {
        folded.set(op.id, { seq: ch.seq, author: who, resized: resized || (folded.get(op.id)?.resized ?? false) })
        continue
      }
      if (parts.length) lines.push(`${prefix} ${name}: ${parts.join('; ')}`)
    }
    if (ch.note && ch.ops.length === 0) lines.push(`${prefix} ${ch.note}`)
  }
  if (folded.size) lines.push(foldedLine(board, changes, folded))
  return lines
}

function foldedLine(board: Board, changes: Change[], folded: Map<string, { seq: number; author: string; resized: boolean }>): string {
  const all = [...folded.values()]
  const seqs = all.map((f) => f.seq)
  const lo = Math.min(...seqs)
  const hi = Math.max(...seqs)
  const authors = [...new Set(all.map((f) => f.author))].join('/')
  const names = [...folded.keys()].map((id) => {
    const it = board.items[id] ?? changes.find((c) => c.before[id])?.before[id]
    return short(it?.type === 'arrow' ? nameOf(it, board) : it?.text, 30) || id
  })
  const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ', …' : '')
  const verb = all.some((f) => f.resized) ? 'moved or resized' : 'moved'
  return `[${lo === hi ? lo : `${lo}–${hi}`} ${authors}] ${verb} ${names.length} item${names.length === 1 ? '' : 's'}: ${shown}`
}

export interface CardMove {
  cardId: string
  title: string
  from: string | undefined
  to: string | undefined
  seq: number
  author: Author
  ts: string
}

/**
 * Column moves of kanban cards in `changes` — the structured form of the
 * `card "…" [id]: moved from A → B` diff line, for the workflow trigger. A move
 * is a `parent` change, or (when `parent` was never set) a change of the column
 * that geometrically contains the card.
 */
export function cardMoves(board: Board, changes: Change[]): CardMove[] {
  const out: CardMove[] = []
  const find = finder(board, changes)
  const columnName = (id: string | undefined) => {
    const c = find(id)
    return c && c.type === 'lane' && c.role === 'column' ? (c.text ?? c.id) : undefined
  }
  for (const ch of changes) {
    if (isBookkeeping(ch)) continue
    for (const op of ch.ops) {
      if (op.kind !== 'update') continue
      const was = ch.before[op.id]
      if (!was || was.type !== 'card') continue
      const now = board.items[op.id] ?? { ...was, ...op.patch }
      let from: string | undefined
      let to: string | undefined
      if (op.patch.parent !== undefined && op.patch.parent !== was.parent) {
        from = columnName(was.parent)
        to = columnName(op.patch.parent ?? undefined)
      } else if ((op.patch.x !== undefined && op.patch.x !== was.x) || (op.patch.y !== undefined && op.patch.y !== was.y)) {
        const beforeC = containerOf({ ...board, items: { ...board.items, [was.id]: was } }, was)
        const afterC = containerOf(board, now)
        if (beforeC?.id === afterC?.id) continue
        from = beforeC?.role === 'column' ? beforeC.text : undefined
        to = afterC?.role === 'column' ? afterC.text : undefined
      } else continue
      if (from === to) continue
      out.push({ cardId: op.id, title: now.text ?? was.text ?? op.id, from, to, seq: ch.seq, author: ch.author, ts: ch.ts })
    }
  }
  return out
}

/** Read receipts for the user comments the agent has just been shown in `changes`. */
export function agentSeenOps(board: Board, changes: Change[], agent?: string): Op[] {
  const ids = new Set<string>()
  for (const ch of changes) {
    if (ch.author !== 'user' || isBookkeeping(ch)) continue
    for (const op of ch.ops) ids.add(op.kind === 'add' ? op.item.id : op.id)
  }
  const ops: Op[] = []
  for (const id of ids) {
    const it = board.items[id]
    const op = it?.type === 'comment' && it.createdBy === 'user' && it.text?.trim() ? markSeen(it, 'agent', agent) : undefined
    if (op) ops.push(op)
  }
  return ops
}

/** The nearest sticky to the right on the same row inside the same container, if any. */
function neighbourBefore(board: Board, item: Item | undefined): Item | undefined {
  if (!item) return undefined
  const container = containerOf(board, item)
  let best: Item | undefined
  for (const o of Object.values(board.items)) {
    if (o.id === item.id || o.type === 'arrow' || o.type === 'lane' || o.type === 'frame' || o.type === 'comment') continue
    if (containerOf(board, o)?.id !== container?.id) continue
    if (Math.abs(o.y - item.y) > item.h / 2) continue
    if (o.x <= item.x) continue
    if (!best || o.x < best.x) best = o
  }
  return best
}

/** The board outline moved to outline.ts (grouped by diagram frame → lane / column → items); kept here for callers. */
export { outline } from './outline.js'

/** `+3 −1 lines` of a unified diff. */
function diffCount(diff: string): string {
  const { added, removed } = diffStat(diff)
  return `+${added} −${removed} lines`
}

// ── Reading changes at agent scale (docs/canvas.md "Reading big boards") ────────────────────────────────

/** What an op does, for the `kinds` filter: comments are their own kind; a pure move / resize / reroute is a move. */
export type ChangeKind = 'add' | 'update' | 'remove' | 'comment' | 'move'
export const CHANGE_KINDS: ChangeKind[] = ['add', 'update', 'remove', 'comment', 'move']

export function opKind(op: Op, before: Item | null | undefined): ChangeKind {
  const it = op.kind === 'add' ? op.item : before
  if (it?.type === 'comment') return 'comment'
  if (op.kind === 'add') return 'add'
  if (op.kind === 'remove') return 'remove'
  return isLayoutOnly(op, before) ? 'move' : 'update'
}

export interface ChangeFilter {
  /** a diagram key, or a frame / container id: only ops on items inside it (and threads about them) */
  frame?: string
  /** who made it: agent names, 'person' (the person), 'agent' / 'studio' (the default local agent) */
  from?: string[]
  kinds?: ChangeKind[]
}

/** Who a change is from, as the `from` filter and the summary name it. */
export const changeWho = (c: Change): string => c.by ?? (c.author === 'user' ? 'person' : 'agent')

function fromMatches(c: Change, from: string[]): boolean {
  const who = changeWho(c).toLowerCase()
  return from.some((f) => {
    const n = f.trim().toLowerCase()
    if (n === 'person' || n === 'user') return c.author === 'user'
    if (n === 'studio' || n === 'agent') return c.author === 'agent' && !c.by
    return who === n
  })
}

/**
 * Changes narrowed to the ops that pass the filter (a change with none left is dropped; a settings change with no
 * ops stays when no frame / kinds filter asks otherwise). Throws a plain Error naming the keys for an unknown frame.
 */
export function filterChanges(board: Board, changes: Change[], f: ChangeFilter): Change[] {
  const kinds = f.kinds?.length ? new Set(f.kinds) : undefined
  let inFrame: ((id: string, before: Item | null | undefined) => boolean) | undefined
  if (f.frame) {
    const fr = resolveFrame(board, f.frame)
    if (!fr) throw Object.assign(new Error(`no frame "${f.frame}" on this board — diagram keys: ${frameKeys(board).join(', ') || '(none)'}`), { status: 404 })
    if (fr !== 'board') {
      const set = itemsInFrame(board, fr)
      const key = (fr.data?.diagram as { key?: string } | undefined)?.key
      const was = (id: string, before: Item | null | undefined): boolean => {
        if (set.has(id)) return true
        if (key && id.startsWith(`${key}.`)) return true
        if (!before) return false
        // removed or changed items: through their parent, target or wire end as it was
        for (const ref of [before.parent, before.target, before.from]) if (ref && (ref === fr.id || set.has(ref))) return true
        return false
      }
      inFrame = was
    }
  }
  const out: Change[] = []
  for (const c of changes) {
    if (f.from?.length && !fromMatches(c, f.from)) continue
    if (!c.ops.length) {
      if (!inFrame && (!kinds || kinds.has('update'))) out.push(c)
      continue
    }
    const ops = c.ops.filter((op) => {
      const id = op.kind === 'add' ? op.item.id : op.id
      const before = c.before[id] ?? (op.kind === 'add' ? op.item : undefined)
      if (kinds && !kinds.has(opKind(op, c.before[id]))) return false
      if (inFrame && !inFrame(id, before ?? board.items[id])) return false
      return true
    })
    if (ops.length) out.push(ops.length === c.ops.length ? c : { ...c, ops })
  }
  return out
}

/** Counts by who × kind and by diagram frame, then the last `last` lines — what to read first on a long history. */
export function diffSummary(board: Board, changes: Change[], lines: string[], o: { since: number; last?: number } = { since: 0 }): string {
  const byWho = new Map<string, Map<ChangeKind, number>>()
  const byFrame = new Map<string, number>()
  let ops = 0
  const tree = containmentTree(board)
  const frameOf = (id: string, before: Item | null | undefined): string => {
    for (let cur: string | undefined = id, g = 0; cur && g < 200; g++, cur = tree.parent.get(cur) ?? board.items[cur]?.parent) {
      const spec = diagramSpecOf(board.items[cur])
      if (spec) return spec.key
    }
    const it = before ?? board.items[id]
    const ref = it?.target ?? it?.from ?? it?.parent
    if (ref && ref !== id && board.items[ref]) return frameOf(ref, undefined)
    const key = /^([a-z0-9-]+)\./.exec(id)?.[1]
    return key && board.items[`diagram.${key}`] ? key : board.kind !== 'freeform' ? board.kind : '(no frame)'
  }
  for (const c of changes) {
    if (isBookkeeping(c)) continue
    const who = changeWho(c)
    const m = byWho.get(who) ?? new Map<ChangeKind, number>()
    byWho.set(who, m)
    if (!c.ops.length) {
      m.set('update', (m.get('update') ?? 0) + 1)
      continue
    }
    for (const op of c.ops) {
      const id = op.kind === 'add' ? op.item.id : op.id
      if (op.kind === 'update' && isSeenOnly(op, c.before[id])) continue
      ops++
      const k = opKind(op, c.before[id])
      m.set(k, (m.get(k) ?? 0) + 1)
      const fr = frameOf(id, c.before[id] ?? (op.kind === 'add' ? op.item : undefined))
      byFrame.set(fr, (byFrame.get(fr) ?? 0) + 1)
    }
  }
  const last = o.last ?? 20
  const fmt = (m: Map<ChangeKind, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')
  const out = [`${changes.length} change(s) since seq ${o.since} (board seq ${board.seq}), ${ops} op(s), ${lines.length} line(s)`]
  if (byWho.size) out.push('by who × kind:', ...[...byWho.entries()].map(([w, m]) => `  ${w}: ${fmt(m) || '—'}`))
  if (byFrame.size) out.push('by frame (ops):', ...[...byFrame.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`))
  if (lines.length) out.push(`last ${Math.min(last, lines.length)} line(s):`, ...lines.slice(-last).map((l) => `  ${l}`))
  return out.join('\n')
}

/** A page of lines under a size cap: `cursor` is the line offset as the previous page gave it ("<seq>:<n>"). */
export function pageLines(lines: string[], o: { cursor?: string; limit?: number; maxChars?: number; seq: number }): { lines: string[]; nextCursor?: string; left: number; from: number } {
  let from = 0
  if (o.cursor) {
    const m = /^(?:[a-z]+:)?(\d+):(\d+)$/.exec(o.cursor.trim())
    if (!m) throw Object.assign(new Error(`cursor "${o.cursor}" is not one this canvas gave out (it looks like "56:120")`), { status: 400 })
    from = Number(m[2])
  }
  const max = Math.min(200_000, Math.max(2_000, o.maxChars ?? 40_000))
  const limit = o.limit && o.limit > 0 ? o.limit : Infinity
  const page: string[] = []
  let size = 0
  let i = from
  for (; i < lines.length && page.length < limit; i++) {
    const s = lines[i].length + 1
    if (page.length && size + s > max) break
    page.push(lines[i])
    size += s
  }
  const left = lines.length - i
  return { lines: page, left, from, ...(left > 0 ? { nextCursor: `${o.seq}:${i}` } : {}) }
}
