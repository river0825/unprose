// Reflection, the application part: three layers, all derived from the log.
//   signal   — one `reflection.noted` event (an agent's / script's `reflect`), or
//              any `<step>.failed` / `<step>.timeout` event, each with its key
//   pattern  — signals grouped: failures by step + reason class, reflections by
//              kind + tags (or note); counted, dated, with example keys
//   decision — a pattern past the threshold becomes ONE kanban card carrying a
//              suggested guard (a golden, a lint rule, a gate) — never prose
// Pure functions; the CLI and the reflection step do the IO around them.

import { createHash } from 'node:crypto'
import type { Event } from '@awd/core'
import type { ReflectKind, ReflectNote } from '@awd/core'

export const REFLECTION_NOTED = 'reflection.noted'

export interface ReflectionData extends ReflectNote { agent?: string; source: 'ai' | 'script'; key?: string; step?: string }

export interface Signal {
  kind: 'failure' | 'reflection'
  key: string
  step?: string
  at: string
  eventId: string
  /** failure: the reason class; reflection: the note. */
  text: string
  reason?: string
  outcome?: 'failed' | 'timeout'
  rkind?: ReflectKind
  tags: string[]
  agent?: string
}

export interface Pattern {
  id: string
  kind: 'failure' | 'reflection'
  title: string
  step?: string
  reason?: string
  rkind?: ReflectKind
  tags: string[]
  count: number
  firstAt: string
  lastAt: string
  keys: string[]
  examples: string[]
  guard: string
}

export interface PatternOptions {
  /** Only signals at or after this time (ms epoch or ISO). */
  since?: number | string
  now?: number
}

/** Failure reasons, classified: the `data.error` text minus the noise that makes every failure look unique. */
export function reasonClass(data: unknown): string {
  const d = (data ?? {}) as { reason?: unknown; error?: unknown }
  if (typeof d.reason === 'string' && d.reason) return d.reason
  const err = typeof d.error === 'string' ? d.error : ''
  if (!err) return 'unknown'
  if (/^exit \d+/.test(err)) return 'exit non-zero'
  if (/output does not match schema/i.test(err)) return 'schema mismatch'
  if (/killed after|timed out/i.test(err)) return 'timeout'
  if (/^agent_blocked/.test(err)) return 'agent_blocked'
  if (/^agent_busy/.test(err)) return 'agent_busy'
  if (/ENOENT|not found/i.test(err)) return 'missing file or command'
  return err.toLowerCase().replace(/0x[0-9a-f]+|\d+|\/[^\s]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'unknown'
}

export function signalsOf(events: Event[], opts: PatternOptions = {}): Signal[] {
  const since = opts.since === undefined ? -Infinity : typeof opts.since === 'string' ? Date.parse(opts.since) : opts.since
  const out: Signal[] = []
  for (const ev of events) {
    if (Date.parse(ev.ts) < since) continue
    if (ev.type === REFLECTION_NOTED) {
      const d = (ev.data ?? {}) as Partial<ReflectionData>
      if (typeof d.note !== 'string') continue
      out.push({ kind: 'reflection', key: ev.key, step: d.step, at: ev.ts, eventId: ev.id, text: d.note, rkind: d.kind ?? 'friction', tags: Array.isArray(d.tags) ? d.tags.map(String) : [], agent: d.agent })
      continue
    }
    if (ev.type.startsWith('timer.') || ev.type.startsWith('memory.') || ev.type.startsWith('board.')) continue
    const i = ev.type.lastIndexOf('.')
    if (i <= 0) continue
    const outcome = ev.type.slice(i + 1)
    if (outcome !== 'failed' && outcome !== 'timeout') continue
    const step = ev.type.slice(0, i)
    const reason = outcome === 'timeout' ? 'timeout' : reasonClass(ev.data)
    out.push({ kind: 'failure', key: ev.key, step, at: ev.ts, eventId: ev.id, text: reason, reason, outcome, tags: [], agent: (ev.meta?.agent as string | undefined) })
  }
  return out
}

const KIND_LABEL: Record<ReflectKind, string> = { friction: 'friction', bug: 'bug', idea: 'idea', rule: 'rule' }

export function guardFor(p: Pick<Pattern, 'kind' | 'step' | 'reason' | 'rkind'>): string {
  if (p.kind === 'failure') return `add a golden \`tests/${slug(p.step ?? 'step')}-${slug(p.reason ?? 'fails')}.golden.yaml\` that reproduces this (events in, expected outcomes out), then fix the step until it is green`
  switch (p.rkind) {
    case 'rule': return 'turn it into a lint rule or a gate step — a rule that only lives in a prompt is a suggestion'
    case 'bug': return 'add a golden that reproduces it before touching the code'
    case 'idea': return 'keep it as a card; size it; no code until it is on the board'
    default: return 'remove the friction with a script step or a line in the docs — not a longer prompt'
  }
}

export function patternsOf(events: Event[], opts: PatternOptions = {}): Pattern[] {
  const groups = new Map<string, Pattern>()
  for (const s of signalsOf(events, opts)) {
    const groupKey = s.kind === 'failure' ? `failure|${s.step}|${s.reason}` : `reflection|${s.rkind}|${s.tags.length ? [...s.tags].sort().join(',') : normalize(s.text)}`
    let p = groups.get(groupKey)
    if (!p) {
      const base = { kind: s.kind, step: s.step, reason: s.reason, rkind: s.rkind, tags: s.tags }
      p = {
        id: `rf-${createHash('sha1').update(groupKey).digest('hex').slice(0, 8)}`,
        ...base,
        title: s.kind === 'failure' ? `${s.step} fails: ${s.reason}` : `[${KIND_LABEL[s.rkind!]}] ${s.tags.length ? s.tags.join(', ') + ' — ' : ''}${clip(s.text, 70)}`,
        count: 0, firstAt: s.at, lastAt: s.at, keys: [], examples: [], guard: guardFor(base),
      }
      groups.set(groupKey, p)
    }
    p.count++
    if (s.at < p.firstAt) p.firstAt = s.at
    if (s.at > p.lastAt) p.lastAt = s.at
    if (!p.keys.includes(s.key)) p.keys.push(s.key)
    const ex = s.kind === 'failure' ? `${s.key}: ${s.step}.${s.outcome} (${s.reason})` : `${s.key}${s.step ? ' / ' + s.step : ''}${s.agent ? ' @' + s.agent : ''}: ${clip(s.text, 160)}`
    if (p.examples.length < 5 && !p.examples.includes(ex)) p.examples.push(ex)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1))
}

