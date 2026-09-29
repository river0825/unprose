// Everything a BoardRepository does that is *not* about where bytes go:
// applying ops, sequencing changes, fan-out, the quiet-window wait, presence.
// Adapters implement the four persistence hooks.

import { applyOps, isBookkeeping, isLayoutOnly, newId, type Author, type Board, type Change, type Op, type Wake } from '../../model.js'
import { HANDOFF_NOTE, NotFound, type BoardRepository, type ChangeListener, type ChangesQuery, type CreateBoardInput, type PresenceListener } from '../../ports/boardRepository.js'

function wakes(c: Change, wake: Wake): boolean {
  if (c.note === HANDOFF_NOTE) return true
  if (wake === 'handoff' || isBookkeeping(c)) return false
  return wake === 'any' || c.ops.some((op) => !isLayoutOnly(op, c.before[op.kind === 'add' ? op.item.id : op.id]))
}

export abstract class BoardRepositoryBase implements BoardRepository {
  protected boards = new Map<string, Board>()
  private subs = new Map<string, Set<ChangeListener>>()
  private watching = new Map<string, number>()
  private presenceSubs = new Set<PresenceListener>()

  // ---- persistence hooks ----
  /** Save the current snapshot of a board. */
  protected abstract persist(board: Board): void
  /** Append one change to the board's log. */
  protected abstract appendLog(change: Change): void
  /** Every change of a board, in order. */
  protected abstract readLog(id: string): Change[]
  /** Forget a board's snapshot and log. */
  protected abstract remove(id: string): void

  /** Rebuild a board from its log alone (a missing or torn snapshot). */
  protected rebuild(id: string): Board | null {
    const changes = this.readLog(id)
    if (changes.length === 0) return null
    const first = changes[0]
    let board: Board = { id, title: (first.note ?? id).replace(/^create: /, ''), kind: 'freeform', seq: 0, createdAt: first.ts, updatedAt: first.ts, items: {} }
    for (const c of changes) board = { ...applyOps(board, c.ops, c.author, c.ts).board, seq: c.seq }
    return board
  }

  list(): Board[] {
    return [...this.boards.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  get(id: string): Board | undefined {
    return this.boards.get(id)
  }

  create(input: CreateBoardInput, author: Author = 'agent'): Board {
    const now = new Date().toISOString()
    const id = input.id ?? newId('b')
    if (this.boards.has(id)) throw new Error(`board ${id} already exists`)
    let board: Board = { id, title: input.title, kind: input.kind, seq: 0, createdAt: now, updatedAt: now, items: {}, meta: input.meta }
    this.boards.set(id, board)
    this.persist(board)
    if (input.items?.length) {
      this.apply(id, input.items.map((item) => ({ kind: 'add', item }) as Op), author, `create: ${input.title}`)
      board = this.boards.get(id)!
    }
    return board
  }

  apply(id: string, ops: Op[], author: Author, note?: string): Change {
    const board = this.boards.get(id)
    if (!board) throw new NotFound(`board ${id} not found`)
    const now = new Date().toISOString()
    const { board: next, before } = applyOps(board, ops, author, now)
    const change: Change = { seq: board.seq + 1, ts: now, author, boardId: id, ops, before, note }
    const updated: Board = { ...next, seq: change.seq }
    this.boards.set(id, updated)
    this.appendLog(change)
    this.persist(updated)
    for (const fn of this.subs.get(id) ?? []) {
      try {
        fn(change)
      } catch {
        // a broken subscriber never blocks the writer
      }
    }
    return change
  }

  updateBoard(id: string, patch: Partial<Pick<Board, 'title' | 'meta'>>): Board {
    const board = this.boards.get(id)
    if (!board) throw new NotFound(`board ${id} not found`)
    const updated = { ...board, ...patch, updatedAt: new Date().toISOString() }
    this.boards.set(id, updated)
    this.persist(updated)
    return updated
  }

  changes(id: string, q: ChangesQuery = {}): Change[] {
    if (!this.boards.has(id)) throw new NotFound(`board ${id} not found`)
    const since = q.since ?? 0
    return this.readLog(id).filter((c) => c.seq > since && (!q.author || c.author === q.author))
  }

  subscribe(id: string, fn: ChangeListener): () => void {
    if (!this.subs.has(id)) this.subs.set(id, new Set())
    this.subs.get(id)!.add(fn)
    return () => this.subs.get(id)?.delete(fn)
  }

  waitFor(id: string, since: number, timeoutMs: number, author?: Author, opts: { quietMs?: number; wake?: Wake } = {}): Promise<Change[]> {
    const quietMs = opts.quietMs ?? 2500
    const wake = opts.wake ?? 'meaningful'
    const matching = () => this.changes(id, { since, author }).filter((c) => !isBookkeeping(c))
    const existing = matching()
    if (existing.some((c) => c.note === HANDOFF_NOTE)) return Promise.resolve(existing)
    this.setWatching(id, +1)
    return new Promise((resolve) => {
      let woke = existing.some((c) => wakes(c, wake))
      let quiet: ReturnType<typeof setTimeout> | undefined
      const finish = (result: Change[]) => {
        clearTimeout(deadline)
        if (quiet) clearTimeout(quiet)
        off()
        this.setWatching(id, -1)
        resolve(result)
      }
      const armQuiet = () => {
        if (quiet) clearTimeout(quiet)
        quiet = setTimeout(() => finish(matching()), quietMs)
      }
      const off = this.subscribe(id, (c) => {
        if ((author && c.author !== author) || !wakes(c, wake)) return
        woke = true
        if (c.note === HANDOFF_NOTE) finish(matching())
        else armQuiet()
      })
      const deadline = setTimeout(() => finish(woke ? matching() : []), timeoutMs)
      if (woke) armQuiet()
    })
  }

  watchers(id: string): number {
    return this.watching.get(id) ?? 0
  }

  onPresence(fn: PresenceListener): () => void {
    this.presenceSubs.add(fn)
    return () => void this.presenceSubs.delete(fn)
  }

  private setWatching(id: string, delta: number) {
    const n = Math.max(0, (this.watching.get(id) ?? 0) + delta)
    this.watching.set(id, n)
    for (const fn of this.presenceSubs) {
      try {
        fn(id, n)
      } catch {
        // never let a listener break the wait
      }
    }
  }

  delete(id: string): boolean {
    if (!this.boards.delete(id)) return false
    this.remove(id)
    return true
  }
}
