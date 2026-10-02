// The board as text an agent can read (docs/canvas.md "Reading big boards"): a containment tree — diagram frame →
// lane / column / screen / group → items — in reading order, with each item's comment threads, pending proposals
// and the wires of each diagram. Pure; `read.ts` filters, paginates and caps it.
import { diagramSpecOf, type Board, type Item } from './model.js'
import { displayName, holdersOf, settingsLines } from './routing.js'

export const short = (s: string | undefined, n = 60) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** Human names of the diagram kinds (the frame header). */
export const KIND_LABEL: Record<string, string> = {
  'event-storming': 'EventStorming',
  'user-story-map': 'story map',
  'user-journey': 'journey',
  wireframe: 'wireframe',
  workflow: 'workflow',
  kanban: 'kanban',
  'domain-story': 'domain story',
  'ui-mock': 'UI mock',
}

/** Holds other items: frames, lanes (incl. kanban columns, story-map releases), wireframe screens, UI mock containers. */
export function isContainer(it: Item): boolean {
  if (it.type === 'frame' || it.type === 'lane') return true
  if (it.type === 'wireframe') return it.role === 'screen'
  if (it.type === 'ui') return Boolean((it.data?.ui as { container?: boolean } | undefined)?.container)
  return false
}

export interface Tree {
  /** the container each item sits in (absent: top level); comments and wires have none */
  parent: Map<string, string>
  children: Map<string, Item[]>
  roots: Item[]
}

const inside = (it: Item, c: Item) => {
  const cx = it.x + it.w / 2
  const cy = it.y + it.h / 2
  return cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h
}

/**
 * Who contains whom. `parent` when it names an item (and makes no cycle); otherwise the smallest container
 * whose box holds the item's centre — never the item's own descendant, never a container smaller than itself.
 * A diagram frame without a parent is always top level. Comments and wires are not in the tree.
 */
export function containmentTree(board: Pick<Board, 'items'>): Tree {
  const items = Object.values(board.items).filter((i) => i.type !== 'comment' && i.type !== 'arrow')
  const containers = items.filter(isContainer)
  const parent = new Map<string, string>()
  // 1. explicit parents, cycles cut
  for (const it of items) {
    const p = it.parent ? board.items[it.parent] : undefined
    if (!p || p.id === it.id || p.type === 'comment' || p.type === 'arrow') continue
    let cur: string | undefined = p.id
    let cycle = false
    for (let guard = 0; cur && guard < 200; guard++) {
      if (cur === it.id) {
        cycle = true
        break
      }
      cur = parent.get(cur) ?? board.items[cur]?.parent
    }
    if (!cycle) parent.set(it.id, p.id)
  }
  const isUnder = (cand: string, ancestor: string) => {
    for (let cur: string | undefined = cand, guard = 0; cur && guard < 200; guard++, cur = parent.get(cur)) if (cur === ancestor) return true
    return false
  }
  // 2. geometry for the rest
  for (const it of items) {
    if (parent.has(it.id)) continue
    if (diagramSpecOf(it)) continue
    let best: Item | undefined
    for (const c of containers) {
      if (c.id === it.id || !inside(it, c)) continue
      if (isContainer(it) && c.w * c.h <= it.w * it.h) continue
      if (isUnder(c.id, it.id)) continue
      if (!best || c.w * c.h < best.w * best.h) best = c
    }
    if (best) parent.set(it.id, best.id)
  }
  const children = new Map<string, Item[]>()
  const roots: Item[] = []
  for (const it of items) {
    const p = parent.get(it.id)
    if (p) children.set(p, [...(children.get(p) ?? []), it])
    else roots.push(it)
  }
  return { parent, children, roots }
}

/** Every item under `rootId` (at any depth, not the root itself). */
export function descendants(tree: Tree, rootId: string): Set<string> {
  const out = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    for (const c of tree.children.get(id) ?? []) {
      if (out.has(c.id)) continue
      out.add(c.id)
      stack.push(c.id)
    }
  }
  return out
}

/** A frame filter: a diagram key ('studio-es'), a frame or any container's id; 'board' = a legacy board's own diagram. */
export function resolveFrame(board: Pick<Board, 'items' | 'kind'>, frame: string): Item | 'board' | undefined {
  const byKey = board.items[`diagram.${frame}`]
  if (byKey) return byKey
  const byId = board.items[frame]
  if (byId && (isContainer(byId) || byId.type === 'frame')) return byId
  if (board.kind !== 'freeform' && frame === board.kind) return 'board'
  return undefined
}

/** The diagram frame keys on a board, for error messages. */
export function frameKeys(board: Pick<Board, 'items' | 'kind'>): string[] {
  const keys = Object.values(board.items).flatMap((i) => (diagramSpecOf(i) ? [diagramSpecOf(i)!.key] : []))
  return keys.length ? keys : board.kind !== 'freeform' ? [board.kind] : []
}

