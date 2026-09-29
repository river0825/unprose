// Studio, the use case (docs/diagrams.md §8, docs/studio.md §6, §8): one process per
// project. It finds the boards that belong to the project, turns chat requests on them
// into Claude Code sessions in herdr — one session per board, a fork of it for a chat
// that arrives while it is busy — keeps a receipt on each chat root saying what its
// session is doing, and keeps the panes few: one tab per project, at most
// `maxSessions` panes, a queue when they are all busy, idle panes closed and their
// conversations resumed on the next message.
// Talks only to ports: the canvas (CanvasBoard), herdr (AgentChannel), its files (StudioStore).

import type { AgentChannel, AgentRow } from '../ports/agentChannel.js'
import type { BoardSnapshot, CanvasBoard } from '../ports/canvasBoard.js'
import type { BoardCursor, StudioChat, StudioJob, StudioSession, StudioStore } from '../ports/studioStore.js'
import { evictable, idleExpired, openSessions, paneNumber } from './pool.js'
import {
  ackComment, boardScope, boardSessionName, boardSources, briefKey, chatRequest, discussRequests, forkSessionName, inProject,
  newUserComments, promptFor, promptForFollowUp, promptWarm, renderBrief, rootOf, tabLabel, type DiscussRequest, type StudioModel,
} from './studio.js'

export interface StudioOptions {
  canvas: CanvasBoard
  channel: AgentChannel
  store: StudioStore
  /** Project root (absolute). Boards whose `meta.project.root` or `meta.workflow.file` is inside it are served. */
  project: string
  /** For the tab label `studio: <name>` (default: the root's folder name). */
  projectName?: string
  /** Serve only these boards, whatever their meta says (default: discover every board in the project). */
  boards?: string[]
  /** Where panes open (default: the project root). */
  cwd?: string
  canvasUrl: string
  /** How the session calls the awd CLI (see BriefInput.awd). */
  awd?: string
  /** For requests that name no (known) model. */
  model?: StudioModel
  /** Claude Code `--permission-mode` for new sessions. Comes from the command line, never from the board. */
  permissionMode?: string
  /** Panes in the studio tab, across all boards of the project (default 3). */
  maxSessions?: number
  /** Close a pane idle this long (ms, default 30 min); its conversation stays resumable. */
  idleCloseMs?: number
  /** Prime each board's session with its design sources once, before any chat (default off). */
  warm?: boolean
  /** Look again at boards that are not (yet) in the project every n ticks (default 10). */
  rescanEvery?: number
  /** A fresh Claude Code session id (the composition root passes crypto.randomUUID). */
  newSessionId?: () => string
  sleep?: (ms: number) => Promise<void>
  /** Clock for receipts and idle times (ms since epoch). */
  now?: () => number
  log?: (line: string) => void
}

export type StudioAction = 'opened' | 'resumed' | 'prompted' | 'forked' | 'warmed' | 'queued' | 'failed'

/** What a chat root's `data.agentState.state` says (docs/studio.md §6, §8a). */
export type AgentWork = 'starting' | 'working' | 'idle' | 'blocked' | 'failed' | 'queued' | 'parked'

/** herdr's agent_status in receipt words; undefined = nothing to say (unknown / gone). */
function workOf(status: string | undefined): AgentWork | undefined {
  if (status === 'working' || status === 'blocked' || status === 'idle') return status
  if (status === 'done') return 'idle'
  return undefined
}

/** Right after a prompt herdr can still say idle before claude picks it up; don't flip working → idle that soon. */
const GRACE_MS = 10_000

type Done = { board: string; req?: DiscussRequest; action: StudioAction }

export class Studio {
  private boards: Record<string, BoardCursor> = {}
  private sessions: Record<string, StudioSession> = {}
  private chats: Record<string, StudioChat> = {}
  private queue: StudioJob[] = []
  private promptedAt = new Map<string, number>()
  /** Boards seen that are not in the project, and the tick they were last looked at. */
  private outside = new Map<string, number>()
  private ticks = 0
  private loaded = false
  constructor(private o: StudioOptions) {}

  /** Boards being served. */
  get watching() { return Object.keys(this.boards) }

