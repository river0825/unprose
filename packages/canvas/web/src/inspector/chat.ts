// Chats with the selection (docs/studio.md §2b), the pure half: which comment
// threads are "about" the selected items, and what to call an item in a chip.
import type { Board, Item } from '../../../src/model'
import { threadOf } from '../flow/boardToFlow'
import { detailOf, discussOf } from './detail'

export interface Chat {
  root: Item
  /** root first, then every reply, oldest first */
  messages: Item[]
  /** the items the chat is about: `data.discuss.about`, else the root's target */
  about: string[]
  /** a studio request (`data.discuss`), not a plain comment thread */
  ai: boolean
  model?: string
  /** newest message time, for ordering */
  lastAt: string
}

/** What the root is about: the §2b list, or just its target. */
export function aboutOf(root: Item): string[] {
  const about = (discussOf(root) as { about?: unknown } | undefined)?.about
  if (Array.isArray(about) && about.every((a) => typeof a === 'string')) return about as string[]
  return root.target ? [root.target] : []
}

/** Selected items a chat can be about: everything but comments. */
export function chatSelection(board: Board, ids: string[]): Item[] {
  return ids.flatMap((id) => {
    const it = board.items[id]
    return it && it.type !== 'comment' ? [it] : []
  })
}

/**
 * Every chat on the board, newest first. A chat is a root comment (one not targeting another comment) and its
 * replies. A loose root comment (no target) is a board chat: it is about the whole board (`about` = []).
 */
export function allChats(board: Board): Chat[] {
  const out: Chat[] = []
  for (const it of Object.values(board.items)) {
    if (it.type !== 'comment') continue
    if (it.target && board.items[it.target]?.type === 'comment') continue // a reply, not a root
    const messages = threadOf(board, it.id).filter((m) => m.id === it.id || m.text?.trim())
    const ask = discussOf(it)
    out.push({
      root: it,
      messages,
      about: aboutOf(it),
      ai: Boolean(ask),
      model: ask?.model,
      lastAt: messages.reduce((t, m) => (m.updatedAt > t ? m.updatedAt : t), it.updatedAt),
    })
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

/** Chats about the whole board (a loose comment, or `about: []`), newest first. */
export function boardChats(board: Board): Chat[] {
  return allChats(board).filter((c) => c.about.length === 0)
}

/** Chats whose `about` overlaps the selection, newest first. */
export function chatsFor(board: Board, selectionIds: string[]): Chat[] {
  const sel = new Set(selectionIds)
  return allChats(board).filter((c) => c.about.some((a) => sel.has(a)))
}

/** A short name for an item in a chip: its text, else its block id, else its type. */
export function itemName(board: Board, it: Item, max = 28): string {
  const d = detailOf(it)
  const agent = it.role === 'agent' && typeof it.data?.agent === 'string' ? `@${it.data.agent}` : undefined
  const node = typeof it.data?.nodeId === 'string' ? it.data.nodeId : undefined
  let text = agent ?? node ?? it.label ?? it.text?.split('\n')[0]?.trim()
  if (!text && it.type === 'arrow') {
    const from = it.from ? board.items[it.from] : undefined
    const to = it.to ? board.items[it.to] : undefined
    text = from && to ? `${itemName(board, from, 12)} → ${itemName(board, to, 12)}` : 'arrow'
  }
  text = text || (d ? d.kind : it.type)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
