// BoardRepository adapter: boards live in the project they belong to. A board of a project is stored
// in `<project>/.unprose/boards/` (the snapshot `<id>.json` is meant to be committed with the project,
// the change log `<id>.changes.ndjson` stays local); boards of no project stay in the personal dir
// (the server's `--dir`). One server serves every registered project; board ids stay unique across them.
//
// Same files and log-first rules as FileBoardRepository — only the directory is chosen per board.

import fs from 'node:fs'
import path from 'node:path'
import { newId, type Author, type Board, type Change } from '../../model.js'
import { NotFound, PERSONAL_PROJECT, type CreateBoardInput, type ProjectBoards, type ProjectInfo } from '../../ports/boardRepository.js'
import { BoardRepositoryBase } from './base.js'
import { defaultBoardsDir } from './location.js'

/** The registry of projects, kept next to the personal boards (a dotfile, never read as a board). */
export const REGISTRY_FILE = '.projects.json'

/** What a project's `.unprose/.gitignore` says: commit the snapshots, keep the logs and temp files local. */
export const PROJECT_GITIGNORE = `# Unprose (https://github.com/river0825/unprose)
# boards/<id>.json — the board snapshots — are meant to be committed with the project.
# The change logs are local history (large, noisy in diffs); temporary files are never wanted.
boards/*.changes.ndjson
boards/*.tmp
`

const LOG = '.changes.ndjson'

/** `My Project!` → `my-project`; never empty. */
export function projectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  )
}

interface Registered {
  id: string
  root: string
}

export class ProjectsBoardRepository extends BoardRepositoryBase implements ProjectBoards {
  /** The personal boards dir (kept as `dir` so callers that print "boards in <dir>" still work). */
  readonly dir: string
  private readonly registryPath: string
  private registered: Registered[] = []
  /** Which directory stores each board. */
  private dirOf = new Map<string, string>()

  constructor(dir = defaultBoardsDir()) {
    super()
    this.dir = path.resolve(dir)
    this.registryPath = path.join(this.dir, REGISTRY_FILE)
    fs.mkdirSync(this.dir, { recursive: true })
    this.loadDir(this.dir)
    for (const p of this.readRegistry()) {
      this.registered.push(p)
      this.loadDir(boardsDirOf(p.root))
    }
  }

  // ---- projects ----

  projects(): ProjectInfo[] {
    return [
      { id: PERSONAL_PROJECT, name: 'Personal', root: null, boardsDir: this.dir, personal: true },
      ...this.registered.map((p) => ({ id: p.id, name: path.basename(p.root), root: p.root, boardsDir: boardsDirOf(p.root) })),
    ]
  }

