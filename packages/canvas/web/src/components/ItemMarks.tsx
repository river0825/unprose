// The selected item's annotations and TODOs in its panel (docs/canvas.md → "Notes"): the numbered cards and the
// person's drafts (and where each draft stands), the TODOs with their boxes, and the two ways to add one — the same
// as "Annotate…" and "Add TODO…" in the item's menu.
import { useMemo, useState } from 'react'
import type { Board, Item } from '../../../src/model'
import { calloutOf, isAnnotationDraft } from '../../../src/annotations'
import { annotateHint, annotateWhere, draftHolder, draftStatus } from '../flow/annotationsView'
import { threadOf } from '../flow/boardToFlow'
import { isApplied, isDeclined } from '../flow/notesView'
import { todoList } from '../flow/todoView'
import { DraftGlyph } from '../flow/nodes/Marks'
import { MarkFields } from './MarkInput'
import { TodoLine, type TodoActions } from './TodoList'
import '../annotations.css'

export interface ItemMarksActions extends TodoActions {
  onAnnotate: (text: string) => void
  onAddTodo: (text: string, ask?: string) => void
}

export function ItemMarks({ board, item, actions }: { board: Board; item: Item; actions: ItemMarksActions }) {
  const [adding, setAdding] = useState<'annotate' | 'todo' | null>(null)
  const notes = useMemo(() => {
    const out: Array<{ card: Item; n?: number; status?: string }> = []
    for (const it of Object.values(board.items)) {
      if (it.type !== 'comment' || it.target !== item.id) continue
      const n = calloutOf(it)
      if (n !== undefined) out.push({ card: it, n })
      else if (isAnnotationDraft(it)) {
        const thread = threadOf(board, it.id)
        out.push({ card: it, status: isApplied(thread) ? 'Applied — the card from the file replaces it' : isDeclined(thread) ? 'Declined' : draftStatus(thread.slice(1), draftHolder(board, it)) })
      }
    }
    return out.sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity))
  }, [board, item.id])
  const todos = useMemo(() => {
    const { open, done } = todoList(board)
    return [...open, ...done].filter((r) => r.target === item.id)
  }, [board, item.id])
  return (
    <section className="insp-sec marks-sec" aria-label="Annotations and TODOs">
      <h3>Annotations</h3>
      {notes.length ? (
        <ul className="marks-ul">
          {notes.map(({ card, n, status }) => (
            <li key={card.id}>
              <button type="button" className="marks-li" data-item-link={card.id} title="Show it on the board" onClick={() => actions.onShow(card.id)}>
                <span className={`ui-pin ${n === undefined ? 'draft' : ''}`} aria-hidden="true">
                  {n ?? <DraftGlyph />}
                </span>
                <span className="marks-li-text">{card.text}</span>
              </button>
              {status ? <p className="marks-li-status muted">{status}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">None — what is this item for? Annotate it.</p>
      )}
      <h3>TODOs</h3>
      {todos.length ? (
        <ul className="todo-ul">
          {todos.map((r) => (
            <TodoLine key={r.id} row={r} board={board} actions={actions} about={false} />
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing to confirm with anyone.</p>
      )}
      {adding ? (
        <MarkFields
          kind={adding}
          hint={adding === 'annotate' ? annotateHint(annotateWhere(board, item)) : 'On the board only; it wakes no agent.'}
          onCancel={() => setAdding(null)}
          onSubmit={(text, ask) => {
            if (adding === 'annotate') actions.onAnnotate(text)
            else actions.onAddTodo(text, ask)
            setAdding(null)
          }}
        />
      ) : (
        <div className="marks-add">
          <button type="button" className="ghost small" onClick={() => setAdding('annotate')}>
            Annotate…
          </button>
          <button type="button" className="ghost small" onClick={() => setAdding('todo')}>
            Add TODO…
          </button>
        </div>
      )}
    </section>
  )
}
