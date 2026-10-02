// Panels for diagrams on a board (docs/diagrams.md): a selected diagram frame (kind, key, file,
// grammar findings) and a selected element inside one (what it means in the book, who it should sit
// next to, and the trace links to other diagrams). A proposed story (pending) can be accepted — asked of
// the AI, which writes the story-map file — or dismissed.
import { useState } from 'react'
import type { Board, Item } from '../../../src/model'
import { KIND_NAMES, diagramOf, membersOf, type DiagramInfo } from '../diagrams/frame'
import { grammarRule, neighboursOf, roleInfo, type Finding } from '../diagrams/es'
import { FINDING_KINDS, useFrameFindings } from '../diagrams/findings'
import { REL_NAMES, tracesOf } from '../diagrams/traces'
import { pendingOf, type Pending } from '../inspector/pending'
import { MODELS, type DiscussModel } from '../inspector/detail'
import { useModelChoice } from '../inspector/useModel'
import { useFrozen } from '../flow/freeze'
import { headerGroups } from '../flow/headerStrips'
import { PanelLink } from '../inspector/panelNav'

const nameOf = (it: Item | undefined) => (it?.text ?? it?.id ?? 'missing').split('\n')[0].slice(0, 60)

function ItemLink({ it, onSelect }: { it: Item | undefined; onSelect: (id: string) => void }) {
  if (!it) return <span className="muted">missing item</span>
  return (
    <PanelLink id={it.id} name={nameOf(it)} className="wire-block" onSelect={onSelect}>
      {nameOf(it)}
      {it.role ? <span className="wire-note">{it.role.replace(/-/g, ' ')}</span> : null}
    </PanelLink>
  )
}

/** A selected diagram frame. */
export function DiagramFramePanel({ board, diagram, onSelect, onOpenFile }: { board: Board; diagram: DiagramInfo & { frame: Item }; onSelect: (id: string) => void; onOpenFile: (path: string) => void }) {
  const findings = useFrameFindings(board, diagram.frame, diagram.key, diagram.level, diagram.source, diagram.kind)
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
      <FreezeToggle board={board} diagramKey={diagram.key} />
      {FINDING_KINDS.has(diagram.kind) ? <Findings findings={findings} board={board} onSelect={onSelect} kind={diagram.kind} /> : null}
    </section>
  )
}

/** Spreadsheet-style frozen headers for this frame (flow/FrozenHeaders.tsx); only shown when the frame has any. */
function FreezeToggle({ board, diagramKey }: { board: Board; diagramKey: string }) {
  const [on, setOn] = useFrozen(board.id, diagramKey)
  const has = headerGroups(board).some((g) => g.key === diagramKey)
  if (!has) return null
  return (
    <label className="dg-freeze">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      Freeze headers <span className="muted">— keep column and row titles in view while you pan</span>
    </label>
  )
}

const ALL_CLEAR: Record<string, string> = {
  'domain-story': 'Every actor takes part, every work object is in a sentence, and every reference resolves.',
  'ui-mock': 'awd design lint finds nothing: every field is known, every goto and flow has its screen, tables are even.',
}

function Findings({ findings, board, onSelect, kind }: { findings: Finding[]; board: Board; onSelect: (id: string) => void; kind: string }) {
  return (
    <section className="insp-sec">
      <h3>
        {kind === 'ui-mock' ? 'Checks' : 'Grammar'} <span className="muted">({findings.length ? `${findings.length} to look at` : 'nothing to fix'})</span>
      </h3>
      {findings.length ? (
        <ul className="dg-findings">
          {findings.map((f, i) => {
            const it = board.items[f.elementId]
            return (
              <li key={`${f.elementId}-${i}`}>
                {f.severity === 'info' ? <span className="dg-sev info">info</span> : kind === 'ui-mock' ? <span className="dg-sev warning">warning</span> : null}{' '}
                {it ? (
                  // a click shows the element on the board (the panel stays on the frame); › opens its details
                  <PanelLink id={it.id} name={nameOf(it)} className="link dg-finding" onSelect={onSelect}>
                    {f.message}
                  </PanelLink>
                ) : (
                  <span>{f.message}</span>
                )}{' '}
                {f.page ? <span className="muted">{f.page}</span> : it && kind === 'ui-mock' && it.data?.element ? <span className="muted mono">{String(it.data.element)}</span> : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="muted">{ALL_CLEAR[kind] ?? 'Every command has its system, every event→command its policy, and no hotspot is open.'}</p>
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
      {typeof item.data?.sentence === 'string' ? (
        <p className="dg-sentence">
          <span className="muted">Sentence</span> {item.data.sentence}
        </p>
      ) : null}
      {typeof item.data?.note === 'string' ? <p className="muted">{item.data.note}</p> : null}
      {pending?.kind === 'add' && item.type !== 'arrow' ? <StoryProposal board={board} item={item} pending={pending} onProposalChat={onProposalChat} onDismiss={onDismiss} /> : null}
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
                  <PanelLink id={t.wire.id} name="the trace wire" className="link conn-wire" onSelect={onSelect}>
                    wire
                  </PanelLink>
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
