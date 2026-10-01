// Workflow graph — the `awd graph --json` shape, laid out in layers left → right.
// Triggers form layer 0; each step's layer = 1 + max layer of its predecessors.
import { z } from 'zod'
import type { ColorToken, Item } from '../model.js'
import { layered } from './layered.js'
import { GAP, LANE_HEADER, PAD, STICKY_H, STICKY_W, arrow, fit, make, offsetAll, type RenderOpts } from './util.js'

export const workflowSchema = z.object({
  name: z.string().optional(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['trigger', 'script', 'ai', 'gate', 'human', 'outcome']),
        label: z.string().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        /** Full block detail (docs/studio.md §1), copied to `item.data.detail` for the Inspector. */
        detail: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
        condition: z.string().optional(),
        /** The `on:` event this wire stands for (docs/studio.md §7); absent in older `awd graph --json`. */
        event: z.string().optional(),
        /** A human step's `resume_on`, not its `on:`. */
        resume: z.boolean().optional(),
      }),
    )
    .default([]),
  /** Who does the ai steps (from `awd graph --json`). Drawn as an Agents frame above the graph. */
  agents: z
    .array(
      z.object({
        id: z.string(),
        description: z.string().optional(),
        model: z.string().optional(),
        runner: z.string().optional(),
        tools: z.array(z.string()).optional(),
        effort: z.string().optional(),
        delegates: z.array(z.string()).optional(),
        steps: z.array(z.string()).default([]),
        legacy: z.boolean().optional(),
        detail: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .default([]),
})
export type WorkflowContent = z.input<typeof workflowSchema>

const KIND_COLOR: Record<string, ColorToken> = {
  trigger: 'pink',
  script: 'blue',
  ai: 'lilac',
  gate: 'yellow',
  human: 'green',
  outcome: 'orange',
}

/** Columns leave room for the widest wire label (monospace ≈ 7.5 px a character, wrapped at 220 px by the UI). */
const labelGap = (labels: string[]) => Math.min(250, Math.max(GAP * 3, Math.max(0, ...labels.map((l) => l.length)) * 7.5 + 30))
const AGENT_W = 200
const AGENT_H = 96
const AGENT_GAP = 24

export function renderWorkflow(raw: WorkflowContent, opts: RenderOpts = {}): Item[] {
  const c = workflowSchema.parse(raw)
  const edgeLabel = (e: (typeof c.edges)[number]) => [e.event ? (e.resume ? `resume: ${e.event}` : e.event) : e.label, e.condition ? `if ${e.condition}` : undefined].filter(Boolean).join(' ')
  const COL = STICKY_W + labelGap(c.edges.map(edgeLabel))
  const now = opts.now ?? new Date().toISOString()
  const scope = opts.scope ?? 'wf'
  const nodeId = (n: string) => `${scope}.node.${n}`
  const items: Item[] = []

  // Layered layout (./layered.ts): loops are drawn back instead of pushing their nodes to the right,
  // each column is ordered to cut crossings, and a long wire gets a free lane on its source's row.
  const known = new Set(c.nodes.map((n) => n.id))
  const lay = layered(
    c.nodes.map((n) => ({ id: n.id, source: n.kind === 'trigger', h: STICKY_H })),
    c.edges.map((e) => ({ from: e.from, to: e.to })),
    { gap: GAP + 10 },
  )
  const layer = lay.layer

  // The Agents frame sits above the graph; the graph moves down by its height.
  const agentId = (a: string) => `${scope}.agent.${a}`
  const frameH = c.agents.length ? LANE_HEADER + AGENT_H + PAD : 0
  const graphTop = PAD + (frameH ? frameH + GAP * 2 : 0)

  const labelOf = (n: (typeof c.nodes)[number]) => n.label ?? n.id
  for (const n of c.nodes) {
    const l = layer.get(n.id)!
    const row = [...layer].filter(([id, k]) => k === l && lay.y.get(id)! < lay.y.get(n.id)!).length
    items.push(
      make(
        {
          id: nodeId(n.id),
          type: 'card',
          x: PAD + l * COL,
          y: graphTop + lay.y.get(n.id)!,
          w: STICKY_W,
          h: STICKY_H,
          text: labelOf(n),
          color: KIND_COLOR[n.kind] ?? 'grey',
          role: n.kind,
          order: row,
          data: { nodeId: n.id, kind: n.kind, config: n.config ?? {}, ...(n.config?.agent ? { agent: n.config.agent } : {}), ...(n.detail ? { detail: n.detail } : {}) },
        },
        now,
      ),
    )
  }
  // One wire per event subscription: "when <from> emits <event> (and if …), <to> runs" (docs/studio.md §7).
  for (const e of c.edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue
    const name = e.event ? (e.resume ? `resume: ${e.event}` : e.event) : e.label
    const label = [name, e.condition ? `if ${e.condition}` : undefined].filter(Boolean).join(' ')
    const data = e.event ? { event: { event: e.event, from: e.from, to: e.to, ...(e.condition ? { condition: e.condition } : {}), ...(e.resume ? { resume: true } : {}) } } : undefined
    const key = e.event ? `${e.resume ? 'resume:' : ''}${e.event}` : undefined
    items.push(arrow(scope, nodeId(e.from), nodeId(e.to), now, label || undefined, 'flow', { key, data }))
  }
  if (c.agents.length) {
    // One card per agent, in a row; dotted "owns" arrows to its steps, dashed "delegates" between agents.
    const cards: Item[] = c.agents.map((a, i) =>
      make(
        {
          id: agentId(a.id),
          type: 'card',
          x: PAD + PAD + i * (AGENT_W + AGENT_GAP),
          y: PAD + LANE_HEADER,
          w: AGENT_W,
          h: AGENT_H,
          text: `@${a.id}\n${a.model ?? 'model?'} · ${a.runner ?? 'claude-code'}`,
          color: 'lilac',
          role: 'agent',
          parent: `${scope}.agents`,
          order: i,
          data: { agent: a.id, model: a.model, runner: a.runner ?? 'claude-code', tools: a.tools ?? [], effort: a.effort, steps: a.steps, delegates: a.delegates ?? [], description: a.description, legacy: !!a.legacy, ...(a.detail ? { detail: a.detail } : {}) },
        },
        now,
      ),
    )
    const frame = fit(
      make({ id: `${scope}.agents`, type: 'frame', x: PAD, y: PAD, w: 0, h: 0, text: 'Agents', role: 'agents', color: 'grey' }, now),
      cards,
      PAD,
      LANE_HEADER,
    )
    items.unshift(frame, ...cards)
    for (const a of c.agents) {
      for (const step of a.steps) if (known.has(step)) items.push(arrow(scope, agentId(a.id), nodeId(step), now, undefined, 'owns'))
      for (const d of a.delegates ?? []) if (c.agents.some((x) => x.id === d)) items.push(arrow(scope, agentId(a.id), agentId(d), now, 'delegates', 'delegates'))
    }
  }
  if (c.name) items.unshift(make({ id: `${scope}.title`, type: 'text', x: PAD, y: PAD - 36, w: 400, h: 28, text: c.name, role: 'title', color: 'white' }, now))
  return offsetAll(items, opts.at)
}
