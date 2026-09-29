// CanvasBoard adapter: the canvas server's HTTP API. Comments go through the
// `freeform` template so the server places them beside their target.

import type { BoardChange, BoardSnapshot, BoardSummary, CanvasBoard, NewItem } from '../../ports/canvasBoard.js'

export interface CanvasBoardHttpOptions {
  base?: string
  fetch?: typeof fetch
}

export function canvasBoardHttp(opts: CanvasBoardHttpOptions = {}): CanvasBoard & { base: string } {
  const base = (opts.base ?? process.env.AWD_CANVAS_URL ?? 'http://localhost:4400').replace(/\/$/, '')
  const f = opts.fetch ?? fetch
  const req = async <T,>(method: string, p: string, body?: unknown): Promise<T> => {
    const res = await f(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json() as Promise<T>
  }
  const b = (id: string) => `/api/boards/${encodeURIComponent(id)}`
  return {
    base,
    async boards() {
      const r = await req<BoardSummary[] | { boards: BoardSummary[] }>('GET', '/api/boards')
      return Array.isArray(r) ? r : r.boards
    },
    async board(id) {
      return (await req<{ board: BoardSnapshot }>('GET', b(id))).board
    },
    async changes(id, since) {
      return req<{ changes: BoardChange[]; seq: number }>('GET', `${b(id)}/changes?since=${since}`)
    },
    async wait(id, since, timeoutMs) {
      // wake on comments/adds only; moves are layout, not requests
      await req('GET', `${b(id)}/wait?since=${since}&timeout=${timeoutMs}&quiet=500&author=user&wake=meaningful`)
    },
    async add(id, items: NewItem[], note) {
      // explicit ids: freeform ids hash the text, so two identical acks would collide
      const stamp = `studio.${Date.now().toString(36)}`
      const content = { items: items.map((it, i) => ({ id: `${stamp}.${i}`, ...it })) }
      const { ops } = await req<{ ops: unknown[] }>('POST', `${b(id)}/template`, { kind: 'freeform', content })
      return (await req<{ seq: number }>('POST', `${b(id)}/ops`, { author: 'agent', ops, note })).seq
    },
    async update(id, patches, note) {
      const ops = patches.map((p) => ({ kind: 'update', id: p.id, patch: p.patch }))
      return (await req<{ seq: number }>('POST', `${b(id)}/ops`, { author: 'agent', ops, note })).seq
    },
  }
}
