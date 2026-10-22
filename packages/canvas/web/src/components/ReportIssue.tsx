// "Report a problem" / "Suggest a feature" (docs/canvas.md "Feedback about Unprose"): a small dialog that turns what
// the person writes into a prefilled GitHub issue (src/issueLink.ts) and opens it in a new tab, where they read it and
// submit it under their own GitHub account. Nothing is sent to GitHub from here. One dialog for every page
// (ReportHost, in App), opened with openReport — from the help sheets, the board list, and Connected agents →
// Feedback from agents → File on GitHub (prefilled with what the agent wrote). A modal <dialog>: the page behind is
// inert, focus stays inside, Escape closes, focus goes back where it was.
import { useEffect, useId, useRef, useState } from 'react'
import { DEFAULT_ISSUES_REPO, issueUrl, titleFrom, type IssueDraft, type IssueKind, type IssueWhere } from '../../../src/issueLink'
import './report.css'

const REPORT_EVENT = 'unprose:report'

export interface ReportDraft extends Partial<IssueDraft> {
  /** the bug form's "Where": the canvas page when the person reports from it; unknown for an agent's feedback */
  where?: IssueWhere
}

/** Open the dialog, optionally prefilled. */
export function openReport(draft: ReportDraft = {}) {
  window.dispatchEvent(new CustomEvent<ReportDraft>(REPORT_EVENT, { detail: draft }))
}

/** The one dialog of the page; mounted once in App. */
export function ReportHost() {
  const [open, setOpen] = useState<{ draft: ReportDraft; n: number } | null>(null)
  useEffect(() => {
    const on = (e: Event) => setOpen((o) => ({ draft: (e as CustomEvent<ReportDraft>).detail ?? {}, n: (o?.n ?? 0) + 1 }))
    window.addEventListener(REPORT_EVENT, on)
    return () => window.removeEventListener(REPORT_EVENT, on)
  }, [])
  return open ? <ReportDialog key={open.n} draft={open.draft} onClose={() => setOpen(null)} /> : null
}

/**
 * The quiet entry: "Something wrong or missing in Unprose? Report a problem  Suggest a feature". `before` runs first —
 * a sheet closes itself, so the dialog is not opened on top of it.
 */
export function ReportEntry({ before, className }: { before?: () => void; className?: string }) {
  const go = (kind: IssueKind) => {
    before?.()
    openReport({ kind, where: 'Canvas page' })
  }
  return (
    <p className={`report-entry${className ? ` ${className}` : ''}`}>
      <span className="report-entry-lead">Something wrong or missing in Unprose?</span>
      <button type="button" className="report-link" onClick={() => go('bug')}>
        Report a problem
      </button>
      <button type="button" className="report-link" onClick={() => go('idea')}>
        Suggest a feature
      </button>
    </p>
  )
}

const KINDS: Record<IssueKind, { heading: string; option: string; text: string; hint: string }> = {
  bug: { heading: 'Report a problem', option: 'A problem', text: 'What happened', hint: 'What you did and what Unprose did. Steps can be added on GitHub.' },
  idea: { heading: 'Suggest a feature', option: 'An idea', text: 'What is hard or missing, and what would help', hint: 'What you were trying to do. More detail can be added on GitHub.' },
}

function ReportDialog({ draft, onClose }: { draft: ReportDraft; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const opener = useRef<Element | null>(null)
  const uid = useId()
  const [kind, setKind] = useState<IssueKind>(draft.kind ?? 'bug')
  const [title, setTitle] = useState(draft.title ?? '')
  const [text, setText] = useState(draft.text ?? '')
  // the running version and where issues go (GET /api/version); without an answer the version is left for the person
  const [about, setAbout] = useState<{ version: string | null; repo: string }>({ version: null, repo: DEFAULT_ISSUES_REPO })

  useEffect(() => {
    opener.current = document.activeElement
    dialog.current?.showModal()
    titleRef.current?.focus()
    let off = false
    fetch('/api/version')
      .then((r) => (r.ok ? (r.json() as Promise<{ version?: string | null; issuesRepo?: string }>) : null))
      .then((j) => !off && j && setAbout({ version: j.version ?? null, repo: j.issuesRepo || DEFAULT_ISSUES_REPO }))
      .catch(() => undefined)
    return () => {
      off = true
      ;(opener.current as HTMLElement | null)?.focus?.()
    }
  }, [])

  const k = KINDS[kind]
  const submit = () => {
    if (!text.trim()) return
    window.open(issueUrl({ kind, title, text, where: draft.where, version: about.version, repo: about.repo }), '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <dialog
      ref={dialog}
      className="report-dialog"
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-intro`}
      data-no-board-keys
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <header className="report-head">
          <h2 id={`${uid}-title`}>{k.heading}</h2>
          <p id={`${uid}-intro`} className="muted">
            It opens as a new issue on GitHub (<span className="mono">{about.repo}</span>){about.version ? <>, with v{about.version} filled in</> : null}. You check it there and submit it.
          </p>
        </header>
        <fieldset className="report-kind">
          <legend className="visually-hidden">Kind</legend>
          {(['bug', 'idea'] as const).map((v) => (
            <label key={v}>
              <input type="radio" name={`${uid}-kind`} value={v} checked={kind === v} onChange={() => setKind(v)} />
              <span>{KINDS[v].option}</span>
            </label>
          ))}
        </fieldset>
        <div className="report-field">
          <label htmlFor={`${uid}-t`}>Title</label>
          <input ref={titleRef} id={`${uid}-t`} type="text" maxLength={200} value={title} placeholder={titleFrom(text) || undefined} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="report-field">
          <label htmlFor={`${uid}-d`}>{k.text}</label>
          <textarea id={`${uid}-d`} rows={7} required value={text} onChange={(e) => setText(e.target.value)} aria-describedby={`${uid}-hint ${uid}-privacy`} />
          <p id={`${uid}-hint`} className="report-hint">
            {k.hint}
          </p>
        </div>
        <p id={`${uid}-privacy`} className="report-privacy">
          The issue is public: leave out board content, names, links and tokens.
        </p>
        <footer className="report-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!text.trim()}>
            Continue on GitHub<span className="visually-hidden"> (opens a new tab)</span>
          </button>
        </footer>
      </form>
    </dialog>
  )
}
