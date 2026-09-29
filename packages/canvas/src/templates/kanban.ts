// Kanban — columns as vertical lanes side by side, cards stacked inside them.
// A card's column is its `parent`; a user dragging a card into another column
// is the event the workflow runtime listens for (see docs/canvas.md → "Kanban
// as an event source"). Ids are deterministic so re-rendering updates in place.
import { z } from 'zod'
import type { Board, Item } from '../model.js'
import { make, offsetAll, stableId, type RenderOpts } from './util.js'
import { idAllocator, slugify, traceSchema, type Trace } from '../diagrams/ids.js'

export const CARD_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const

export const kanbanSchema = z.object({
  columns: z.array(z.object({ name: z.string().min(1), wip: z.number().int().positive().optional() })).min(1),
  cards: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1),
        column: z.string(),
        labels: z.array(z.string()).optional(),
        size: z.enum(CARD_SIZES).optional(),
        assignee: z.string().optional(),
        description: z.string().optional(),
        order: z.number().optional(),
        /** Links into other diagrams (docs/diagrams.md §2), e.g. `{ from: 'studio-story-map/receipts', rel: 'groups' }`. */
        traces: z.array(traceSchema).optional(),
        /** Shorthand for the stories this card groups: `'<story map key>/<story id>'` → a `groups` trace (§6). */
        stories: z.array(z.string()).optional(),
      }),
    )
    .default([]),
})
export type KanbanContent = z.input<typeof kanbanSchema>

export const COLUMN_W = 280
export const CARD_W = 240
export const CARD_GAP = 12
export const COLUMN_PAD = (COLUMN_W - CARD_W) / 2 // 20
export const COLUMN_HEADER = 44
export const COLUMN_MIN_H = 600
export const COLUMN_GAP = 12

/** Card height from its content: title lines + a row for labels / size / assignee. */
export function cardHeight(card: { title: string; labels?: string[]; size?: string; assignee?: string }): number {
  const lines = Math.max(1, Math.ceil(card.title.length / 26))
  const meta = (card.labels?.length ?? 0) > 0 || card.size || card.assignee ? 24 : 0
  return Math.max(96, 16 + lines * 18 + 16 + meta)
}

export const columnId = (scope: string, name: string) => stableId(scope, 'column', name)
export const cardId = (scope: string, idOrTitle: string) => `${scope}.card.${idOrTitle.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'card'}`

export function renderKanban(raw: KanbanContent, opts: RenderOpts = {}): Item[] {
  const c = kanbanSchema.parse(raw)
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'kb'
  const items: Item[] = []
  const lanes: Item[] = []

  // Element ids (what a trace in another diagram points at): the card's `id`, else the slug of its title.
  const alloc = idAllocator()
  const elementOf = new Map(c.cards.map((card) => [card, alloc(card.id, card.title, 'card')]))
  const known = new Set(c.columns.map((col) => col.name))
  // cards naming an unknown column go to the first one rather than vanishing
  const columnOf = (name: string) => (known.has(name) ? name : c.columns[0].name)

  c.columns.forEach((col, ci) => {
    const laneId = columnId(scope, col.name)
    const x = ci * (COLUMN_W + COLUMN_GAP)
    const inCol = c.cards
      .map((card, i) => ({ card, i }))
      .filter(({ card }) => columnOf(card.column) === col.name)
      .sort((a, b) => (a.card.order ?? a.i) - (b.card.order ?? b.i))
    let y = COLUMN_HEADER + CARD_GAP
    inCol.forEach(({ card }, k) => {
      const h = cardHeight(card)
      const data: Record<string, unknown> = {}
      if (card.labels?.length) data.labels = card.labels
      if (card.size) data.size = card.size
      if (card.assignee) data.assignee = card.assignee
      if (card.description) data.description = card.description
      data.element = elementOf.get(card)
      const traces: Trace[] = [...(card.traces ?? []), ...(card.stories ?? []).map((from) => ({ from, rel: 'groups' as const }))]
      if (traces.length) data.traces = traces
      if (card.stories?.length) data.stories = card.stories
      items.push(
        make(
          { id: cardId(scope, card.id ?? card.title), type: 'card', x: x + COLUMN_PAD, y, w: CARD_W, h, text: card.title, color: 'white', role: 'card', parent: laneId, order: k, data },
          now,
        ),
      )
      y += h + CARD_GAP
    })
    const laneH = Math.max(COLUMN_MIN_H, y + COLUMN_PAD)
    lanes.push(make({ id: laneId, type: 'lane', x, y: 0, w: COLUMN_W, h: laneH, text: col.name, role: 'column', color: 'grey', order: ci, data: { name: col.name, element: slugify(col.name) || `column-${ci + 1}`, ...(col.wip ? { wip: col.wip } : {}) } }, now))
  })
  // Every column is as tall as the tallest one so they read as one board.
  const tallest = Math.max(...lanes.map((l) => l.h))
  return offsetAll([...lanes.map((l) => ({ ...l, h: tallest })), ...items], opts.at)
}

/** The column lanes of a board, left → right. */
export function columnsOf(board: Board): Item[] {
  return Object.values(board.items)
    .filter((i) => i.type === 'lane' && i.role === 'column')
    .sort((a, b) => a.x - b.x)
}

/** Cards in a column, top → bottom (by `y`, then `order`). Uses `parent` only — geometry is the diff's fallback, not the board's truth. */
export function cardsIn(board: Board, column: Item): Item[] {
  return Object.values(board.items)
    .filter((i) => i.type === 'card' && i.parent === column.id)
    .sort((a, b) => a.y - b.y || (a.order ?? 0) - (b.order ?? 0))
}

/** Where a new (or moved) card goes: the bottom of the column, with the lane grown if it must. */
export function bottomOf(board: Board, column: Item, h: number): { x: number; y: number; laneH: number } {
  const cards = cardsIn(board, column)
  const last = cards[cards.length - 1]
  const y = last ? last.y + last.h + CARD_GAP : column.y + COLUMN_HEADER + CARD_GAP
  return { x: column.x + COLUMN_PAD, y, laneH: Math.max(column.h, y + h + COLUMN_PAD - column.y) }
}
