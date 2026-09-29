// Port: StudioStore — where `awd studio` keeps its state for one project: each
// board's cursor, the Claude sessions and their queue, the briefs a session reads,
// and the status the canvas shows. The file adapter writes under <repo>/.awd/studio/
// (briefs per board under <board-scope>/).

/**
 * One Claude Code conversation (docs/diagrams.md §8). A board has one `board` session;
 * a chat that arrives while it is busy runs in a `fork` of it; a board session the
 * person replaced ("new session") is `retired` — it finishes its chats, takes no new ones.
 */
export interface StudioSession {
  /** Board id this session belongs to. */
  board: string
  role: 'board' | 'fork' | 'retired'
  /** Claude Code session id: `--session-id` at first open (a fork's own id, too), `--resume` after its pane was closed. */
  sessionId: string
  /** The session it was forked from (forks only). */
  forkOf?: string
  /** The latest chat root; the request comment the session replies under ('' before any chat, e.g. warm-up). */
  root: string
  /** Every chat root this session took — a follow-up under any of them goes back to it. */
  roots: string[]
  /** herdr pane while open; absent = parked (resumable). */
  pane?: string
  /** When the pane was opened (ms): orders panes for their 1-based number in the tab. */
  openedAt?: number
  /** Last prompt or activity (ms): the least recently used idle pane is evicted first. */
  lastUsed: number
  /** State last shown on the root's receipt (docs/studio.md §6). */
  state?: string
  /** The request that opened the latest chat (the application's DiscussRequest, as JSON). */
  req?: Record<string, unknown>
}

/** One chat: the session answering it, and the request that opened it. */
export interface StudioChat {
  session: string
  req: Record<string, unknown>
}

/** A request waiting for a pane, oldest first. */
export interface StudioJob {
  board: string
  /** new: a chat request · followup: a person's reply in a parked chat · warm: prime the board session. */
  kind: 'new' | 'followup' | 'warm'
  /** The session a follow-up continues (new/warm jobs are placed when they run). */
  session?: string
  /** The request (for a follow-up: the chat's request with the new text; for warm-up: empty). */
  req: Record<string, unknown>
  /** The ack "queued" was already posted. */
  announced?: boolean
  /** Position last shown on the root's receipt. */
  shownPosition?: number
}

/** Per board: how far studio has read, and how its sessions are named. */
export interface BoardCursor {
  /** Newest board seq already handled. */
  seq: number
  /** Short name in herdr agent names and brief folders. */
  scope: string
  /** Board session generation: bumped by "new session". */
  gen: number
  /** Forks made so far (names `…-f<n>`). */
  forks: number
  /** `meta.studio.newSessionAt` already acted on. */
  resetAt?: string
  /** The board was warmed up once. */
  warmed?: boolean
}

export interface StudioState {
  /** Project root this state belongs to. */
  project: string
  boards: Record<string, BoardCursor>
  /** Conversations by herdr session name. */
  sessions?: Record<string, StudioSession>
  /** Chat root comment id → the session that took it, and the chat's request (a follow-up resumes with it). */
  chats?: Record<string, StudioChat>
  queue?: StudioJob[]
}

/** What the canvas server shows next to the Studio control (docs/diagrams.md §8). */
export interface StudioStatus {
  /** Project root (absolute). */
  project: string
  /** Boards studio is watching. */
  boards: number
  open: number
  max: number
  queued: number
  updatedAt: string
}

export interface StudioStore {
  loadState(): StudioState | undefined
  saveState(state: StudioState): void
  /** Write the brief for a chat under the board's folder; returns the path the session should read. */
  writeBrief(scope: string, key: string, markdown: string): string
  writeStatus(status: StudioStatus): void
}
