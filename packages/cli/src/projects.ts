// Boards belong to the project they come from (docs/canvas.md "Projects"): a design or workflow file's
// repo is registered on the canvas, and a board looked up by title is found — or created — there.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export type Api = <T>(method: string, p: string, body?: unknown) => Promise<T>

/**
 * What every call to the canvas carries: `UNPROSE_TOKEN` for a canvas elsewhere (docs/canvas.md "Remote
 * agents"), else the token this agent's MCP server got with a pairing code for that canvas (`~/.awd/tokens.json`,
 * `UNPROSE_TOKENS_FILE`), else `UNPROSE_AGENT_NAME` so a local canvas can sign this agent's changes with its name.
 */
export function canvasHeaders(env: NodeJS.ProcessEnv = process.env, base?: string): Record<string, string> {
  if (env.UNPROSE_TOKEN) return { authorization: `Bearer ${env.UNPROSE_TOKEN}` }
  const saved = base ? savedToken(base, env) : undefined
  if (saved) return { authorization: `Bearer ${saved}` }
  return env.UNPROSE_AGENT_NAME ? { 'x-unprose-agent': env.UNPROSE_AGENT_NAME } : {}
}

/** The device-flow token kept for this canvas address (written by the MCP server, `awd mcp`). */
function savedToken(base: string, env: NodeJS.ProcessEnv): string | undefined {
  try {
    const file = env.UNPROSE_TOKENS_FILE || path.join(os.homedir(), '.awd', 'tokens.json')
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const key = base.replace(/\/+$/, '')
    const t = j[key]
    return typeof t === 'string' && t ? t : undefined
  } catch {
    return undefined
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
type Summary = { id: string; title: string; kind: string; project?: string }

/** Register `root` as a project on the canvas; undefined when the canvas does not take it (remote, old server, memory store). */
export async function registerProject(api: Api, root: string): Promise<string | undefined> {
  try {
    return (await api<{ project: { id: string } }>('POST', '/api/projects', { root: path.resolve(root) })).project.id
  } catch {
    return undefined
  }
}

/**
 * The board titled `title` (of `kind`, when given): the one in `project` first, else one anywhere with
 * that title (boards made before projects keep being used), else a new board created in `project`.
 */
export async function boardByTitle(api: Api, title: string, kind: string, project: string | undefined, match: (b: Summary) => boolean = () => true): Promise<Summary> {
  const { boards } = await api<{ boards: Summary[] }>('GET', '/api/boards')
  const named = boards.filter((b) => b.title === title && match(b))
  const hit = (project ? named.find((b) => b.project === project) : undefined) ?? named[0]
  if (hit) return hit
  // a board drawn from this agent's files is answered by this agent (a named one; the canvas ignores it otherwise)
  return (await api<{ board: Summary }>('POST', '/api/boards', { title, kind, ...(project ? { project } : {}), answeredBy: 'me' })).board
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
  const base = ((typeof flags.canvas === 'string' && flags.canvas) || process.env.AWD_CANVAS_URL || 'http://localhost:4400').replace(/\/$/, '')
  const api: Api = async <T,>(method: string, p: string, body?: unknown): Promise<T> => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...canvasHeaders(process.env, base) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 300)}`)
    return JSON.parse(text) as T
  }
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