  /** True while a request waits or a pane is not idle — the caller should tick often, so receipts keep up. */
  get busy() {
    return this.queue.length > 0 || Object.values(this.sessions).some((s) => s.pane && s.state !== 'idle' && s.state !== 'failed')
  }

  private get max() { return this.o.maxSessions ?? 3 }
  private get root() { return this.o.project.replace(/\/+$/, '') }
  private get tab() { return tabLabel(this.o.projectName ?? this.root.split('/').pop() ?? 'project') }

  /** Restore the saved state of this project (a state from another project, or an older format, is ignored). */
  init() {
    const saved = this.o.store.loadState()
    if (saved?.project === this.root && saved.boards) {
      this.boards = saved.boards
      this.sessions = Object.fromEntries(Object.entries(saved.sessions ?? {}).filter(([, s]) => typeof s?.sessionId === 'string' && typeof s?.board === 'string'))
      this.chats = saved.chats ?? {}
      this.queue = (saved.queue ?? []).filter((j) => typeof j?.board === 'string')
    }
    this.loaded = true
    this.save()
  }

  /**
   * One pass: find the project's boards, queue new requests (and follow-ups to parked
   * chats), notice panes the person closed, mirror each open session's state onto its
   * chat, close idle ones, give waiting requests a pane, and report the counts.
   */
  async tick(): Promise<Done[]> {
    if (!this.loaded) this.init()
    this.ticks++
    await this.discover()
    for (const id of Object.keys(this.boards)) {
      let board: BoardSnapshot
      try {
        board = await this.o.canvas.board(id)
      } catch (e) {
        this.o.log?.(`board ${id}: ${(e as Error).message}`)
        continue
      }
      this.renew(board)
      await this.pickUp(board)
    }
    await this.reconcile()
    // fresh states first: an idle pane may make room, an expired one may close
    await this.mirror()
    await this.closeIdle()
    const done = await this.drain()
    await this.showQueue()
    this.save()
    this.o.store.writeStatus({ project: this.root, boards: Object.keys(this.boards).length, open: openSessions(this.sessions).length, max: this.max, queued: this.queue.length, updatedAt: new Date(this.now()).toISOString() })
    return done
  }

  /** Boards in the project join (a first look starts at the board's current seq, not its history). */
  private async discover() {
    const every = this.o.rescanEvery ?? 10
    const listed = this.o.boards ? this.o.boards.map((id) => ({ id })) : await this.o.canvas.boards()
    for (const { id } of listed) {
      if (this.boards[id]) continue
      const last = this.outside.get(id)
      if (last !== undefined && this.ticks - last < every) continue
      let board: BoardSnapshot
      try {
        board = await this.o.canvas.board(id)
      } catch {
        continue
      }
      if (!this.o.boards && !inProject(board.meta, this.root)) {
        this.outside.set(id, this.ticks)
        continue
      }
      this.outside.delete(id)
      // an old "new session" stamp is history, not a request
      this.boards[id] = { seq: board.seq, scope: boardScope(board), gen: 0, forks: 0, resetAt: stampOf(board) }
      this.o.log?.(`watching "${board.title}" (${id})`)
      if (this.o.warm) this.queue.push({ board: id, kind: 'warm', req: {} })
    }
  }

  /** "New session" (the Studio control stamps `meta.studio.newSessionAt`): the board session retires; the next chat starts fresh. */
  private renew(board: BoardSnapshot) {
    const c = this.boards[board.id]
    const at = stampOf(board)
    if (!at || at === c.resetAt) return
    c.resetAt = at
    const name = boardSessionName(c.scope, c.gen)
    if (this.sessions[name]) this.sessions[name].role = 'retired'
    c.gen++
    this.o.log?.(`"${board.title}": new session requested — the next chat starts ${boardSessionName(c.scope, c.gen)}`)
  }

