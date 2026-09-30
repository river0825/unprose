// Port: BoardRepository — where boards and their change logs live. The web
// UI, the MCP server and the HTTP API only ever see this interface; today's
// adapters are a directory of JSON + NDJSON files and an in-memory map.

import type { Author, Board, Change, DiagramKind, Item, Op, Wake } from '../model.js'

export interface CreateBoardInput {
  title: string
  kind: DiagramKind
  meta?: Record<string, unknown>
  items?: Item[]
  id?: string
  /** Which project stores it (a `ProjectInfo.id`); default: the personal space. */
  project?: string
}

export interface ChangesQuery {
  since?: number
  author?: Author
}

export type ChangeListener = (change: Change) => void
export type PresenceListener = (boardId: string, watchers: number) => void
/** Saving a board failed (`ok: false`), or works again after a failure (`ok: true`). */
export interface StorageEvent { boardId: string; ok: boolean; message: string; at: string }
export type StorageListener = (e: StorageEvent) => void

/** The note a user change carries when they press "Hand to agent". */
export const HANDOFF_NOTE = 'handoff'

export interface BoardRepository {
  list(): Board[]
  get(id: string): Board | undefined
  create(input: CreateBoardInput, author?: Author): Board
  /** Apply ops atomically, append the change to the log, notify subscribers. */
  apply(id: string, ops: Op[], author: Author, note?: string): Change
  /** Update board-level fields (title, meta). Not logged as an item change. */
  updateBoard(id: string, patch: Partial<Pick<Board, 'title' | 'meta'>>): Board
  changes(id: string, q?: ChangesQuery): Change[]
  subscribe(id: string, fn: ChangeListener): () => void
  /**
   * Resolve with every change after `since` once the person has *stopped*
   * (`quietMs` after the last waking change), at once on a `handoff` change,
   * or with [] after `timeoutMs`. `wake` (default 'meaningful') decides which
   * changes wake and restart the quiet window: layout-only moves and read
   * receipts do not, but ride along in the result. While pending the board counts as watched.
   */
  waitFor(id: string, since: number, timeoutMs: number, author?: Author, opts?: { quietMs?: number; wake?: Wake }): Promise<Change[]>
  /** How many agent waits are currently pending on this board. */
  watchers(id: string): number
  onPresence(fn: PresenceListener): () => void
  /** Hear about saves that fail (and recover), so clients can say "changes are not being saved". */
  onStorage(fn: StorageListener): () => void
  delete(id: string): boolean
}

export class NotFound extends Error {}

// ---- Projects: boards live inside the project they belong to (`<root>/.unprose/boards/`) ----

/** The space for boards that belong to no project (the server's own boards dir). */
export const PERSONAL_PROJECT = 'personal'

export interface ProjectInfo {
  /** Stable, url-safe: the slug of the directory name (`-2`, `-3` … on a clash); `personal` for the personal space. */
  id: string
  /** Shown to people: the directory name, or "Personal". */
  name: string
  /** Absolute project root; null for the personal space. */
  root: string | null
  /** Where its boards are stored. */
  boardsDir: string | null
  personal?: boolean
}

/** A repository that stores each board in the project it belongs to (optional capability of a BoardRepository). */
export interface ProjectBoards {
  projects(): ProjectInfo[]
  /** Register (or find) the project at `root`; idempotent, persisted. */
  registerProject(root: string): ProjectInfo
  /** The project that stores a board. */
  projectOf(boardId: string): string
  /** Move a board (snapshot and change log) into another project; the old files go only after the copy succeeded. */
  moveBoard(boardId: string, projectId: string): Board
}

export function hasProjects(r: BoardRepository): r is BoardRepository & ProjectBoards {
  return typeof (r as Partial<ProjectBoards>).registerProject === 'function'
}
