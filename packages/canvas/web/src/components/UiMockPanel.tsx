// A selected UI mock element (docs/diagrams.md §6c): what it is, where it sits in the file, and — when its
// words were edited on the board — the proposal: before → after, the diff to the file, Ask AI to apply, Undo.
import { useEffect, useState } from 'react'
import type { Board, Item } from '../../../src/model'
import { diagramOf } from '../diagrams/frame'
import { uiPendingOf } from '../diagrams/uiProposal'
import { sha1, unifiedDiff, type EditRequest } from '../inspector/diff'
import { MODELS, type DiscussModel } from '../inspector/detail'
import { useModelChoice } from '../inspector/useModel'
import { filesOf } from '../inspector/anchor'
import { uiOf } from '../flow/nodes/UiNode'

const KIND: Record<string, string> = { screen: 'Screen', navbar: 'Navigation bar', sidebar: 'Sidebar', textarea: 'Text area', stat: 'Metric', empty: 'Empty state' }
const nameOf = (t: string) => KIND[t] ?? t.charAt(0).toUpperCase() + t.slice(1)
const pathText = (p: Array<string | number>) => p.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '')

export function UiMockPanel({
  board,
  item,
  onEditChat,
  onUndo,
  onOpenFile,
}: {
  board: Board
  item: Item
  onEditChat: (ids: string[], text: string, model: DiscussModel, edit: EditRequest) => void
  onUndo: (id: string) => void
  onOpenFile: (path: string) => void
}) {
  const u = uiOf(item)
  const diagram = diagramOf(board, item)
  const pending = uiPendingOf(item)
  const source = diagram?.source
  const file = source ? filesOf(board)[source] : undefined
  const [model, pickModel] = useModelChoice()
  const [note, setNote] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  useEffect(() => setSent(null), [pending?.at])
  // the diff to the file, computed with the yaml parser (loaded on demand)
  const [diff, setDiff] = useState('')
  useEffect(() => {
    let live = true
    setDiff('')
    if (pending && file !== undefined && source)
      void import('../diagrams/uiProposalFile').then(({ applyUiText }) => live && setDiff(unifiedDiff(file, applyUiText(file, pending), source)))
    return () => {
      live = false
    }
  }, [pending?.at, pending?.after.text, file, source])
  if (!u) return null
  const element = typeof item.data?.element === 'string' ? item.data.element : undefined
  const ask = async () => {
    if (!pending || !file || !source || !diff) return
    const edit: EditRequest = { file: source, base: await sha1(file), diff }
    const words = `Apply this text change to ${source}: ${element ?? item.id} “${pending.before.text}” → “${pending.after.text}”.`
    onEditChat([item.id], [words, note.trim()].filter(Boolean).join('\n\n'), model, edit)
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
              {u.path ? <span className="muted mono">{pathText(u.path)}</span> : null}
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
      {pending ? (
        <div className="wire-proposal ui-proposal" role="group" aria-label="Proposed text change">
          <p>
            <span className="wire-tag proposed">proposed</span> Changed on the board; the file still says the old words.
          </p>
          <p className="wire-words">
            <span className="ui-was">“{pending.before.text}”</span> → <strong>“{pending.after.text}”</strong>
          </p>
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
      ) : (
        <p className="muted">Double-click to change its words (a proposal the AI applies to the file); moving or resizing it only changes this board. Chat or comment to ask for anything else.</p>
      )}
    </section>
  )
}