  /**
   * Every new comment of the person's reaches the agent (docs/studio.md §2): a root comment — Ask AI or
   * plain — opens a chat; a reply goes to its chat's session (studio drives it, the session does not
   * watch the board); a reply on a thread that was never a chat opens one on its root.
   */
  private async pickUp(board: BoardSnapshot) {
    const c = this.boards[board.id]
    const { changes, seq } = await this.o.canvas.changes(board.id, c.seq)
    if (!changes.length) {
      c.seq = Math.max(c.seq, seq)
      return
    }
    for (const req of discussRequests(board, changes, c.seq, this.o.model)) await this.enqueueNew(board.id, req)
    for (const { seq: at, comment } of newUserComments(board, changes, c.seq)) {
      if (!comment.target || board.items[comment.target]?.type !== 'comment') continue // a root: a new chat, above
      const root = rootOf(board, comment.id)
      const text = (comment.text ?? '').trim()
      const chat = this.chats[root]
      const queuedNew = this.queue.find((j) => j.kind === 'new' && (j.req as unknown as DiscussRequest).commentId === root)
      await this.markSeen(board.id, comment.id)
      if (chat || queuedNew) {
        // per chat, in order: delivered when its session is idle (never a fork for a follow-up)
        const base = (chat?.req ?? queuedNew!.req) as unknown as DiscussRequest
        const req: DiscussRequest = { ...base, text, seq: at, followUp: true }
        this.queue.push({ board: board.id, kind: 'followup', session: chat?.session, req: req as unknown as Record<string, unknown> })
        const s = chat && this.sessions[chat.session]
        if (s && !s.pane) await this.receipt(board.id, root, 'starting', chat.session)
        continue
      }
      const rootComment = board.items[root]
      const req = rootComment && chatRequest(board, rootComment, at, this.o.model, 'studio', text)
      if (req) await this.enqueueNew(board.id, req)
    }
    c.seq = Math.max(c.seq, seq)
  }

  private async enqueueNew(boardId: string, req: DiscussRequest) {
    const c = this.boards[boardId]
    this.queue.push({ board: boardId, kind: 'new', req: req as unknown as Record<string, unknown> })
    await this.receipt(boardId, req.commentId, 'starting', boardSessionName(c.scope, c.gen), { seen: true })
  }

  /** A pane whose agent herdr no longer lists was closed by hand: its session is parked. */
  private async reconcile() {
    const open = openSessions(this.sessions)
    if (!open.length) return
    const live = new Set((await this.o.channel.list()).map((a) => a.name))
    for (const [name, s] of open) if (!live.has(name)) await this.park(name, s)
  }

  private async closeIdle() {
    for (const name of idleExpired(this.sessions, this.now(), this.o.idleCloseMs ?? 30 * 60_000)) {
      const s = this.sessions[name]
      await this.o.channel.closePane(s.pane!)
      this.o.log?.(`${name}: idle, pane closed (resumable)`)
      await this.park(name, s)
    }
  }

  private async park(name: string, s: StudioSession) {
    delete s.pane
    delete s.openedAt
    this.promptedAt.delete(name)
    if (s.root) await this.receipt(s.board, s.root, 'parked', name)
  }

  /** Oldest first: prompt an open idle session, fork a busy board session, open (or reopen) one in a free pane, or leave the job waiting. */
  private async drain(): Promise<Done[]> {
    const done: Done[] = []
    const waiting: StudioJob[] = []
    let full = false // once a job could not get a pane, later ones don't jump ahead of it
    for (const job of this.queue) {
      const req = job.kind === 'warm' ? undefined : (job.req as unknown as DiscussRequest)
      let action: StudioAction | 'wait' | 'busy' | 'skip'
      try {
        action = await this.place(job, full)
      } catch (e) {
        action = 'failed'
        if (req) {
          await this.say(job.board, req, `Could not open a session for ${req.block}: ${(e as Error).message}`)
          await this.receipt(job.board, req.commentId, 'failed', job.session ?? '')
        } else this.o.log?.(`warm-up for ${job.board} failed: ${(e as Error).message}`)
        if (job.session && this.sessions[job.session]) this.sessions[job.session].state = 'failed'
      }
      if (action === 'wait' || action === 'busy') {
        if (action === 'wait') full = true // no pane: later jobs needing one wait behind it
        waiting.push(job)
        continue
      }
      if (action === 'skip') continue
      this.o.log?.(`${req?.block ?? `warm-up ${job.board}`}: ${action}${req ? ` (${req.model})` : ''}`)
      done.push({ board: job.board, req, action })
    }
    // a job that is still waiting was queued: say so once
    for (const job of waiting) {
      if (job.announced || job.kind !== 'new') continue // a follow-up just waits for its own session
      const req = job.req as unknown as DiscussRequest
      await this.say(job.board, req, `Queued: every studio pane is busy (${this.max} max in herdr tab "${this.tab}"), or this chat's session is at work; it starts when one frees.`)
      job.announced = true
      done.push({ board: job.board, req, action: 'queued' })
    }
    this.queue = waiting
    return done
  }

