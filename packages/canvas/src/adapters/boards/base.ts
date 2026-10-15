// Everything a BoardRepository does that is *not* about where bytes go:
// applying ops, sequencing changes, fan-out, the quiet-window wait, presence.
// Adapters implement the four persistence hooks.

import { applyOps, isBookkeeping, isLayoutOnly, newId, type Author, type Board, type Change, type Op, type Wake } from '../../model.js'
import { HANDOFF_NOTE, NotFound, type BoardRepository, type ChangeListener, type ChangesQuery, type CreateBoardInput, type PresenceListener, type StorageListener, type WaitOptions } from '../../ports/boardRepository.js'

function wakes(c: Change, wake: Wake): boolean {
  if (c.note === HANDOFF_NOTE) return true
  if (wake === 'handoff' || isBookkeeping(c)) return false
  return wake === 'any' || c.ops.some((op) => !isLayoutOnly(op, c.before[op.kind === 'add' ? op.item.id : op.id]))
}

/** `meta` with these keys set (null removes one). */
export function mergeMeta(meta: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(meta ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k]
    else out[k] = v
  }
  return out
}

export abstract class BoardRepositoryBase implements BoardRepository {
  protected boards = new Map<string, Board>()
  private subs = new Map<string, Set<ChangeListener>>()
  /** Pending waits per board, counted per agent name. */
  private watching = new Map<string, Map<string, number>>()
  /** When each agent last started or stopped waiting, per board. */
  private lastSeen = new Map<string, Map<string, string>>()
  private presenceSubs = new Set<PresenceListener>()
  private storageSubs = new Set<StorageListener>()
  /** Boards whose last save failed: the next good save announces the recovery. */
  private unsaved = new Set<string>()

  // ---- persistence hooks ----
  /** Save the current snapshot of a board. */
  protected abstract persist(board: Board): void
  /** Append one change to the board's log. */
  protected abstract appendLog(change: Change): void
  /** The changes of a board with seq > `since` (every change without it), in order — so a file need only read its tail. */
  protected abstract readLog(id: string, since?: number): Change[]
  /** Forget a board's snapshot and log. */
  protected abstract remove(id: string): void

  /** Called once when a save throws; an adapter may repair its storage (e.g. recreate a deleted directory) and return true to retry. */
  protected recover(_error: unknown): boolean {
    return false
  }

  /**
   * Run a save; on failure let the adapter repair and retry once. A failure that stays is logged,
   * announced to storage listeners and rethrown (the writer gets the error, the UI gets a banner).
   */
  private save(boardId: string, write: () => void): void {
    try {
      write()
    } catch (first) {
      let err: unknown = first
      let retried = false
      try {
        if (this.recover(first)) {
          retried = true
          write()
          console.warn(`awd-canvas: board ${boardId}: storage was repaired after "${(first as Error).message}"; earlier history may be lost`)
          this.announce(boardId, true, `Saving works again (storage was repaired after: ${(first as Error).message})`)
          return
        }
      } catch (second) {
        err = second
      }
      const message = (err as Error)?.message ?? String(err)
      console.error(`awd-canvas: board ${boardId}: could not save${retried ? ' (after a repair attempt)' : ''}: ${message}`)
      this.unsaved.add(boardId)
      this.announce(boardId, false, message)
      throw err
    }
    if (this.unsaved.delete(boardId)) this.announce(boardId, true, 'Saving works again')
  }

  private announce(boardId: string, ok: boolean, message: string) {
    const e = { boardId, ok, message, at: new Date().toISOString() }
    for (const fn of this.storageSubs) {
      try {
        fn(e)
      } catch {
        // a listener never breaks a save
      }
    }
  }

  onStorage(fn: StorageListener): () => void {
    this.storageSubs.add(fn)
    return () => void this.storageSubs.delete(fn)
  }

  /** Rebuild a board from its log alone (a missing or torn snapshot). */
  protected rebuild(id: string): Board | null {
    const changes = this.readLog(id)
    if (changes.length === 0) return null
    const first = changes[0]
    let board: Board = { id, title: (first.note ?? id).replace(/^create: /, ''), kind: 'freeform', seq: 0, createdAt: first.ts, updatedAt: first.ts, items: {} }
    for (const c of changes) board = { ...applyOps(board, c.ops, c.author, c.ts).board, seq: c.seq, ...(c.meta ? { meta: mergeMeta(board.meta, c.meta) } : {}) }
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
    this.save(id, () => this.persist(board))
    this.boards.set(id, board)
    if (input.items?.length) {
      this.apply(id, input.items.map((item) => ({ kind: 'add', item }) as Op), author, `create: ${input.title}`, input.by)
      board = this.boards.get(id)!
    }
    return board
  }

