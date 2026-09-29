// Static checks over a parsed workflow. Errors block `awd run`; warnings don't.

import type { WorkflowDefinition, StepDef } from './schema.js'
import { outcomeEnum, MODEL_ALIAS_NAMES } from './schema.js'
import { wildcardOutcome } from './reflection.js'
import { rootIdentifiers, templateExpressions, compile } from './expr.js'

export interface Issue { level: 'error' | 'warning'; where: string; message: string }
export interface LintResult { errors: Issue[]; warnings: Issue[]; ok: boolean }

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const DOTTED = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$|^[a-z][a-z0-9-]*$/
const STEP_SCOPE = new Set(['event', 'vars', 'key', 'env', 'now', 'history'])
const TRIGGER_SCOPE = new Set(['body', 'query', 'headers', 'env', 'now'])
// board trigger: a card moved between columns on a canvas kanban board
const BOARD_TRIGGER_SCOPE = new Set(['card', 'from', 'to', 'author', 'seq', 'env', 'now'])
const IMPLICIT_OUTCOMES = ['failed', 'timeout', 'retry']

function collectTemplateExprs(value: unknown, out: string[]) {
  if (typeof value === 'string') out.push(...templateExpressions(value))
  else if (Array.isArray(value)) value.forEach((v) => collectTemplateExprs(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectTemplateExprs(v, out))
}

export function lint(def: WorkflowDefinition): LintResult {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const err = (where: string, message: string) => errors.push({ level: 'error', where, message })
  const warn = (where: string, message: string) => warnings.push({ level: 'warning', where, message })

  // ids
  const seen = new Set<string>()
  for (const t of def.triggers) {
    if (!KEBAB.test(t.id)) err(`triggers.${t.id}`, 'trigger id must be kebab-case')
    if (seen.has(t.id)) err(`triggers.${t.id}`, 'duplicate id'); seen.add(t.id)
    if (!DOTTED.test(t.emit)) err(`triggers.${t.id}.emit`, `event type "${t.emit}" must be dotted.lowercase`)
    if (t.on === 'webhook' && !t.path) err(`triggers.${t.id}`, 'webhook needs a path')
    if (t.on === 'cron' && !t.every && !t.at) err(`triggers.${t.id}`, 'cron needs `every` or `at`')
    if (t.on === 'board' && !t.board) err(`triggers.${t.id}`, 'board trigger needs `board` (a board id or `title:<board title>`)')
    if (t.frame !== undefined && t.on !== 'board') err(`triggers.${t.id}.frame`, '`frame` only applies to a board trigger')
    if (t.frame !== undefined && !/^[a-z0-9][a-z0-9_-]*$/i.test(t.frame)) err(`triggers.${t.id}.frame`, `frame key "${t.frame}" should be a diagram key like dev-kanban`)
    if (!['webhook', 'cron', 'cli', 'manual', 'board'].includes(t.on)) err(`triggers.${t.id}.on`, `unknown trigger kind "${t.on}"`)
  }
  for (const s of def.steps) {
    if (!KEBAB.test(s.id)) err(`steps.${s.id}`, 'step id must be kebab-case')
    if (seen.has(s.id)) err(`steps.${s.id}`, 'duplicate id (clashes with a trigger or step)'); seen.add(s.id)
    for (const o of s.outcomes) if (!/^[a-z][a-z0-9-]*$/.test(o)) err(`steps.${s.id}.outcomes`, `outcome "${o}" must be lowercase`)
    if (s.on.length === 0) warn(`steps.${s.id}`, 'step has no `on:` — it can only be reached by `awd emit`')
  }

  // event universe
  const produced = new Set<string>()
  for (const t of def.triggers) produced.add(t.emit)
  for (const s of def.steps) {
    for (const o of s.outcomes) produced.add(`${s.id}.${o}`)
    for (const o of IMPLICIT_OUTCOMES) produced.add(`${s.id}.${o}`)
  }

  // listeners reference real events
  const consumed = new Set<string>()
  for (const s of def.steps) {
    for (const l of s.on) {
      const wild = wildcardOutcome(l.event)
      if (wild) {
        // `*.<outcome>`: every other step's `<outcome>` — the reflection hook. Only failed/timeout
        // make sense (they are implicit on every step); a declared outcome would need a real name.
        if (!IMPLICIT_OUTCOMES.includes(wild) || wild === 'retry') err(`steps.${s.id}.on`, `wildcard listener "${l.event}" — only "*.failed" and "*.timeout" exist`)
        if (l.event.startsWith('*.') && def.steps.length < 2) err(`steps.${s.id}.on`, `"${l.event}" needs another step to listen to`)
        for (const o of def.steps) if (o.id !== s.id) consumed.add(`${o.id}.${wild}`)
        checkExpr(l.if, `steps.${s.id}.on[${l.event}].if`, STEP_SCOPE, err)
        continue
      }
      consumed.add(l.event)
      if (!produced.has(l.event)) err(`steps.${s.id}.on`, `nothing produces event "${l.event}"`)
      checkExpr(l.if, `steps.${s.id}.on[${l.event}].if`, STEP_SCOPE, err)
    }
    if (s.kind === 'human') for (const e of s.human.resume_on) { consumed.add(e); if (!produced.has(e)) err(`steps.${s.id}.human.resume_on`, `nothing produces event "${e}"`) }
  }

  // every declared outcome is consumed (warning) unless terminal
  for (const s of def.steps) {
    const terminal = new Set(s.terminal ?? [])
    for (const o of s.outcomes) {
      if (terminal.has('*') || terminal.has(o)) continue
      if (!consumed.has(`${s.id}.${o}`)) warn(`steps.${s.id}`, `outcome "${o}" is not consumed by any step (add \`terminal: [${o}]\` if intended)`)
    }
  }

  // kind-specific
  for (const s of def.steps) checkStep(s, err, warn)

  // agents
  checkAgents(def, err, warn)

  // trigger templates
  for (const t of def.triggers) {
    const exprs: string[] = []
    collectTemplateExprs(t.data, exprs)
    const scope = t.on === 'board' ? BOARD_TRIGGER_SCOPE : TRIGGER_SCOPE
    for (const e of exprs) checkExpr(e, `triggers.${t.id}.data`, scope, err)
    checkExpr(t.if, `triggers.${t.id}.if`, scope, err)
  }
  if (def.key) for (const e of templateExpressions(def.key)) checkExpr(e, 'key', new Set(['event', 'env', 'now']), err)

  // reachability + cycles
  const reach = reachability(def)
  for (const s of def.steps) if (!reach.has(s.id) && s.on.length) err(`steps.${s.id}`, 'unreachable from any trigger')
  for (const cyc of findCycles(def)) {
    const guarded = cyc.some((id) => { const st = def.steps.find((x) => x.id === id); return st && (st.kind === 'human' || st.kind === 'gate') })
    if (!guarded) warn(`steps.${cyc[0]}`, `cycle ${cyc.join(' → ')} has no human or gate step in it`)
  }

  return { errors, warnings, ok: errors.length === 0 }
}

const KNOWN_RUNNERS = ['claude-code', 'anthropic', 'fake', 'cli', 'herdr']
const KNOWN_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max']

function checkModel(model: string | undefined, where: string, warn: (w: string, m: string) => void) {
  if (!model) return
  if (MODEL_ALIAS_NAMES.includes(model) || /^claude-/.test(model) || model.includes('/')) return
  warn(where, `model "${model}" is neither an alias (${MODEL_ALIAS_NAMES.join('|')}) nor a claude-* id — the worker passes it through unchanged`)
}

function checkAgents(def: WorkflowDefinition, err: (w: string, m: string) => void, warn: (w: string, m: string) => void) {
  const agents = def.agents ?? {}
  for (const [id, a] of Object.entries(agents)) {
    const where = `agents.${id}`
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(id)) err(where, 'agent id must be lowercase [a-z0-9_-], ≤ 32 chars')
    if (a.tools !== undefined && (!Array.isArray(a.tools) || a.tools.some((t) => typeof t !== 'string'))) err(`${where}.tools`, 'tools must be a list of strings')
    if (a.effort && !KNOWN_EFFORT.includes(a.effort)) err(`${where}.effort`, `effort must be one of ${KNOWN_EFFORT.join('|')}`)
    if (a.runner && !KNOWN_RUNNERS.includes(a.runner)) err(`${where}.runner`, `unknown runner "${a.runner}" (${KNOWN_RUNNERS.join('|')})`)
    if (a.runner === 'cli' && !a.cli?.command && !a.cli?.preset) err(`${where}.cli`, 'runner cli needs `cli.command` or `cli.preset` (codex | opencode)')
    if (a.runner === 'herdr' && !a.herdr?.kind) err(`${where}.herdr`, 'runner herdr needs `herdr.kind` (codex | claude | opencode | …)')
    for (const d of a.delegates ?? []) if (!agents[d]) err(`${where}.delegates`, `delegation target "${d}" is not an agent`)
    if (a.memory && (!Number.isInteger(a.memory.recall) || a.memory.recall < 0 || a.memory.recall > 200)) err(`${where}.memory.recall`, 'recall must be an integer 0–200')
    checkModel(a.model, `${where}.model`, warn)
    if (!a.system && !a.file && !a.description) warn(where, 'agent has no system/file/description — the model only gets the step input (or roles/<id>.md if it exists)')
  }
  const agentOfStep = new Map<string, string>()
  for (const s of def.steps) {
    if (s.kind !== 'ai') continue
    const where = `steps.${s.id}.ai`
    if (s.ai.agent && s.ai.role) err(where, 'use either `agent` or `role`, not both')
    if (s.ai.agent && !agents[s.ai.agent]) err(where, `unknown agent "${s.ai.agent}" (declared: ${Object.keys(agents).join(', ') || 'none'})`)
    if (s.ai.agent) agentOfStep.set(s.id, s.ai.agent)
    checkModel(s.ai.model, `${where}.model`, warn)
  }
  // Delegation is an ai→ai edge: an outcome of one agent's step directly starts another agent's step.
  for (const s of def.steps) {
    if (s.kind !== 'ai' || !s.ai.agent) continue
    for (const t of def.steps) {
      if (t.kind !== 'ai' || !t.ai.agent || t.ai.agent === s.ai.agent) continue
      const direct = t.on.some((l) => l.event.startsWith(`${s.id}.`))
      if (!direct) continue
      const from = agents[s.ai.agent]
      if (!from?.delegates?.includes(t.ai.agent)) warn(`steps.${t.id}`, `agent "${s.ai.agent}" hands work to "${t.ai.agent}" (via ${s.id} → ${t.id}) but agents.${s.ai.agent}.delegates does not list it`)
    }
  }
}

