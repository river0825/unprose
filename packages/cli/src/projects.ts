// Boards belong to the project they come from (docs/canvas.md "Projects"): a design or workflow file's
// repo is registered on the canvas, and a board looked up by title is found — or created — there.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
// narrow imports (not the whole @awd/canvas, which brings the server): every `awd` command loads this file
import { canvasHeaders as sharedHeaders } from '@awd/canvas/dist/credentials.js'
import { ambiguityNote, pickBoardByTitle } from '@awd/canvas/dist/boardLookup.js'
import { canvasOrigin } from '@awd/canvas/dist/client.js'

export type Api = <T>(method: string, p: string, body?: unknown) => Promise<T>

/**
 * What every call to the canvas carries (one credential for every Unprose client, @awd/canvas credentials.ts):
 * `UNPROSE_TOKEN`, else the token a pairing code got for that canvas (`~/.awd/tokens.json`, `UNPROSE_TOKENS_FILE` —
 * the MCP server keeps it there), else `UNPROSE_AGENT_NAME` so a local canvas can sign this agent's changes with its
 * name; and the User-Agent `unprose/<version> (cli)` (Cloudflare refuses requests without one).
 */
export function canvasHeaders(env: NodeJS.ProcessEnv = process.env, base?: string): Record<string, string> {
  return sharedHeaders(base ?? env.AWD_CANVAS_URL ?? 'http://localhost:4400', 'cli', env)
}

/** The canvas address from `--canvas`, AWD_CANVAS_URL or the default; a board link works too. */
export function canvasBase(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = flag || env.AWD_CANVAS_URL || 'http://localhost:4400'
  try {
    return canvasOrigin(raw)
  } catch {
    return raw.replace(/\/+$/, '')
  }
}

/** A JSON client for the canvas API with this machine's credentials (see canvasHeaders). */
export function canvasApi(base: string): Api {
  return async <T,>(method: string, p: string, body?: unknown): Promise<T> => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...canvasHeaders(process.env, base) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) {
      let msg = text.slice(0, 300)
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? msg
      } catch {
        // a 403 page from a proxy in front of the canvas, not its JSON
        if (res.status === 403) msg = `not the canvas's answer — something in front of it (Cloudflare?) refused the request`
      }
      throw new Error(`${method} ${p} → ${res.status} ${msg}`)
    }
    return (text ? JSON.parse(text) : {}) as T
  }
}

/**
 * Where the files behind a drawing live (docs/canvas.md "Several agents on one board"): this machine's name, the
 * repo root and folder name, and its git remote (without credentials). The canvas stamps the agent's name and the
 * time, and shows machine and root only to pages on its own machine.
 */
