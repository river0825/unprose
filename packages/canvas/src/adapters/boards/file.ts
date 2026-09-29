// BoardRepository adapter: a directory. `<id>.json` is the snapshot,
// `<id>.changes.ndjson` the append-only log — the log is the truth, the
// snapshot a rebuildable projection (like the runtime's event store).

import fs from 'node:fs'
import path from 'node:path'
import type { Board, Change } from '../../model.js'
import { BoardRepositoryBase } from './base.js'
import { defaultBoardsDir } from './location.js'

export class FileBoardRepository extends BoardRepositoryBase {
  readonly dir: string

  constructor(dir = defaultBoardsDir()) {
    super()
    this.dir = path.resolve(dir)
    fs.mkdirSync(this.dir, { recursive: true })
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const board = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Board
        if (board?.id) this.boards.set(board.id, board)
      } catch {
        // a half-written snapshot is rebuilt from the log below
      }
    }
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.changes.ndjson')) continue
      const id = f.slice(0, -'.changes.ndjson'.length)
      if (this.boards.has(id)) continue
      const rebuilt = this.rebuild(id)
      if (rebuilt) this.boards.set(id, rebuilt)
    }
  }

  private snapshotPath(id: string) {
    return path.join(this.dir, `${id}.json`)
  }
  private logPath(id: string) {
    return path.join(this.dir, `${id}.changes.ndjson`)
  }

  /** The directory vanished (e.g. a plugin reinstall deleted it): make it again, so the retry can write. */
  protected override recover(error: unknown): boolean {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') return false
    fs.mkdirSync(this.dir, { recursive: true })
    return true
  }

  protected persist(board: Board): void {
    const p = this.snapshotPath(board.id)
    const tmp = `${p}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(board, null, 2))
    fs.renameSync(tmp, p)
  }

  protected appendLog(change: Change): void {
    fs.appendFileSync(this.logPath(change.boardId), JSON.stringify(change) + '\n')
  }

  protected readLog(id: string): Change[] {
    const p = this.logPath(id)
    if (!fs.existsSync(p)) return []
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Change)
  }

  protected remove(id: string): void {
    for (const p of [this.snapshotPath(id), this.logPath(id)]) if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}
