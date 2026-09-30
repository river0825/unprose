// HTTP routes for projects (docs/canvas.md "Projects"). The canvas has no auth yet, so everything that
// names a directory on this machine — registering a project, moving a board into one — is only
// accepted from a local caller: loopback address and no proxy/tunnel forwarding headers (a tunnel
// such as cloudflared connects from localhost but adds them).
import type http from 'node:http'
import { hasProjects, NotFound, PERSONAL_PROJECT, type BoardRepository, type ProjectInfo } from './ports/boardRepository.js'

export class ProjectHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const FORWARDED = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'cf-ray', 'true-client-ip']

/** A caller on this machine (not through a proxy or tunnel). */
export function isLocalRequest(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? ''
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  return loopback && !FORWARDED.some((h) => req.headers[h] !== undefined)
}

/** What a caller may see of a project: the root path only for local callers. */
export function projectView(p: ProjectInfo, local: boolean, boards: number) {
  return { id: p.id, name: p.name, personal: !!p.personal, boards, ...(local ? { root: p.root } : {}) }
}

/** The project id a board list/create names: `?project=` / `project`, or a local caller's `projectRoot`. */
export function resolveProject(store: BoardRepository, req: http.IncomingMessage, project?: unknown, projectRoot?: unknown): string | undefined {
  if (typeof projectRoot === 'string' && projectRoot) {
    if (!isLocalRequest(req)) throw new ProjectHttpError(403, 'projectRoot is only accepted from this machine')
    if (!hasProjects(store)) throw new ProjectHttpError(400, 'this canvas store has no projects')
    return store.registerProject(projectRoot).id
  }
  if (typeof project !== 'string' || !project) return undefined
  if (project === PERSONAL_PROJECT) return project
  if (!hasProjects(store) || !store.projects().some((p) => p.id === project)) throw new ProjectHttpError(404, `project ${project} is not registered`)
  return project
}

/** GET /api/projects · POST /api/projects { root } (local only). */
export async function projectsRoute(store: BoardRepository, req: http.IncomingMessage, method: string, readBody: () => Promise<unknown>) {
  const local = isLocalRequest(req)
  const counts = new Map<string, number>()
  if (hasProjects(store)) for (const b of store.list()) counts.set(store.projectOf(b.id), (counts.get(store.projectOf(b.id)) ?? 0) + 1)
  if (method === 'GET') {
    const list = hasProjects(store) ? store.projects() : [{ id: PERSONAL_PROJECT, name: 'Personal', root: null, boardsDir: null, personal: true }]
    return { status: 200, body: { projects: list.map((p) => projectView(p, local, hasProjects(store) ? (counts.get(p.id) ?? 0) : store.list().length)) } }
  }
  if (method === 'POST') {
    if (!local) throw new ProjectHttpError(403, 'projects can only be registered from this machine')
    if (!hasProjects(store)) throw new ProjectHttpError(400, 'this canvas store has no projects')
    const body = (await readBody()) as { root?: unknown }
    if (typeof body.root !== 'string' || !body.root) throw new ProjectHttpError(400, 'root (an absolute directory) required')
    try {
      const p = store.registerProject(body.root)
      return { status: 200, body: { project: projectView(p, true, counts.get(p.id) ?? 0) } }
    } catch (e) {
      throw new ProjectHttpError(400, (e as Error).message)
    }
  }
  throw new ProjectHttpError(405, 'method not allowed')
}

/** POST /api/boards/:id/move { project } (local only). */
export async function moveRoute(store: BoardRepository, req: http.IncomingMessage, id: string, readBody: () => Promise<unknown>) {
  if (!isLocalRequest(req)) throw new ProjectHttpError(403, 'boards can only be moved from this machine')
  if (!hasProjects(store)) throw new ProjectHttpError(400, 'this canvas store has no projects')
  const body = (await readBody()) as { project?: unknown; projectRoot?: unknown }
  const project = resolveProject(store, req, body.project, body.projectRoot)
  if (!project) throw new ProjectHttpError(400, 'project (an id) or projectRoot (a directory) required')
  try {
    store.moveBoard(id, project)
  } catch (e) {
    throw new ProjectHttpError(e instanceof NotFound ? 404 : 500, (e as Error).message)
  }
  return { status: 200, body: { board: id, project } }
}
