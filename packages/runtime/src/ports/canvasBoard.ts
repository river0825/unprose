// Port: CanvasBoard — read a board and its changes, and add items to it as the
// agent. What `awd studio` needs from the canvas server; the HTTP adapter is
// in adapters/canvas/board.ts, the in-memory fake beside it.

export type BoardItem = { id: string; type: string; role?: string; text?: string; label?: string; target?: string; parent?: string; from?: string; to?: string; data?: Record<string, unknown>; createdBy?: string }
export type BoardSnapshot = { id: string; title: string; kind?: string; seq: number; items: Record<string, BoardItem>; meta?: Record<string, unknown> }
export type BoardChange = { seq: number; author: 'agent' | 'user'; /** the named agent / signed-in person who made it */ by?: string; ops: Array<{ kind: string; id?: string; item?: BoardItem; patch?: Partial<BoardItem> }> }
/** An item to add; the canvas fills in id / geometry (a comment lands beside its target). */
export type NewItem = { type: string; text?: string; target?: string; data?: Record<string, unknown> }

/** A row of the board list (enough to decide whether to look closer). */
export type BoardSummary = { id: string; title: string; kind?: string; seq?: number }

export interface CanvasBoard {
  /** Every board on the server (studio looks for the ones in its project). */
  boards(): Promise<BoardSummary[]>
  board(id: string): Promise<BoardSnapshot>
  /** Changes after `since`, and the board's current seq. */
  changes(id: string, since: number): Promise<{ changes: BoardChange[]; seq: number }>
  /** Block until something changed after `since` (or the timeout); resolves either way. */
  wait(id: string, since: number, timeoutMs: number): Promise<void>
  /** Add items as the agent; returns the new seq. */
  add(id: string, items: NewItem[], note?: string): Promise<number>
  /** Patch existing items as the agent (e.g. receipts on a comment's `data`); returns the new seq. */
  update(id: string, patches: Array<{ id: string; patch: Partial<BoardItem> }>, note?: string): Promise<number>
}
