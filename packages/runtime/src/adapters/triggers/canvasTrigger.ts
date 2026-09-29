// `on: board` — a kanban board on the canvas is the event source. A person
// drags a card into another column; this adapter turns that into a domain
// event, exactly like the Trello webhook did. It polls the canvas HTTP API
// (long-poll `/wait`, then `/cards?since` when the server has it, else
// `/changes` + the ops' `before` snapshots) and never touches the reducer.
//
// Cursor: every emitted event carries `meta.boardSeq`; on start the newest one
// for this trigger is the resume point, so a restart never replays old moves
// and no extra event type is needed.

import { evalCondition, templateDeep, type WorkflowDefinition, type TriggerDef } from '@awd/core'
import type { EventStore } from '../../ports/eventStore.js'
import type { TriggerSource } from '../../ports/triggerSource.js'
import { keyFor } from '../../application/keys.js'

export interface CardMove {
  cardId: string
  title: string
  from?: string
  to?: string
  seq: number
  author: 'agent' | 'user'
  card: { id: string; title: string; labels?: string[]; size?: string; assignee?: string; description?: string }
}

export interface CanvasTriggerOptions {
  def: WorkflowDefinition
  store: EventStore
  env?: Record<string, string>
  log?: (line: string) => void
  /** Injected for tests. */
  fetch?: typeof fetch
  /** Polling interval when long-poll is unavailable (ms). */
  pollMs?: number
  /** Long-poll timeout (ms). */
  waitMs?: number
}

type Item = { id: string; type: string; role?: string; text?: string; parent?: string; data?: Record<string, unknown> }
type Board = { id: string; title: string; kind?: string; seq: number; items: Record<string, Item> }
type Change = { seq: number; author: 'agent' | 'user'; ops: Array<{ kind: string; id?: string; patch?: Partial<Item>; item?: Item }>; before: Record<string, Item | null> }

const isCard = (it: Item | null | undefined) => !!it && (it.role === 'card' || it.type === 'card')

const diagramOf = (it: Item | undefined) => (it?.type === 'frame' ? (it.data?.diagram as { kind?: string; key?: string } | undefined) : undefined)

/**
 * Which items belong to the kanban this trigger watches (docs/diagrams.md §7): the kanban diagram
 * frame whose key is `frame`, or — without `frame` — the board's only kanban frame, or the whole
 * board when it has none (a legacy `kanban` board). Throws when the choice is missing or ambiguous.
 */
export function kanbanScope(board: Board, frame?: string): (itemId: string | undefined) => boolean {
  const kanbans = Object.values(board.items).filter((it) => diagramOf(it)?.kind === 'kanban')
  let target: Item | undefined
  if (frame) {
    target = kanbans.find((it) => diagramOf(it)?.key === frame)
    if (!target) throw new Error(`board "${board.title}" has no kanban frame keyed "${frame}"${kanbans.length ? ` (it has: ${kanbans.map((k) => diagramOf(k)?.key).join(', ')})` : ''}`)
  } else if (kanbans.length > 1) {
    throw new Error(`board "${board.title}" has ${kanbans.length} kanban frames (${kanbans.map((k) => diagramOf(k)?.key).join(', ')}) — name one with \`frame:\``)
  } else target = kanbans[0]
  if (!target) return () => true
  const frameId = target.id
  return (itemId) => {
    for (let id = itemId, hops = 0; id && hops < 50; hops++) {
      if (id === frameId) return true
      id = board.items[id]?.parent
    }
    return false
  }
}

/** Pure: the card moves inside a batch of changes, resolved against a board snapshot. `inScope` keeps moves from/to columns of the watched kanban. */
export function movesFromChanges(board: Board, changes: Change[], inScope: (itemId: string | undefined) => boolean = () => true): CardMove[] {
  const columnName = (id: string | undefined) => (id ? board.items[id]?.text : undefined)
  const out: CardMove[] = []
  for (const ch of changes) {
    for (const op of ch.ops) {
      if (op.kind !== 'update' || !op.id || !op.patch || !('parent' in op.patch)) continue
      const was = ch.before[op.id]
      const now = board.items[op.id] ?? (was ? { ...was, ...op.patch } : undefined)
      if (!isCard(now) && !isCard(was)) continue
      const fromId = was?.parent
      const toId = op.patch.parent as string | undefined
      if (fromId === toId) continue
      if (!inScope(fromId) && !inScope(toId)) continue
      const it = now ?? was!
      out.push({
        cardId: op.id,
        title: it.text ?? op.id,
        from: columnName(fromId),
        to: columnName(toId),
        seq: ch.seq,
        author: ch.author,
        card: { id: op.id, title: it.text ?? op.id, labels: it.data?.labels as string[] | undefined, size: it.data?.size as string | undefined, assignee: it.data?.assignee as string | undefined, description: it.data?.description as string | undefined },
      })
    }
  }
  return out
}

/** Pure except for the append: one card move → one domain event (or nothing). */
export function fireBoardMove(t: TriggerDef, def: WorkflowDefinition, store: EventStore, move: CardMove, env: Record<string, string> = {}) {
  const wanted = t.author ?? 'user'
  if (wanted !== 'all' && move.author !== wanted) return undefined
  const now = new Date().toISOString()
  const scope = { card: move.card, from: move.from, to: move.to, author: move.author, seq: move.seq, env, now }
  if (!evalCondition(t.if, scope)) return undefined
  const data = t.data === undefined ? { card: move.card, from: move.from, to: move.to } : templateDeep(t.data, scope)
  const draft = { id: 'pending', type: t.emit, data, ts: now }
  let key: string
  try { key = keyFor(def, draft, env) } catch { key = move.cardId }
  return store.append({ type: t.emit, key, data, meta: { trigger: t.id, boardSeq: move.seq, board: t.board } })
}

