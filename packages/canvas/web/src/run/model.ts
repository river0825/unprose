// Pure helpers for the run overlay: fold runtime state onto workflow / agent cards.
import type { Board, Item } from '../../../src/model'

export type RunStatus = 'idle' | 'running' | 'waiting' | 'done' | 'failed'

export interface RunState {
  key: string
  status: RunStatus
  active: Record<string, { commandId: string; since: string; attempt: number; agent?: string }>
  waiting: Record<string, { since: string; resumeOn: string[] }>
  history: Array<{ step: string; outcome: string; at: string; attempt?: number }>
  failed: string[]
  lastEventAt?: string
}

export interface RunEvent {
  id: string
  type: string
  key: string
  data?: unknown
  ts: string
  causationId?: string
  meta?: Record<string, unknown>
}

export type StepBadgeKind = 'running' | 'waiting' | 'done' | 'failed'

export interface StepBadge {
  kind: StepBadgeKind
  /** How many runs are in this state on this step. */
  count: number
  /** The runs, newest first (first one shown in the badge). */
  keys: string[]
}

export interface AgentBadge {
  working: boolean
  /** "planner · c-arch · plan" for the first busy run. */
  label: string
  count: number
}

/** The workflow status URL a board points at, if any (`?run=` beats `meta.workflow.statusUrl`). */
export function statusUrlOf(board: Board | null, search = typeof location !== 'undefined' ? location.search : ''): string | undefined {
  const q = new URLSearchParams(search).get('run')
  if (q) return q.replace(/\/$/, '')
  const meta = board?.meta?.workflow as { statusUrl?: string } | undefined
  return meta?.statusUrl?.replace(/\/$/, '')
}

/** Step id ↔ board item (workflow template cards carry `data.nodeId`). */
export function stepItems(board: Board): Map<string, Item> {
  const out = new Map<string, Item>()
  for (const it of Object.values(board.items)) {
    const step = it.data?.nodeId
    if (typeof step === 'string' && it.type !== 'arrow') out.set(step, it)
  }
  return out
}

/** Agent id ↔ board item (`role: 'agent'` + `data.agent`). */
export function agentItems(board: Board): Map<string, Item> {
  const out = new Map<string, Item>()
  for (const it of Object.values(board.items)) {
    if (it.role === 'agent' && typeof it.data?.agent === 'string') out.set(it.data.agent, it)
  }
  return out
}

const byRecent = (a: RunState, b: RunState) => (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? '')

/** One badge per step: running beats waiting beats failed beats done. */
export function stepBadges(runs: RunState[], filterKey?: string | null): Map<string, StepBadge> {
  const out = new Map<string, StepBadge>()
  const hit = (step: string, kind: StepBadgeKind, key: string) => {
    const cur = out.get(step)
    const rank: Record<StepBadgeKind, number> = { running: 3, waiting: 2, failed: 1, done: 0 }
    if (!cur) return out.set(step, { kind, count: 1, keys: [key] })
    if (rank[kind] > rank[cur.kind]) return out.set(step, { kind, count: 1, keys: [key] })
    if (rank[kind] === rank[cur.kind]) { cur.count += 1; cur.keys.push(key) }
  }
  for (const run of [...runs].sort(byRecent)) {
    if (filterKey && run.key !== filterKey) continue
    for (const step of Object.keys(run.active)) hit(step, 'running', run.key)
    for (const step of Object.keys(run.waiting)) hit(step, 'waiting', run.key)
    const seen = new Set<string>()
    for (let i = run.history.length - 1; i >= 0; i--) {
      const h = run.history[i]
      if (seen.has(h.step) || run.active[h.step] || run.waiting[h.step]) continue
      seen.add(h.step)
      hit(h.step, h.outcome === 'failed' && run.failed.includes(h.step) ? 'failed' : h.outcome === 'failed' ? 'failed' : 'done', run.key)
    }
  }
  return out
}

/** One badge per agent: working when any active step in any run is theirs. */
export function agentBadges(runs: RunState[], filterKey?: string | null): Map<string, AgentBadge> {
  const out = new Map<string, AgentBadge>()
  for (const run of [...runs].sort(byRecent)) {
    if (filterKey && run.key !== filterKey) continue
    for (const [step, a] of Object.entries(run.active)) {
      if (!a.agent) continue
      const cur = out.get(a.agent)
      if (cur) { cur.count += 1; continue }
      out.set(a.agent, { working: true, label: `${a.agent} · ${run.key} · ${step}`, count: 1 })
    }
  }
  return out
}

/** The step a run is on right now, with its agent when it is an ai step. */
export function currentStep(run: RunState): { step: string; agent?: string; kind: 'running' | 'waiting' | 'idle' } {
  const active = Object.entries(run.active)[0]
  if (active) return { step: active[0], agent: active[1].agent, kind: 'running' }
  const waiting = Object.keys(run.waiting)[0]
  if (waiting) return { step: waiting, kind: 'waiting' }
  const last = run.history[run.history.length - 1]
  return { step: last ? `${last.step}.${last.outcome}` : '—', kind: 'idle' }
}

export function relTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
