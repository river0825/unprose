// The board's TODOs at the top of the panel (docs/canvas.md → "Notes"; flow/todoView.ts), under its context: folded to
// how many are open; opened, the open ones first — text, what it is about, who to ask, the agent that opened it — a
// click goes to it on the board, the box checks it off; the done ones folded underneath, with their answers. A TODO
// about the whole board is written here.
import { useMemo, useState } from 'react'
import type { Board } from '../../../src/model'
import { displayName, responderName, responderOf } from '../../../src/routing'
import { openTodoCount, todoList, type TodoRow } from '../flow/todoView'
import { CheckOffField } from './CheckOff'
import { MarkFields } from './MarkInput'
import '../annotations.css'

export interface TodoActions {
  /** go to the TODO's card on the board */
  onShow: (id: string) => void
  onCheck: (id: string, answer?: string) => void
  onReopen: (id: string) => void
}

/** Who answers the board ("Answered by"), as people read it: an answer given when checking a TODO off goes there. */
export function answeredByName(board: Board): string | undefined {
  const r = responderName(responderOf(board.meta))
  return r ? displayName(r) : undefined
}

export const CheckGlyph = () => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
)

/** One TODO in a list: its box, its text (a click goes to it), what it is about and who to ask; the answer once done. */
export function TodoLine({ row, board, actions, about = true }: { row: TodoRow; board: Board; actions: TodoActions; about?: boolean }) {
  const [asking, setAsking] = useState(false)
  return (
    <li className={`todo-li ${row.done ? 'done' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={row.done}
        className="todo-check"
        aria-label={row.done ? `Done — reopen “${row.text}”` : `Check off “${row.text}”`}
        title={row.done ? 'Done — click to reopen' : 'Check it off'}
        onClick={() => (row.done ? actions.onReopen(row.id) : setAsking((a) => !a))}
      >
        {row.done ? <CheckGlyph /> : null}
      </button>
      <div className="todo-li-body">
        <button type="button" className="todo-li-text" data-item-link={row.id} title="Show it on the board (⌥← goes back)" onClick={() => actions.onShow(row.id)}>
          {row.text || '(no text)'}
        </button>
        <div className="todo-li-meta">
          {about ? row.targetName ? <span data-item-link={row.target}>on {row.targetName}</span> : <span>about the board</span> : null}
          {row.ask ? <span>ask: {row.ask}</span> : null}
          {row.by ? <span>by {row.by}</span> : null}
          {row.replies ? <span>{row.replies} {row.replies === 1 ? 'reply' : 'replies'}</span> : null}
        </div>
        {row.done && row.answer ? <p className="todo-answer">✓ {row.answer}</p> : null}
        {asking && !row.done ? (
          <CheckOffField
            answeredBy={answeredByName(board)}
            onCancel={() => setAsking(false)}
            onDone={(answer) => {
              setAsking(false)
              actions.onCheck(row.id, answer)
            }}
          />
        ) : null}
      </div>
    </li>
  )
}

/** The list itself. */
export function TodoList({ board, actions, onAdd }: { board: Board; actions: TodoActions; onAdd: (text: string, ask?: string) => void }) {
  const { open, done } = useMemo(() => todoList(board), [board])
  const [adding, setAdding] = useState(false)
  const to = answeredByName(board) ?? 'the agents on this board'
  return (
    <div className="todo-list">
      <p className="muted small">Still to be confirmed with someone else. TODOs live on the board only and wake no agent; one checked off with an answer sends it to {to}.</p>
      {open.length ? (
        <ul className="todo-ul" aria-label={`${open.length} open`}>
          {open.map((r) => (
            <TodoLine key={r.id} row={r} board={board} actions={actions} />
          ))}
        </ul>
      ) : (
        <p className="muted">No open TODO. Right-click an item → Add TODO…, or add one about the board below.</p>
      )}
      {done.length ? (
        <details className="todo-done">
          <summary>Done ({done.length})</summary>
          <ul className="todo-ul">
            {done.map((r) => (
              <TodoLine key={r.id} row={r} board={board} actions={actions} />
            ))}
          </ul>
        </details>
      ) : null}
      {adding ? (
        <div className="todo-add">
          <MarkFields
            kind="todo"
            submitLabel="Add a board TODO"
            hint="About the whole board: placed near the top-left of the view."
            onCancel={() => setAdding(false)}
            onSubmit={(text, ask) => {
              onAdd(text, ask)
              setAdding(false)
            }}
          />
        </div>
      ) : (
        <button type="button" className="ghost small todo-add-btn" onClick={() => setAdding(true)}>
          + TODO about the board
        </button>
      )}
    </div>
  )
}

/** The TODOs section at the top of the panel: folded by default (remembered per board in this browser), the open count on it. */
export function BoardTodos({ board, actions, onAdd }: { board: Board; actions: TodoActions; onAdd: (text: string, ask?: string) => void }) {
  const count = useMemo(() => openTodoCount(board), [board])
  const key = `unprose.todos.${board.id}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) === 'open'
    } catch {
      return false
    }
  })
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(key, next ? 'open' : 'closed')
    } catch {
      // per viewer only
    }
  }
  return (
    <section className={`board-context board-todos${open ? ' open' : ''}`} aria-label="TODOs">
      <button type="button" className="board-context-head" aria-expanded={open} onClick={toggle}>
        <span className="chat-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="board-context-title">TODOs</span>
        {count ? (
          <span className="tab-badge todo-count" aria-label={`${count} open`}>
            {count}
          </span>
        ) : null}
        {!open && <span className="board-context-preview muted">{count ? 'still to confirm with someone' : 'none open'}</span>}
      </button>
      {open && (
        <div className="board-todos-body">
          <TodoList board={board} actions={actions} onAdd={onAdd} />
        </div>
      )}
    </section>
  )
}