  /** `wait`: no free pane · `busy`: the chat's own open session is at work (other jobs may still go ahead). */
  private async place(job: StudioJob, full: boolean): Promise<StudioAction | 'wait' | 'busy' | 'skip'> {
    const c = this.boards[job.board]
    if (!c) return 'skip' // the board left the project
    const main = boardSessionName(c.scope, c.gen)
    if (job.kind === 'warm') {
      if (this.sessions[main] || c.warmed) return 'skip'
      const pane = await this.freePane(full)
      if (!pane) return 'wait'
      const s = (this.sessions[main] = { board: job.board, role: 'board', sessionId: this.newId(), root: '', roots: [], lastUsed: this.now() })
      await this.launch(main, s, pane, ['--session-id', s.sessionId], this.o.model ?? 'opus', 'board')
      const board = await this.o.canvas.board(job.board)
      await this.prompt(main, promptWarm(board, boardSources(board, this.root)))
      c.warmed = true
      await this.started(main)
      return 'warmed'
    }
    const req = job.req as unknown as DiscussRequest

    if (job.kind === 'followup') {
      // the chat's session; for a chat still waiting to open, the one it gets once it does
      const name = job.session ?? this.chats[req.commentId]?.session
      if (!name) return 'busy'
      const s = this.sessions[name]
      if (!s) return 'skip'
      if (s.pane) {
        if (!(await this.idle(name))) return 'busy'
        this.take(name, job)
        await this.prompt(name, await this.promptOf(job, name))
        await this.started(name)
        return 'prompted'
      }
      const pane = await this.freePane(full)
      if (!pane) return 'wait'
      this.take(name, job)
      await this.launch(name, s, pane, ['--resume', s.sessionId], req.model, s.role)
      await this.prompt(name, await this.promptOf(job, name, true))
      await this.say(job.board, req, `Resumed this chat's conversation (${req.model}) in ${this.where(name)}.`)
      await this.started(name)
      return 'resumed'
    }

    // a new chat: the board's session if it is free, a fork of it if it is busy
    const s = this.sessions[main]
    if (s?.pane) {
      if (await this.idle(main)) {
        this.take(main, job)
        await this.prompt(main, await this.promptOf(job, main))
        await this.say(job.board, req, `Sent to this board's Claude session (${this.where(main)}).`)
        await this.started(main)
        return 'prompted'
      }
      const pane = await this.freePane(full)
      if (!pane) return 'wait'
      const name = forkSessionName(c.scope, ++c.forks)
      const f: StudioSession = (this.sessions[name] = { board: job.board, role: 'fork', forkOf: main, sessionId: this.newId(), root: req.commentId, roots: [], lastUsed: this.now() })
      this.take(name, job)
      await this.launch(name, f, pane, ['--resume', s.sessionId, '--fork-session', '--session-id', f.sessionId], req.model, 'fork')
      await this.prompt(name, await this.promptOf(job, name))
      await this.say(job.board, req, `The board's session is busy, so this chat runs in a fork of it (${req.model}, ${this.where(name)}) — it knows the conversation so far.`)
      await this.started(name)
      return 'forked'
    }
    const pane = await this.freePane(full)
    if (!pane) return 'wait'
    const resume = !!s
    const b = s ?? (this.sessions[main] = { board: job.board, role: 'board', sessionId: this.newId(), root: req.commentId, roots: [], lastUsed: this.now() })
    this.take(main, job)
    await this.launch(main, b, pane, resume ? ['--resume', b.sessionId] : ['--session-id', b.sessionId], req.model, 'board')
    await this.prompt(main, await this.promptOf(job, main))
    await this.say(job.board, req, resume ? `Resumed this board's conversation (${req.model}) in ${this.where(main)}.` : `Opened Claude (${req.model}) for this board in ${this.where(main)}.`)
    await this.started(main)
    return resume ? 'resumed' : 'opened'
  }

