// "Check for updates" in the release-notes dialog (docs/canvas.md "Updating"): what the person reads after a
// check — pure, so it is tested without a browser (test/updateCheck.test.ts).

/** GET /api/update (docs/canvas.md "Updating"). */
export interface UpdateInfo {
  current: string | null
  latest?: string
  available: boolean
  notes?: string
  url?: string
  error?: string
  checkedAt?: string
  install: 'plugin' | 'checkout' | 'bundle' | 'unknown'
  supported: boolean
  canUpgrade: boolean
  reason?: string
  command: string
  /** A refresh within 30 s of the previous check: that check's result. */
  throttled?: boolean
  /** This canvas restarts by itself after `claude plugin update`. */
  followsPluginUpdate?: boolean
}

export type CheckTone = 'checking' | 'latest' | 'available' | 'error' | 'unknown'

export interface CheckSummary {
  tone: CheckTone
  /** One sentence; empty when the "is available" banner says it. */
  text: string
  /** "last checked 3 min ago", when the check has a time. */
  lastChecked?: string
}

/** "just now", "a minute ago", "5 min ago", "2 h ago", "3 days ago". */
export function timeAgo(iso: string | undefined, now: number): string | undefined {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return undefined
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  if (s < 90) return 'a minute ago'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** The server's reason a check failed, in plain words, with how to fix it when there is a fix. */
export function plainError(error: string): string {
  if (/private repository/i.test(error))
    return "Couldn't check: the release repository is private. Set GITHUB_TOKEN (or GH_TOKEN) in the canvas's environment, or run gh auth login, then restart the canvas."
  if (/checks are off/i.test(error)) return 'Update checks are off on this canvas (UNPROSE_UPDATE_CHECK=0).'
  if (/not set up/i.test(error)) return 'This server does not check for updates.'
  const inner = /^cannot check for updates \((.*)\)$/s.exec(error)?.[1] ?? error
  const limit = /HTTP (403|429)/.test(inner) ? ' — GitHub may be rate-limiting this address; setting GITHUB_TOKEN raises the limit' : ''
  return `Couldn't reach GitHub: ${inner}${limit}.`
}

/** What the dialog says about the newest check (or the one in flight). */
export function checkSummary(info: UpdateInfo | null, checking: boolean, failed: string | null, now: number): CheckSummary {
  const lastChecked = info ? timeAgo(info.checkedAt, now) : undefined
  const last = lastChecked ? { lastChecked: `last checked ${lastChecked}` } : {}
  if (checking) return { tone: 'checking', text: 'Checking…', ...last }
  if (failed) return { tone: 'error', text: `Couldn't reach this canvas: ${failed}.`, ...last }
  if (!info) return { tone: 'unknown', text: '' }
  if (info.available) return { tone: 'available', text: '', ...last }
  if (info.error) return { tone: 'error', text: plainError(info.error), ...last }
  if (!info.latest) return { tone: 'unknown', text: 'No release was found.', ...last }
  return { tone: 'latest', text: `You're on the latest version (v${info.current}${lastChecked ? `, checked ${lastChecked}` : ''}).`, ...last }
}