export function holderInfo(root: string): { machine: string; root: string; repo: string; remote?: string } {
  let remote: string | undefined
  try {
    remote = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim() || undefined
  } catch {
    // not a git repo, or no remote
  }
  return { machine: os.hostname().replace(/\.local$/, ''), root, repo: path.basename(root), ...(remote ? { remote: remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1') } : {}) }
}
type Summary = { id: string; title: string; kind: string; project?: string; updatedAt?: string }

/** Register `root` as a project on the canvas; undefined when the canvas does not take it (remote, old server, memory store). */
export async function registerProject(api: Api, root: string): Promise<string | undefined> {
  try {
    return (await api<{ project: { id: string } }>('POST', '/api/projects', { root: path.resolve(root) })).project.id
  } catch {
    return undefined
  }
}

/**
 * The board titled `title` (of `kind`, when `sameKind`): in `project` first, then the personal space, then any board
 * this caller sees (boards made before projects, or by another machine, keep being used), else a new board created in
 * `project`. The canvas decides the last step itself (`reuse`), so two draws at once still share one board. Several
 * boards with the title: the most recently changed, and a warning on stderr.
 */
export async function boardByTitle(api: Api, title: string, kind: string, project: string | undefined, match: (b: Summary) => boolean = () => true, sameKind = false): Promise<Summary> {
  const { boards } = await api<{ boards: Summary[] }>('GET', '/api/boards')
  const found = pickBoardByTitle(boards, title, project, match)
  const note = ambiguityNote(title, found)
  if (note) console.warn(`⚠ ${note}`)
  if (found.board) return found.board
  // a board drawn from this agent's files suggests this agent as "Answered by" (a named one); the person confirms it
  const made = await api<{ board: Summary; reused?: boolean; ambiguous?: Summary[] }>('POST', '/api/boards', { title, kind, ...(project ? { project } : {}), answeredBy: 'me', reuse: sameKind ? 'title+kind' : 'title' })
  return made.board
}

/**
 * `awd projects remove <dir | id> [--force] [--canvas URL]` — forget a project on the canvas (its directory and files
 * stay). Refused while it still stores boards, unless --force: then they move to the personal space first.
 * `awd projects list` — the projects and their board counts. Both run on the canvas's machine (like registering).
 */
export async function cmdProjects(args: string[], flags: Record<string, string | boolean>): Promise<boolean> {
  const [sub] = args
  let ref = args[1]
  // `--force <dir>` (the flag parser takes the next word as the flag's value)
  const forceWord = typeof flags.force === 'string' && !['true', 'false', '1', '0'].includes(flags.force) ? flags.force : undefined
  if (forceWord && !ref) ref = forceWord
  const base = canvasBase(typeof flags.canvas === 'string' ? flags.canvas : undefined)
  const api = canvasApi(base)
  const { projects } = await api<{ projects: Array<{ id: string; name: string; personal: boolean; boards: number; root?: string | null }> }>('GET', '/api/projects')
  if (sub === 'list' || sub === 'ls') {
    for (const p of projects) console.log(`${p.id}\t${p.boards} board(s)\t${p.personal ? '(personal space)' : (p.root ?? p.name)}`)
    return true
  }
  if ((sub !== 'remove' && sub !== 'rm') || !ref) {
    console.error('usage: awd projects remove <project dir | project id> [--force] [--canvas URL]   ·   awd projects list')
    return false
  }
  const abs = path.resolve(ref)
  const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs
  const p = projects.find((x) => !x.personal && (x.id === ref || x.root === abs || x.root === real))
  if (!p) {
    console.error(`no project ${ref} on ${base} (projects: ${projects.filter((x) => !x.personal).map((x) => `${x.id}${x.root ? ` = ${x.root}` : ''}`).join(', ') || 'none'})`)
    return false
  }
  const force = flags.force === true || flags.force === 'true' || flags.force === '1' || !!forceWord
  try {
    const r = await api<{ removed: { id: string }; moved: string[] }>('DELETE', `/api/projects/${encodeURIComponent(p.id)}${force ? '?force=1' : ''}`)
    console.log(`removed project ${r.removed.id}${p.root ? ` (${p.root} — its files stay)` : ''}${r.moved.length ? `; moved ${r.moved.length} board(s) to the personal space: ${r.moved.join(', ')}` : ''}`)
    return true
  } catch (e) {
    console.error((e as Error).message)
    return false
  }
}

/**
 * `awd boards move <board id | title:…> --to <project dir> [--canvas URL]` — move a board (snapshot and
 * change log) into a project's `.unprose/boards/`. The canvas copies first and removes the old files only
 * after the copy is in place; it must run on this machine (it writes into the project directory).
 */
export async function cmdBoards(args: string[], flags: Record<string, string | boolean>): Promise<boolean> {
  const [sub, ref] = args
  const to = typeof flags.to === 'string' ? flags.to : undefined
  if (sub !== 'move' || !ref || !to) {
    console.error('usage: awd boards move <board id | title:…> --to <project dir> [--canvas URL]')
    return false
  }
  const base = canvasBase(typeof flags.canvas === 'string' ? flags.canvas : undefined)
  const api = canvasApi(base)
  let id = ref
  if (ref.startsWith('title:')) {
    const title = ref.slice(6).trim()
    const hits = (await api<{ boards: Summary[] }>('GET', '/api/boards')).boards.filter((b) => b.title === title)
    if (hits.length !== 1) {
      console.error(hits.length ? `${hits.length} boards are titled "${title}" — pass the board id (${hits.map((b) => `${b.id} [${b.project ?? 'personal'}]`).join(', ')})` : `no board titled "${title}"`)
      return false
    }
    id = hits[0].id
  }
  const r = await api<{ board: string; project: string }>('POST', `/api/boards/${encodeURIComponent(id)}/move`, { projectRoot: path.resolve(to) })
  console.log(`moved ${r.board} into project ${r.project} (${path.join(path.resolve(to), '.unprose', 'boards')}); the URL ${base}/b/${r.board} is unchanged`)
  console.log(`commit ${path.join('.unprose', 'boards', `${r.board}.json`)} with the project (the change log stays local)`)
  return true
}
