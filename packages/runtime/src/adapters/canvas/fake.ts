// CanvasBoard adapters for tests: one board in memory (FakeCanvasBoard), or several
// (FakeCanvas). `userComment` plays the person asking the AI on the board.

import type { BoardChange, BoardItem, BoardSnapshot, BoardSummary, CanvasBoard, NewItem } from '../../ports/canvasBoard.js'

export class FakeCanvasBoard implements CanvasBoard {
  readonly log: BoardChange[] = []
  private n = 0
  constructor(readonly snapshot: BoardSnapshot) {}

  async boards(): Promise<BoardSummary[]> { return [{ id: this.snapshot.id, title: this.snapshot.title, kind: this.snapshot.kind, seq: this.snapshot.seq }] }
  async board() { return structuredClone(this.snapshot) }
  async changes(_id: string, since: number) { return { changes: this.log.filter((c) => c.seq > since), seq: this.snapshot.seq } }
  async wait() {}
  async add(_id: string, items: NewItem[]) {
    return this.push('agent', items.map((i) => ({ id: `${this.snapshot.id}.c${++this.n}`, createdBy: 'agent', ...i })))
  }

  async update(_id: string, patches: Array<{ id: string; patch: Partial<BoardItem> }>) {
    const seq = ++this.snapshot.seq
    for (const p of patches) if (this.snapshot.items[p.id]) this.snapshot.items[p.id] = { ...this.snapshot.items[p.id], ...p.patch }
    this.log.push({ seq, author: 'agent', ops: patches.map((p) => ({ kind: 'update', id: p.id, patch: p.patch })) })
    return seq
  }

  /** Test hook: the person adds a comment (with `data.discuss` for a request). */
  userComment(target: string, text: string, data?: Record<string, unknown>): string {
    const id = `${this.snapshot.id}.u${++this.n}`
    this.push('user', [{ id, type: 'comment', target, text, data, createdBy: 'user' }])
    return id
  }

  private push(author: 'agent' | 'user', items: BoardItem[]): number {
    const seq = ++this.snapshot.seq
    for (const it of items) this.snapshot.items[it.id] = it
    this.log.push({ seq, author, ops: items.map((item) => ({ kind: 'add', item })) })
    return seq
  }
}

/** Several boards on one fake server; calls go to the board with that id. */
export class FakeCanvas implements CanvasBoard {
  readonly byId = new Map<string, FakeCanvasBoard>()
  constructor(...boards: FakeCanvasBoard[]) { for (const b of boards) this.byId.set(b.snapshot.id, b) }
  addBoard(b: FakeCanvasBoard) { this.byId.set(b.snapshot.id, b); return b }
  private at(id: string) {
    const b = this.byId.get(id)
    if (!b) throw new Error(`GET /api/boards/${id} → 404`)
    return b
  }
  async boards() { return (await Promise.all([...this.byId.values()].map((b) => b.boards()))).flat() }
  board(id: string) { return this.at(id).board() }
  changes(id: string, since: number) { return this.at(id).changes(id, since) }
  async wait() {}
  add(id: string, items: NewItem[], note?: string) { return this.at(id).add(id, items) }
  update(id: string, patches: Array<{ id: string; patch: Partial<BoardItem> }>, note?: string) { return this.at(id).update(id, patches) }
}
