// A page reached from elsewhere (a tunnel, the LAN) without a sign-in (docs/canvas.md "Remote agents"): ask to
// be let in with a one-time pairing code, or paste an access token made on the canvas machine.
import { useEffect, useState } from 'react'
import { accessApi } from '../access'
import '../access.css'

type Ask = { id: string; code: string; expiresAt: string; status: 'pending' | 'denied' | 'expired' | 'locked' }

export function SignIn() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'Sign in — Unprose canvas'
  }, [])

  useEffect(() => {
    if (!ask || ask.status !== 'pending') return
    let stop = false
    const tick = async () => {
      try {
        const r = await accessApi.pollSignIn(ask.id)
        if (stop) return
        if (r.status === 'approved') return void location.reload()
        if (r.status === 'denied') return setAsk({ ...ask, status: r.locked ? 'locked' : 'denied' })
        if (r.status === 'expired' || r.status === 'unknown') return setAsk({ ...ask, status: 'expired' })
      } catch {
        /* keep trying */
      }
      if (!stop) timer = setTimeout(tick, 1500)
    }
    let timer = setTimeout(tick, 1500)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [ask])

  const start = async () => {
    setError(null)
    setBusy(true)
    try {
      const r = await accessApi.startSignIn()
      setAsk({ ...r, status: 'pending' })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const useToken = async () => {
    setError(null)
    setBusy(true)
    try {
      await accessApi.session(token.trim())
      location.reload()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="signin-page">
      <div className="signin-card">
        <h1>Sign in to this canvas</h1>
        <p className="muted">You opened the canvas from another machine. Only the canvas's own machine is let in without signing in.</p>

        <section className="signin-section" aria-labelledby="signin-ask">
          <h2 id="signin-ask">Ask to be let in</h2>
          {!ask ? (
            <button type="button" className="primary" disabled={busy} onClick={() => void start()}>
              Ask to be let in
            </button>
          ) : ask.status === 'pending' ? (
            <>
              <div className="pair-code mono" aria-label={`Pairing code ${ask.code.split('').join(' ')}`}>
                {ask.code}
              </div>
              <p>
                Type this code on the canvas on its machine, or on a page that is already signed in (the notification, or <strong>Connected agents → Enter a code</strong>).
              </p>
              <p className="muted" role="status" aria-live="polite">
                Waiting for approval… the code works once and expires in 10 minutes.
              </p>
            </>
          ) : (
            <>
              <p className="access-error" role="alert">
                {ask.status === 'denied' ? 'The request was denied.' : ask.status === 'locked' ? 'Locked after too many wrong codes.' : 'The code expired.'}
              </p>
              <button type="button" className="primary" disabled={busy} onClick={() => void start()}>
                Ask again
              </button>
            </>
          )}
        </section>

        <section className="signin-section" aria-labelledby="signin-token">
          <h2 id="signin-token">Use an access token</h2>
          <p className="muted">Made on the canvas machine: Connected agents → New token.</p>
          <form
            className="signin-token"
            onSubmit={(e) => {
              e.preventDefault()
              if (token.trim()) void useToken()
            }}
          >
            <label className="visually-hidden" htmlFor="signin-token-input">
              Access token
            </label>
            <input id="signin-token-input" type="password" className="mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="unp_…" autoComplete="off" />
            <button type="submit" disabled={busy || !token.trim()}>
              Sign in
            </button>
          </form>
        </section>
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