  /** A pane for a new or reopened session: a split of the tab, the tab itself, or the least recently used idle pane's place. */
  private async freePane(full: boolean): Promise<string | undefined> {
    if (full) return undefined
    if (openSessions(this.sessions).length >= this.max) {
      const victim = evictable(this.sessions)
      if (!victim) return undefined
      await this.o.channel.closePane(this.sessions[victim].pane!)
      this.o.log?.(`${victim}: pane closed for a new session (least recently used, resumable)`)
      await this.park(victim, this.sessions[victim])
    }
    const open = openSessions(this.sessions)
    const pane = open.length ? await this.o.channel.splitPane(open[0][1].pane!, this.cwd) : await this.o.channel.openTab(this.cwd, this.tab)
    if (!pane) throw new Error('herdr did not open a pane')
    return pane
  }

  private async launch(name: string, s: StudioSession, pane: string, session: string[], model: string, role: StudioSession['role']) {
    s.pane = pane
    s.openedAt = this.now()
    const label = `${this.boards[s.board]?.scope ?? s.board}${role === 'fork' ? ' · fork' : role === 'retired' ? ' · earlier' : ''}`
    await this.o.channel.start(name, 'claude', pane, ['--model', model, '--permission-mode', this.o.permissionMode ?? 'auto', ...session, '-n', label])
    await this.ready(name)
  }

  /** The session takes this chat: replies go under its root, and follow-ups come back to this session. */
  private take(name: string, job: StudioJob) {
    const req = job.req as unknown as DiscussRequest
    const s = this.sessions[name]
    s.root = req.commentId
    s.req = job.req
    if (!s.roots.includes(req.commentId)) s.roots.push(req.commentId)
    this.chats[req.commentId] = { session: name, req: job.req }
  }

  /** Open and idle — and not just prompted (herdr may not have noticed the prompt yet). */
  private async idle(name: string): Promise<boolean> {
    const s = this.sessions[name]
    const status = workOf((await this.o.channel.get(name))?.agent_status)
    return status === 'idle' && !(s.state === 'working' && this.withinGrace(name))
  }

  /** Write a fresh brief (the board as it is now: the chat so far, open notes) and the one-line prompt pointing at it. */
  private async promptOf(job: StudioJob, _name: string, resumed = false): Promise<string> {
    const req = job.req as unknown as DiscussRequest
    const board = await this.o.canvas.board(job.board)
    const wf = (board.meta?.workflow as { file?: unknown } | undefined)?.file
    const workflow = typeof wf === 'string' ? (wf.startsWith(`${this.root}/`) ? wf.slice(this.root.length + 1) : wf) : undefined
    const brief = this.o.store.writeBrief(this.boards[job.board].scope, briefKey(req), renderBrief({ req, board, workflow, canvasUrl: this.o.canvasUrl, awd: this.o.awd }))
    return job.kind === 'followup' ? promptForFollowUp(req, brief, resumed) : promptFor(req, brief)
  }

  private async started(name: string) {
    const s = this.sessions[name]
    s.lastUsed = this.now()
    this.promptedAt.set(name, this.now())
    if (s.root) await this.receipt(s.board, s.root, 'working', name)
    else s.state = 'working'
  }

  /** Like the herdr worker: `agent start` can return before the input box takes text. */
  private async ready(name: string) {
    const sleep = this.o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
    await this.o.channel.wait(name, ['idle', 'done'], 60_000).catch(() => undefined)
    for (let i = 0; i < 60; i++) {
      const row: AgentRow | undefined = await this.o.channel.get(name)
      if (row?.interactive_ready) break
      await sleep(500)
    }
    await sleep(1500)
  }

  private async prompt(name: string, text: string) {
    const r = await this.o.channel.prompt(name, text)
    if (!r.ok) throw new Error(`herdr prompt to ${name} failed (${r.state ?? '?'})${r.detail ? `: ${r.detail}` : ''}`)
  }

