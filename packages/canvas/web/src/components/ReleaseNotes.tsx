// The running version in the rail's bottom-left corner, and the release notes (CHANGELOG.md) behind it.
// A dot on the button means there is a version this viewer has not opened yet (remembered per viewer).
import { useEffect, useRef, useState } from 'react'
import { Markdown } from '../inspector/Markdown'
import './release-notes.css'

interface Release {
  version: string | null
  changelog: string | null
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

export function VersionButton() {
  const [release, setRelease] = useState<Release | null>(null)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(seenVersion)
  useEffect(() => {
    let off = false
    fetch('/api/version')
      .then((r) => (r.ok ? (r.json() as Promise<Release>) : null))
      .then((j) => !off && j && setRelease(j))
      .catch(() => undefined)
    return () => {
      off = true
    }
  }, [])
  const version = release?.version
  if (!version) return null
  const isNew = seen !== version
  const label = `Version ${version}${isNew ? ', new release notes' : ''}. Show release notes`
  return (
    <>
      <button
        type="button"
        className="rail-btn version-btn"
        aria-label={label}
        data-tip="Release notes"
        onClick={() => {
          setOpen(true)
          markSeen(version)
          setSeen(version)
        }}
      >
        <span className="version-text">v{version}</span>
        {isNew && <span className="version-dot" aria-hidden="true" />}
      </button>
      {open && <ReleaseNotes version={version} changelog={release?.changelog ?? null} onClose={() => setOpen(false)} />}
    </>
  )
}

export function ReleaseNotes({ version, changelog, onClose }: { version: string; changelog: string | null; onClose: () => void }) {
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
          {changelog ? <Markdown text={notesForReading(changelog)} /> : <p className="muted">No release notes were found next to this server (CHANGELOG.md).</p>}
        </div>
      </div>
    </div>
  )
}
