// BoardRepository adapter: a directory. `<id>.json` is the snapshot,
// `<id>.changes.ndjson` the append-only log — the log is the truth, the
// snapshot a rebuildable projection (like the runtime's event store).
// The log is read through an index, so a read since N reads only its tail (changeLog.ts).

import fs from 'node:fs'
import path from 'node:path'
import type { Board, Change } from '../../model.js'
import { BoardRepositoryBase } from './base.js'
import { ChangeLogFiles } from './changeLog.js'
import { defaultBoardsDir } from './location.js'

export class FileBoardRepository extends BoardRepositoryBase {
  readonly dir: string
  private logs = new ChangeLogFiles()

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
    this.logs.append(this.logPath(change.boardId), change)
  }

  protected readLog(id: string, since?: number): Change[] {
    return this.logs.read(this.logPath(id), since)
  }

  protected remove(id: string): void {
    for (const p of [this.snapshotPath(id), this.logPath(id)]) if (fs.existsSync(p)) fs.unlinkSync(p)
    this.logs.forget(this.logPath(id))
  }
}
