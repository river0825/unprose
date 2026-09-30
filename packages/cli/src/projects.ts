// Boards belong to the project they come from (docs/canvas.md "Projects"): a design or workflow file's
// repo is registered on the canvas, and a board looked up by title is found — or created — there.
import path from 'node:path'

export type Api = <T>(method: string, p: string, body?: unknown) => Promise<T>
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
  return (await api<{ board: Summary }>('POST', '/api/boards', { title, kind, ...(project ? { project } : {}) })).board
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
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
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