function checkExpr(src: string | undefined, where: string, allowed: Set<string>, err: (w: string, m: string) => void) {
  if (!src) return
  try {
    compile(src)
    for (const id of rootIdentifiers(src)) if (!allowed.has(id)) err(where, `unknown identifier "${id}" (allowed: ${[...allowed].join(', ')})`)
  } catch (e) {
    err(where, `bad expression: ${(e as Error).message}`)
  }
}

function checkStep(s: StepDef, err: (w: string, m: string) => void, warn: (w: string, m: string) => void) {
  const where = `steps.${s.id}`
  const exprs: string[] = []
  if (s.kind === 'script') {
    collectTemplateExprs(s.run, exprs); collectTemplateExprs(s.env, exprs)
  } else if (s.kind === 'ai') {
    if (!s.ai.output || typeof s.ai.output !== 'object') err(`${where}.ai`, 'ai step needs an `output` JSON schema')
    else {
      const en = outcomeEnum(s.ai.output)
      if (!en || en.length === 0) err(`${where}.ai.output`, 'output schema must declare `properties.outcome` with an enum')
      else for (const o of s.outcomes) if (!en.includes(o)) err(`${where}.outcomes`, `outcome "${o}" is not in the output schema's outcome enum`)
      const req = (s.ai.output as { required?: unknown }).required
      if (!Array.isArray(req) || !req.includes('outcome')) warn(`${where}.ai.output`, '`outcome` should be in `required`')
    }
    if (!s.ai.role && !s.ai.prompt && !s.ai.agent) warn(`${where}.ai`, 'no agent, role or prompt — the model only gets the input')
    collectTemplateExprs(s.ai.input, exprs); collectTemplateExprs(s.ai.prompt, exprs)
  } else if (s.kind === 'gate') {
    if (s.gate.outcomes.length === 0) err(`${where}.gate`, 'gate needs at least one outcome')
    for (const o of s.gate.outcomes) checkExpr(o.if, `${where}.gate.outcomes.${o.outcome}`, STEP_SCOPE, err)
    if (!s.gate.default) warn(`${where}.gate`, 'no `default` — an unmatched gate fails the run')
    if (s.retry) warn(`${where}.retry`, 'retry has no effect on a gate')
  } else if (s.kind === 'human') {
    if (s.human.outcomes.length === 0) err(`${where}.human`, 'human step needs at least one outcome')
    if (s.human.resume_on.length === 0) err(`${where}.human`, 'human step needs `resume_on`')
    for (const o of s.human.outcomes) checkExpr(o.if, `${where}.human.outcomes.${o.outcome}`, STEP_SCOPE, err)
  }
  for (const e of exprs) checkExpr(e, where, STEP_SCOPE, err)
}

