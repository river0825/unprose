// Studio's pane pool, the pure half (docs/studio.md §8a, docs/diagrams.md §8): one
// herdr tab per project, at most `max` panes in it across its boards, the least recently used idle pane gives
// way to a new chat, and a pane idle too long is closed. Its conversation stays
// resumable — the Claude session id outlives the pane.

export interface PoolSession {
  pane?: string
  openedAt?: number
  lastUsed: number
  /** Receipt state: starting | working | idle | blocked | failed | queued | parked. */
  state?: string
}

/** A pane may be closed only when nobody is waiting on it: never while working, blocked or starting. */
const closable = (s: PoolSession) => s.state === 'idle' || s.state === 'failed'

/** Sessions with an open pane, in the order their panes were opened. */
export function openSessions<S extends PoolSession>(sessions: Record<string, S>): Array<[string, S]> {
  return Object.entries(sessions)
    .filter(([, s]) => s.pane)
    .sort(([, a], [, b]) => (a.openedAt ?? 0) - (b.openedAt ?? 0))
}

/** The pane's 1-based number in the studio tab, as the person sees it. */
export function paneNumber(sessions: Record<string, PoolSession>, name: string): number | undefined {
  const i = openSessions(sessions).findIndex(([n]) => n === name)
  return i < 0 ? undefined : i + 1
}

/** The pane to close for a new chat when the tab is full: the least recently used idle one, if any. */
export function evictable(sessions: Record<string, PoolSession>): string | undefined {
  const idle = openSessions(sessions).filter(([, s]) => closable(s))
  idle.sort(([, a], [, b]) => a.lastUsed - b.lastUsed)
  return idle[0]?.[0]
}

/** Panes idle for longer than `idleMs`. */
export function idleExpired(sessions: Record<string, PoolSession>, now: number, idleMs: number): string[] {
  return openSessions(sessions)
    .filter(([, s]) => closable(s) && now - s.lastUsed > idleMs)
    .map(([n]) => n)
}
