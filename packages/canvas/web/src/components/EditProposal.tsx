// An edit proposal at the top of its chat (docs/canvas.md "Proposals and saving"): the file, who proposed it
// (an agent through canvas_propose_edit, or the person in the source dialog), the diff, and how it gets saved —
// by whoever has the files, after the person agrees in this thread. Nothing here writes a file.
import type { Item } from '../../../src/model'
import { diffStat, type EditRequest } from '../inspector/diff'

export function editOf(root: Item): EditRequest | undefined {
  const e = (root.data?.discuss as { edit?: Partial<EditRequest> } | undefined)?.edit
  return e && typeof e.diff === 'string' && e.diff.trim() ? (e as EditRequest) : undefined
}

/** The name the canvas signed a comment with (`data.by`), when an agent or a signed-in person wrote it. */
export const signedBy = (m: Item): string | undefined => (typeof m.data?.by === 'string' && m.data.by ? m.data.by : undefined)

export function EditProposal({ root, answered, onReply }: { root: Item; /** the person has replied in the thread already */ answered?: boolean; onReply?: (rootId: string, text: string) => void }) {
  const edit = editOf(root)
  if (!edit) return null
  const byAgent = root.createdBy === 'agent'
  const who = byAgent ? (edit.by ?? signedBy(root) ?? 'an agent') : 'you'
  const { added, removed } = diffStat(edit.diff)
  const lines = edit.diff.split('\n').filter((l, i) => !(i < 2 && (l.startsWith('---') || l.startsWith('+++'))))
  if (lines[lines.length - 1] === '') lines.pop()
  return (
    <section className="edit-prop" aria-label={`Proposed edit to ${edit.file ?? 'a text'} by ${who}`}>
      <div className="edit-prop-head">
        <span className="wire-tag">proposed edit</span>
        <span className="mono edit-prop-file" title={edit.file}>
          {edit.file ?? edit.doc ?? 'text'}
        </span>
        <span className="edit-prop-stat mono" aria-label={`${added} lines added, ${removed} removed`}>
          <span className="edit-prop-add">+{added}</span> <span className="edit-prop-del">−{removed}</span>
        </span>
      </div>
      <p className="edit-prop-by">
        Proposed by <strong>{who}</strong>
        {byAgent ? <span className="muted"> · agent</span> : null}
        {edit.base ? <span className="muted mono" title={`sha-1 of the file it was made against: ${edit.base}`}> · base {edit.base.slice(0, 8)}</span> : null}
      </p>
      <pre className="edit-prop-diff mono" aria-label="The change, as a diff">
        {lines.map((l, i) => (
          <span key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : l.startsWith('\\') ? 'hunk' : ''}>
            {l || ' '}
            {'\n'}
          </span>
        ))}
      </pre>
      <p className="muted edit-prop-how">
        {answered
          ? 'You answered below. The agent that has the files applies it (checking the file still matches), lints, tests, redraws and says so in this thread.'
          : `Not in the file yet. ${byAgent ? `${who} cannot write the files; ` : ''}whoever has them applies it after you agree here — the studio session on the canvas machine, or your own agent — checking the file still matches, then lints, tests and redraws.`}
      </p>
      {byAgent && onReply && !answered ? (
        <div className="edit-prop-actions" role="group" aria-label="Answer the proposal">
          <button type="button" className="small" onClick={() => onReply(root.id, 'Yes — apply this edit.')}>
            Agree
          </button>
          <button type="button" className="small ghost" onClick={() => onReply(root.id, 'No, leave the file as it is.')}>
            Decline
          </button>
        </div>
      ) : null}
    </section>
  )
}
