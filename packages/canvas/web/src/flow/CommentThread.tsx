import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isUnread, seenBy, type Item } from '../../../src/model'
import { EditableText } from './EditableText'
import { useEdit } from './EditContext'

const authorName = (it: Item) => (it.createdBy === 'agent' ? 'Agent' : 'You')

/** Ids from `newId` start with their creation time; template ids do not, so those fall back to the last edit. */
function sentAt(it: Item): number {
  const m = /^[a-z]+_([0-9a-z]{8})/.exec(it.id)
  const t = m ? parseInt(m[1], 36) : NaN
  return t > Date.UTC(2020, 0) && t < Date.now() + 86_400_000 ? t : Date.parse(it.updatedAt)
}

function ago(t: number, now = Date.now()): string {
  if (!Number.isFinite(t)) return ''
  const min = Math.round((now - t) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString()
}

function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

export interface ThreadState {
  unread: boolean
  waiting: boolean
  status: string
}

/** Unread: any message the agent wrote that the user has not opened. Waiting: a user message the agent has not read. */
export function threadState(messages: Item[]): ThreadState {
  const unread = messages.some((m) => isUnread(m, 'user'))
  const waiting = messages.some((m) => m.createdBy === 'user' && Boolean(m.text?.trim()) && !seenBy(m).includes('agent'))
  const last = messages[messages.length - 1]
  const status = unread ? 'Unread' : waiting ? 'Not seen by agent yet' : last?.createdBy === 'user' ? 'Seen by agent' : 'Read'
  return { unread, waiting, status }
}

/**
 * A folded thread: a small bubble, author by colour, state by dot. `done`: a settled proposal (flow/notesView.ts) —
 * a quiet ✓ instead, no author colour, no unread dot; a click opens it for this viewer.
 */
export function CommentBadge({ messages, pulse, done }: { messages: Item[]; pulse: boolean; done?: boolean }) {
  const edit = useEdit()
  const root = messages[0]
  const last = messages[messages.length - 1]
  const { unread, waiting, status } = threadState(messages)
  const preview = (last.text ?? '').replace(/\s+/g, ' ').slice(0, 120)
  const count = messages.length > 1 ? `${messages.length} messages, ` : ''
  const open = (e: { stopPropagation: () => void }) => {
    if (edit.attachTarget) return
    e.stopPropagation()
    edit.setCommentOpen(root.id, true)
  }
  if (done)
    return (
      <button
        type="button"
        className={`comment-badge done ${pulse ? 'pulse' : ''}`}
        title={`Proposal settled — ${preview}\n\nClick to open the thread`}
        aria-label={`Settled proposal, ${count}${status.toLowerCase()}. Open`}
        onClick={open}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </button>
    )
  return (
    <button
      type="button"
      className={`comment-badge ${root.createdBy} ${unread ? 'unread' : waiting ? 'waiting' : ''} ${pulse ? 'pulse' : ''}`}
      title={`${count}${authorName(last)}: ${preview} (${status})`}
      aria-label={`${authorName(root)} comment, ${count}${status.toLowerCase()}. Open`}
      onClick={open}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M4 5h16v11H9l-5 4z" />
      </svg>
      {messages.length > 1 && <span className="count">{messages.length}</span>}
    </button>
  )
}

function Meta({ item, now, children }: { item: Item; now: number; children?: ReactNode }) {
  const t = sentAt(item)
  return (
    <div className="who">
      <span className="author">{authorName(item)}</span>
      <time dateTime={Number.isFinite(t) ? new Date(t).toISOString() : undefined} title={Number.isFinite(t) ? new Date(t).toLocaleString() : undefined}>
        {ago(t, now)}
      </time>
      {children}
    </div>
  )
}

function Message({ item, placeholder }: { item: Item; placeholder?: string }) {
  const edit = useEdit()
  return (
    <EditableText
      text={item.text ?? ''}
      editing={edit.editingId === item.id}
      onCommit={(t) => edit.commitText(item.id, t)}
      onCancel={edit.cancelEdit}
      placeholder={placeholder}
    />
  )
}

/** Commits on Enter or blur; an empty reply is never sent. */
function ReplyBox({ rootId, onFocus }: { rootId: string; onFocus: () => void }) {
  const edit = useEdit()
  const [draft, setDraft] = useState('')
  const dropped = useRef(false)
  const send = () => {
    const text = draft.trim()
    setDraft('')
    if (text) edit.reply(rootId, text)
  }
  return (
    <textarea
      className="reply nodrag nowheel"
      rows={1}
      placeholder="Reply"
      aria-label="Reply to this thread"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={() => {
        if (dropped.current) dropped.current = false
        else send()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          send()
        } else if (e.key === 'Escape') {
          dropped.current = true
          setDraft('')
          e.currentTarget.blur()
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}

/** An open thread: the root message with its header, every reply in order, and a reply box. */
export function ThreadBody({ messages }: { messages: Item[] }) {
  const edit = useEdit()
  const now = useMinuteClock()
  const [root, ...replies] = messages
  const { unread, waiting, status } = threadState(messages)
  const markRead = () => {
    if (unread) edit.setCommentOpen(root.id, true)
  }
  const drafting = edit.editingId === root.id && !root.text?.trim()
  return (
    <div className="thread" onPointerDown={markRead}>
      <Meta item={root} now={now}>
        <span className={`seen ${waiting ? 'waiting' : ''}`}>{status}</span>
        <button
          type="button"
          className="fold nodrag"
          aria-label="Fold thread"
          title="Fold"
          onClick={(e) => {
            e.stopPropagation()
            edit.setCommentOpen(root.id, false)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 12h12" />
          </svg>
        </button>
      </Meta>
      <Message item={root} placeholder="Comment" />
      <ThreadReplies root={root} replies={replies} now={now} reply={!drafting} onFocus={markRead} />
    </div>
  )
}

/** A thread's replies in order and its reply box: under an open thread, and under a TODO card opened to its thread. */
export function ThreadReplies({ root, replies, now, reply = true, onFocus }: { root: Item; replies: Item[]; now?: number; reply?: boolean; onFocus?: () => void }) {
  const edit = useEdit()
  const clock = useMinuteClock()
  const at = now ?? clock
  const markRead = onFocus ?? (() => (replies.some((m) => isUnread(m, 'user')) ? edit.setCommentOpen(root.id, true) : undefined))
  return (
    <>
      {replies.length > 0 && (
        <ol className="replies nowheel" aria-label={`${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}>
          {replies.map((m) => (
            <li
              key={m.id}
              className={`reply-msg ${m.createdBy} ${isUnread(m, 'user') ? 'unread' : ''}`}
              onDoubleClick={(e) => {
                e.stopPropagation()
                edit.startEdit(m.id)
              }}
            >
              <Meta item={m} now={at} />
              <Message item={m} placeholder="Reply" />
            </li>
          ))}
        </ol>
      )}
      {reply && <ReplyBox rootId={root.id} onFocus={markRead} />}
    </>
  )
}