/**
 * The items a frame filter selects: the frame and everything inside it, the wires with an end inside, and the
 * comments (whole threads) about any of those.
 */
export function itemsInFrame(board: Board, frame: Item | 'board', tree = containmentTree(board)): Set<string> {
  if (frame === 'board') return new Set(Object.keys(board.items))
  const set = descendants(tree, frame.id)
  set.add(frame.id)
  for (const it of Object.values(board.items)) if (it.type === 'arrow' && ((it.from && set.has(it.from)) || (it.to && set.has(it.to)))) set.add(it.id)
  return withThreads(board, set)
}

/** `ids` plus every comment whose thread hangs from one of them (and the thread's other messages). */
export function withThreads(board: Board, ids: Set<string>): Set<string> {
  const out = new Set(ids)
  for (const it of Object.values(board.items)) {
    if (it.type !== 'comment') continue
    const root = rootOf(board, it)
    if (out.has(it.id) || out.has(root.id) || (root.target && ids.has(root.target))) {
      out.add(it.id)
      out.add(root.id)
    }
  }
  return out
}

/** A reply's thread root: follow `target` through comments (a cycle makes each comment its own root). */
export function rootOf(board: Pick<Board, 'items'>, it: Item): Item {
  const seen = new Set<string>()
  let cur = it
  while (!seen.has(cur.id)) {
    seen.add(cur.id)
    const next = cur.target ? board.items[cur.target] : undefined
    if (next?.type !== 'comment') return cur
    cur = next
  }
  return it
}

export function byPos(a: Item, b: Item): number {
  const rowA = Math.round(a.y / 60)
  const rowB = Math.round(b.y / 60)
  return rowA !== rowB ? rowA - rowB : a.x - b.x
}

/** Pending proposal on an item (`data.pending`): "proposed add", "proposed remove", "proposed text". */
export function pendingTag(it: Item): string | undefined {
  const p = it.data?.pending as { kind?: unknown; by?: unknown; deleted?: unknown } | undefined
  if (!p || typeof p !== 'object') return undefined
  const kind = typeof p.kind === 'string' ? p.kind : 'change'
  // deleted on the board by the person, still in the file (docs/diagrams.md "What a redraw keeps")
  if (kind === 'remove' && p.deleted) return 'deleted by the person — the file still has it: proposed remove from the file'
  return `proposed ${kind}${typeof p.by === 'string' ? ` by ${displayName(p.by)}` : ''}`
}

const who = (c: Item) => (c.createdBy === 'agent' && typeof c.data?.by === 'string' ? (c.data.by as string) : c.createdBy)

export interface OutlineOptions {
  /** print only these items (and the containers on the way to them); default everything */
  only?: Set<string>
  /** replies shown per thread before "+N earlier" (default 3) */
  replies?: number
  /** leave out the board header and settings (a filtered page) */
  bare?: boolean
}

/**
 * Compact text rendering of the board, grouped by diagram frame → lane / column / screen / group → items, in
 * reading order, with comment threads under the item they are about, pending proposals marked, and each diagram's
 * wires at its end.
 */
