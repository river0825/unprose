// Problems and ideas become GitHub issues that the person files (docs/canvas.md "Feedback about Unprose"): a link to
// the repository's "new issue" page that picks an issue form (.github/ISSUE_TEMPLATE) and fills its fields from the
// query (GitHub fills a form field from the query parameter named by the field's id). Unprose never posts: the
// person reads the issue on GitHub and submits it under their own account. Pure: the server (unprose_feedback's
// answer) and the web page (the "Report a problem" dialog, Connected agents → File on GitHub) build the same link.

export type IssueKind = 'bug' | 'idea'

/** Where problems and ideas go when neither UNPROSE_ISSUES_REPO nor UNPROSE_UPDATE_REPO says otherwise. */
export const DEFAULT_ISSUES_REPO = 'river0825/unprose'

/** The issue forms and their field ids — test/issueLink.test.ts checks every id against the YAML files. */
export const ISSUE_FORMS = {
  bug: { template: 'bug_report.yml', text: 'what-happened', fields: ['what-happened', 'expected', 'steps', 'where', 'version'] },
  idea: { template: 'feature_request.yml', text: 'problem', fields: ['problem', 'idea', 'version'] },
} as const satisfies Record<IssueKind, { template: string; text: string; fields: readonly string[] }>

/** The options of the bug form's "Where" dropdown, exactly as the YAML lists them. */
export const ISSUE_WHERE = ['Canvas page', 'awd CLI', 'Local MCP', 'Remote /mcp', 'Claude Code plugin', 'Other'] as const
export type IssueWhere = (typeof ISSUE_WHERE)[number]

/** GitHub (and browsers) cope with longer URLs, but proxies and some servers stop near 8 KB. */
export const MAX_ISSUE_URL = 7000
const CUT = '… (cut)'
const MAX_TITLE = 200

export interface IssueDraft {
  kind: IssueKind
  title?: string
  /** The main text: what happened (a problem), or what is hard or missing and what would help (an idea). */
  text?: string
}

export interface IssueLinkInput extends IssueDraft {
  /** More fields of the form, by field id (`expected`, `steps`, `idea` …). */
  fields?: Record<string, string | undefined>
  /** The bug form's "Where" (an idea has no such field). */
  where?: IssueWhere
  version?: string | null
  /** `owner/name` (a github.com URL works too); anything else falls back to DEFAULT_ISSUES_REPO. */
  repo?: string
  max?: number
}

/** `owner/name` from `owner/name`, `https://github.com/owner/name(.git)`; undefined for anything else. */
export function repoName(raw: string | undefined): string | undefined {
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(raw?.trim() ?? '')
  return m?.[1]
}

/** UNPROSE_ISSUES_REPO, else the repository updates come from (UNPROSE_UPDATE_REPO), else DEFAULT_ISSUES_REPO. */
export function issuesRepo(env: Record<string, string | undefined>): string {
  return repoName(env.UNPROSE_ISSUES_REPO) ?? repoName(env.UNPROSE_UPDATE_REPO) ?? DEFAULT_ISSUES_REPO
}

const chars = (s: string) => [...s]
/** At most `n` characters, ending in "…" when cut — at a space when there is one in the second half. */
function clip(s: string, n: number): string {
  if (chars(s).length <= n) return s
  const head = chars(s).slice(0, n - 1).join('')
  const space = head.lastIndexOf(' ')
  return `${(space > n / 2 ? head.slice(0, space) : head).trimEnd()}…`
}

/** A title from the text when none was given: its first sentence (or line), at most 80 characters. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  // "." ends a sentence before a space ("v0.28.0" does not); "。" ends one wherever it is
  const sentence = /^(.+?(?:[.!?](?=\s|$)|[。！？]))/u.exec(line)?.[1] ?? line
  return clip(sentence.replace(/\s+/g, ' ').trim().replace(/[.。]$/u, ''), 80)
}

/** A record of unprose_feedback as an issue draft: its kind (an idea unless it says bug), title and text, and the tools it was about. */
export function feedbackDraft(f: { kind?: IssueKind; title?: string; text: string; about?: string[] }): Required<IssueDraft> {
  // tool names only: an item id names the board's content, which stays off a public issue
  const tools = (f.about ?? []).filter((a) => /^(?:canvas|design|unprose)_[a-z_]+$/.test(a))
  return { kind: f.kind ?? 'idea', title: f.title?.trim() || titleFrom(f.text), text: tools.length ? `${f.text}\n\nTools: ${tools.join(', ')}` : f.text }
}

// a lone surrogate (half an emoji, cut elsewhere) makes encodeURIComponent throw
const wellFormed = (s: string) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
const enc = (s: string) => encodeURIComponent(wellFormed(s))

/** The longest start of `s` whose encoded form fits in `room` characters (never splitting a character). */
function fit(s: string, room: number): string {
  const cs = chars(s)
  let [lo, hi] = [0, cs.length]
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (enc(cs.slice(0, mid).join('')).length <= room) lo = mid
    else hi = mid - 1
  }
  return cs.slice(0, lo).join('').trimEnd()
}

/**
 * The prefilled "new issue" link: `https://github.com/<repo>/issues/new?template=<form>&title=…&<field id>=…`. The
 * whole URL stays within `max` (MAX_ISSUE_URL) characters: the longest field is cut and ends in "… (cut)".
 */
export function issueUrl(input: IssueLinkInput): string {
  const form = ISSUE_FORMS[input.kind]
  const max = input.max ?? MAX_ISSUE_URL
  const tidy = (s: string | undefined) => (s ?? '').replace(/\r\n?/g, '\n').trim()
  const title = clip(tidy(input.title).replace(/\s+/g, ' ') || titleFrom(tidy(input.text)), MAX_TITLE)
  const fields: Array<[string, string]> = []
  const known = new Set<string>(form.fields)
  const add = (id: string, v: string | undefined) => {
    if (known.has(id) && tidy(v) && !fields.some(([k]) => k === id)) fields.push([id, tidy(v)])
  }
  add(form.text, input.text)
  for (const [id, v] of Object.entries(input.fields ?? {})) add(id, v)
  if (input.kind === 'bug' && input.where) add('where', input.where)
  if (input.version) add('version', input.version)
  const base = `https://github.com/${repoName(input.repo) ?? DEFAULT_ISSUES_REPO}/issues/new`
  const build = () => `${base}?template=${enc(form.template)}${title ? `&title=${enc(title)}` : ''}${fields.map(([k, v]) => `&${enc(k)}=${enc(v)}`).join('')}`
  const url = build()
  if (url.length <= max) return url
  // Too long: cut the longest field down — to the next longest if that is not enough, and so on (one level for all,
  // the largest that fits). Text fields only: the version and "Where" are short and must stay whole for GitHub.
  const cuttable = fields.filter(([k]) => k !== 'version' && k !== 'where')
  const lens = cuttable.map(([, v]) => enc(v).length)
  const fixed = url.length - lens.reduce((a, b) => a + b, 0)
  const total = (level: number) => fixed + lens.reduce((a, n) => a + Math.min(n, level), 0)
  let [lo, hi] = [0, Math.max(...lens, 0)]
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (total(mid) <= max) lo = mid
    else hi = mid - 1
  }
  cuttable.forEach((f, i) => {
    if (lens[i] <= lo) return
    const kept = lo > enc(CUT).length ? fit(f[1], lo - enc(CUT).length) : ''
    f[1] = kept ? `${kept}${CUT}` : ''
  })
  for (let i = fields.length - 1; i >= 0; i--) if (!fields[i][1]) fields.splice(i, 1)
  return build()
}
