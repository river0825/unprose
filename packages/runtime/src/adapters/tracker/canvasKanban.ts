// WorkTracker adapter: a kanban on the canvas — a legacy kanban board, or one kanban
// diagram frame on a board (docs/diagrams.md §1, §7). Columns are resolved inside that
// kanban and passed to the server by id, so two kanbans with a "Backlog" each never mix;
// placement stays the server's job (the `/cards` API).

import type { CardDraft, TrackerCard, WorkTracker } from '../../ports/workTracker.js'
import { kanbanScope } from '../triggers/canvasTrigger.js'
import { canvasUserAgent } from '../canvas/userAgent.js'

export interface CanvasKanbanOptions {
  /** Board id or `title:<board title>`. */
  board: string
  /** Kanban diagram frame key; optional when the board has one kanban. */
  frame?: string
  base?: string
  fetch?: typeof fetch
}

type Item = { id: string; type: string; role?: string; text?: string; parent?: string; x?: number; data?: Record<string, unknown> }
type Board = { id: string; title: string; kind?: string; seq: number; items: Record<string, Item> }

export class CanvasKanbanTracker implements WorkTracker {
  readonly name = 'canvas'
  private base: string
  private f: typeof fetch
  constructor(private o: CanvasKanbanOptions) {
    this.base = (o.base ?? process.env.AWD_CANVAS_URL ?? 'http://localhost:4400').replace(/\/$/, '')
    this.f = o.fetch ?? fetch
  }

  private async req<T>(method: string, p: string, body?: unknown): Promise<T> {
    const res = await this.f(this.base + p, { method, headers: { 'content-type': 'application/json', 'user-agent': canvasUserAgent('runtime') }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json() as Promise<T>
  }

  private async board(): Promise<Board> {
    const ref = this.o.board
    if (ref.startsWith('title:')) {
      const title = ref.slice(6).trim()
      const { boards } = await this.req<{ boards: Array<{ id: string; title: string }> }>('GET', '/api/boards')
      const hit = boards.find((b) => b.title === title)
      if (!hit) throw new Error(`no board titled "${title}" on ${this.base}`)
      return (await this.req<{ board: Board }>('GET', `/api/boards/${hit.id}`)).board
    }
    return (await this.req<{ board: Board }>('GET', `/api/boards/${encodeURIComponent(ref)}`)).board
  }

  /** The watched kanban's columns (left → right) and cards. */
  private async view() {
    const board = await this.board()
    const inScope = kanbanScope(board, this.o.frame)
    const columns = Object.values(board.items)
      .filter((i) => i.type === 'lane' && i.role === 'column' && inScope(i.id))
      .sort((a, b) => (a.x ?? 0) - (b.x ?? 0))
    const colIds = new Set(columns.map((c) => c.id))
    const cards = Object.values(board.items).filter((i) => i.type === 'card' && i.parent && colIds.has(i.parent))
    return { board, columns, cards }
  }

  private columnId(columns: Item[], name: string): string {
    const col = columns.find((c) => (c.text ?? '').toLowerCase() === name.toLowerCase())
    if (!col) throw new Error(`unknown column "${name}" (${columns.map((c) => c.text).join(', ')})`)
    return col.id
  }

  private toCard(it: Item, columns: Item[]): TrackerCard {
    const d = it.data ?? {}
    const card: TrackerCard = {
      // our id if we stamped one, else the element id inside `<key>.card.<id>` / `kb.card.<id>`
      id: typeof d.cardId === 'string' ? d.cardId : (it.id.match(/^[^.]+\.card\.(.+)$/)?.[1] ?? it.id),
      title: it.text ?? it.id,
      column: columns.find((c) => c.id === it.parent)?.text ?? '',
      stories: Array.isArray(d.stories) ? d.stories.map(String) : [],
    }
    if (typeof d.description === 'string') card.description = d.description
    if (Array.isArray(d.labels) && d.labels.length) card.labels = d.labels.map(String)
    return card
  }

  async columns() {
    return (await this.view()).columns.map((c) => c.text ?? c.id)
  }

  async list() {
    const { columns, cards } = await this.view()
    return cards.map((c) => this.toCard(c, columns))
  }

  async upsert(draft: CardDraft) {
    const { board, columns, cards } = await this.view()
    const was = cards.find((c) => this.toCard(c, columns).id === draft.id || c.id === draft.id)
    const data = (it?: Item) => ({ ...(it?.data ?? {}), cardId: draft.id, stories: draft.stories, labels: draft.labels, description: draft.description })
    if (was) {
      await this.req('POST', `/api/boards/${board.id}/ops`, { author: 'agent', ops: [{ kind: 'update', id: was.id, patch: { text: draft.title, data: data(was) } }], note: `tracker: update "${draft.title}"` })
      if (draft.column && this.toCard(was, columns).column !== draft.column) await this.move(draft.id, draft.column)
      return { created: false }
    }
    if (!columns.length) throw new Error(`board "${board.title}" has no kanban columns${this.o.frame ? ` in frame ${this.o.frame}` : ''}`)
    const column = draft.column ? this.columnId(columns, draft.column) : columns[0].id
    const { card } = await this.req<{ card: Item }>('POST', `/api/boards/${board.id}/cards`, {
      id: draft.id, title: draft.title, column, labels: draft.labels, description: draft.description, author: 'agent', note: `tracker: add "${draft.title}"`,
    })
    // the create endpoint keeps only its known fields: stamp our id and the story traces
    await this.req('POST', `/api/boards/${board.id}/ops`, { author: 'agent', ops: [{ kind: 'update', id: card.id, patch: { data: data(card) } }], note: 'tracker: link card to its stories' })
    return { created: true }
  }

  async move(cardId: string, column: string) {
    const { board, columns, cards } = await this.view()
    const card = cards.find((c) => this.toCard(c, columns).id === cardId || c.id === cardId)
    if (!card) throw new Error(`no card "${cardId}" in this kanban`)
    await this.req('POST', `/api/boards/${board.id}/cards/${encodeURIComponent(card.id)}/move`, { column: this.columnId(columns, column), author: 'agent' })
  }
}
