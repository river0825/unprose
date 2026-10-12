// The diagram is a projection of the definition, never the other way round.

import type { StepDef, WorkflowDefinition } from './schema.js'
import { formatDuration } from './schema.js'

export interface GraphNode { id: string; kind: 'trigger' | 'script' | 'ai' | 'gate' | 'human' | 'outcome'; label: string; config: Record<string, unknown> }
/** One event subscription: `to` runs when `from` emits `event` (and `condition` holds). */
export interface GraphEdge { from: string; to: string; label: string; condition?: string; event: string; resume?: boolean }
/** Who does the ai steps — one entry per `agents:` id, plus one per legacy `role:` still in use. */
export interface GraphAgent {
  id: string
  description?: string
  model?: string
  runner?: string
  tools?: string[]
  effort?: string
  delegates?: string[]
  /** ai step ids this agent owns. */
  steps: string[]
  /** true when the entry comes from a `role:` prompt file, not an `agents:` definition. */
  legacy?: boolean
}
/** What a block is for (the file's top-level `annotations:`, docs/diagrams.md "Annotations"): the runner ignores it, the board draws it. */
export interface GraphAnnotation { id?: string; on: string; text: string }
export interface Graph { name: string; nodes: GraphNode[]; edges: GraphEdge[]; agents: GraphAgent[]; annotations?: GraphAnnotation[] }

export function toGraph(def: WorkflowDefinition): Graph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const producers = new Map<string, { node: string; label: string }>()

  for (const t of def.triggers) {
    const config: Record<string, unknown> = { on: t.on, emit: t.emit }
    if (t.path) config.path = t.path
    if (t.every) config.every = formatDuration(t.every)
    if (t.at) config.at = t.at
    nodes.push({ id: t.id, kind: 'trigger', label: `${t.id}\n(${t.on}${t.every ? ' ' + formatDuration(t.every) : ''})`, config })
    producers.set(t.emit, { node: t.id, label: t.emit })
  }
  for (const s of def.steps) {
    const config: Record<string, unknown> = { outcomes: s.outcomes }
    if (s.timeout) config.timeout = formatDuration(s.timeout)
    if (s.retry) config.retry = s.retry
    if (s.kind === 'script') config.run = s.run
    if (s.kind === 'ai') {
      const agent = s.ai.agent ? def.agents?.[s.ai.agent] : undefined
      Object.assign(config, { agent: s.ai.agent, role: s.ai.role, model: s.ai.model ?? agent?.model, runner: agent?.runner, input: s.ai.input, output: s.ai.output })
    }
    if (s.kind === 'gate') config.gate = s.gate
    if (s.kind === 'human') config.human = s.human
    if (s.description) config.description = s.description
    const who = s.kind === 'ai' ? `@${s.ai.agent ?? s.ai.role ?? 'model'}${config.model ? ` (${config.model})` : ''}` : undefined
    nodes.push({ id: s.id, kind: s.kind, label: who ? `${s.id}\n${who}` : s.id, config })
    for (const o of s.outcomes) producers.set(`${s.id}.${o}`, { node: s.id, label: o })
    for (const o of ['failed', 'timeout']) producers.set(`${s.id}.${o}`, { node: s.id, label: o })
  }
  for (const s of def.steps) {
    for (const l of s.on) {
      if (/^\*\./.test(l.event)) {
        // `*.failed`: one synthetic node stands for "any step", instead of an edge from every step
        if (!nodes.some((n) => n.id === l.event)) nodes.push({ id: l.event, kind: 'outcome', label: `any step\n${l.event.slice(2)}`, config: { wildcard: true } })
        edges.push({ from: l.event, to: s.id, label: l.event.slice(2), condition: l.if, event: l.event })
        continue
      }
      const p = producers.get(l.event)
      if (!p) continue
      edges.push({ from: p.node, to: s.id, label: p.label, condition: l.if, event: l.event })
    }
    if (s.kind === 'human') for (const e of s.human.resume_on) {
      const p = producers.get(e)
      if (p) edges.push({ from: p.node, to: s.id, label: `resume: ${p.label}`, event: e, resume: true })
    }
  }
  const annotations = graphAnnotations(def.extra?.annotations)
  return { name: def.name, nodes, edges, agents: graphAgents(def), ...(annotations.length ? { annotations } : {}) }
}

