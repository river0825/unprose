// The running version in the rail's bottom-left corner, and the release notes (CHANGELOG.md) behind it.
// A dot on the button means there is a version this viewer has not opened yet (remembered per viewer), or a
// newer release that can be installed (docs/canvas.md "Updating") — then the dialog offers Upgrade.
// "Check for updates" in the dialog asks the server to check again now (throttled to one check per 30 s there).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Markdown } from '../inspector/Markdown'
import { checkSummary, type UpdateInfo } from './updateCheck'
import { ReportEntry } from './ReportIssue'
import './release-notes.css'

export type { UpdateInfo } from './updateCheck'

interface Release {
  version: string | null
  changelog: string | null
}

interface UpdateStatus {
  running: boolean
  phase?: 'checking' | 'installing' | 'building' | 'restarting' | 'done' | 'failed'
  message?: string
  version?: string
  log: string[]
}

const SIX_HOURS = 6 * 60 * 60 * 1000
const UPGRADED_KEY = 'awd.upgradingTo'
const remember = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* private window */
  }
}
const recall = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

export interface UpdateState {
  info: UpdateInfo | null
  /** A "Check for updates" is in flight. */
  checking: boolean
  /** The canvas itself did not answer that check. */
  failed: string | null
  /** Check now, past the server's six-hour cache. */
  refresh: () => void
}

/** The update check, on load and every six hours; `refresh` checks now. */
export function useUpdate(): UpdateState {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const load = useCallback((refresh = false) => {
    if (refresh) {
      setChecking(true)
      setFailed(null)
    }
    const started = Date.now()
    fetch(`/api/update${refresh ? '?refresh=1' : ''}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`)
        return r.json() as Promise<UpdateInfo>
      })
      .then((j) => setInfo(j))
      .catch((e: Error) => refresh && setFailed(e.message))
      .finally(async () => {
        if (!refresh) return
        // keep "Checking…" up long enough to be read, even when the answer is the cached one
        const left = 400 - (Date.now() - started)
        if (left > 0) await new Promise((r) => setTimeout(r, left))
        setChecking(false)
      })
  }, [])
  useEffect(() => {
    load()
    const t = window.setInterval(() => load(), SIX_HOURS)
    return () => window.clearInterval(t)
  }, [load])
  const refresh = useCallback(() => load(true), [load])
  return { info, checking, failed, refresh }
}

const SEEN_KEY = 'awd.seenVersion'
const seenVersion = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}
const markSeen = (v: string) => {
  try {
    localStorage.setItem(SEEN_KEY, v)
  } catch {
    /* private window: the dot just comes back */
  }
}

/**
 * CHANGELOG.md for reading: drop the title and preamble (the dialog has its own heading), empty sections
 * (a fresh "## [Unreleased]") and the link definitions at the bottom; "## [0.2.0] — date" → "## 0.2.0 — date".
 */
