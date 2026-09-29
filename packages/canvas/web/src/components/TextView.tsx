// Text with line numbers you can comment on, like a code review (docs/studio.md §5).
// Click a line number (shift-click to extend) — or focus the text and use the
// arrow keys, Shift+arrows and Enter — then Comment or Ask AI. Threads show
// under the line they are about; comments whose lines are gone are "outdated".
import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Author, Board, Item } from '../../../src/model'
import { threadOf } from '../flow/boardToFlow'
import { anchoredOn, relocate, quoteOf, type Anchor, type TextSource } from '../inspector/anchor'
import { MODELS, discussOf, type DiscussModel } from '../inspector/detail'
import type { DiscussArg } from '../inspector/diff'
import { useModelChoice } from '../inspector/useModel'
import { timeAgo } from '../time'
import { AgentStatus } from './AgentStatus'
import '../inspector.css'

// The large editor view is a separate chunk, loaded the first time someone expands a text.
const SourceDialog = lazy(() => import('./SourceDialog'))

export interface TextViewProps {
  board: Board
  text: string
  src: TextSource
  /** accessible name, e.g. the file path */
  label: string
  /** the block a new comment on this line is about (undefined: commenting is off) */
  targetFor: (line: number) => string | undefined
  /** `discuss.edit` comes from the source dialog's Edit mode (docs/studio.md §9) */
  onAnchoredComment: (target: string, text: string, anchor: Anchor, discuss?: DiscussArg) => void
  onReply: (rootId: string, text: string) => void
  /** show only these lines (numbers stay the file's) */
  range?: { start: number; end: number }
  /** scroll to this line and put the cursor on it */
  focusLine?: number
}

type Sel = { from: number; to: number }
const who = (a: Author) => (a === 'agent' ? 'Agent' : 'You')