  /** Ask herdr how each open session is doing; write it on its chat root when it changed. */
  private async mirror() {
    for (const [name, s] of openSessions(this.sessions)) {
      const work = workOf((await this.o.channel.get(name).catch(() => undefined))?.agent_status)
      if (!work) continue
      if (work === 'working') s.lastUsed = this.now()
      if (work === 'idle' && s.state === 'working' && this.withinGrace(name)) continue
      if (s.root) await this.receipt(s.board, s.root, work, name)
      else s.state = work
    }
  }

  /** Waiting chats show their place in line. */
  private async showQueue() {
    const chatsInLine = this.queue.filter((j) => j.kind === 'new')
    for (const [i, job] of chatsInLine.entries()) {
      if (job.shownPosition === i + 1) continue
      const req = job.req as unknown as DiscussRequest
      await this.receipt(job.board, req.commentId, 'queued', job.session ?? '', { position: i + 1 })
      job.shownPosition = i + 1
    }
  }

  private withinGrace(name: string) { return this.now() - (this.promptedAt.get(name) ?? 0) < GRACE_MS }

  private where(name: string) { return `pane ${paneNumber(this.sessions, name)} of herdr tab "${this.tab}"` }

  private get cwd() { return this.o.cwd ?? this.root }

  /**
   * Merge `agentState` (and, on pickup, `seenBy += agent`) into the comment's data — never
   * drop what is there (anchor, discuss). Written only when something changed.
   */
  private async receipt(boardId: string, commentId: string, state: AgentWork, session: string, opts: { seen?: boolean; position?: number } = {}) {
    const item = (await this.o.canvas.board(boardId)).items[commentId]
    if (!item) return
    const s = this.sessions[session]
    if (s?.root === commentId) s.state = state
    const pane = ['starting', 'working', 'idle', 'blocked'].includes(state) ? paneNumber(this.sessions, session) : undefined
    const data = item.data ?? {}
    const seenBy = Array.isArray(data.seenBy) ? (data.seenBy as string[]) : []
    const prev = data.agentState as { state?: string; pane?: number; position?: number; session?: string } | undefined
    const needSeen = opts.seen && !seenBy.includes('agent')
    if (!needSeen && prev?.state === state && prev?.pane === pane && prev?.position === opts.position && prev?.session === (session || undefined)) return
    const agentState = { state, ...(session ? { session } : {}), tab: this.tab, ...(pane ? { pane } : {}), ...(opts.position ? { position: opts.position } : {}), at: new Date(this.now()).toISOString() }
    const next = { ...data, ...(needSeen ? { seenBy: [...seenBy, 'agent'] } : {}), agentState }
    await this.o.canvas.update(boardId, [{ id: commentId, patch: { data: next } }], `studio: ${state}`)
  }

  /** A follow-up studio acted on is read, like a request. */
  private async markSeen(boardId: string, commentId: string) {
    const item = (await this.o.canvas.board(boardId)).items[commentId]
    const seenBy = Array.isArray(item?.data?.seenBy) ? (item!.data!.seenBy as string[]) : []
    if (!item || seenBy.includes('agent')) return
    await this.o.canvas.update(boardId, [{ id: commentId, patch: { data: { ...item.data, seenBy: [...seenBy, 'agent'] } } }], 'studio: seen')
  }

  private now() { return (this.o.now ?? Date.now)() }

  private newId() { return (this.o.newSessionId ?? uuidish)() }

  private async say(boardId: string, req: DiscussRequest, text: string) {
    await this.o.canvas.add(boardId, [ackComment(req, text)], `studio: ${req.block}`)
  }

  private save() {
    this.o.store.saveState({ project: this.root, boards: this.boards, sessions: this.sessions, chats: this.chats, queue: this.queue })
  }
}

/** `meta.studio.newSessionAt`, the stamp the canvas server writes for "new session". */
function stampOf(board: BoardSnapshot): string | undefined {
  const at = (board.meta?.studio as { newSessionAt?: unknown } | undefined)?.newSessionAt
  return typeof at === 'string' ? at : undefined
}

/** A v4-shaped id when none is injected (tests); the CLI passes crypto.randomUUID. */
function uuidish(): string {
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`
}
