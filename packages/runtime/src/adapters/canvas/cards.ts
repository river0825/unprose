// Outbound adapter: put reflection cards on a kanban board of the canvas server.
// One card per pattern, found again by `data.pattern`, so re-running updates
// the count and description instead of adding a twin.

import type { ReflectionCard } from '../../application/reflection.js'

export interface CanvasCardsOptions {
  base?: string
  fetch?: typeof fetch
}

interface BoardSummary { id: string; title: string; kind: string }
interface BoardItem { id: string; type: string; text?: string; parent?: string; role?: string; data?: Record<string, unknown> }
interface Board { id: string; title: string; kind: string; items: Record<string, BoardItem> }

export interface UpsertResult { created: string[]; updated: string[]; board: string; url: string }

export function canvasCards(opts: CanvasCardsOptions = {}) {
  const base = (opts.base ?? process.env.AWD_CANVAS_URL ?? 'http://localhost:4400').replace(/\/$/, '')
  const f = opts.fetch ?? fetch
  const req = async <T,>(method: string, p: string, body?: unknown): Promise<T> => {
    const res = await f(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json() as Promise<T>
  }

  /** `title:<board title>` or a board id. */
  async function resolveBoard(ref: string): Promise<Board> {
    if (ref.startsWith('title:')) {
      const title = ref.slice(6).trim()
      const { boards } = await req<{ boards: BoardSummary[] }>('GET', '/api/boards')
      const hit = boards.find((b) => b.title === title) ?? boards.find((b) => b.title.toLowerCase() === title.toLowerCase())
      if (!hit) throw new Error(`no board titled "${title}"`)
      return (await req<{ board: Board }>('GET', `/api/boards/${hit.id}`)).board
    }
    return (await req<{ board: Board }>('GET', `/api/boards/${encodeURIComponent(ref)}`)).board
  }

  async function upsertCards(boardRef: string, cards: ReflectionCard[], column = 'Backlog'): Promise<UpsertResult> {
    const board = await resolveBoard(boardRef)
    if (board.kind !== 'kanban') throw new Error(`board "${board.title}" is a ${board.kind} board, not a kanban`)
    const result: UpsertResult = { created: [], updated: [], board: board.id, url: `${base}/b/${board.id}` }
    for (const card of cards) {
      const existing = Object.values(board.items).find((i) => i.type === 'card' && i.data?.pattern === card.pattern)
      if (existing) {
        if (existing.data?.count === card.count && existing.text === card.title) continue
        await req('POST', `/api/boards/${board.id}/ops`, {
          author: 'agent',
          ops: [{ kind: 'update', id: existing.id, patch: { text: card.title, data: { ...existing.data, description: card.description, count: card.count, labels: card.labels, pattern: card.pattern } } }],
          note: `reflection: ${card.title} (${card.count}×)`,
        })
        result.updated.push(existing.id)
        continue
      }
      const created = await req<{ card: BoardItem }>('POST', `/api/boards/${board.id}/cards`, {
        id: card.id, title: card.title, column, labels: card.labels, size: card.size, description: card.description, author: 'agent', note: `reflection: ${card.title}`,
      })
      // the create endpoint keeps only the known fields; stamp the pattern id so the next run finds it
      await req('POST', `/api/boards/${board.id}/ops`, {
        author: 'agent',
        ops: [{ kind: 'update', id: created.card.id, patch: { data: { ...(created.card.data ?? {}), pattern: card.pattern, count: card.count } } }],
        note: 'reflection: link card to its pattern',
      })
      result.created.push(created.card.id)
    }
    return result
  }

  return { resolveBoard, upsertCards, base }
}
