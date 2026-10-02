import type { Author, Board, Change, Op, WsMessage } from '../../src/model'

async function json<T>(res: Response): Promise<T> {
  // signed out (or never signed in) from elsewhere: the app asks who it is again and shows the sign-in screen
  if (res.status === 401) window.dispatchEvent(new Event('unprose:signin'))
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  return (await res.json()) as T
}

export interface BoardSummary {
  id: string
  title: string
  kind: Board['kind']
  seq: number
  updatedAt: string
  createdAt?: string
  itemCount?: number
  /** The project that stores it (docs/canvas.md "Projects"); absent on older servers. */
  project?: string
}

export interface ProjectSummary {
  id: string
  name: string
  personal: boolean
  boards: number
}

export const api = {
  listBoards: () => fetch('/api/boards').then((r) => json<BoardSummary[] | { boards: BoardSummary[] }>(r)),
  /** Projects on this canvas; an older server (no route) answers with the personal space only. */
  listProjects: () =>
    fetch('/api/projects')
      .then((r) => (r.ok ? json<{ projects: ProjectSummary[] }>(r) : { projects: [] as ProjectSummary[] }))
      .then((r) => r.projects)
      .catch(() => [] as ProjectSummary[]),
  getBoard: (id: string) =>
    fetch(`/api/boards/${encodeURIComponent(id)}`)
      .then((r) => json<Board | { board: Board }>(r))
      .then((b) => ('board' in b ? b.board : b)),
  updateBoard: (id: string, patch: { title?: string }) =>
    fetch(`/api/boards/${encodeURIComponent(id)}`, {
      // PATCH merges (only what is sent changes); PUT would replace the board's meta whole
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((r) => json<{ board: Board }>(r))
      .then((b) => b.board),
  changes: (id: string, since = 0) =>
    fetch(`/api/boards/${encodeURIComponent(id)}/changes?since=${since}`).then((r) =>
      json<Change[] | { changes: Change[] }>(r),
    ),
  postOps: (id: string, ops: Op[], note?: string, author: Author = 'user') =>
    fetch(`/api/boards/${encodeURIComponent(id)}/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ author, ops, note }),
    }).then((r) => json<{ seq: number; change?: Change }>(r)),
}

export function asArray<T>(v: T[] | Record<string, T[]>, key: string): T[] {
  if (Array.isArray(v)) return v
  const inner = (v as Record<string, T[]>)[key]
  return Array.isArray(inner) ? inner : []
}

/** Reconnecting websocket for one board. */
export function connectBoard(
  id: string,
  handlers: { onMessage: (m: WsMessage) => void; onStatus: (open: boolean) => void },
): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retry = 500
  let timer: ReturnType<typeof setTimeout> | undefined

  const open = () => {
    if (closed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws/${encodeURIComponent(id)}`)
    ws.onopen = () => {
      retry = 500
      handlers.onStatus(true)
    }
    ws.onmessage = (ev) => {
      try {
        handlers.onMessage(JSON.parse(String(ev.data)) as WsMessage)
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      handlers.onStatus(false)
      if (closed) return
      timer = setTimeout(open, retry)
      retry = Math.min(retry * 2, 8000)
    }
    ws.onerror = () => ws?.close()
  }
  open()
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    ws?.close()
  }
}