  apply(id: string, ops: Op[], author: Author, note?: string, by?: string): Change {
    const board = this.boards.get(id)
    if (!board) throw new NotFound(`board ${id} not found`)
    const now = new Date().toISOString()
    const { board: next, before } = applyOps(board, ops, author, now)
    const change: Change = { seq: board.seq + 1, ts: now, author, boardId: id, ops, before, note, ...(by ? { by } : {}) }
    const updated: Board = { ...next, seq: change.seq }
    this.save(id, () => {
      this.appendLog(change)
      this.persist(updated)
    })
    this.boards.set(id, updated)
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
    this.save(id, () => this.persist(updated))
    this.boards.set(id, updated)
    return updated
  }

  setMeta(id: string, patch: Record<string, unknown>, author: Author, note: string, by?: string): Change {
    const board = this.boards.get(id)
    if (!board) throw new NotFound(`board ${id} not found`)
    const now = new Date().toISOString()
    const change: Change = { seq: board.seq + 1, ts: now, author, boardId: id, ops: [], before: {}, note, meta: patch, ...(by ? { by } : {}) }
    const updated: Board = { ...board, seq: change.seq, updatedAt: now, meta: mergeMeta(board.meta, patch) }
    this.save(id, () => {
      this.appendLog(change)
      this.persist(updated)
    })
    this.boards.set(id, updated)
    for (const fn of this.subs.get(id) ?? []) {
      try {
        fn(change)
      } catch {
        // a broken subscriber never blocks the writer
      }
    }
    return change
  }

  changes(id: string, q: ChangesQuery = {}): Change[] {
    if (!this.boards.has(id)) throw new NotFound(`board ${id} not found`)
    const since = q.since ?? 0
    return this.readLog(id, since).filter((c) => c.seq > since && (!q.author || c.author === q.author) && (!q.match || q.match(c)))
  }

  subscribe(id: string, fn: ChangeListener): () => void {
    if (!this.subs.has(id)) this.subs.set(id, new Set())
    this.subs.get(id)!.add(fn)
    return () => this.subs.get(id)?.delete(fn)
  }

  waitFor(id: string, since: number, timeoutMs: number, author?: Author, opts: WaitOptions = {}): Promise<Change[]> {
    const quietMs = opts.quietMs ?? 2500
    const wake = opts.wake ?? 'meaningful'
    const who = opts.who || 'agent'
    const matching = () => this.changes(id, { since, author, match: opts.match }).filter((c) => !isBookkeeping(c))
    const existing = matching()
    if (existing.some((c) => c.note === HANDOFF_NOTE)) return Promise.resolve(existing)
    if (opts.signal?.aborted) return Promise.resolve([])
    this.setWatching(id, who, +1)
    return new Promise((resolve) => {
      let woke = existing.some((c) => wakes(c, wake))
      let quiet: ReturnType<typeof setTimeout> | undefined
      let done = false
      const onAbort = () => finish([])
      const finish = (result: Change[]) => {
        if (done) return
        done = true
        clearTimeout(deadline)
        if (quiet) clearTimeout(quiet)
        off()
        opts.signal?.removeEventListener('abort', onAbort)
        this.setWatching(id, who, -1)
        resolve(result)
      }
      const armQuiet = () => {
        if (quiet) clearTimeout(quiet)
        quiet = setTimeout(() => finish(matching()), quietMs)
      }
      const off = this.subscribe(id, (c) => {
        if ((author && c.author !== author) || (opts.match && !opts.match(c)) || !wakes(c, wake)) return
        woke = true
        if (c.note === HANDOFF_NOTE) finish(matching())
        else armQuiet()
      })
      const deadline = setTimeout(() => finish(woke ? matching() : []), timeoutMs)
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      if (woke) armQuiet()
    })
  }

  watchers(id: string): number {
    let n = 0
    for (const c of this.watching.get(id)?.values() ?? []) n += c
    return n
  }

  watcherNames(id: string): string[] {
    return [...(this.watching.get(id)?.entries() ?? [])].filter(([, c]) => c > 0).map(([name]) => name).sort()
  }

  watcherSeen(id: string): Record<string, string> {
    return Object.fromEntries(this.lastSeen.get(id) ?? [])
  }

  onPresence(fn: PresenceListener): () => void {
    this.presenceSubs.add(fn)
    return () => void this.presenceSubs.delete(fn)
  }

  private setWatching(id: string, who: string, delta: number) {
    let per = this.watching.get(id)
    if (!per) this.watching.set(id, (per = new Map()))
    const c = Math.max(0, (per.get(who) ?? 0) + delta)
    if (c) per.set(who, c)
    else per.delete(who)
    let seen = this.lastSeen.get(id)
    if (!seen) this.lastSeen.set(id, (seen = new Map()))
    seen.set(who, new Date().toISOString())
    const n = this.watchers(id)
    const names = this.watcherNames(id)
    for (const fn of this.presenceSubs) {
      try {
        fn(id, n, names)
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