export function TextView({ board, text, src, label, targetFor, onAnchoredComment, onReply, range, focusLine }: TextViewProps) {
  const uid = useId()
  const lines = useMemo(() => text.split('\n'), [text])
  const first = range ? Math.max(1, range.start) : 1
  const last = range ? Math.min(lines.length, range.end) : lines.length
  const [sel, setSel] = useState<Sel | null>(null)
  const [pivot, setPivot] = useState<number>(focusLine ?? first)
  const [cursor, setCursor] = useState<number>(focusLine ?? first)
  const [composing, setComposing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Anchored comments on this text, placed on the line their quote is on now.
  const { at, marked, outdated, elsewhere } = useMemo(() => {
    const at = new Map<number, Item[]>()
    const marked = new Set<number>()
    const outdated: Array<{ item: Item; anchor: Anchor }> = []
    let elsewhere = 0
    for (const c of anchoredOn(board, src)) {
      const where = relocate(lines, c.anchor)
      if (!where) outdated.push(c)
      else if (where.endLine < first || where.line > last) elsewhere++
      else {
        at.set(where.endLine, [...(at.get(where.endLine) ?? []), c.item])
        for (let n = where.line; n <= where.endLine; n++) marked.add(n)
      }
    }
    return { at, marked, outdated, elsewhere }
  }, [board, src, lines, first, last])

  useEffect(() => {
    if (!focusLine) return
    setCursor(focusLine)
    setPivot(focusLine)
    setSel({ from: focusLine, to: focusLine })
    lineEl(focusLine)?.scrollIntoView({ block: 'center' })
  }, [focusLine]) // eslint-disable-line react-hooks/exhaustive-deps

  const lineEl = (n: number) => box.current?.querySelector<HTMLElement>(`[data-line="${n}"]`)
  const target = sel ? targetFor(sel.from) : undefined

  const pick = (n: number, extend: boolean) => {
    const p = extend && sel ? pivot : n
    setPivot(p)
    setCursor(n)
    setSel({ from: Math.min(p, n), to: Math.max(p, n) })
    setComposing(true)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== box.current) return
    // Keys here are for the text, not the board (arrows would nudge, Delete would delete the selection).
    if (!e.metaKey && !e.ctrlKey && !(e.key === 'Escape' && !sel)) e.stopPropagation()
    const move = (n: number) => {
      const c = Math.min(last, Math.max(first, n))
      e.preventDefault()
      setCursor(c)
      if (e.shiftKey) setSel({ from: Math.min(pivot, c), to: Math.max(pivot, c) })
      else {
        setPivot(c)
        setSel({ from: c, to: c })
      }
      lineEl(c)?.scrollIntoView({ block: 'nearest' })
    }
    if (e.key === 'ArrowDown') move(cursor + 1)
    else if (e.key === 'ArrowUp') move(cursor - 1)
    else if (e.key === 'PageDown') move(cursor + 20)
    else if (e.key === 'PageUp') move(cursor - 20)
    else if (e.key === 'Home') move(first)
    else if (e.key === 'End') move(last)
    else if ((e.key === 'Enter' || e.key === 'c') && sel) {
      e.preventDefault()
      setComposing(true)
    } else if (e.key === 'Escape' && sel) {
      e.preventDefault()
      e.stopPropagation()
      setSel(null)
      setComposing(false)
    }
  }
  const send = (body: string, model?: DiscussModel) => {
    if (!sel || !target) return
    const anchor: Anchor = { ...('file' in src ? { file: src.file } : { doc: src.doc }), line: sel.from, ...(sel.to !== sel.from ? { endLine: sel.to } : {}), quote: quoteOf(text, sel.from, sel.to) }
    onAnchoredComment(target, body, anchor, model ? { model } : undefined)
    setComposing(false)
    box.current?.focus()
  }
  const selText = sel ? (sel.from === sel.to ? `Line ${sel.from}` : `Lines ${sel.from}–${sel.to}`) : ''

  const rows = []
  for (let n = first; n <= last; n++) {
    const inSel = sel && n >= sel.from && n <= sel.to
    rows.push(
      <div key={n} data-line={n} className={`tv-line${inSel ? ' sel' : ''}${n === cursor ? ' cursor' : ''}${marked.has(n) ? ' has-c' : ''}`}>
        <button type="button" tabIndex={-1} className="tv-num" aria-label={`Comment on line ${n}`} onClick={(e) => pick(n, e.shiftKey)}>
          {n}
        </button>
        <span className="tv-text">{lines[n - 1] || ' '}</span>
      </div>,
    )
    if (composing && sel && n === sel.to)
      rows.push(
        <Composer key="composer" selText={selText} disabled={!target} onSend={send} onCancel={() => { setComposing(false); box.current?.focus() }} />,
      )
    for (const c of at.get(n) ?? []) rows.push(<Thread key={c.id} board={board} root={c} onReply={onReply} />)
  }

  return (
    <div className="tv">
      <div className="tv-tools">
        <button type="button" className="ghost small" onClick={() => setExpanded(true)} aria-haspopup="dialog" title="Open in a large view with syntax highlighting">
          Expand ⤢
        </button>
      </div>
      {expanded && (
        <Suspense fallback={null}>
          <SourceDialog
            board={board}
            text={text}
            src={src}
            label={label}
            targetFor={targetFor}
            onAnchoredComment={onAnchoredComment}
            onReply={onReply}
            onClose={() => setExpanded(false)}
            focusLine={sel?.from ?? range?.start ?? focusLine}
          />
        </Suspense>
      )}
      <div
        ref={box}
        data-no-board-keys
        className="tv-body mono"
        tabIndex={0}
        role="group"
        aria-label={`${label}, lines ${first}–${last}`}
        aria-describedby={`${uid}-hint`}
        onKeyDown={onKey}
      >
        {rows}
      </div>
      <p id={`${uid}-hint`} className="tv-hint muted">
        Click a line number (shift-click for more) — or ↑↓, Shift+↑↓, Enter — to comment.
        {elsewhere ? ` ${elsewhere} more comment${elsewhere === 1 ? '' : 's'} outside these lines.` : ''}
      </p>
      <span className="visually-hidden" aria-live="polite">
        {sel ? `${selText} selected` : ''}
      </span>
      {outdated.length > 0 && (
        <section className="tv-outdated" aria-label="Outdated comments">
          <h4>Outdated — the text they were about changed</h4>
          {outdated.map(({ item, anchor }) => (
            <div key={item.id}>
              <pre className="tv-quote mono">{anchor.quote}</pre>
              <Thread board={board} root={item} onReply={onReply} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

export function Composer({ selText, disabled, onSend, onCancel }: { selText: string; disabled: boolean; onSend: (text: string, model?: DiscussModel) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState('')
  const [model, pickModel] = useModelChoice()
  const go = (ai: boolean) => {
    const t = draft.trim()
    if (t) onSend(t, ai ? model : undefined)
  }
  return (
    <form
      className="tv-composer"
      onSubmit={(e) => {
        e.preventDefault()
        go(false)
      }}
    >
      <label className="tv-composer-label">
        <span>Comment on {selText.toLowerCase()}</span>
        <textarea
          autoFocus
          rows={3}
          value={draft}
          placeholder={disabled ? 'No block owns this text — redraw the board to comment here.' : 'What should change here, or what is unclear?'}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onCancel()
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              go(e.shiftKey)
            }
          }}
        />
      </label>
      <div className="insp-send">
        <button type="button" className="ghost small" onClick={onCancel}>
          Cancel
        </button>
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
        <button type="submit" className="small" disabled={disabled || !draft.trim()}>
          Comment
        </button>
        <button type="button" className="primary small" disabled={disabled || !draft.trim()} onClick={() => go(true)}>
          Ask AI
        </button>
      </div>
      <p className="muted insp-hint">⌘ Enter comments · ⌘ ⇧ Enter asks AI (awd studio opens a Claude session for this block).</p>
    </form>
  )
}

/** One anchored comment and its replies, with a reply box. */
export function Thread({ board, root, onReply }: { board: Board; root: Item; onReply: (rootId: string, text: string) => void }) {
  const [draft, setDraft] = useState('')
  const [replying, setReplying] = useState(false)
  const messages = threadOf(board, root.id).filter((m) => m.id === root.id || m.text?.trim())
  const ask = discussOf(root)
  const send = () => {
    const t = draft.trim()
    if (!t) return
    onReply(root.id, t)
    setDraft('')
    setReplying(false)
  }
  return (
    <div className="tv-thread">
      {messages.map((m) => (
        <div key={m.id} className={`tv-msg ${m.createdBy}`}>
          <div className="chat-who">
            {who(m.createdBy)} · {timeAgo(m.updatedAt)}
            {m.id === root.id && ask && <span className="insp-tag">asked AI{ask.model ? ` · ${ask.model}` : ''}</span>}
          </div>
          <div className="tv-msg-text">{m.text}</div>
        </div>
      ))}
      <AgentStatus root={root} messages={messages} />
      {replying ? (
        <form
          className="chat-reply"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <label className="visually-hidden" htmlFor={`tv-reply-${root.id}`}>
            Reply to this comment
          </label>
          <textarea
            id={`tv-reply-${root.id}`}
            autoFocus
            rows={2}
            value={draft}
            placeholder="Reply…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setReplying(false)
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="primary small" type="submit" disabled={!draft.trim()}>
            Reply
          </button>
        </form>
      ) : (
        <button type="button" className="link tv-reply-btn" onClick={() => setReplying(true)}>
          Reply
        </button>
      )}
    </div>
  )
}

