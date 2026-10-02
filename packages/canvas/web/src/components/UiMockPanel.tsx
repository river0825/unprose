// A selected UI mock element (docs/diagrams.md §6c): what it is, where it sits in the file, what `awd design
// lint` says about it, and its proposal — new words (its own, a table cell, a list item), its removal, or a
// new element: the change, the diff to the file, Ask AI to apply, Undo. With no proposal open, a new element
// can be proposed inside a screen or container, or after the element.
import { useEffect, useState } from 'react'
import type { Board, Item, Op } from '../../../src/model'
import { diagramOf } from '../diagrams/frame'
import { UI_ADDABLE, uiAddOps, uiAddTarget, uiProposalOf, uiRemovedIds, type UiPending } from '../diagrams/uiProposal'
import { uiFindingsOf } from '../diagrams/uiFindings'
import { sha1, unifiedDiff, type EditRequest } from '../inspector/diff'
import { MODELS, type DiscussModel } from '../inspector/detail'
import { useModelChoice } from '../inspector/useModel'
import { filesOf } from '../inspector/anchor'
import { uiOf } from '../flow/nodes/UiNode'

const KIND: Record<string, string> = { screen: 'Screen', navbar: 'Navigation bar', sidebar: 'Sidebar', textarea: 'Text area', stat: 'Metric', empty: 'Empty state' }
const nameOf = (t: string) => KIND[t] ?? t.charAt(0).toUpperCase() + t.slice(1)
const pathText = (p: Array<string | number>) => p.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '')
const elementOf = (it: Item | undefined) => (typeof it?.data?.element === 'string' ? it.data.element : undefined)

/** Which value a text proposal is about, in words: "row 2, column 3" / "item 1". */
function valueName(p: UiPending): string | undefined {
  if (p.kind !== 'text' || !p.sub) return undefined
  return p.sub[0] === 'rows' ? `table cell row ${Number(p.sub[1]) + 1}, column ${Number(p.sub[2]) + 1}` : `item ${Number(p.sub[1]) + 1}`
}

/** The request to the AI, in words; the diff travels with it. */
function requestWords(p: UiPending, source: string, element: string): string {
  if (p.kind === 'text') {
    const what = valueName(p)
    return `Apply this text change to ${source}: ${element}${what ? ` ${what}` : ''} “${p.before.text}” → “${p.after.text}”.`
  }
  if (p.kind === 'remove') return `Remove ${element} (${p.before.type}${p.before.text ? ` “${p.before.text}”` : ''}) from ${source}.`
  const where = p.after ? `right after ${p.after.element}` : `at the end of ${p.parent?.element ?? 'its screen'}`
  return `Add a new ${p.node.type} “${p.node.text}” (id ${p.node.id}) to ${source}, ${where}.`
}