export function notesForReading(changelog: string): string {
  const lines = changelog.split('\n').filter((l) => !/^\[[^\]]+\]:\s*\S+/.test(l))
  const first = lines.findIndex((l) => l.startsWith('## '))
  if (first < 0) return lines.join('\n').trim()
  const sections: string[][] = []
  for (const l of lines.slice(first)) {
    if (l.startsWith('## ')) sections.push([l.replace(/^## \[([^\]]+)\]/, '## $1')])
    else sections[sections.length - 1].push(l)
  }
  return sections
    .filter((s) => s.slice(1).some((l) => l.trim()))
    .map((s) => s.join('\n').trim())
    .join('\n\n')
}

export function VersionButton({ onToast }: { onToast?: (text: string) => void } = {}) {
  const [release, setRelease] = useState<Release | null>(null)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(seenVersion)
  const upd = useUpdate()
  const update = upd.info
  // the latest callback without re-running the fetch on every render (callers pass an inline function)
  const toastRef = useRef(onToast)
  toastRef.current = onToast
  useEffect(() => {
    let off = false
    fetch('/api/version')
      .then((r) => (r.ok ? (r.json() as Promise<Release>) : null))
      .then((j) => {
        if (off || !j) return
        setRelease(j)
        // back after an upgrade this viewer started: say so once
        const to = recall(UPGRADED_KEY)
        if (to && j.version === to) {
          remember(UPGRADED_KEY, null)
          toastRef.current?.(`Upgraded to v${to}`)
        }
      })
      .catch(() => undefined)
    return () => {
      off = true
    }
  }, [])
  const version = release?.version
  if (!version) return null
  const isNew = seen !== version
  const upgradable = !!update?.available
  const label = `Version ${version}${upgradable ? `, v${update?.latest} is available` : isNew ? ', new release notes' : ''}. Show release notes`
  return (
    <>
      <button
        type="button"
        className={`rail-btn version-btn${upgradable ? ' has-update' : ''}`}
        aria-label={label}
        data-tip={upgradable ? `v${update?.latest} available` : 'Release notes'}
        onClick={() => {
          setOpen(true)
          markSeen(version)
          setSeen(version)
        }}
      >
        <span className="version-text">v{version}</span>
        {upgradable && <span className="version-update">update</span>}
        {(isNew || upgradable) && <span className={`version-dot${upgradable ? ' update' : ''}`} aria-hidden="true" />}
      </button>
      {open && <ReleaseNotes version={version} changelog={release?.changelog ?? null} check={upd} onClose={() => setOpen(false)} />}
    </>
  )
}

/** "v0.5.0 is available": its notes, and Upgrade (or why not, with the command to run by hand). */
function UpdateBanner({ update }: { update: UpdateInfo }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const busy = !!status?.running || restarting
  // while an upgrade runs: follow its progress; once the server goes away, wait for the new one and reload
  useEffect(() => {
    if (!busy) return
    let stop = false
    const tick = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 1000))
        try {
          if (restarting) {
            const v = (await (await fetch('/api/version')).json()) as Release
            if (v.version && v.version !== update.current) {
              window.location.reload()
              return
            }
            continue
          }
          const st = (await (await fetch('/api/update/status')).json()) as UpdateStatus
          setStatus(st)
          if (st.phase === 'restarting') setRestarting(true)
          if (!st.running && st.phase === 'failed') {
            setError(st.message ?? 'the upgrade failed')
            remember(UPGRADED_KEY, null)
            return
          }
        } catch {
          setRestarting(true) // the old server is gone: the new one is starting
        }
      }
    }
    void tick()
    return () => {
      stop = true
    }
  }, [busy, restarting, update.current])

  const upgrade = async () => {
    setError(null)
    try {
      const r = await fetch('/api/update', { method: 'POST' })
      const j = (await r.json()) as { started?: boolean; error?: string; version?: string }
      if (!r.ok || !j.started) return setError(j.error ?? `HTTP ${r.status}`)
      remember(UPGRADED_KEY, j.version ?? update.latest ?? null)
      setStatus({ running: true, phase: 'checking', message: `upgrading to v${j.version}`, log: [] })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const copy = () => void navigator.clipboard?.writeText(update.command).catch(() => undefined)
  const phaseText = restarting ? 'Restarting on the new version — this page reloads by itself…' : status?.message
  return (
    <section className="update-banner" aria-label={`Version ${update.latest} is available`}>
      <div className="update-head">
        <strong>v{update.latest} is available</strong>
        <span className="muted"> — you have v{update.current}</span>
        {update.url && (
          <a className="update-link" href={update.url} target="_blank" rel="noreferrer">
            on GitHub
          </a>
        )}
      </div>
      {update.notes && (
        <details className="update-notes" open>
          <summary>What's new</summary>
          <Markdown text={update.notes} />
        </details>
      )}
      <div className="update-actions">
        <button type="button" className="primary" disabled={!update.canUpgrade || busy} onClick={() => void upgrade()} aria-describedby={!update.canUpgrade ? 'update-why' : undefined}>
          {busy ? 'Upgrading…' : `Upgrade to v${update.latest}`}
        </button>
      </div>
      {!update.canUpgrade && (
        <p id="update-why" className="update-why">
          {update.reason ?? 'This canvas cannot upgrade itself.'} Run it by hand: <code>{update.command}</code>{' '}
          <button type="button" className="link" onClick={copy}>
            copy
          </button>
        </p>
      )}
      {busy && phaseText && (
        <p className="update-progress" role="status" aria-live="polite">
          {phaseText}
        </p>
      )}
      {error && (
        <p className="update-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

/** "Check for updates", what the last check said and when, and whether this canvas follows `claude plugin update`. */
function UpdateCheckRow({ check }: { check: UpdateState }) {
  // "checked 2 min ago" keeps up while the dialog is open
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => setNow(Date.now()), [check.info, check.checking])
  const s = checkSummary(check.info, check.checking, check.failed, now)
  return (
    <section className="update-check" aria-label="Updates">
      <div className="update-check-row">
        <button type="button" className="ghost small update-check-btn" onClick={check.refresh} disabled={check.checking}>
          {check.checking ? 'Checking…' : 'Check for updates'}
        </button>
        <p className={`update-check-text tone-${s.tone}`} role="status" aria-live="polite">
          {s.tone !== 'checking' && s.text}
          {s.lastChecked && s.tone !== 'latest' && <span className="muted update-check-when">{s.text ? ' · ' : ''}{s.lastChecked}</span>}
        </p>
      </div>
      {check.info?.followsPluginUpdate && (
        <p className="muted update-check-follow">
          This canvas restarts by itself after <code>claude plugin update</code>.
        </p>
      )}
    </section>
  )
}

export function ReleaseNotes({ version, changelog, check, onClose }: { version: string; changelog: string | null; check?: UpdateState; onClose: () => void }) {
  const update = check?.info
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      // keep Tab inside the dialog
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')]
        if (!f.length) return
        const [a, z] = [f[0], f[f.length - 1]]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          z.focus()
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus()
    }
  }, [onClose])
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="sheet release-notes" role="dialog" aria-modal="true" aria-labelledby="release-title">
        <div className="sheet-head">
          <h2 id="release-title">
            Release notes <span className="release-version">v{version}</span>
          </h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sheet-body release-body" tabIndex={0}>
          {check && <UpdateCheckRow check={check} />}
          {update?.available && <UpdateBanner update={update} />}
          {changelog ? <Markdown text={notesForReading(changelog)} /> : <p className="muted">No release notes were found next to this server (CHANGELOG.md).</p>}
        </div>
        <div className="sheet-foot">
          <ReportEntry before={onClose} />
        </div>
      </div>
    </div>
  )
}
