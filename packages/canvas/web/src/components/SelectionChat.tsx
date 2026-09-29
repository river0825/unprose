// Chat with the selection (docs/studio.md §2b): the chats about the selected
// items, a reply box for each, and "New chat" — a comment marked
// `data.discuss = { model, about }` that awd studio turns into a Claude session.
import { useEffect, useMemo, useState } from 'react'
import type { Board, Item } from '../../../src/model'
import { boardChats, chatSelection, chatsFor, itemName, type Chat } from '../inspector/chat'
import { MODELS, SUGGESTED_ASKS, detailOf, type DiscussModel } from '../inspector/detail'
import { anchorLabel, anchorOf } from '../inspector/anchor'
import { isBusy, signFor } from '../inspector/status'
import { useModelChoice } from '../inspector/useModel'
import { timeAgo } from '../time'
import { AgentStatus, SignLine } from './AgentStatus'
import '../inspector.css'
import { StudioHint } from './StudioControl'

interface Props {
  board: Board
  selectedIds: string[]
  /** start a chat about these items */
  onChat: (ids: string[], text: string, model: DiscussModel) => void
  /** a follow-up in an open chat: a plain comment on its root */
  onReply: (rootId: string, text: string) => void
  onSelect: (id: string) => void
  /** select these items and show them on the board */
  onLocate?: (ids: string[]) => void
}

const MULTI_ASKS = ['How do these fit together?', "What's missing between these?", 'Merge or split these?']
const BOARD_ASKS = ['What is this board about?', 'What is missing or inconsistent across these diagrams?', 'What should we do next?']

export function SelectionChat({ board, selectedIds, onChat, onReply, onSelect, onLocate }: Props) {
  const items = chatSelection(board, selectedIds)
  const ids = items.map((i) => i.id)
  const key = ids.join(',')
  // nothing selected: the chat is about the whole board
  const chats = useMemo(() => (ids.length ? chatsFor(board, ids) : boardChats(board)), [board, key]) // eslint-disable-line react-hooks/exhaustive-deps
  // Which chats are unfolded; the newest one starts open.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const newest = chats[0]?.root.id
  useEffect(() => {
    setOpen(new Set(newest ? [newest] : []))
  }, [key, newest])
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  if (!items.length)
    return (
      <div className="chat">
        <p className="muted">Nothing selected: this chat is about the whole board. Select items to chat about them instead.</p>
        {chats.length === 0 ? (
          <p className="muted">No chats about this board yet.</p>
        ) : (
          <ul className="chat-list">
            {chats.map((c) => (
              <ChatThread key={c.root.id} board={board} chat={c} open={open.has(c.root.id)} onToggle={() => toggle(c.root.id)} onReply={onReply} onLocate={onLocate} />
            ))}
          </ul>
        )}
        <NewChat boardId={board.id} key="board" asks={BOARD_ASKS} count={0} onSend={(text, model) => onChat([], text, model)} />
      </div>
    )

  const single = items.length === 1 ? detailOf(items[0]) : undefined
  const asks = items.length > 1 ? MULTI_ASKS : single ? SUGGESTED_ASKS[single.kind] : ['Explain this.', 'What would you change here?']

  return (
    <div className="chat">
      <div className="chat-chips" role="group" aria-label="Chatting about">
        {items.map((it) => (
          <button key={it.id} type="button" className="chat-chip" title={`Select only ${itemName(board, it, 80)}`} onClick={() => onSelect(it.id)}>
            {itemName(board, it)}
          </button>
        ))}
      </div>

      {chats.length === 0 ? (
        <p className="muted">No chats about {items.length === 1 ? 'this item' : 'these items'} yet.</p>
      ) : (
        <ul className="chat-list">
          {chats.map((c) => (
            <ChatThread key={c.root.id} board={board} chat={c} open={open.has(c.root.id)} onToggle={() => toggle(c.root.id)} onReply={onReply} onLocate={onLocate} />
          ))}
        </ul>
      )}

      <NewChat boardId={board.id} key={key} asks={asks} count={items.length} onSend={(text, model) => onChat(ids, text, model)} />
    </div>
  )
}