/** Which steps can be reached from a trigger event by following outcome edges. */
export function reachability(def: WorkflowDefinition): Set<string> {
  const byEvent = new Map<string, string[]>()
  for (const s of def.steps) for (const l of s.on) byEvent.set(l.event, [...(byEvent.get(l.event) ?? []), s.id])
  const seen = new Set<string>()
  const queue = def.triggers.map((t) => t.emit)
  while (queue.length) {
    const ev = queue.shift()!
    const dot = ev.lastIndexOf('.')
    // a reachable `<step>.<outcome>` also reaches every `*.<outcome>` listener (except the step itself)
    const wild = dot > 0 ? (byEvent.get(`*.${ev.slice(dot + 1)}`) ?? []).filter((sid) => sid !== ev.slice(0, dot)) : []
    for (const sid of [...(byEvent.get(ev) ?? []), ...wild]) {
      if (seen.has(sid)) continue
      seen.add(sid)
      const s = def.steps.find((x) => x.id === sid)!
      for (const o of [...s.outcomes, ...IMPLICIT_OUTCOMES]) queue.push(`${sid}.${o}`)
    }
  }
  return seen
}

/** Step → steps it feeds (via any outcome). */
export function successors(def: WorkflowDefinition): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const s of def.steps) out.set(s.id, new Set())
  for (const s of def.steps) for (const l of s.on) {
    const i = l.event.lastIndexOf('.')
    if (i <= 0) continue
    const from = l.event.slice(0, i)
    if (out.has(from)) out.get(from)!.add(s.id)
  }
  return out
}

export function findCycles(def: WorkflowDefinition): string[][] {
  const succ = successors(def)
  const cycles: string[][] = []
  const color = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const visit = (n: string) => {
    color.set(n, 1); stack.push(n)
    for (const m of succ.get(n) ?? []) {
      const c = color.get(m) ?? 0
      if (c === 0) visit(m)
      else if (c === 1) cycles.push(stack.slice(stack.indexOf(m)))
    }
    stack.pop(); color.set(n, 2)
  }
  for (const s of def.steps) if ((color.get(s.id) ?? 0) === 0) visit(s.id)
  return cycles
}
