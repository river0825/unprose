// Panels for diagrams on a board (docs/diagrams.md): a selected diagram frame (kind, key, file,
// grammar findings) and a selected element inside one (what it means in the book, who it should sit
// next to, and the trace links to other diagrams). A proposed story (pending) can be accepted — asked of
// the AI, which writes the story-map file — or dismissed.
import { useState } from 'react'
import type { Board, Item } from '../../../src/model'
import { KIND_NAMES, diagramOf, membersOf, type DiagramInfo } from '../diagrams/frame'
import { grammarRule, neighboursOf, roleInfo, type Finding } from '../diagrams/es'
import { useFrameFindings } from '../diagrams/findings'
import { REL_NAMES, tracesOf } from '../diagrams/traces'
import { pendingOf, type Pending } from '../inspector/pending'
import { MODELS, type DiscussModel } from '../inspector/detail'
import { useModelChoice } from '../inspector/useModel'

const nameOf = (it: Item | undefined) => (it?.text ?? it?.id ?? 'missing').split('\n')[0].slice(0, 60)

function ItemLink({ it, onSelect }: { it: Item | undefined; onSelect: (id: string) => void }) {
  if (!it) return <span className="muted">missing item</span>
  return (
    <button type="button" className="wire-block" onClick={() => onSelect(it.id)} title={`Select ${nameOf(it)}`}>
      {nameOf(it)}
      {it.role ? <span className="wire-note">{it.role.replace(/-/g, ' ')}</span> : null}
    </button>
  )
}

/** A selected diagram frame. */
export function DiagramFramePanel({ board, diagram, onSelect, onOpenFile }: { board: Board; diagram: DiagramInfo & { frame: Item }; onSelect: (id: string) => void; onOpenFile: (path: string) => void }) {
  const findings = useFrameFindings(board, diagram.frame, diagram.key, diagram.level, diagram.source)
  const count = membersOf(board, diagram.frame.id).length
  return (
    <section className="dg-panel" aria-label="Diagram">
      <div className="insp-head">
        <span className={`insp-kind dg-kind k-${diagram.kind}`}>{KIND_NAMES[diagram.kind] ?? diagram.kind}</span>
      </div>
      <dl className="kv">
        <dt>Key</dt>
        <dd className="mono">{diagram.key}</dd>
        {diagram.level ? (
          <>
            <dt>Level</dt>
            <dd>{diagram.level.replace(/-/g, ' ')}</dd>
          </>
        ) : null}
        <dt>File</dt>
        <dd>
          {diagram.source ? (
            <button type="button" className="link mono" onClick={() => onOpenFile(diagram.source!)} title="Open in Files">
              {diagram.source}
            </button>
          ) : (
            <span className="muted">not backed by a file yet</span>
          )}
        </dd>
        <dt>Elements</dt>
        <dd>{count}</dd>
      </dl>
      {diagram.kind === 'event-storming' ? <Findings findings={findings} board={board} onSelect={onSelect} /> : null}
    </section>
  )
}

