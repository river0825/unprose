// A flow wire on a workflow board (docs/studio.md §7): the event it stands for, and —
// when the person has dragged, drawn, relabelled or deleted it — the proposal, with
// "Ask AI to review" (a chat request carrying the proposal) and "Undo".
import { useState } from 'react'
import type { Board, Item } from '../../../src/model'
import { MODELS, detailOf, type DiscussModel } from '../inspector/detail'
import { describePending, eventOf, itemOfNode, nodeIdOf, pendingOf, yamlIntent, type Pending } from '../inspector/pending'
import { useModelChoice } from '../inspector/useModel'
import { chatsFor } from '../inspector/chat'
import '../inspector.css'

interface Props {
  board: Board
  item: Item
  onSelect: (id: string) => void
  onOpenFile: (path: string, line?: number) => void
  onWireChat: (ids: string[], text: string, model: DiscussModel, proposal: Pending) => void
  onUndo: (id: string) => void
  onPickEvent: (id: string, event: string) => void
}

const nameOf = (board: Board, nodeId: string | undefined) => {
  const it = nodeId ? itemOfNode(board, nodeId) : undefined
  return { it, name: it?.text?.split('\n')[0].trim() || nodeId || '?' }
}

function Block({ board, nodeId, onSelect }: { board: Board; nodeId: string | undefined; onSelect: (id: string) => void }) {
  const { it, name } = nameOf(board, nodeId)
  if (!it) return <span className="mono">{name}</span>
  return (
    <button type="button" className="wire-block" onClick={() => onSelect(it.id)} title={`Select ${name}`}>
      {name}
    </button>
  )
}

export function WireProposal({ board, item, onSelect, onOpenFile, onWireChat, onUndo, onPickEvent }: Props) {
  const ev = eventOf(item)
  const pending = pendingOf(item)
  const from = ev?.from ?? nodeIdOf(board.items[item.from ?? ''])
  const to = ev?.to ?? nodeIdOf(board.items[item.to ?? ''])
  // the consumer's `on:` is where this subscription lives in the yaml
  const consumer = detailOf(nameOf(board, pending?.before?.to ?? to).it)
  const src = consumer?.source

  return (
    <section className="wire-panel" aria-label="Wire event">
      <h3>Event</h3>
      {ev ? (
        <div className="wire-event">
          <span className="insp-chip mono">{ev.event}</span>
          {ev.condition ? <span className="wire-if mono">if {ev.condition}</span> : null}
          {ev.resume ? <span className="wire-note">resumes a waiting step</span> : null}
        </div>
      ) : pending?.kind === 'add' ? (
        <p className="muted">A new wire — not in the file yet.</p>
      ) : (
        <p className="muted">This wire has no event recorded; redraw the board with a newer awd graph.</p>
      )}
      <div className="wire-ends">
        <Block board={board} nodeId={from} onSelect={onSelect} />
        <span aria-hidden="true">→</span>
        <span className="sr">runs</span>
        <Block board={board} nodeId={to} onSelect={onSelect} />
      </div>
      {src?.workflow ? (
        <button type="button" className="link mono wire-yaml" onClick={() => onOpenFile(src.workflow, src.line)} title="Open the step's on: in Files">
          {src.workflow}
          {src.line ? `:${src.line}` : ''} — {pending?.before?.to ?? to}.on
        </button>
      ) : null}
      {pending ? <Proposal board={board} item={item} pending={pending} onWireChat={onWireChat} onUndo={onUndo} onPickEvent={onPickEvent} onSelect={onSelect} /> : null}
    </section>
  )
}

function Proposal({ board, item, pending, onWireChat, onUndo, onPickEvent, onSelect }: { board: Board; item: Item; pending: Pending; onWireChat: Props['onWireChat']; onUndo: Props['onUndo']; onPickEvent: Props['onPickEvent']; onSelect: Props['onSelect'] }) {
  const [model, setModel] = useModelChoice()
  const [note, setNote] = useState('')
  const [custom, setCustom] = useState('')
  const needsEvent = pending.kind !== 'remove' && !pending.after?.event
  const source = pending.after?.from ? detailOf(itemOfNode(board, pending.after.from)) : undefined
  const emits = source?.emits ?? []
  // this very proposal (same edit time), not an earlier one on the same wire
  const asked = chatsFor(board, [item.id]).some((c) => (c.root.data?.discuss as { proposal?: Pending } | undefined)?.proposal?.at === pending.at)

  const ask = () => {
    // the chat is about the wire and every block the change touches
    const nodes = [pending.after?.from, pending.after?.to, pending.before?.from, pending.before?.to]
    const ids = [item.id, ...nodes.map((n) => (n ? itemOfNode(board, n)?.id : undefined))].filter((x, i, all): x is string => Boolean(x) && all.indexOf(x) === i)
    const text = [`Review this wire change: ${describePending(pending)}`, note.trim()].filter(Boolean).join('\n\n')
    onWireChat(ids, text, model, pending)
    setNote('')
  }

  return (
    <div className={`wire-proposal ${pending.kind}`} role="group" aria-label="Proposed change">
      <div className="wire-proposal-head">
        <span className={`wire-tag ${pending.kind}`}>{pending.kind === 'remove' ? 'remove?' : 'proposed'}</span>
        <span>Not in the file yet</span>
      </div>
      <p className="wire-words">{describePending(pending)}</p>
      {yamlIntent(pending) ? <p className="wire-intent mono">{yamlIntent(pending)}</p> : null}

      {needsEvent && (
        <div className="field">
          <span className="wire-pick-label">Which event of {pending.after?.from ?? 'the source'} should run it?</span>
          <div className="insp-chips">
            {emits.map((e) => (
              <button key={e} type="button" className="insp-chip mono wire-pick" onClick={() => onPickEvent(item.id, e)}>
                {e}
              </button>
            ))}
          </div>
          <form
            className="wire-custom"
            onSubmit={(e) => {
              e.preventDefault()
              if (custom.trim()) onPickEvent(item.id, custom.trim())
              setCustom('')
            }}
          >
            <label className="sr" htmlFor={`wire-ev-${item.id}`}>
              Another event
            </label>
            <input id={`wire-ev-${item.id}`} className="mono" value={custom} placeholder="another event, e.g. plan.ready" onChange={(e) => setCustom(e.target.value)} />
            <button type="submit" className="ghost small" disabled={!custom.trim()}>
              Use
            </button>
          </form>
        </div>
      )}

      <label className="wire-pick-label" htmlFor={`wire-note-${item.id}`}>
        Note for the AI (optional)
      </label>
      <textarea
        id={`wire-note-${item.id}`}
        value={note}
        rows={2}
        placeholder="Why this change? Anything to watch for?"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask()
        }}
      />
      <div className="actions wire-actions">
        <label className="sr" htmlFor={`wire-model-${item.id}`}>
          Model
        </label>
        <select id={`wire-model-${item.id}`} value={model} onChange={(e) => setModel(e.target.value as DiscussModel)}>
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="button" className="ghost" onClick={() => onUndo(item.id)}>
          Undo
        </button>
        <button type="button" className="primary" onClick={ask}>
          Ask AI to review
        </button>
      </div>
      <p className="muted small">
        {asked ? 'Already sent to the AI — see the Chat tab. ' : ''}The AI reviews the change with you, then edits the yaml; the board redraws and this wire stops being a proposal.
        {pending.before ? (
          <>
            {' '}
            Was: <Block board={board} nodeId={pending.before.from} onSelect={onSelect} /> → <Block board={board} nodeId={pending.before.to} onSelect={onSelect} />
          </>
        ) : null}
      </p>
    </div>
  )
}
