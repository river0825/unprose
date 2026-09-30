// The running version in the rail's bottom-left corner, and the release notes (CHANGELOG.md) behind it.
// A dot on the button means there is a version this viewer has not opened yet (remembered per viewer), or a
// newer release that can be installed (docs/canvas.md "Updating") — then the dialog offers Upgrade.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Markdown } from '../inspector/Markdown'
import './release-notes.css'

interface Release {
  version: string | null
  changelog: string | null
}

/** GET /api/update (docs/canvas.md "Updating"). */
export interface UpdateInfo {
  current: string | null
  latest?: string
  available: boolean
  notes?: string
  url?: string
  error?: string
  install: 'plugin' | 'checkout' | 'bundle' | 'unknown'
  supported: boolean
  canUpgrade: boolean
  reason?: string
  command: string
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

/** The update check, on load and every six hours. */
export function useUpdate(): [UpdateInfo | null, () => void] {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const load = useCallback((refresh = false) => {
    fetch(`/api/update${refresh ? '?refresh=1' : ''}`)
      .then((r) => (r.ok ? (r.json() as Promise<UpdateInfo>) : null))
      .then((j) => j && setInfo(j))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    load()
    const t = window.setInterval(() => load(), SIX_HOURS)
    return () => window.clearInterval(t)
  }, [load])
  return [info, () => load(true)]
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
  const [update, refresh] = useUpdate()
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
      {open && <ReleaseNotes version={version} changelog={release?.changelog ?? null} update={update} onRefresh={refresh} onClose={() => setOpen(false)} />}
    </>
  )
}

/** "v0.5.0 is available": its notes, and Upgrade (or why not, with the command to run by hand). */
function UpdateBanner({ update, onRefresh }: { update: UpdateInfo; onRefresh: () => void }) {
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
        <button type="button" className="ghost small" onClick={onRefresh} disabled={busy}>
          Check again
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

export function ReleaseNotes({ version, changelog, update, onRefresh, onClose }: { version: string; changelog: string | null; update?: UpdateInfo | null; onRefresh?: () => void; onClose: () => void }) {
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
          {update?.available && <UpdateBanner update={update} onRefresh={onRefresh ?? (() => undefined)} />}
          {update && !update.available && update.error && <p className="muted update-check-error">Could not check for a newer version: {update.error}</p>}
          {changelog ? <Markdown text={notesForReading(changelog)} /> : <p className="muted">No release notes were found next to this server (CHANGELOG.md).</p>}
        </div>
      </div>
    </div>
  )
}
