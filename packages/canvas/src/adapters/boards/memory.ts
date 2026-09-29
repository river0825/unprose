// BoardRepository adapter: memory only (tests, `AWD_CANVAS_STORE=memory`).
// Same log-first shape as the file adapter, so a board can still be rebuilt.

import type { Board, Change } from '../../model.js'
import { BoardRepositoryBase } from './base.js'

export class MemoryBoardRepository extends BoardRepositoryBase {
  private logs = new Map<string, Change[]>()

  protected persist(board: Board): void {
    this.boards.set(board.id, board)
  }
  protected appendLog(change: Change): void {
    if (!this.logs.has(change.boardId)) this.logs.set(change.boardId, [])
    this.logs.get(change.boardId)!.push(change)
  }
  protected readLog(id: string): Change[] {
    return (this.logs.get(id) ?? []).slice()
  }
  protected remove(id: string): void {
    this.logs.delete(id)
  }
}