function Findings({ findings, board, onSelect }: { findings: Finding[]; board: Board; onSelect: (id: string) => void }) {
  return (
    <section className="insp-sec">
      <h3>
        Grammar <span className="muted">({findings.length ? `${findings.length} to look at` : 'nothing to fix'})</span>
      </h3>
      {findings.length ? (
        <ul className="dg-findings">
          {findings.map((f, i) => (
            <li key={`${f.elementId}-${i}`}>
              <button type="button" className="link" onClick={() => onSelect(f.elementId)} disabled={!board.items[f.elementId]}>
                {f.message}
              </button>{' '}
              <span className="muted">{f.page}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Every command has its system, every event→command its policy, and no hotspot is open.</p>
      )}
    </section>
  )
}

/** A selected element inside a diagram frame (or a legacy diagram board). */
export function DiagramElementPanel({
  board,
  item,
  onSelect,
  onProposalChat,
  onDismiss,
}: {
  board: Board
  item: Item
  onSelect: (id: string) => void
  onProposalChat: (ids: string[], text: string, model: DiscussModel, proposal: Pending) => void
  onDismiss: (id: string) => void
}) {
  const diagram = diagramOf(board, item)
  if (!diagram) return null
  const info = roleInfo(diagram.kind, item)
  const traces = tracesOf(board, item)
  const nb = diagram.kind === 'event-storming' && diagram.frame ? neighboursOf(board, diagram.frame.id, item) : undefined
  const rule = diagram.kind === 'event-storming' ? grammarRule(item) : undefined
  const pending = pendingOf(item)
  if (!info && !traces.length && !pending) return null
  return (
    <section className="dg-panel" aria-label="Diagram element">
      <div className="insp-head">
        <span className={`insp-kind dg-kind k-${diagram.kind}`}>{KIND_NAMES[diagram.kind] ?? diagram.kind}</span>
        {info ? <span className="dg-role">{info.name}</span> : null}
      </div>
      {info ? (
        <p className="dg-meaning">
          {info.meaning} <span className="muted">({info.colour} · {info.page})</span>
        </p>
      ) : null}
      {pending?.kind === 'add' ? <StoryProposal board={board} item={item} pending={pending} onProposalChat={onProposalChat} onDismiss={onDismiss} /> : null}
      {rule || (nb && (nb.before.length || nb.after.length)) ? (
        <section className="insp-sec">
          <h3>Grammar</h3>
          {rule ? <p className="muted dg-rule">{rule}</p> : null}
          {nb?.before.length ? (
            <div className="dg-nb">
              <span className="muted">Before</span> {nb.before.map((it) => <ItemLink key={it.id} it={it} onSelect={onSelect} />)}
            </div>
          ) : null}
          {nb?.after.length ? (
            <div className="dg-nb">
              <span className="muted">After</span> {nb.after.map((it) => <ItemLink key={it.id} it={it} onSelect={onSelect} />)}
            </div>
          ) : null}
        </section>
      ) : null}
      {traces.length ? (
        <section className="insp-sec">
          <h3>Traces</h3>
          <ul className="wire-list">
            {traces.map((t) => {
              const rel = t.rel ? REL_NAMES[t.rel] : 'trace'
              const where = t.other ? diagramOf(board, t.other) : undefined
              return (
                <li key={t.wire.id}>
                  {t.dir === 'out' ? (
                    <>
                      <span className="muted">this</span> <span className="insp-chip">{rel}</span> <ItemLink it={t.other} onSelect={onSelect} />
                    </>
                  ) : (
                    <>
                      <ItemLink it={t.other} onSelect={onSelect} /> <span className="insp-chip">{rel}</span> <span className="muted">this</span>
                    </>
                  )}
                  {where ? <span className="wire-note">{KIND_NAMES[where.kind] ?? where.kind}</span> : null}
                  <button type="button" className="link conn-wire" onClick={() => onSelect(t.wire.id)} aria-label="Select the trace wire">
                    wire
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </section>
  )
}

/** A story the agent proposed (docs/diagrams.md §4): accept = ask the AI to write it; dismiss = drop it. */
function StoryProposal({
  board,
  item,
  pending,
  onProposalChat,
  onDismiss,
}: {
  board: Board
  item: Item
  pending: Pending
  onProposalChat: (ids: string[], text: string, model: DiscussModel, proposal: Pending) => void
  onDismiss: (id: string) => void
}) {
  const [model, pickModel] = useModelChoice()
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const from = tracesOf(board, item).filter((t) => t.rel === 'derived-from').map((t) => t.other?.id).filter(Boolean) as string[]
  const accept = () => {
    const text = `Add this proposed story to the story-map file: “${nameOf(item)}”.${note.trim() ? `\n\n${note.trim()}` : ''}`
    onProposalChat([item.id, ...from], text, model, pending)
    setSent(true)
  }
  return (
    <div className="wire-proposal dg-proposal" role="group" aria-label="Proposed story">
      <p>
        <span className="wire-tag proposed">proposed</span> The agent proposes this story; the story-map file does not have it yet.
      </p>
      <label className="insp-model-note">
        <span className="muted">Note for the AI (optional)</span>
        <textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="e.g. merge it with the story next to it" />
      </label>
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
        <button type="button" className="small" onClick={() => onDismiss(item.id)}>
          Dismiss
        </button>
        <button type="button" className="primary small" onClick={accept} disabled={sent}>
          {sent ? 'Sent to the AI' : 'Accept'}
        </button>
      </div>
    </div>
  )
}