export function UiMockPanel({
  board,
  item,
  onEditChat,
  onUndo,
  onOpenFile,
  onOps,
}: {
  board: Board
  item: Item
  onEditChat: (ids: string[], text: string, model: DiscussModel, edit: EditRequest) => void
  onUndo: (id: string) => void
  onOpenFile: (path: string) => void
  /** a change made here: a proposed new element (selected afterwards) */
  onOps?: (ops: Op[], label: string, select?: string) => void
}) {
  const u = uiOf(item)
  const diagram = diagramOf(board, item)
  const pending = uiProposalOf(item)
  const source = diagram?.source
  const file = source ? filesOf(board)[source] : undefined
  const element = elementOf(item)
  const [model, pickModel] = useModelChoice()
  const [note, setNote] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  useEffect(() => setSent(null), [pending?.at])
  // the diff to the file, computed with the yaml parser (loaded on demand)
  const [diff, setDiff] = useState('')
  const key = pending ? JSON.stringify(pending) : ''
  useEffect(() => {
    let live = true
    setDiff('')
    if (pending && file !== undefined && source)
      void import('../diagrams/uiProposalFile').then(({ applyUiPending }) => live && setDiff(unifiedDiff(file, applyUiPending(file, pending, element), source)))
    return () => {
      live = false
    }
  }, [key, file, source, element])
  if (!u) return null
  const findings = uiFindingsOf(item)
  const inRemoved = !pending && uiRemovedIds(board).has(item.id)
  const ask = async () => {
    if (!pending || !file || !source || !diff) return
    const edit: EditRequest = { file: source, base: await sha1(file), diff }
    onEditChat([item.id], [requestWords(pending, source, element ?? item.id), note.trim()].filter(Boolean).join('\n\n'), model, edit)
    setSent(pending.at)
  }
  return (
    <section className="dg-panel ui-panel" aria-label="UI mock element">
      <div className="insp-head">
        <span className="insp-kind dg-kind k-ui-mock">UI mock</span>
        <span className="dg-role">{nameOf(u.type)}</span>
      </div>
      <dl className="kv">
        {element ? (
          <>
            <dt>Element</dt>
            <dd className="mono">{element}</dd>
          </>
        ) : null}
        {source ? (
          <>
            <dt>In file</dt>
            <dd>
              <button type="button" className="link mono" onClick={() => onOpenFile(source)} title="Open in Files">
                {source}
              </button>{' '}
              {u.path && pending?.kind !== 'add' ? <span className="muted mono">{pathText(u.path)}</span> : pending?.kind === 'add' ? <span className="muted">not yet — proposed</span> : null}
            </dd>
          </>
        ) : null}
        {u.goto ? (
          <>
            <dt>Goes to</dt>
            <dd className="mono">{u.goto}</dd>
          </>
        ) : null}
      </dl>
      {findings.length ? (
        <section className="insp-sec" aria-label="Lint findings">
          <h3>
            Checks <span className="muted">(awd design lint)</span>
          </h3>
          <ul className="ui-checks">
            {findings.map((f, i) => (
              <li key={i}>
                <span className={`dg-sev ${f.severity}`}>{f.severity}</span> {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pending ? (
        <div className="wire-proposal ui-proposal" role="group" aria-label={pending.kind === 'remove' ? 'Proposed removal' : pending.kind === 'add' ? 'Proposed new element' : 'Proposed text change'}>
          <Summary p={pending} container={Boolean(u.container)} />
          {diff ? <pre className="ui-diff mono" aria-label="The change to the file">{diff}</pre> : <p className="muted">The file behind this frame is not on the board, so no diff can be shown; the AI can still apply it.</p>}
          <label className="insp-model-note">
            <span className="muted">Note for the AI (optional)</span>
            <textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="e.g. use the same words on the phone screen" />
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
            <button type="button" className="small" onClick={() => onUndo(item.id)}>
              Undo
            </button>
            <button type="button" className="primary small" onClick={() => void ask()} disabled={sent === pending.at || !source || (file !== undefined && !diff)}>
              {sent === pending.at ? 'Sent to the AI' : 'Ask AI to apply'}
            </button>
          </div>
        </div>
      ) : inRemoved ? (
        <p className="muted">It sits inside an element proposed for removal: it goes with it once the AI applies that.</p>
      ) : (
        <>
          <p className="muted">
            Double-click to change its words{u.type === 'table' ? ' — or a cell' : u.items?.length ? ' — or an item' : ''} (a proposal the AI applies to the file); Delete proposes removing it. Moving or resizing it only changes this board.
          </p>
          {onOps ? <AddElement board={board} item={item} onOps={onOps} /> : null}
        </>
      )}
    </section>
  )
}

function Summary({ p, container }: { p: UiPending; container: boolean }) {
  if (p.kind === 'remove')
    return (
      <p>
        <span className="wire-tag remove">remove</span> Deleted on the board; the file still has this {p.before.type}
        {p.before.text ? ` “${p.before.text}”` : ''}
        {container ? ' and everything inside it' : ''}.
      </p>
    )
  if (p.kind === 'add')
    return (
      <p>
        <span className="wire-tag proposed">proposed</span> A new {p.node.type} <strong>“{p.node.text}”</strong> <span className="muted mono">id {p.node.id}</span>,{' '}
        {p.after ? `right after ${p.after.element}` : `at the end of ${p.parent?.element}`}. Double-click it to change its words.
      </p>
    )
  const what = valueName(p)
  return (
    <>
      <p>
        <span className="wire-tag proposed">proposed</span> Changed on the board{what ? ` (${what})` : ''}; the file still says the old words.
      </p>
      <p className="wire-words">
        <span className="ui-was">“{p.before.text}”</span> → <strong>“{p.after.text}”</strong>
      </p>
    </>
  )
}

/** Propose a new element: inside the selected screen / container, else right after the selected element. */
function AddElement({ board, item, onOps }: { board: Board; item: Item; onOps: (ops: Op[], label: string, select?: string) => void }) {
  const { mode } = uiAddTarget(board, item)
  const where = mode === 'append' ? `at the end of this ${uiOf(item)?.type ?? 'container'}` : 'after this element'
  const add = (type: string) => {
    const r = uiAddOps(board, item, type, new Date().toISOString())
    if (r) onOps(r.ops, `proposed a new ${type}`, r.id)
  }
  return (
    <section className="insp-sec ui-add" aria-label="Add an element">
      <h3>
        Add element <span className="muted">— {where}, as a proposal</span>
      </h3>
      <div className="ui-add-types">
        {UI_ADDABLE.map((a) => (
          <button key={a.type} type="button" className="small" onClick={() => add(a.type)} title={`Propose a new ${a.label.toLowerCase()} ${where}`}>
            + {a.label}
          </button>
        ))}
      </div>
    </section>
  )
}