/** The newest board seq this trigger already turned into an event. */
export function cursorFor(store: EventStore, triggerId: string): number {
  let max = 0
  for (const e of store.all()) {
    const m = e.meta as { trigger?: string; boardSeq?: number } | undefined
    if (m?.trigger === triggerId && typeof m.boardSeq === 'number' && m.boardSeq > max) max = m.boardSeq
  }
  return max
}

export function canvasSource(opts: CanvasTriggerOptions): TriggerSource {
  const { def, store } = opts
  const env = opts.env ?? {}
  const f = opts.fetch ?? fetch
  const triggers = def.triggers.filter((t) => t.on === 'board' && t.board)
  let stopped = false
  const loops: Promise<void>[] = []
  const aborts = new Set<AbortController>()

  const baseFor = (t: TriggerDef) => (t.canvas ?? env.AWD_CANVAS_URL ?? 'http://localhost:4400').replace(/\/$/, '')
  const getJson = async <T,>(url: string, signal?: AbortSignal): Promise<T> => {
    const r = await f(url, { signal })
    if (!r.ok) throw Object.assign(new Error(`${url} → ${r.status}`), { status: r.status })
    return r.json() as Promise<T>
  }

  async function resolveBoard(t: TriggerDef): Promise<Board> {
    const base = baseFor(t)
    const ref = t.board!
    if (ref.startsWith('title:')) {
      const title = ref.slice(6).trim()
      const { boards } = await getJson<{ boards: Array<{ id: string; title: string }> }>(`${base}/api/boards`)
      const hit = boards.find((b) => b.title === title)
      if (!hit) throw new Error(`no board titled "${title}" on ${base}`)
      return (await getJson<{ board: Board }>(`${base}/api/boards/${hit.id}`)).board
    }
    return (await getJson<{ board: Board }>(`${base}/api/boards/${encodeURIComponent(ref)}`)).board
  }

  async function loop(t: TriggerDef) {
    const base = baseFor(t)
    let board: Board | undefined
    let inScope: (itemId: string | undefined) => boolean = () => true
    let since = cursorFor(store, t.id)
    let useCards: boolean | undefined
    const waitMs = opts.waitMs ?? 25_000
    while (!stopped) {
      try {
        if (!board) {
          board = await resolveBoard(t)
          inScope = kanbanScope(board, t.frame)
          if (since === 0) since = board.seq // a fresh trigger starts now, not from the board's history
          opts.log?.(`board ${t.id}: watching "${board.title}" (${board.id})${t.frame ? ` frame ${t.frame}` : ''} from seq ${since}`)
        }
        const ctrl = new AbortController()
        aborts.add(ctrl)
        try {
          // 1) block until the person changed something
          await getJson(`${base}/api/boards/${board.id}/wait?since=${since}&timeout=${waitMs}&quiet=500&author=${t.author === 'all' ? '' : (t.author ?? 'user')}`, ctrl.signal)
        } finally { aborts.delete(ctrl) }
        if (stopped) break
        // 2) fetch the moves: the kanban `/cards` endpoint when present, else derive from changes
        let moves: CardMove[] = []
        if (useCards !== false) {
          try {
            const r = await getJson<{ moves?: CardMove[]; cards?: CardMove[]; seq?: number }>(`${base}/api/boards/${board.id}/cards?since=${since}`)
            const list = r.moves ?? r.cards ?? []
            // `/cards` names columns by text only: keep the moves whose card now sits in the watched kanban
            const fresh = (await getJson<{ board: Board }>(`${base}/api/boards/${board.id}`)).board
            board = fresh
            inScope = kanbanScope(board, t.frame)
            moves = list.map((m) => ({ ...m, card: m.card ?? { id: m.cardId, title: m.title } })).filter((m) => inScope(board!.items[m.cardId]?.parent))
            useCards = true
          } catch (e) {
            if ((e as { status?: number }).status === 404) useCards = false
            else throw e
          }
        }
        if (useCards === false) {
          const [{ changes, seq }, fresh] = await Promise.all([
            getJson<{ changes: Change[]; seq: number }>(`${base}/api/boards/${board.id}/changes?since=${since}`),
            getJson<{ board: Board }>(`${base}/api/boards/${board.id}`),
          ])
          board = fresh.board
          inScope = kanbanScope(board, t.frame)
          moves = movesFromChanges(board, changes, inScope)
          since = Math.max(since, seq)
        }
        for (const m of moves) {
          if (m.seq <= since && useCards) continue // already turned into an event
          const ev = fireBoardMove(t, def, store, m, env)
          if (ev) opts.log?.(`board ${t.id}: card "${m.title}" ${m.from ?? '?'} → ${m.to ?? '?'} → ${ev.type} [${ev.key}]`)
          since = Math.max(since, m.seq)
        }
        if (useCards) {
          const cur = await getJson<{ board: Board }>(`${base}/api/boards/${board.id}`)
          since = Math.max(since, cur.board.seq)
        }
      } catch (e) {
        if (stopped) break
        opts.log?.(`board ${t.id}: ${(e as Error).message} — retrying in ${opts.pollMs ?? 2000} ms`)
        board = undefined
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000))
      }
    }
  }

  return {
    name: 'board',
    start() {
      stopped = false
      for (const t of triggers) loops.push(loop(t))
    },
    async stop() {
      stopped = true
      for (const a of aborts) a.abort()
      await Promise.allSettled(loops)
    },
  }
}
