// Every chat on the board in one list, whatever is selected: filter by what needs you,
// see what each chat is about, jump to those items, and reply in place.
import { useMemo, useState } from 'react'
import { isUnread, type Board } from '../../../src/model'
import { allChats, itemName, type Chat } from '../inspector/chat'
import { isBusy, signFor } from '../inspector/status'
import { ChatThread } from './SelectionChat'
import '../inspector.css'

type Filter = 'all' | 'ai' | 'waiting' | 'unread'
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['ai', 'Asked AI'],
  ['waiting', 'Agent busy'],
  ['unread', 'Unread'],
]

/** An agent reply the person has not opened yet. */
const hasUnread = (c: Chat) => c.messages.some((m) => isUnread(m, 'user'))
/** The agent is working on it, queued, or waiting for the person in herdr. */
const agentBusy = (c: Chat) => {
  const s = signFor(c.root, c.messages)
  return Boolean(s && (isBusy(s) || s.kind === 'blocked'))
}

/** How many chats want the person's eye: unread agent replies. Shown on the tab. */
export function chatsNeedingYou(board: Board): number {
  return allChats(board).filter(hasUnread).length
}

export function AllChats({ board, onLocate, onReply }: { board: Board; onLocate: (ids: string[]) => void; onReply: (rootId: string, text: string) => void }) {
  const chats = useMemo(() => allChats(board), [board])
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const shown = chats.filter((c) => (filter === 'ai' ? c.ai : filter === 'waiting' ? agentBusy(c) : filter === 'unread' ? hasUnread(c) : true))
  const count = (f: Filter) => chats.filter((c) => (f === 'ai' ? c.ai : f === 'waiting' ? agentBusy(c) : f === 'unread' ? hasUnread(c) : true)).length
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  if (!chats.length) return <p className="muted">No chats on this board yet. Select items and ask something in the Chat tab.</p>

  return (
    <div className="chat all-chats">
      <div className="filter" role="group" aria-label="Show chats">
        {FILTERS.map(([f, label]) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label} <span className="muted">{count(f)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <ul className="chat-list">
          {shown.map((c) => {
            const about = c.about.filter((a) => board.items[a])
            return (
              <li key={c.root.id} className="all-chats-row">
                <div className="all-chats-about">
                  <span className="muted">About</span>
                  {about.length ? (
                    about.slice(0, 4).map((a) => (
                      <button key={a} type="button" className="chat-chip" data-item-link={a} title="Show on the board" onClick={() => onLocate([a])}>
                        {itemName(board, board.items[a], 20)}
                      </button>
                    ))
                  ) : (
                    <span className="muted">{c.about.length === 0 ? 'this board' : 'an item no longer on the board'}</span>
                  )}
                  {about.length > 4 && <span className="muted">+{about.length - 4}</span>}
                  {about.length > 1 && (
                    <button type="button" className="link" data-item-link={about.join(' ')} onClick={() => onLocate(about)}>
                      show all
                    </button>
                  )}
                  {hasUnread(c) && <span className="all-chats-unread">unread</span>}
                </div>
                <ul className="chat-list">
                  <ChatThread board={board} chat={c} open={open.has(c.root.id)} onToggle={() => toggle(c.root.id)} onReply={onReply} onLocate={onLocate} />
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