/** The file's `annotations:` entries that say something about something (`on` and `text`), as written. */
function graphAnnotations(raw: unknown): GraphAnnotation[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) => {
    const o = a as Partial<GraphAnnotation> | null
    if (!o || typeof o !== 'object' || typeof o.on !== 'string' || typeof o.text !== 'string') return []
    return [{ ...(typeof o.id === 'string' ? { id: o.id } : {}), on: o.on, text: o.text }]
  })
}

function graphAgents(def: WorkflowDefinition): GraphAgent[] {
  const out: GraphAgent[] = []
  const stepsOf = (pick: (s: Extract<StepDef, { kind: 'ai' }>) => boolean) =>
    def.steps.filter((s): s is Extract<StepDef, { kind: 'ai' }> => s.kind === 'ai' && pick(s)).map((s) => s.id)
  for (const a of Object.values(def.agents ?? {})) {
    out.push({
      id: a.id,
      description: a.description,
      model: a.model,
      runner: a.runner,
      tools: a.tools,
      effort: a.effort,
      delegates: a.delegates,
      steps: stepsOf((s) => s.ai.agent === a.id),
    })
  }
  // Steps still on a `role:` show up as agents too, so an old workflow answers "who does this?".
  const roles = new Set(def.steps.flatMap((s) => (s.kind === 'ai' && !s.ai.agent && s.ai.role ? [s.ai.role] : [])))
  for (const role of roles) {
    if (out.some((a) => a.id === role)) continue
    const steps = stepsOf((s) => !s.ai.agent && s.ai.role === role)
    const model = def.steps.find((s) => s.kind === 'ai' && s.ai.role === role && s.ai.model)
    out.push({ id: role, model: model && model.kind === 'ai' ? model.ai.model : undefined, steps, legacy: true })
  }
  return out
}

const SHAPES: Record<GraphNode['kind'], [string, string]> = {
  trigger: ['([', '])'],
  script: ['[', ']'],
  ai: ['[[', ']]'],
  outcome: ['>', ']'],
  gate: ['{', '}'],
  human: ['[/', '/]'],
}

export function toMermaid(def: WorkflowDefinition): string {
  const g = toGraph(def)
  const lines = ['flowchart LR']
  const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/\n/g, '<br/>')
  for (const n of g.nodes) {
    const [l, r] = SHAPES[n.kind]
    lines.push(`  ${n.id}${l}"${esc(n.label)}"${r}`)
  }
  for (const e of g.edges) {
    const label = e.condition ? `${e.label}<br/><i>${esc(e.condition)}</i>` : e.label
    lines.push(`  ${e.from} -->|"${label}"| ${e.to}`)
  }
  lines.push('  classDef trigger fill:#e8f4ff,stroke:#3b82f6')
  lines.push('  classDef ai fill:#f3e8ff,stroke:#a855f7')
  lines.push('  classDef human fill:#fff7e6,stroke:#f59e0b')
  lines.push('  classDef gate fill:#ecfdf5,stroke:#10b981')
  for (const kind of ['trigger', 'ai', 'human', 'gate'] as const) {
    const ids = g.nodes.filter((n) => n.kind === kind).map((n) => n.id)
    if (ids.length) lines.push(`  class ${ids.join(',')} ${kind}`)
  }
  // Mermaid ignores %% comments; the agent roster still travels with the diagram text.
  for (const a of g.agents) lines.push(`  %% agent @${a.id}${a.model ? ` (${a.model})` : ''}${a.runner ? ` via ${a.runner}` : ''}: ${a.steps.join(', ') || '-'}`)
  return lines.join('\n')
}
