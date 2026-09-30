// UpdateSource adapter: the latest GitHub release of the Unprose repo. Tries, in order, the public API, a
// token from the environment (GITHUB_TOKEN / GH_TOKEN — for a private repo), and the `gh` CLI if it is on
// PATH (its own login). The first answer wins; otherwise one readable error.
import { execFile } from 'node:child_process'
import type { ReleaseInfo, UpdateSource } from '../../ports/update.js'

export interface GitHubSourceOptions {
  repo: string
  env?: Record<string, string | undefined>
  /** Injected for tests. */
  fetch?: typeof fetch
  /** `gh api <path>` → JSON text; injected for tests, default runs the gh CLI. */
  gh?: (path: string) => Promise<string>
  timeoutMs?: number
}

interface GitHubRelease {
  tag_name?: string
  body?: string | null
  html_url?: string
  draft?: boolean
  prerelease?: boolean
}

const runGh = (p: string) =>
  new Promise<string>((resolve, reject) =>
    execFile('gh', ['api', p], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout))),
  )

export function releaseFrom(j: GitHubRelease, source: string): ReleaseInfo {
  if (!j.tag_name) throw new Error('the release has no tag')
  return { version: j.tag_name.replace(/^v/, ''), notes: j.body ?? undefined, url: j.html_url, source }
}

export class GitHubReleaseSource implements UpdateSource {
  constructor(private o: GitHubSourceOptions) {}

  async latest(): Promise<ReleaseInfo> {
    const env = this.o.env ?? process.env
    const f = this.o.fetch ?? fetch
    const url = `https://api.github.com/repos/${this.o.repo}/releases/latest`
    const tries: string[] = []
    let notFound = false
    const get = async (headers: Record<string, string>, source: string) => {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 10_000)
      try {
        const r = await f(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'unprose-canvas', ...headers }, signal: ctl.signal })
        if (r.ok) return releaseFrom((await r.json()) as GitHubRelease, source)
        if (r.status === 404) notFound = true
        tries.push(`${source}: HTTP ${r.status}`)
      } catch (e) {
        tries.push(`${source}: ${(e as Error).message}`)
      } finally {
        clearTimeout(timer)
      }
      return undefined
    }
    const pub = await get({}, 'github')
    if (pub) return pub
    const token = env.GITHUB_TOKEN || env.GH_TOKEN
    if (token) {
      const r = await get({ authorization: `Bearer ${token}` }, 'github (token)')
      if (r) return r
    }
    try {
      return releaseFrom(JSON.parse(await (this.o.gh ?? runGh)(`repos/${this.o.repo}/releases/latest`)) as GitHubRelease, 'gh')
    } catch (e) {
      tries.push(`gh: ${(e as Error).message.split('\n')[0]}`)
    }
    if (notFound && !token) throw new Error('cannot check (private repository): set GITHUB_TOKEN or log in with gh')
    throw new Error(`cannot check for updates (${tries.join('; ')})`)
  }
}