export interface DecisionOptions { threshold?: number }

/** The few patterns worth a card: seen at least `threshold` times (default 2), or any `rule`. */
export function decisionsOf(patterns: Pattern[], opts: DecisionOptions = {}): Pattern[] {
  const th = opts.threshold ?? 2
  return patterns.filter((p) => p.count >= th || p.rkind === 'rule')
}

export interface ReflectionCard {
  id: string
  title: string
  labels: string[]
  size: 'S'
  description: string
  /** Set on the card's data so re-running updates instead of duplicating. */
  pattern: string
  count: number
}

export function cardForPattern(p: Pattern): ReflectionCard {
  const lines = [
    p.kind === 'failure' ? `Step \`${p.step}\` failed with "${p.reason}" ${p.count}× (${p.firstAt.slice(0, 10)} → ${p.lastAt.slice(0, 10)}).` : `${p.count}× ${p.rkind} signal${p.tags.length ? ` tagged ${p.tags.join(', ')}` : ''} (${p.firstAt.slice(0, 10)} → ${p.lastAt.slice(0, 10)}).`,
    `Keys: ${p.keys.slice(0, 8).join(', ')}${p.keys.length > 8 ? ` +${p.keys.length - 8}` : ''}`,
    '',
    'Examples:',
    ...p.examples.map((e) => `- ${e}`),
    '',
    `Suggested guard: ${p.guard}`,
    `Pattern ${p.id} — this card is updated in place while the pattern keeps occurring.`,
  ]
  return { id: p.id, title: p.title, labels: ['reflection', p.kind === 'failure' ? 'failure' : p.rkind!], size: 'S', description: lines.join('\n'), pattern: p.id, count: p.count }
}

export function renderPatterns(patterns: Pattern[], opts: { threshold?: number } = {}): string {
  if (!patterns.length) return 'no signals — nothing failed and nobody reflected'
  const th = opts.threshold ?? 2
  const rows = patterns.map((p) => [String(p.count) + (p.count >= th || p.rkind === 'rule' ? ' ●' : '  '), p.kind === 'failure' ? 'failure' : p.rkind!, p.title, `${p.firstAt.slice(5, 10)}→${p.lastAt.slice(5, 10)}`, p.keys.slice(0, 3).join(',') + (p.keys.length > 3 ? '…' : '')])
  const head = ['n', 'kind', 'pattern', 'when', 'keys']
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (r: string[]) => r.map((c, i) => (i === 2 ? c.padEnd(widths[i]) : c.padEnd(widths[i]))).join('  ')
  return [line(head), ...rows.map(line), '', `● = past the threshold (${th}) or a rule → becomes a card with --to-board`].join('\n')
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'
}
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
