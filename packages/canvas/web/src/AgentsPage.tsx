// Connected agents (docs/canvas.md "Remote agents"): the agents and browsers let in from elsewhere, the
// requests waiting, "Enter a code", and new access tokens (made only on a page on the canvas machine).
import { useCallback, useEffect, useState } from 'react'
import { ACCESS_CHANGED_EVENT, accessApi, shortUa, useAccess, type AccessRequestView, type AgentView, type Setup } from './access'
import { api, type ProjectSummary } from './api'
import { navigate } from './BoardPage'
import { timeAgo } from './time'
import { RequestCard } from './components/RequestCard'
import { usePendingRequests } from './components/AccessCenter'
import './access.css'

const HOW: Record<AgentView['via'], string> = { token: 'Token', oauth: 'OAuth', device: 'Device code', browser: 'Browser' }

export function AgentsPage() {
  const me = useAccess()
  const [agents, setAgents] = useState<AgentView[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [created, setCreated] = useState<{ agent: AgentView; token: string; setup: Setup } | null>(null)
  const live = usePendingRequests(me.canApprove)

  const load = useCallback(() => {
    accessApi
      .agents()
      .then((r) => {
        setAgents(r.agents)
        setCanManage(r.canManage)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
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
  const waiting = requests.filter((r) => !gone.has(r.id))

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
                  <AgentRow key={a.id} a={a} canManage={canManage} onChange={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="agents-section" aria-labelledby="new-h">
        <h2 id="new-h">New token</h2>
        {canManage ? (
          created ? (
            <Created c={created} onClose={() => setCreated(null)} />
          ) : (
            <NewToken projects={projects} publicUrl={me.publicUrl} onCreated={(c) => (setCreated(c), load())} />
          )
        ) : (
          <p className="muted">
            Tokens are made on a page opened on the canvas machine (<span className="mono">http://localhost…</span>). From here you can approve agents that show you a code.
          </p>
        )}
      </section>
    </main>
  )
}

function AgentRow({ a, canManage, onChange }: { a: AgentView; canManage: boolean; onChange: () => void }) {
  const [err, setErr] = useState<string | null>(null)
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
  return (
    <tr className={a.revokedAt ? 'revoked' : undefined}>
      <td>
        <strong>{a.name}</strong>
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
        {err && (
          <span className="access-error" role="alert">
            {err}
          </span>
        )}
      </td>
    </tr>
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