export function outline(board: Board, opts: OutlineOptions = {}): string {
  const items = Object.values(board.items)
  const tree = containmentTree(board)
  const only = opts.only
  const keep = (id: string) => !only || only.has(id)
  // containers on the way to a kept item are printed too (as headers)
  const visible = new Set<string>()
  // the items kept comment threads are about: printed (as context) so a thread shows where it sits
  const context = new Set<string>()
  if (only) {
    for (const id of only) {
      const it = board.items[id]
      if (it?.type === 'comment') {
        const t = rootOf(board, it).target
        if (t && board.items[t] && board.items[t].type !== 'comment' && board.items[t].type !== 'arrow' && !only.has(t)) context.add(t)
      }
    }
    for (const id of [...only, ...context]) {
      const it = board.items[id]
      if (!it || it.type === 'comment' || it.type === 'arrow') continue
      for (let cur: string | undefined = id, g = 0; cur && g < 200; g++, cur = tree.parent.get(cur)) visible.add(cur)
    }
  }
  const shown = (id: string) => !only || visible.has(id)

  // threads: root → replies (in posting order)
  const replies = new Map<string, Item[]>()
  const roots: Item[] = []
  for (const c of items.filter((i) => i.type === 'comment')) {
    const root = rootOf(board, c)
    if (root.id === c.id) roots.push(c)
    else replies.set(root.id, [...(replies.get(root.id) ?? []), c])
  }
  const when = (i: Item) => String(i.data?.postedAt ?? i.updatedAt ?? '')
  for (const list of replies.values()) list.sort((a, b) => when(a).localeCompare(when(b)))
  const threadsOn = new Map<string, Item[]>()
  for (const r of roots) if (r.target && board.items[r.target]) threadsOn.set(r.target, [...(threadsOn.get(r.target) ?? []), r])

  const out: string[] = []
  if (!opts.bare) {
    out.push(`# ${board.title} (${board.kind}, seq ${board.seq}, ${items.length} items)`)
    const settings = settingsLines(board.meta)
    if (settings.length) out.push(...settings, '')
  }
  const printed = new Set<string>()
  const maxReplies = opts.replies ?? 3

  const said = (c: Item) => {
    const to = Array.isArray(c.data?.to) && c.data.route === 'mention' && (c.data.to as unknown[]).length ? ` → ${(c.data.to as string[]).join(', ')}` : ''
    return `(${who(c)}${to})${c.data?.paused ? ' [agents paused here — waits for the person]' : ''}`
  }
  const thread = (c: Item, indent: string) => {
    if (printed.has(c.id) || !keep(c.id)) return
    printed.add(c.id)
    const rs = replies.get(c.id) ?? []
    const last = rs[rs.length - 1] ?? c
    const edit = (c.data?.discuss as { edit?: { file?: unknown } } | undefined)?.edit
    const tags = [edit ? `proposal: edit to ${typeof edit.file === 'string' ? edit.file : 'a text'}` : '', rs.length ? `${rs.length + 1} messages` : '', last.createdBy === 'user' ? 'waiting for an answer' : ''].filter(Boolean)
    out.push(`${indent}💬 ${said(c)} ${short(c.text, 200)}${tags.length ? ` [${tags.join(' · ')}]` : ''}  #${c.id}`)
    const hidden = Math.max(0, rs.length - maxReplies)
    if (hidden) out.push(`${indent}  ↳ … ${hidden} earlier repl${hidden === 1 ? 'y' : 'ies'} (ids: [${c.id}] with format json for all)`)
    for (const r of rs.slice(hidden)) {
      out.push(`${indent}  ↳ ${said(r)} ${short(r.text, 200)}  #${r.id}`)
      printed.add(r.id)
    }
    for (const r of rs) printed.add(r.id)
  }
  const meta = (i: Item): string[] => {
    const f: string[] = []
    if (i.data?.pivotal) f.push('pivotal')
    const pend = pendingTag(i)
    if (pend) f.push(pend)
    if (i.type === 'card' && i.role === 'card') {
      const labels = Array.isArray(i.data?.labels) ? (i.data.labels as unknown[]).filter((l) => typeof l === 'string') : []
      if (labels.length) f.push(labels.join(', '))
      if (typeof i.data?.size === 'string') f.push(`size ${i.data.size}`)
      if (typeof i.data?.assignee === 'string') f.push(`@${i.data.assignee}`)
    }
    if (i.updatedBy === 'user') f.push('edited by user')
    const n = threadsOn.get(i.id)?.length
    if (n && only) f.push(`${n} thread${n === 1 ? '' : 's'}`)
    return f
  }
  const line = (i: Item, indent: string) => {
    printed.add(i.id)
    if (i.role === 'pivotal') return // a bare marker line; the event carries the flag
    if (!keep(i.id) && !context.has(i.id)) return
    const role = i.type === 'ui' ? String((i.data?.ui as { type?: string } | undefined)?.type ?? i.role ?? 'ui') : (i.role ?? i.type)
    const f = meta(i)
    out.push(`${indent}- ${role}: ${short(i.text, 80) || '(untitled)'}${f.length ? ` [${f.join(', ')}]` : ''}  #${i.id}`)
    for (const c of threadsOn.get(i.id) ?? []) thread(c, `${indent}    `)
  }
  const sortKids = (parent: Item | undefined, kids: Item[]) => {
    // a kanban column's cards in the order they stack; everything else in reading order
    if (parent?.role === 'column') return [...kids].sort((a, b) => a.y - b.y || (a.order ?? 0) - (b.order ?? 0))
    return [...kids].sort(byPos)
  }
  const arrowLine = (a: Item) => {
    const f = board.items[a.from ?? '']
    const t = board.items[a.to ?? '']
    const pend = pendingTag(a)
    return `- ${short(f?.text, 40) || a.from} → ${short(t?.text, 40) || a.to}${a.label ? ` (${short(a.label, 40)})` : ''}${a.role && !['flow', 'arrow'].includes(a.role) ? ` [${a.role}${pend ? `, ${pend}` : ''}]` : pend ? ` [${pend}]` : ''}`
  }
  const frameOfArrow = new Map<string, string>()
  const topFrameOf = (id: string | undefined): string | undefined => {
    let top: string | undefined
    for (let cur = id, g = 0; cur && g < 200; g++, cur = tree.parent.get(cur)) if (diagramSpecOf(board.items[cur])) top = cur
    return top
  }
  for (const a of items.filter((i) => i.type === 'arrow')) {
    const fa = topFrameOf(a.from)
    const fb = topFrameOf(a.to)
    if (fa && fa === fb) frameOfArrow.set(a.id, fa)
  }
  const arrowsIn = (frameId: string) => items.filter((a) => frameOfArrow.get(a.id) === frameId && keep(a.id))

  const walk = (c: Item, indent: string) => {
    if (!shown(c.id)) return
    printed.add(c.id)
    const spec = diagramSpecOf(c)
    if (spec) {
      const n = descendants(tree, c.id).size
      const holder = holdersOf(board.meta).find((h) => h.key === spec.key)
      const bits = [`key ${spec.key}`, spec.source, spec.level, `${n} items`, holder ? `files held by ${displayName(holder.holder.agent)}` : ''].filter(Boolean)
      out.push(`${indent}## ${KIND_LABEL[spec.kind] ?? spec.kind} "${short(c.text, 60)}" — ${bits.join(' · ')}  #${c.id}`)
    } else {
      const role = c.type === 'ui' ? String((c.data?.ui as { type?: string } | undefined)?.type ?? 'ui') : (c.role ?? c.type)
      const f = c.type === 'lane' && c.role === 'column' ? [`${(tree.children.get(c.id) ?? []).filter((k) => k.type === 'card').length} cards${typeof c.data?.wip === 'number' ? `, WIP ${c.data.wip}` : ''}`] : []
      if (c.data?.ds === 'group' && Array.isArray(c.data?.members)) f.push(`members: ${(c.data.members as unknown[]).join(', ')}`)
      const pend = pendingTag(c)
      if (pend) f.push(pend)
      out.push(`${indent}## ${role}: ${short(c.text, 80) || '(untitled)'}${f.length ? ` [${f.join('; ')}]` : ''}  #${c.id}`)
    }
    for (const t of threadsOn.get(c.id) ?? []) thread(t, `${indent}    `)
    for (const k of sortKids(c, tree.children.get(c.id) ?? [])) {
      if (printed.has(k.id)) continue
      if (isContainer(k)) walk(k, indent + '  ')
      else line(k, indent + '  ')
    }
    if (spec?.kind === 'domain-story') {
      // the story itself: its sentences in order (the work objects carry them)
      const sentences = [...new Map(Array.from(descendants(tree, c.id)).map((id) => board.items[id]).filter((i) => typeof i?.data?.sentence === 'string' && keep(i.id)).sort((a, b) => Number(a.data?.seq ?? 0) - Number(b.data?.seq ?? 0)).map((i) => [String(i.data!.sentence), i.id] as const)).entries()]
      if (sentences.length) {
        out.push(`${indent}  sentences:`)
        for (const [s, id] of sentences) out.push(`${indent}    ${s}  #${id}`)
      }
    }
    if (spec) {
      const ds = spec.kind === 'domain-story'
      const wires = arrowsIn(c.id).filter((a) => !(ds && (a.role === 'activity' || a.role === 'activity-to')))
      if (wires.length) {
        out.push(`${indent}  ## arrows (${wires.length})`)
        for (const a of wires.sort((p, q) => (p.from ?? '').localeCompare(q.from ?? ''))) {
          out.push(`${indent}    ${arrowLine(a)}`)
          printed.add(a.id)
        }
      }
      if (ds) for (const a of arrowsIn(c.id)) printed.add(a.id)
    }
  }
  const tops = tree.roots.filter(isContainer).sort((a, b) => (diagramSpecOf(b) ? 1 : 0) - (diagramSpecOf(a) ? 1 : 0) || byPos(a, b))
  for (const c of tops) walk(c, '')
  const loose = tree.roots.filter((s) => !isContainer(s) && !printed.has(s.id) && keep(s.id)).sort(byPos)
  if (loose.length) {
    out.push(tops.length ? '## outside any frame or lane' : '## items')
    for (const s of loose) line(s, '  ')
  }
  const rest = items.filter((a) => a.type === 'arrow' && !printed.has(a.id) && keep(a.id))
  if (rest.length) {
    out.push(frameOfArrow.size || tops.some((t) => diagramSpecOf(t)) ? '## arrows between diagrams and loose items' : '## arrows')
    for (const a of rest.sort((p, q) => (p.from ?? '').localeCompare(q.from ?? ''))) out.push(`  ${arrowLine(a)}`)
  }
  const orphan = roots.filter((c) => !printed.has(c.id) && keep(c.id))
  if (orphan.length) {
    out.push('## comments (general)')
    for (const c of orphan.sort(byPos)) thread(c, '  ')
  }
  return out.join('\n')
}
