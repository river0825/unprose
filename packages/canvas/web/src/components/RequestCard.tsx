// One connect request: "<name> wants to connect". A page on this machine allows with one click; any other
// signed-in page types the pairing code the requester shows (docs/canvas.md "Remote agents").
import { useEffect, useId, useState } from 'react'
import { accessApi, shortUa, VIA_TEXT, type AccessRequestView } from '../access'

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const left = (until: string, now: number) => {
  const s = Math.max(0, Math.round((Date.parse(until) - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function RequestCard({ request, oneClick, onDone, onLater }: { request: AccessRequestView; oneClick: boolean; onDone?: (status: string) => void; onLater?: () => void }) {
  const now = useNow()
  const uid = useId()
  const [scope, setScope] = useState<'read' | 'write'>(request.scope)
  const [code, setCode] = useState('')
  const [manage, setManage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const expired = Date.parse(request.expiresAt) <= now

  const decide = async (allow: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const r = await accessApi.decide(request.id, { allow, scope, ...(oneClick ? {} : { code }), ...(oneClick && request.via === 'browser' && manage ? { manage: true } : {}) })
      onDone?.(r.status)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ua = shortUa(request.userAgent)
  const needCode = !oneClick
  const codeOk = code.replace(/[\s-]/g, '').length === 8
  return (
    <section className="access-card" role="alertdialog" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`}>
      <h3 id={`${uid}-t`} className="access-card-title">
        {request.name} wants to connect
      </h3>
      <p id={`${uid}-d`} className="access-card-meta">
        {VIA_TEXT[request.via]}
        {request.redirectHost ? <> · returns to <span className="mono">{request.redirectHost}</span></> : null}
        {request.ip ? <> · from <span className="mono">{request.ip}</span></> : null}
        {ua ? <> · {ua}</> : null}
        <br />
        {expired ? 'expired' : <>expires in <span className="mono">{left(request.expiresAt, now)}</span></>}
      </p>
      <div className="access-card-row">
        <label className="access-field">
          <span>Access</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')} disabled={busy}>
            <option value="write">Read and draw</option>
            <option value="read">Read only</option>
          </select>
        </label>
        {needCode && (
          <label className="access-field">
            <span>Code it shows</span>
            <input
              className="code-input mono"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-EFGH"
              maxLength={11}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Pairing code shown by ${request.name}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && codeOk) void decide(true)
              }}
            />
          </label>
        )}
      </div>
      {oneClick && request.via === 'browser' && (
        <label className="access-check">
          <input type="checkbox" checked={manage} onChange={(e) => setManage(e.target.checked)} /> may also manage agents and tokens
        </label>
      )}
      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
      <div className="access-card-actions">
        <button type="button" className="primary small" disabled={busy || expired || (needCode && !codeOk)} onClick={() => void decide(true)}>
          Allow
        </button>
        <button type="button" className="small" disabled={busy || expired} onClick={() => void decide(false)}>
          Deny
        </button>
        {onLater && (
          <button type="button" className="ghost small" onClick={onLater}>
            Later
          </button>
        )}
      </div>
    </section>
  )
}
