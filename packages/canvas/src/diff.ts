// Human-readable diffs and outlines — what the agent reads instead of raw JSON.
import { diffStat } from './patch.js'
import { isBookkeeping, isLayoutOnly, isSeenOnly, markSeen, meaningOf, type Author, type Board, type Change, type Item, type Op } from './model.js'

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
  const role = threaded ? 'comment thread' : (item.role ?? item.type)
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
          if (root.id !== it.id) lines.push(`${prefix} replied in thread on ${nameOf(on ?? root, board)}: "${text}" [thread ${root.id}]`)
          else {
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
        parts.push(`moved from ${containerName(was?.parent, board, changes) ?? 'nowhere'} → ${containerName(patch.parent as string | undefined, board, changes) ?? 'nowhere'}`)
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
      if (patch.data !== undefined && JSON.stringify(meaningOf(patch.data)) !== JSON.stringify(meaningOf(was?.data))) parts.push(`data changed: ${short(JSON.stringify(meaningOf(patch.data)), 120)}`)
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
        to = columnName(op.patch.parent as string | undefined)
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

/**
 * Compact text rendering of the whole board, grouped by container, with arrows
 * and comments, in reading order (left → right, top → bottom).
 */
export function outline(board: Board): string {
  const items = Object.values(board.items)
  const containers = items.filter((i) => i.type === 'lane' || i.type === 'frame' || i.type === 'wireframe' || isUiBox(i)).sort(byPos)
  const arrows = items.filter((i) => i.type === 'arrow')
  const find: Lookup = (id) => (id ? board.items[id] : undefined)
  const replies = new Map<string, Item[]>()
  const comments = items.filter((i) => {
    if (i.type !== 'comment') return false
    const root = rootOf(i, find)
    if (root.id === i.id) return true
    replies.set(root.id, [...(replies.get(root.id) ?? []), i])
    return false
  })
  const stickies = items.filter((i) => !['arrow', 'comment', 'lane', 'frame', 'wireframe'].includes(i.type) && !isUiBox(i))
  const commentsFor = new Map<string, Item[]>()
  for (const c of comments) {
    const k = c.target ?? ''
    if (!commentsFor.has(k)) commentsFor.set(k, [])
    commentsFor.get(k)!.push(c)
  }
  const out: string[] = [`# ${board.title} (${board.kind}, seq ${board.seq}, ${items.length} items)`]
  const printed = new Set<string>()
  const comment = (c: Item, indent: string) => {
    out.push(`${indent}💬 (${c.createdBy}) ${short(c.text, 200)}  #${c.id}`)
    printed.add(c.id)
    for (const r of replies.get(c.id) ?? []) out.push(`${indent}  ↳ (${r.createdBy}) ${short(r.text, 200)}  #${r.id}`)
  }
  const line = (i: Item, indent: string) => {
    const role = i.role ?? i.type
    if (role === 'pivotal') {
      // a pivotal marker is a bare line; the event itself already carries the flag
      printed.add(i.id)
      return
    }
    const flags: string[] = []
    if (i.data?.pivotal) flags.push('pivotal')
    if (i.updatedBy === 'user') flags.push('edited by user')
    out.push(`${indent}- ${role}: ${short(i.text, 80) || '(untitled)'}${flags.length ? ` [${flags.join(', ')}]` : ''}  #${i.id}`)
    for (const c of commentsFor.get(i.id) ?? []) comment(c, `${indent}    `)
    printed.add(i.id)
  }
  const childrenOf = (container: Item) =>
    stickies.filter((s) => !printed.has(s.id) && containerOf(board, s)?.id === container.id).sort(byPos)
  // Outer containers first (those not inside another container).
  const outer = containers.filter((c) => !containerOf(board, c) || containerOf(board, c)?.id === c.id)
  const walk = (c: Item, indent: string) => {
    out.push(`${indent}## ${c.role ?? c.type}: ${short(c.text, 80) || '(untitled)'}  #${c.id}`)
    printed.add(c.id)
    for (const cc of commentsFor.get(c.id) ?? []) comment(cc, `${indent}    `)
    for (const inner of containers.filter((x) => !printed.has(x.id) && x.id !== c.id && containerOf(board, x)?.id === c.id).sort(byPos)) walk(inner, indent + '  ')
    for (const s of childrenOf(c)) line(s, indent + '  ')
  }
  for (const c of outer) walk(c, '')
  const loose = stickies.filter((s) => !printed.has(s.id)).sort(byPos)
  if (loose.length) {
    out.push('## (unplaced)')
    for (const s of loose) line(s, '  ')
  }
  if (arrows.length) {
    out.push('## arrows')
    for (const a of arrows.sort((p, q) => (p.from ?? '').localeCompare(q.from ?? ''))) {
      const f = board.items[a.from ?? '']
      const t = board.items[a.to ?? '']
      out.push(`  - ${short(f?.text, 40) || a.from} → ${short(t?.text, 40) || a.to}${a.label ? ` (${short(a.label, 40)})` : ''}`)
    }
  }
  const orphanComments = comments.filter((c) => !printed.has(c.id))
  if (orphanComments.length) {
    out.push('## comments (general)')
    for (const c of orphanComments.sort(byPos)) comment(c, '  ')
  }
  return out.join('\n')
}

function byPos(a: Item, b: Item): number {
  const rowA = Math.round(a.y / 60)
  const rowB = Math.round(b.y / 60)
  return rowA !== rowB ? rowA - rowB : a.x - b.x
}

/** `+3 −1 lines` of a unified diff. */
function diffCount(diff: string): string {
  const { added, removed } = diffStat(diff)
  return `+${added} −${removed} lines`
}
