// The EventStorming grammar check (docs/diagrams.md §3). Shared by `awd design lint` and the web.
// Every finding names the element it is about and the page of the book behind the rule.
import { normalizeEventStorming, type EventStormingContent, type EsModel } from './eventStorming.js'

export type GrammarRule =
  | 'unresolved-reference'
  | 'command-without-system'
  | 'command-without-event'
  | 'command-without-trigger'
  | 'policy-without-event'
  | 'policy-without-command'
  | 'event-without-source'
  | 'read-model-unused'
  | 'open-hotspots'
  | 'pivotal-on-process'
  | 'aggregate-without-behaviour'

export interface GrammarFinding {
  rule: GrammarRule
  severity: 'warning' | 'info'
  /** Element id the finding is about (absent for board-wide findings such as the hotspot count). */
  element?: string
  message: string
  /** The book page(s) the rule comes from, e.g. 'p.202'. */
  page: string
}

/** Check a diagram against the book's grammar. Pure: content (or an already normalized model) in, findings out. */
export function checkEventStorming(content: EventStormingContent | EsModel): GrammarFinding[] {
  const m = 'kindOf' in content ? content : normalizeEventStorming(content)
  const out: GrammarFinding[] = []
  for (const u of m.unresolved) out.push({ rule: 'unresolved-reference', severity: 'warning', element: u.element, message: `${u.field} "${u.ref}" matches no element`, page: 'p.202' })

  const detailed = m.level !== 'big-picture'
  if (detailed) {
    for (const k of m.commands) {
      if (!k.system) out.push({ rule: 'command-without-system', severity: 'warning', element: k.id, message: `"${k.text}": no system between the command and its event`, page: 'p.202' })
      if (!k.produces.length) out.push({ rule: 'command-without-event', severity: 'warning', element: k.id, message: `"${k.text}" produces no event — the path is not complete`, page: 'p.199' })
      const triggered = !!k.by || m.policies.some((p) => p.then.includes(k.id)) || m.readModels.some((r) => r.informs.includes(k.id))
      if (!triggered) out.push({ rule: 'command-without-trigger', severity: 'info', element: k.id, message: `"${k.text}": nobody issues it — add a person or a policy`, page: 'p.216' })
    }
    for (const p of m.policies) {
      if (!p.when.length) out.push({ rule: 'policy-without-event', severity: 'warning', element: p.id, message: `"${p.text}": whenever … what? no event`, page: 'p.222' })
      if (!p.then.length) out.push({ rule: 'policy-without-command', severity: 'warning', element: p.id, message: `"${p.text}": … then what? no command`, page: 'p.222' })
    }
    const produced = new Set(m.commands.flatMap((k) => k.produces))
    const raised = new Set(m.systems.flatMap((s) => s.raises))
    m.events.forEach((e, i) => {
      // The first event of the flow is its trigger; every later one needs one of the four sources (p.208).
      if (i === 0 || produced.has(e.id) || raised.has(e.id) || e.time || e.person) return
      out.push({ rule: 'event-without-source', severity: 'info', element: e.id, message: `"${e.text}": where does it come from? a command, a system, time or a policy`, page: 'p.208' })
    })
    for (const r of m.readModels) {
      if (!r.informs.length) out.push({ rule: 'read-model-unused', severity: 'warning', element: r.id, message: `"${r.text}" informs no person or command`, page: 'p.231' })
    }
    if (m.level === 'process') {
      for (const e of m.events.filter((e) => e.pivotal)) out.push({ rule: 'pivotal-on-process', severity: 'info', element: e.id, message: `"${e.text}": pivotal events sort a big picture; a process board follows one flow`, page: 'p.82, p.197' })
    }
  }
  if (m.level === 'software') {
    for (const a of m.aggregates) {
      const owns = m.commands.some((k) => k.aggregate === a.id) || m.events.some((e) => e.aggregate === a.id)
      if (!owns) out.push({ rule: 'aggregate-without-behaviour', severity: 'info', element: a.id, message: `aggregate "${a.text}" handles no command and raises no event`, page: 'p.260' })
    }
  }
  if (m.hotspots.length) {
    out.push({ rule: 'open-hotspots', severity: 'info', message: `${m.hotspots.length} open hotspot${m.hotspots.length === 1 ? '' : 's'} — a process is done when this reaches zero`, page: 'p.199, p.203' })
  }
  return out
}

/** Open hotspots: the book's "not done yet" signal (p.203). */
export function openHotspotCount(content: EventStormingContent | EsModel): number {
  const m = 'kindOf' in content ? content : normalizeEventStorming(content)
  return m.hotspots.length
}