  registerProject(root: string): ProjectInfo {
    const abs = path.resolve(root)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`project root ${abs} is not a directory`)
    const real = fs.realpathSync(abs)
    if (real === fs.realpathSync(this.dir)) throw new Error('the personal boards dir cannot be a project')
    let p = this.registered.find((r) => r.root === real)
    if (!p) {
      const taken = new Set([PERSONAL_PROJECT, ...this.registered.map((r) => r.id)])
      const base = projectSlug(path.basename(real))
      let id = base
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
      p = { id, root: real }
      this.registered.push(p)
      this.writeRegistry()
      this.loadDir(boardsDirOf(real))
    }
    return this.projects().find((x) => x.id === p!.id)!
  }

  projectOf(boardId: string): string {
    const dir = this.dirOf.get(boardId)
    return this.registered.find((p) => boardsDirOf(p.root) === dir)?.id ?? PERSONAL_PROJECT
  }

  override create(input: CreateBoardInput, author: Author = 'agent'): Board {
    const dir = this.dirForProject(input.project ?? PERSONAL_PROJECT)
    const id = input.id ?? newId('b')
    if (this.get(id)) throw new Error(`board ${id} already exists`)
    this.prepare(dir)
    this.dirOf.set(id, dir)
    try {
      return super.create({ ...input, id }, author)
    } catch (e) {
      if (!this.get(id)) this.dirOf.delete(id)
      throw e
    }
  }

  moveBoard(boardId: string, projectId: string): Board {
    const board = this.get(boardId)
    if (!board) throw new NotFound(`board ${boardId} not found`)
    const from = this.dirOf.get(boardId)!
    const to = this.dirForProject(projectId)
    if (from === to) return board
    this.prepare(to)
    // copy first (log as-is, snapshot freshly written), check, then switch and remove the old files
    const log = path.join(from, `${boardId}${LOG}`)
    if (fs.existsSync(log)) fs.copyFileSync(log, path.join(to, `${boardId}${LOG}`))
    writeSnapshot(to, board)
    if (!fs.existsSync(path.join(to, `${boardId}.json`))) throw new Error(`could not write ${boardId}.json into ${to}`)
    this.dirOf.set(boardId, to)
    for (const f of [path.join(from, `${boardId}.json`), log]) if (fs.existsSync(f)) fs.unlinkSync(f)
    return board
  }

  // ---- persistence hooks ----

  protected persist(board: Board): void {
    writeSnapshot(this.dirFor(board.id), board)
  }

  protected appendLog(change: Change): void {
    fs.appendFileSync(path.join(this.dirFor(change.boardId), `${change.boardId}${LOG}`), JSON.stringify(change) + '\n')
  }

  protected readLog(id: string): Change[] {
    const p = path.join(this.dirFor(id), `${id}${LOG}`)
    if (!fs.existsSync(p)) return []
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Change)
  }

  protected remove(id: string): void {
    const dir = this.dirFor(id)
    for (const p of [path.join(dir, `${id}.json`), path.join(dir, `${id}${LOG}`)]) if (fs.existsSync(p)) fs.unlinkSync(p)
    this.dirOf.delete(id)
  }

  /** A directory vanished (a plugin reinstall, a `git clean`): make it again so the retry can write. */
  protected override recover(error: unknown): boolean {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') return false
    for (const dir of new Set(this.dirOf.values())) fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(this.dir, { recursive: true })
    return true
  }

  // ---- internals ----

  private dirFor(id: string): string {
    return this.dirOf.get(id) ?? this.dir
  }

  private dirForProject(projectId: string): string {
    if (projectId === PERSONAL_PROJECT) return this.dir
    const p = this.registered.find((r) => r.id === projectId)
    if (!p) throw new NotFound(`project ${projectId} is not registered`)
    return boardsDirOf(p.root)
  }

  /** A project's boards dir exists and its `.unprose/.gitignore` says what to commit. */
  private prepare(dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    if (dir === this.dir) return
    const ignore = path.join(path.dirname(dir), '.gitignore')
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, PROJECT_GITIGNORE)
  }

  /** Load the boards stored in `dir` (snapshots first, then boards that only have a log). */
  private loadDir(dir: string) {
    if (!fs.existsSync(dir)) return
    const files = fs.readdirSync(dir)
    for (const f of files) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue
      try {
        const board = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Board
        if (!board?.id) continue
        if (this.boards.has(board.id) && this.dirOf.get(board.id) !== dir) {
          console.warn(`awd-canvas: board ${board.id} exists in ${this.dirOf.get(board.id)} and ${dir}; keeping the first`)
          continue
        }
        this.boards.set(board.id, board)
        this.dirOf.set(board.id, dir)
      } catch {
        // a half-written snapshot is rebuilt from the log below
      }
    }
    for (const f of files) {
      if (!f.endsWith(LOG)) continue
      const id = f.slice(0, -LOG.length)
      if (this.boards.has(id)) continue
      this.dirOf.set(id, dir)
      const rebuilt = this.rebuild(id)
      if (rebuilt) this.boards.set(id, rebuilt)
      else this.dirOf.delete(id)
    }
  }

  private readRegistry(): Registered[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.registryPath, 'utf8')) as { projects?: Registered[] }
      return (raw.projects ?? []).filter((p) => p && typeof p.id === 'string' && typeof p.root === 'string' && fs.existsSync(p.root))
    } catch {
      return []
    }
  }

  private writeRegistry() {
    const tmp = `${this.registryPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ projects: this.registered }, null, 2) + '\n')
    fs.renameSync(tmp, this.registryPath)
  }
}

function boardsDirOf(root: string): string {
  return path.join(root, '.unprose', 'boards')
}

/** Pretty, stable JSON (2-space indent, trailing newline) so a committed snapshot diffs well. */
function writeSnapshot(dir: string, board: Board) {
  const p = path.join(dir, `${board.id}.json`)
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2) + '\n')
  fs.renameSync(tmp, p)
}