export function ChatThread({ board, chat, open, onToggle, onReply, onLocate }: { board: Board; chat: Chat; open: boolean; onToggle: () => void; onReply: Props['onReply']; onLocate?: (ids: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const first = chat.messages[0]
  const aboutNames = chat.about.flatMap((a) => (board.items[a] ? [itemName(board, board.items[a], 18)] : []))
  const aboutIds = chat.about.filter((a) => board.items[a])
  const replies = chat.messages.length - 1
  const send = () => {
    const t = draft.trim()
    if (!t) return
    onReply(chat.root.id, t)
    setDraft('')
  }
  const bodyId = `chat-body-${chat.root.id}`
  const sign = signFor(chat.root, chat.messages)
  return (
    <li className={`chat-item${open ? ' open' : ''}`}>
      <button type="button" className="chat-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="chat-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="chat-summary">{oneLine(first?.text) || '(empty)'}</span>
        {!open && sign && isBusy(sign) && <SignLine sign={sign} compact />}
        <span className="chat-meta">
          {replies ? `${replies} repl${replies === 1 ? 'y' : 'ies'} · ` : ''}
          {timeAgo(chat.lastAt)}
        </span>
      </button>
      {open && (
        <div id={bodyId} className="chat-body">
          <p className="chat-about muted">
            {chat.about.length === 0 ? 'About this board' : aboutNames.length ? `About ${aboutNames.join(', ')}` : 'About an item no longer on the board'}
            {onLocate && aboutIds.length > 0 && (
              <>
                {' · '}
                <button type="button" className="link" onClick={() => onLocate(aboutIds)} title="Select these items and show them on the board">
                  show on board
                </button>
              </>
            )}
          </p>
          <ol className="chat-msgs">
            {chat.messages.map((m) => (
              <Bubble key={m.id} m={m} tag={m.id === chat.root.id && chat.ai ? `${(chat.root.data?.discuss as { proposal?: unknown } | undefined)?.proposal ? 'wire change · ' : ''}asked AI${chat.model ? ` · ${chat.model}` : ''}` : undefined} />
            ))}
          </ol>
          <AgentStatus root={chat.root} messages={chat.messages} />
          <form
            className="chat-reply"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <label className="visually-hidden" htmlFor={`reply-${chat.root.id}`}>
              Reply in this chat
            </label>
            <textarea
              id={`reply-${chat.root.id}`}
              rows={2}
              value={draft}
              placeholder="Reply…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button className="primary small" type="submit" disabled={!draft.trim()}>
              Reply
            </button>
          </form>
        </div>
      )}
    </li>
  )
}

function Bubble({ m, tag }: { m: Item; tag?: string }) {
  const mine = m.createdBy === 'user'
  const anchor = anchorOf(m)
  return (
    <li className={`chat-msg ${mine ? 'mine' : 'theirs'}`}>
      <div className="chat-who">
        {mine ? 'You' : 'Agent'} · {timeAgo(m.updatedAt)}
        {tag && <span className="insp-tag">{tag}</span>}
      </div>
      {anchor && (
        <div className="chat-anchor mono" title={anchor.quote}>
          {anchorLabel(anchor)}
        </div>
      )}
      <div className="chat-bubble">{m.text}</div>
    </li>
  )
}

function NewChat({ boardId, asks, count, onSend }: { boardId: string; asks: string[]; count: number; onSend: (text: string, model: DiscussModel) => void }) {
  const [draft, setDraft] = useState('')
  const [model, pickModel] = useModelChoice()
  const send = () => {
    const t = draft.trim()
    if (!t) return
    onSend(t, model)
    setDraft('')
  }
  return (
    <section className="chat-new" aria-labelledby="chat-new-title">
      <h3 id="chat-new-title">New chat{count === 0 ? ' about this board' : count > 1 ? ` about ${count} items` : ''}</h3>
      <div className="insp-asks" role="group" aria-label="Suggested questions">
        {asks.map((a) => (
          <button key={a} type="button" className="small" onClick={() => setDraft(a)}>
            {a}
          </button>
        ))}
      </div>
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <label htmlFor="chat-new-draft">What do you want changed or explained?</label>
        <textarea
          id="chat-new-draft"
          value={draft}
          placeholder="Say what should change, or ask why it is this way."
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="insp-send">
          <label className="insp-model">
            <span>Model</span>
            <select value={model} onChange={(e) => pickModel(e.target.value as DiscussModel)}>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button className="primary small" type="submit" disabled={!draft.trim()}>
            Ask AI
          </button>
        </div>
        <StudioHint boardId={boardId} />
        <p className="muted insp-hint">
          ⌘ Enter asks. Replies come from the Claude session <span className="mono">awd studio</span> opens in herdr for {count === 0 ? 'this board' : count > 1 ? 'this selection' : 'this item'}; while studio is on, plain comments reach it too.
        </p>
      </form>
    </section>
  )
}

const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
