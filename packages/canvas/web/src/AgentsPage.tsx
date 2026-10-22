// Connected agents (docs/canvas.md "Remote agents"): the agents and browsers let in from elsewhere, the
// requests waiting, "Enter a code", and new access tokens (made only on a page on the canvas machine).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCESS_CHANGED_EVENT, accessApi, shortUa, useAccess, type AccessRequestView, type AgentView, type AuditEntry, type Setup, type WhyNotManage } from './access'
import { api, type ProjectSummary } from './api'
import { navigate } from './BoardPage'
import { timeAgo } from './time'
import { RequestCard } from './components/RequestCard'
import { usePendingRequests } from './components/AccessCenter'
import { openReport } from './components/ReportIssue'
import './access.css'
import { handleOf } from '../../src/routing'
import { feedbackDraft } from '../../src/issueLink'

const HOW: Record<AgentView['via'], string> = { token: 'Token', oauth: 'OAuth', device: 'Device code', browser: 'Browser' }

export function AgentsPage() {
  const me = useAccess()
  const [agents, setAgents] = useState<AgentView[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [whyNot, setWhyNot] = useState<WhyNotManage | undefined>(undefined)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [justGranted, setJustGranted] = useState(false)
  const couldNot = useRef(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [created, setCreated] = useState<{ agent: AgentView; token: string; setup: Setup } | null>(null)
  const live = usePendingRequests(me.canApprove)

  const load = useCallback(() => {
    accessApi
      .agents()
      .then((r) => {
        setAgents(r.agents)
        // the right to manage arrived while this page was open (a manage-rights request was allowed)
        if (r.canManage && couldNot.current) setJustGranted(true)
        couldNot.current = !r.canManage
        setCanManage(r.canManage)
        setWhyNot(r.whyNotManage)
        setAudit(r.audit ?? [])
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
  const granted = useCallback(() => load(), [load])
  useEffect(() => {
    document.title = 'Connected agents — Unprose canvas'
    load()
    void api.listProjects().then(setProjects)
    const on = () => load()
    window.addEventListener(ACCESS_CHANGED_EVENT, on)
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, on)
  }, [load])

  // the server socket sends every pending request when it opens, then each new one
  const requests: AccessRequestView[] = live
  const [gone, setGone] = useState<Set<string>>(new Set())
  const waiting = requests.filter((r) => !gone.has(r.id) && (r.via !== 'manage' || canManage))

  return (
    <main className="list-page agents-page">
      <div className="list-head">
        <h1>Connected agents</h1>
        <a
          className="docs-link"
          href="/"
          onClick={(e) => {
            e.preventDefault()
            navigate('/')
          }}
        >
          Boards
        </a>
        <a className="docs-link" href="/docs/canvas#remote-agents">
          Docs
        </a>
        {me.grant?.as === 'browser' && (
          <button
            type="button"
            className="ghost"
            onClick={() =>
              void accessApi.signOut().then(() => location.reload())
            }
          >
            Sign out
          </button>
        )}
      </div>
      <p className="sub">
        Agents on other machines and cloud agents (claude.ai, ChatGPT, cloud Codex) connect to <code className="mono">{me.publicUrl}/mcp</code>. Every change they make is signed with their name. Revoke one and it is out at once.
      </p>
      {error && (
        <div className="empty" role="alert">
          {error}
        </div>
      )}
      {agents !== null && !canManage && whyNot && <CannotManage why={whyNot} publicUrl={me.publicUrl} onGranted={granted} />}
      {justGranted && canManage && (
        <p className="access-ok manage-granted" role="status">
          Allowed — this browser may manage agents now: change access, revoke and make tokens below.
        </p>
      )}

      <section className="agents-section" aria-labelledby="waiting-h">
        <h2 id="waiting-h">Waiting to connect</h2>
        {waiting.length ? (
          <div className="agents-requests">
            {waiting.map((r) => (
              <RequestCard key={r.id} request={r} oneClick={me.oneClick} onDone={() => setGone((s) => new Set(s).add(r.id))} />
            ))}
          </div>
        ) : (
          <p className="muted">Nobody is waiting. When an agent connects, its request shows up here and on every open page.</p>
        )}
        <EnterCode onDone={load} />
      </section>

      <section className="agents-section" aria-labelledby="list-h">
        <h2 id="list-h">Agents and browsers</h2>
        {agents === null ? (
          !error && <p className="muted">Loading…</p>
        ) : agents.length === 0 ? (
          <p className="muted">None yet. Make a token below, or connect an agent to {me.publicUrl}/mcp and approve it.</p>
        ) : (
          <div className="agents-table-wrap">
            <table className="agents-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">How</th>
                  <th scope="col">Access</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <AgentRow key={a.id} a={a} canManage={canManage} projects={projects} onChange={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && audit.length > 0 && <AuditSection audit={audit} />}

      {canManage && <FeedbackSection />}

      <section className="agents-section" aria-labelledby="new-h">
        <h2 id="new-h">New token</h2>
        {canManage ? (
          created ? (
            <Created c={created} onClose={() => setCreated(null)} />
          ) : (
            <NewToken projects={projects} publicUrl={me.publicUrl} onCreated={(c) => (setCreated(c), load())} />
          )
        ) : (
          <p className="muted" aria-describedby="why-manage">
            Tokens are made on a page that may manage agents — see <a href="#why-manage">why this page cannot, and how to get the right</a>. From here you can approve agents that show you a code.
          </p>
        )}
      </section>
    </main>
  )
}

/**
 * What agents told the owner about Unprose itself (`unprose_feedback`), newest first. "File on GitHub" opens the
 * report dialog prefilled with the agent's words (and the tools it named) — never the board it happened on.
 */
function FeedbackSection() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof accessApi.feedback>>['feedback'] | null>(null)
  useEffect(() => {
    accessApi.feedback().then((r) => setItems(r.feedback.slice().reverse())).catch(() => setItems([]))
  }, [])
  return (
    <section className="agents-section" aria-labelledby="feedback-h">
      <h2 id="feedback-h">Feedback from agents</h2>
      <p className="muted">
        What agents found hard or missing in Unprose (they send it with <span className="mono">unprose_feedback</span>). Kept on this machine only; <em>File on GitHub</em> turns one into a public issue you check and submit.
      </p>
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="feedback-list">
          {items.slice(0, 50).map((f) => (
            <li key={f.id} className="feedback-item">
              <div className="feedback-meta">
                <span className="muted">
                  <strong>{f.by}</strong> · {timeAgo(f.at)}
                  {f.kind ? <> · {f.kind === 'bug' ? 'problem' : 'idea'}</> : null}
                  {f.board ? <> · board <span className="mono">{f.board}</span></> : null}
                  {f.about?.length ? <> · {f.about.join(', ')}</> : null}
                </span>
                <button type="button" className="ghost small feedback-file" aria-label={`File on GitHub: ${f.title || f.text.slice(0, 60)}`} onClick={() => openReport(feedbackDraft(f))}>
                  File on GitHub
                </button>
              </div>
              {f.title ? <div className="feedback-title">{f.title}</div> : null}
              <div>{f.text}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Why this page cannot make, change or revoke tokens, and the two ways to get the right: open it on the canvas
 * machine (or through an SSH tunnel to it), or ask for manage rights for this browser with a pairing code that a
 * page which already manages agents approves.
 */
function CannotManage({ why, publicUrl, onGranted }: { why: WhyNotManage; publicUrl: string; onGranted: () => void }) {
  const port = why.port ?? 4400
  const myName = useAccess().grant?.name ?? 'this browser'
  const local = `http://localhost:${port}/agents`
  const [ask, setAsk] = useState<{ id: string; code: string; expiresAt: string } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!ask) return
    let stop = false
    const tick = async () => {
      try {
        const r = await accessApi.pollManage(ask.id)
        if (stop) return
        if (r.status === 'approved') {
          setStatus('Allowed — this browser may manage agents now.')
          window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT))
          onGranted()
          return
        }
        if (r.status !== 'pending') {
          setStatus(r.locked ? 'Locked after too many wrong codes. Ask again.' : r.status === 'denied' ? 'Denied.' : 'The request expired. Ask again.')
          setAsk(null)
          return
        }
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(() => void tick(), 2000)
    }
    void tick()
    return () => {
      stop = true
    }
  }, [ask, onGranted])
  const request = async () => {
    setErr(null)
    setStatus(null)
    try {
      setAsk(await accessApi.requestManage())
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const reason =
    why.reason === 'remote' ? (
      <>
        You opened this page through <span className="mono">{publicUrl}</span>, not on the canvas machine, and this browser was not given the right to manage agents. You can approve agents that show you a code; making, changing and revoking tokens is kept to the canvas machine and the browsers it trusts, so someone who only reaches the tunnel cannot take over your agents.
      </>
    ) : why.reason === 'host' ? (
      <>
        This page runs on the canvas machine but was opened as <span className="mono">{location.host}</span>, not as localhost — managing agents needs the page opened as <span className="mono">{local}</span>.
      </>
    ) : why.reason === 'agent' ? (
      <>Agent tokens never manage agents.</>
    ) : (
      <>
        You opened this page from elsewhere without signing in this browser. Managing agents is kept to the canvas machine and the browsers it trusts.
      </>
    )
  return (
    <section className="manage-why" id="why-manage" aria-labelledby="why-manage-h">
      <h2 id="why-manage-h">Why can’t I change or revoke agents here?</h2>
      <p>{reason}</p>
      {why.reason !== 'agent' && (
        <>
          <p>To manage agents, either:</p>
          <ol>
            <li>
              <strong>Open it on the canvas machine</strong>: <span className="mono">{local}</span>
              {why.reason !== 'host' && (
                <>
                  {' '}
                  — or from your computer, forward the canvas port and open that address here: <code className="mono">ssh -L {port}:localhost:{port} &lt;canvas host&gt;</code>
                </>
              )}
            </li>
            {why.canRequest && (
              <li>
                <strong>Ask for manage rights for this browser</strong>: a page that already manages agents (or the canvas machine) approves it by typing a code.{' '}
                {!ask && (
                  <button type="button" className="small" onClick={() => void request()}>
                    Request manage rights
                  </button>
                )}
                {ask && (
                  <div className="manage-ask" role="status">
                    <div className="code-show mono" aria-label="Pairing code for manage rights">
                      {ask.code}
                    </div>
                    <p className="muted">
                      Open <strong>Connected agents</strong> on the canvas machine (<span className="mono">{local}</span>) or in a browser that already manages agents: the request “<strong>{myName} asks to manage agents</strong>” is there — type this code to allow it. It works once and expires in 10 minutes. Waiting…
                    </p>
                  </div>
                )}
              </li>
            )}
          </ol>
        </>
      )}
      {status && <p className={status.startsWith('Allowed') ? 'access-ok' : 'access-error'}>{status}</p>}
      {err && (
        <p className="access-error" role="alert">
          {err}
        </p>
      )}
    </section>
  )
}

/** The last changes to access: tokens made, access changed, revoked, manage rights given. */
function AuditSection({ audit }: { audit: AuditEntry[] }) {
  return (
    <section className="agents-section" aria-labelledby="audit-h">
      <h2 id="audit-h">Access log</h2>
      <ul className="feedback-list audit-list">
        {audit.slice(0, 20).map((l, i) => (
          <li key={`${l.at}-${i}`}>
            <span className="muted">{timeAgo(l.at)} · </span>
            <strong>{l.by}</strong> {l.what}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Change an agent's access and its project / board limits in place. */
function AccessEditor({ a, projects, onDone, onCancel }: { a: AgentView; projects: ProjectSummary[]; onDone: () => void; onCancel: () => void }) {
  const [scope, setScope] = useState<'read' | 'write'>(a.scope)
  const [picked, setPicked] = useState<string[]>(a.projects ?? [])
  const [boards, setBoards] = useState((a.boards ?? []).join(' '))
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await accessApi.updateAccess(a.id, { scope, projects: picked, boards: boards.split(/[\s,]+/).filter(Boolean) })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // projects it is limited to that this page does not list (another machine's) stay selectable
  const all = [...projects.map((p) => ({ id: p.id, name: p.name })), ...(a.projects ?? []).filter((id) => !projects.some((p) => p.id === id)).map((id) => ({ id, name: id }))]
  return (
    <form
      className="access-editor"
      aria-label={`Access of ${a.name}`}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <fieldset className="access-fieldset">
        <legend>Access</legend>
        <label>
          <input type="radio" name={`scope-${a.id}`} checked={scope === 'write'} onChange={() => setScope('write')} /> Read and draw
        </label>
        <label>
          <input type="radio" name={`scope-${a.id}`} checked={scope === 'read'} onChange={() => setScope('read')} /> Read only
        </label>
      </fieldset>
      {all.length > 0 && (
        <fieldset className="access-fieldset">
          <legend>Projects (none ticked = all)</legend>
          {all.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} /> {p.name}
            </label>
          ))}
        </fieldset>
      )}
      <label className="access-field">
        <span>Only these boards (ids, empty = all)</span>
        <input className="mono" value={boards} onChange={(e) => setBoards(e.target.value)} placeholder="b_… b_…" />
      </label>
      <p className="muted">Takes effect on its next request; the change is written to the access log.</p>
      {err && (
        <p className="access-error" role="alert">
          {err}
        </p>
      )}
      <div className="access-card-actions">
        <button type="submit" className="primary small" disabled={busy}>
          Save access
        </button>
        <button type="button" className="small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function AgentRow({ a, canManage, projects, onChange }: { a: AgentView; canManage: boolean; projects: ProjectSummary[]; onChange: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(a.name)
  const rename = async () => {
    const n = name.trim()
    if (!n || n === a.name) return setRenaming(false)
    try {
      await accessApi.rename(a.id, n)
      setRenaming(false)
      onChange()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const act = async (forget: boolean) => {
    if (!forget && !confirm(`Revoke ${a.name}? It loses access at once.`)) return
    try {
      await accessApi.revoke(a.id, forget)
      onChange()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const limits = [a.projects?.length ? `projects: ${a.projects.join(', ')}` : '', a.boards?.length ? `boards: ${a.boards.join(', ')}` : ''].filter(Boolean).join('; ')
  const off = !canManage && !a.revokedAt
  return (
    <>
    <tr className={a.revokedAt ? 'revoked' : undefined}>
      <td>
        {renaming ? (
          <form
            className="agent-rename"
            onSubmit={(e) => {
              e.preventDefault()
              void rename()
            }}
          >
            <label className="visually-hidden" htmlFor={`rename-${a.id}`}>
              New name for {a.name}
            </label>
            <input id={`rename-${a.id}`} value={name} autoFocus maxLength={60} placeholder="codex-b" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)} />
            <button type="submit" className="small primary">
              Save
            </button>
          </form>
        ) : (
          <>
            <strong>{a.name}</strong>
            {a.via !== 'browser' && <span className="mention-chip agent-handle" title="Mention it in a comment with this handle">@{a.handle ?? handleOf(a.name)}</span>}
            {canManage && !a.revokedAt && (
              <button type="button" className="link agent-rename-btn" onClick={() => (setName(a.name), setRenaming(true))} aria-label={`Rename ${a.name}`}>
                Rename
              </button>
            )}
          </>
        )}
        {a.revokedAt && <span className="badge-revoked"> revoked {timeAgo(a.revokedAt)}</span>}
        {a.manage && <span className="muted"> · manages agents</span>}
      </td>
      <td>
        {HOW[a.via]}
        {a.clientName && a.clientName !== a.name ? <span className="muted"> ({a.clientName})</span> : null}
      </td>
      <td>
        {a.scope === 'write' ? 'Read and draw' : 'Read only'}
        <br />
        <span className="muted">{limits || 'all projects'}</span>
        {canManage && !a.revokedAt && !editing && (
          <>
            <br />
            <button type="button" className="link" onClick={() => setEditing(true)} aria-label={`Change access of ${a.name}`}>
              Change access
            </button>
          </>
        )}
      </td>
      <td>
        {timeAgo(a.createdAt)}
        <br />
        <span className="muted">by {a.createdBy}</span>
      </td>
      <td>
        {a.lastUsedAt ? (
          <>
            {timeAgo(a.lastUsedAt)}
            <br />
            <span className="muted">
              {a.lastIp ? <span className="mono">{a.lastIp}</span> : null}
              {a.lastUserAgent ? ` · ${shortUa(a.lastUserAgent)}` : ''}
            </span>
          </>
        ) : (
          <span className="muted">never</span>
        )}
      </td>
      <td className="actions">
        {canManage &&
          (a.revokedAt ? (
            <button type="button" className="ghost small" onClick={() => void act(true)} aria-label={`Forget ${a.name}`}>
              Forget
            </button>
          ) : (
            <button type="button" className="small danger" onClick={() => void act(false)} aria-label={`Revoke ${a.name}`}>
              Revoke
            </button>
          ))}
        {off && (
          <span className="actions-off">
            <button type="button" className="small" disabled aria-describedby="why-manage" title="This page may not manage agents — see “Why can’t I change or revoke agents here?” above">
              Change access
            </button>
            <button type="button" className="small" disabled aria-describedby="why-manage" title="This page may not manage agents — see “Why can’t I change or revoke agents here?” above">
              Revoke
            </button>
            <a className="why-link" href="#why-manage">
              Why?
            </a>
          </span>
        )}
        {err && (
          <span className="access-error" role="alert">
            {err}
          </span>
        )}
      </td>
    </tr>
    {editing && (
      <tr className="access-edit-row">
        <td colSpan={6}>
          <AccessEditor a={a} projects={projects} onCancel={() => setEditing(false)} onDone={() => (setEditing(false), onChange())} />
        </td>
      </tr>
    )}
    </>
  )
}

function EnterCode({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('write')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await accessApi.approveCode(code, scope)
      setMsg({ ok: true, text: 'Approved — it is connecting now.' })
      setCode('')
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="enter-code"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h3>Enter a code</h3>
      <p className="muted">For an agent that shows you a code: its OAuth page, a terminal agent, or a browser asking to sign in.</p>
      <div className="access-card-row">
        <label className="access-field">
          <span>Code</span>
          <input className="code-input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" maxLength={11} autoComplete="off" spellCheck={false} />
        </label>
        <label className="access-field">
          <span>Access</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')}>
            <option value="write">Read and draw</option>
            <option value="read">Read only</option>
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy || code.replace(/[\s-]/g, '').length !== 8}>
          Approve
        </button>
      </div>
      {msg && (
        <p className={msg.ok ? 'access-ok' : 'access-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </form>
  )
}

function NewToken({ projects, publicUrl, onCreated }: { projects: ProjectSummary[]; publicUrl: string; onCreated: (c: { agent: AgentView; token: string; setup: Setup }) => void }) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('write')
  const [picked, setPicked] = useState<string[]>([])
  const [boards, setBoards] = useState('')
  const [url, setUrl] = useState(publicUrl)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const b = boards.split(/[\s,]+/).filter(Boolean)
      onCreated(await accessApi.create({ name: name.trim() || 'agent', scope, ...(picked.length ? { projects: picked } : {}), ...(b.length ? { boards: b } : {}), publicUrl: url.trim() || undefined }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="new-token"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="access-field">
        <span>Name (shown on every change it makes)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="codex-laptop" maxLength={60} />
      </label>
      <fieldset className="access-fieldset">
        <legend>Access</legend>
        <label>
          <input type="radio" name="scope" checked={scope === 'write'} onChange={() => setScope('write')} /> Read and draw
        </label>
        <label>
          <input type="radio" name="scope" checked={scope === 'read'} onChange={() => setScope('read')} /> Read only
        </label>
      </fieldset>
      {projects.length > 0 && (
        <fieldset className="access-fieldset">
          <legend>Projects (none ticked = all)</legend>
          {projects.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} /> {p.name}{' '}
              <span className="muted">({p.boards})</span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="access-field">
        <span>Only these boards (ids, optional)</span>
        <input className="mono" value={boards} onChange={(e) => setBoards(e.target.value)} placeholder="b_… b_…" />
      </label>
      <label className="access-field">
        <span>Canvas address agents use</span>
        <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://canvas.example.com" />
      </label>
      {err && (
        <p className="access-error" role="alert">
          {err}
        </p>
      )}
      <div>
        <button type="submit" className="primary" disabled={busy}>
          Make token
        </button>
      </div>
    </form>
  )
}

function Copyable({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copyable">
      <div className="copyable-head">
        <span>{label}</span>
        <button
          type="button"
          className="small"
          aria-label={`Copy ${label}`}
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mono">{text}</pre>
    </div>
  )
}

function Created({ c, onClose }: { c: { agent: AgentView; token: string; setup: Setup }; onClose: () => void }) {
  return (
    <div className="created">
      <p className="created-warn" role="status">
        <strong>Token for {c.agent.name}.</strong> Copy it now — it is not shown again (only its fingerprint is kept).
      </p>
      <Copyable label="Token" text={c.token} />
      <Copyable label="Claude Code" text={c.setup.claudeCode} />
      <Copyable label="Codex (~/.codex/config.toml)" text={c.setup.codex} />
      <Copyable label="claude.ai connector (OAuth, no token)" text={c.setup.claudeAi} />
      <Copyable label="Any agent, stdio MCP server" text={c.setup.stdio} />
      <Copyable label="MCP JSON config" text={c.setup.json} />
      <button type="button" onClick={onClose}>
        Done
      </button>
    </div>
  )
}
