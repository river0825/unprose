#!/usr/bin/env node
// awd — lint · graph · run · emit · status · replay · test

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { lint, toGraph, toMermaid, replay, formatDuration, parseDuration, type Event, type Command, type RunState } from '@awd/core'
import { loadWorkflow, keyFor, FileEventStore, FileMemoryStore, syncMemory, createRuntime, WORKER_NAMES, projectStates, FakeWorker, patternsOf, decisionsOf, cardForPattern, renderPatterns, canvasCards } from '@awd/runtime'
import { pushGraphToCanvas } from './graphCanvas.js'
import { VERSION } from '@awd/canvas/dist/version.js'

// every request Unprose makes says who it is (User-Agent unprose/<version> (<component>)); the runtime reads it here
process.env.UNPROSE_VERSION ||= VERSION

const HELP = `awd — small event-driven agent workflows

  awd lint    <workflow.yaml>
  awd graph   <workflow.yaml> [--mermaid | --json | --canvas [http://localhost:4400] [--runtime http://localhost:4311] [--applied <proposal thread id>]]
              --canvas draws (or updates) the workflow board and tells it where the runtime is, so the board shows runs live
  awd studio  (--project <dir> | <workflow.yaml>) [--canvas URL] [--model opus|sonnet|fable|haiku] [--permission-mode auto] [--interval 2s] [--max-sessions 3] [--idle-close 30m] [--warm]
              one process per project: every board in it, one Claude session per board (a fork while it is busy)
              draws the board with block details; each "Discuss with AI" comment opens / prompts a Claude session in a herdr tab
  awd design  draw <design/<name>.<kind>.yaml> --board <id | title:...> [--canvas URL] [--applied <proposal thread id>]
              --applied: you applied that proposal (after the person agreed): answers "Applied to <file>" in its thread;
              UNPROSE_APPLY_COMMIT=1 also commits the file (message links the thread), UNPROSE_APPLY_PUSH=1 pushes
              draws (or refreshes) one diagram frame from its file; the board keeps your layout (docs/diagrams.md)
  awd design  lint <file>                # schema + the EventStorming / Domain Storytelling grammar
  awd design  propose-stories <es | domain-story file> --into <story-map file> --board <…>   # story candidates as pending cards
  awd design  import-egon <story.egn | .egn.svg> --out design/<name>.domain-story.yaml   # from Egon.io
  awd design  export-egon <domain-story file> --out <story.egn>                         # to Egon.io
  awd mcp                                # the Unprose MCP server (canvas + design tools + prompts) over AWD_CANVAS_URL
  awd boards  move <board id | title:...> --to <project dir> [--canvas URL]            # store a board in <project>/.unprose/boards
  awd projects list | remove <project dir | id> [--force] [--canvas URL]              # forget a project (--force moves its boards to personal)
  awd run     <workflow.yaml> [--port 4311] [--worker fake|claude-code|anthropic|cli|herdr] [--store file|memory] [--store-dir DIR] [--quiet]
              --worker is the default runner; each agent may pick its own runner:. --worker fake overrides all of them.
              --store memory keeps the event log in RAM (demos, tests); file (default) appends to <store-dir>/events.ndjson.
  awd agents  <workflow.yaml>            # who does what: every agent, its runner/model/tools and the steps it owns
  awd memory  <workflow.yaml> [agent] [--forget <id>] [--json] [--store-dir DIR]   # long-term notes agents learned (memory.learned events)
  awd reflect <workflow.yaml> [--since 7d] [--json] [--to-board <id | title:...>] [--column Backlog] [--threshold 2] [--canvas URL] [--store-dir DIR]
              signals (every <step>.failed/timeout + reflection.noted) → patterns → with --to-board, ONE kanban card per pattern (idempotent)
  awd emit    <workflow.yaml> <event.type> [--data '{"card":"abc"}'] [--key KEY] [--store-dir DIR]
  awd status  <workflow.yaml> [key] [--store-dir DIR] [--json]
  awd replay  <workflow.yaml> [events.ndjson] [--key KEY] [--store-dir DIR]
  awd test    <workflow.yaml> [tests-dir | file.golden.yaml ...]
`

type Flags = Record<string, string | boolean>

function parseArgs(argv: string[]): { cmd: string; args: string[]; flags: Flags } {
  const [cmd = 'help', ...rest] = argv
  const args: string[] = []
  const flags: Flags = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2)
      if (inline !== undefined) flags[k] = inline
      else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) flags[k] = rest[++i]
      else flags[k] = true
    } else args.push(a)
  }
  return { cmd, args, flags }
}

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

function need(args: string[], i: number, what: string): string {
  if (!args[i]) { console.error(c.red(`missing ${what}`)); console.error(HELP); process.exit(2) }
  return args[i]
}

// ---------------------------------------------------------------- lint
function cmdLint(file: string): boolean {
  const { def } = loadWorkflow(file)
  const r = lint(def)
  for (const w of r.warnings) console.log(`${c.yellow('warn ')} ${w.where}: ${w.message}`)
  for (const e of r.errors) console.log(`${c.red('error')} ${e.where}: ${e.message}`)
  const summary = `${def.name}: ${def.triggers.length} triggers, ${def.steps.length} steps — ${r.errors.length} errors, ${r.warnings.length} warnings`
  console.log(r.ok ? c.green(summary) : c.red(summary))
  return r.ok
}

// ---------------------------------------------------------------- graph
async function cmdGraph(file: string, flags: Flags) {
  const { def } = loadWorkflow(file)
  if (flags.canvas !== undefined) {
    const applied = str(flags.applied)
    const r = await pushGraphToCanvas(def, { canvas: str(flags.canvas), runtime: str(flags.runtime), file, ...(applied ? { applied } : {}) })
    const n = toGraph(def).nodes.length
    console.log(`${c.green('✔')} ${def.name} — workflow.yaml → ${r.base}/b/${r.boardId}  (seq ${r.seq}, ${n} nodes, with block details)`)
    if (r.applied) console.log(`${c.green('✔')} answered "Applied to ${r.applied.file}" in thread ${applied}${r.applied.notes.length ? ` (${r.applied.notes.join('; ')})` : ''}`)
    return
  }
  if (flags.json) console.log(JSON.stringify(toGraph(def), null, 2))
  else console.log(toMermaid(def))
}

// ---------------------------------------------------------------- agents
function cmdAgents(file: string, flags: Flags) {
  const wf = loadWorkflow(file)
  const agents = Object.values(wf.agents)
  if (flags.json) return console.log(JSON.stringify(agents, null, 2))
  if (!agents.length) return console.log(c.dim('no agents: declared — ai steps use roles/*.md prompts'))
  for (const a of agents) {
    const steps = wf.def.steps.filter((s) => s.kind === 'ai' && s.ai.agent === a.id).map((s) => s.id)
    console.log(`${c.bold('@' + a.id)}  ${a.runner ?? '(default runner)'}${a.model ? ' · ' + a.model : ''}${a.effort ? ' · effort ' + a.effort : ''}`)
    if (a.description) console.log(`  ${a.description}`)
    console.log(`  steps: ${steps.join(', ') || c.dim('none')}`)
    if (a.tools?.length) console.log(`  tools: ${a.tools.join(', ')}`)
    if (a.delegates?.length) console.log(`  delegates to: ${a.delegates.map((d) => '@' + d).join(', ')}`)
    if (a.cli) console.log(`  cli: ${a.cli.preset ? 'preset ' + a.cli.preset : a.cli.command}`)
    if (a.herdr) console.log(`  herdr: ${a.herdr.kind} pane${a.herdr.name ? ' "' + a.herdr.name + '"' : ''}`)
    console.log(`  prompt: ${a.system ? a.system.trim().split('\n')[0].slice(0, 90) + (a.system.length > 90 ? '…' : '') : c.dim('(none)')}`)
  }
}

// ---------------------------------------------------------------- memory
async function cmdMemory(file: string, agent: string | undefined, flags: Flags) {
  const wf = loadWorkflow(file, { storeDir: str(flags['store-dir']) })
  const store = new FileEventStore(path.join(wf.storeDir, 'events.ndjson'))
  const memory = new FileMemoryStore(path.join(wf.storeDir, 'memory'))
  await syncMemory(store.all(), memory) // the projection may be behind (or missing) — the log is the truth
  const forget = str(flags.forget)
  if (forget) {
    if (!agent) { console.error(c.red('--forget needs the agent: awd memory <wf> <agent> --forget <id>')); process.exit(2) }
    const ok = await memory.forget(agent, forget)
    console.log(ok ? `${c.green('✔')} forgot ${forget} (@${agent}) — note: the memory.learned event stays in the log; only the projection forgets` : c.red(`no entry ${forget} for @${agent}`))
    return
  }
  const entries = await memory.list(agent)
  if (flags.json) return console.log(JSON.stringify(entries, null, 2))
  if (!entries.length) return console.log(c.dim(agent ? `@${agent} has learned nothing yet` : 'no long-term memory yet (agents add `learn: [...]` to an answer)'))
  let current = ''
  for (const e of entries) {
    if (e.agent !== current) { current = e.agent; console.log(c.bold('@' + e.agent)) }
    console.log(`  ${c.dim(e.at.slice(0, 16).replace('T', ' '))} ${c.dim(e.id)} ${e.key ? c.dim('[' + e.key + '] ') : ''}${e.note}${e.tags.length ? c.dim('  #' + e.tags.join(' #')) : ''}`)
  }
  console.log(c.dim(`${entries.length} notes in ${path.join(wf.storeDir, 'memory')}`))
}

// ---------------------------------------------------------------- reflect
async function cmdReflect(file: string, flags: Flags) {
  const wf = loadWorkflow(file, { storeDir: str(flags['store-dir']) })
  const store = new FileEventStore(path.join(wf.storeDir, 'events.ndjson'))
  const since = str(flags.since) ? Date.now() - parseDuration(str(flags.since), '--since') : undefined
  const threshold = flags.threshold !== undefined ? Number(flags.threshold) : 2
  const patterns = patternsOf(store.all(), { since })
  const decisions = decisionsOf(patterns, { threshold })
  const board = str(flags['to-board'])
  if (flags.json && !board) return console.log(JSON.stringify({ patterns, decisions: decisions.map((d) => d.id) }, null, 2))
  if (!board) {
    console.log(renderPatterns(patterns, { threshold }))
    if (decisions.length) console.log(c.dim(`${decisions.length} pattern(s) would become cards: awd reflect ${path.relative(process.cwd(), wf.file)} --to-board "title:<kanban board>"`))
    return
  }
  const cards = decisions.map(cardForPattern)
  if (!cards.length) return console.log(c.dim('no pattern past the threshold — nothing to put on the board'))
  const r = await canvasCards({ base: str(flags.canvas) }).upsertCards(board, cards, str(flags.column) ?? 'Backlog')
  if (flags.json) return console.log(JSON.stringify(r, null, 2))
  console.log(`${c.green('✔')} ${r.created.length} card(s) created, ${r.updated.length} updated, ${cards.length - r.created.length - r.updated.length} unchanged → ${r.url}`)
  for (const card of cards) console.log(`  ${c.dim(card.id)} ${card.title} ${c.dim(`(${card.count}×)`)}`)
}

// ---------------------------------------------------------------- run
async function cmdRun(file: string, flags: Flags) {
  const wf = loadWorkflow(file, { storeDir: str(flags['store-dir']) })
  const r = lint(wf.def)
  for (const w of r.warnings) console.log(`${c.yellow('warn ')} ${w.where}: ${w.message}`)
  if (!r.ok) { for (const e of r.errors) console.log(`${c.red('error')} ${e.where}: ${e.message}`); process.exit(1) }

  const workerName = str(flags.worker) ?? 'fake'
  if (!WORKER_NAMES.includes(workerName as never)) { console.error(c.red(`unknown worker "${workerName}" (${WORKER_NAMES.join(' | ')})`)); process.exit(2) }
  const storeKind = str(flags.store) === 'memory' ? 'memory' : 'file'
  const log = flags.quiet ? undefined : (l: string) => console.log(`${c.dim(new Date().toISOString().slice(11, 19))} ${l}`)
  const port = Number(flags.port ?? 4311)
  // The composition root wires the adapters; each agent picks its runner, --worker is
  // the default, and `fake` forces everything (tests, dry runs).
  const rt = createRuntime({ workflow: wf, store: storeKind, worker: workerName, port, log })
  await rt.start()

  const hooks = wf.def.triggers.filter((t) => t.on === 'webhook').map((t) => `  POST http://localhost:${port}${t.path}  → ${t.emit}`)
  const crons = wf.def.triggers.filter((t) => t.on === 'cron').map((t) => `  cron ${t.id} ${t.every ? 'every ' + formatDuration(t.every) : 'at ' + t.at} → ${t.emit}`)
  console.log(c.bold(`${wf.def.name} running`) + ` (default worker: ${rt.worker.name}, store: ${storeKind === 'memory' ? 'memory' : wf.storeDir})`)
  for (const a of Object.values(wf.agents)) console.log(`  @${a.id}: ${workerName === 'fake' ? 'fake' : a.runner ?? workerName}${a.model ? ' · ' + a.model : ''}${a.tools?.length ? ' · tools ' + a.tools.join(',') : ''}`)
  for (const l of [...hooks, ...crons]) console.log(l)
  console.log(`  status: http://localhost:${port}/api/status   emit: awd emit ${path.relative(process.cwd(), wf.file)} <event.type> --data '{...}'`)

  const shutdown = () => { void rt.stop().then(() => process.exit(0)) }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
}

// ---------------------------------------------------------------- emit
function cmdEmit(file: string, type: string, flags: Flags) {
  const wf = loadWorkflow(file, { storeDir: str(flags['store-dir']) })
  const data = flags.data ? JSON.parse(String(flags.data)) : undefined
  const store = new FileEventStore(path.join(wf.storeDir, 'events.ndjson'))
  const draft = { id: 'pending', type, data, ts: new Date().toISOString() }
  const key = str(flags.key) ?? keyFor(wf.def, draft, process.env as Record<string, string>)
  const ev = store.append({ type, key, data, meta: { trigger: 'cli' } })
  console.log(`${c.green('emitted')} ${ev.type} [${ev.key}] id=${ev.id}`)
}

// ---------------------------------------------------------------- status
function cmdStatus(file: string, key: string | undefined, flags: Flags) {
  const wf = loadWorkflow(file, { storeDir: str(flags['store-dir']) })
  const store = new FileEventStore(path.join(wf.storeDir, 'events.ndjson'))
  const states = projectStates(wf.def, store.all(), { roles: wf.roles, agents: wf.agents, env: process.env as Record<string, string> })
  const list = [...states.values()].filter((s) => !key || s.key === key)
  if (flags.json) return console.log(JSON.stringify(list, null, 2))
  if (!list.length) return console.log(c.dim(`no runs (${store.size()} events in ${wf.storeDir})`))
  for (const s of list) printRun(s)
  console.log(c.dim(`${list.length} runs, ${store.size()} events`))
}

function printRun(s: RunState) {
  const color = s.status === 'done' ? c.green : s.status === 'failed' ? c.red : s.status === 'waiting' ? c.yellow : (x: string) => x
  const active = Object.entries(s.active).map(([k, a]) => `${k}(running${a.agent ? ' @' + a.agent : ''})`)
  const waiting = Object.keys(s.waiting).map((k) => `${k}(waiting ${s.waiting[k].resumeOn.join('|')})`)
  console.log(`${c.bold(s.key)} ${color(s.status)} ${[...active, ...waiting].join(' ')}`)
  const trail = s.history.map((h) => `${h.step}.${h.outcome === 'failed' || h.outcome === 'timeout' ? c.red(h.outcome) : h.outcome}`).join(' → ')
  if (trail) console.log(`  ${trail}`)
  if (s.pending.length) console.log(`  pending: ${s.pending.map((p) => p.step).join(', ')}`)
}

// ---------------------------------------------------------------- replay
function cmdReplay(file: string, eventsFile: string | undefined, flags: Flags) {
  const wf = loadWorkflow(file, { storeDir: str(flags['store-dir']) })
  const src = eventsFile ?? path.join(wf.storeDir, 'events.ndjson')
  const events: Event[] = fs.readFileSync(src, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const byKey = new Map<string, Event[]>()
  for (const e of events) {
    if (e.type.startsWith('timer.')) continue
    const k = e.key || keyFor(wf.def, e)
    byKey.set(k, [...(byKey.get(k) ?? []), { ...e, key: k }])
  }
  for (const [k, evs] of byKey) {
    if (flags.key && k !== flags.key) continue
    console.log(c.bold(`── ${k}`))
    const r = replay(wf.def, k, evs, { roles: wf.roles, agents: wf.agents })
    for (const step of r.steps) {
      console.log(`  ${c.dim(step.event.ts.slice(11, 19))} ${step.event.type}${step.event.data !== undefined ? ' ' + c.dim(short(step.event.data)) : ''}`)
      for (const cmd of step.commands) console.log(`      ${c.yellow('→')} ${describe(cmd)}`)
    }
    printRun(r.state)
  }
}

function short(v: unknown): string {
  const s = JSON.stringify(v) ?? ''
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}

function describe(cmd: Command): string {
  switch (cmd.kind) {
    case 'run_script': return `run_script ${cmd.step}: ${cmd.cmd}`
    case 'call_ai': return `call_ai ${cmd.step} @${cmd.agent ?? cmd.role ?? 'model'}${cmd.runner ? ' via ' + cmd.runner : ''} input=${short(cmd.input)}`
    case 'wait_human': return `wait_human ${cmd.step} on ${cmd.resumeOn.join('|')}`
    case 'emit': return `emit ${cmd.event.type}`
    case 'schedule': return `schedule ${cmd.event.type} at ${new Date(cmd.at).toISOString()}`
    case 'cancel_schedule': return `cancel ${cmd.scheduleId}`
  }
}

// ---------------------------------------------------------------- test
interface Golden {
  name?: string
  key?: string
  /** replay (default): every event is given, only the reducer runs. run: only trigger events are given; scripts + fake worker execute. */
  mode?: 'replay' | 'run'
  events: Array<{ type: string; data?: unknown; key?: string }>
  fixtures?: Record<string, unknown>
  expect: {
    outcomes?: string[]
    status?: string
    commands?: Array<Record<string, unknown>>
    state?: Record<string, unknown>
    vars?: Record<string, unknown>
    /** run mode: events that must appear in the produced log, in order (partial match; `~x` = contains). */
    events?: Array<Record<string, unknown>>
  }
}

async function cmdTest(file: string, targets: string[]): Promise<boolean> {
  const wf = loadWorkflow(file)
  const l = lint(wf.def)
  if (!l.ok) { for (const e of l.errors) console.log(`${c.red('error')} ${e.where}: ${e.message}`); return false }
  const files = collectGoldens(targets.length ? targets : [path.join(wf.dir, 'tests')])
  if (!files.length) { console.log(c.yellow('no *.golden.yaml files found')); return true }
  let pass = 0, fail = 0
  for (const f of files) {
    const g = YAML.parse(fs.readFileSync(f, 'utf8')) as Golden
    const name = g.name ?? path.basename(f).replace(/\.golden\.ya?ml$/, '')
    const problems = await runGolden(wf, g)
    if (problems.length) { fail++; console.log(`${c.red('✖')} ${name}`); for (const p of problems) console.log(`    ${p}`) }
    else { pass++; console.log(`${c.green('✔')} ${name}`) }
  }
  console.log(fail ? c.red(`${pass} passed, ${fail} failed`) : c.green(`${pass} passed`))
  return fail === 0
}

function collectGoldens(targets: string[]): string[] {
  const out: string[] = []
  for (const t of targets) {
    if (!fs.existsSync(t)) continue
    if (fs.statSync(t).isDirectory()) for (const f of fs.readdirSync(t).sort()) if (/\.golden\.ya?ml$/.test(f)) out.push(path.join(t, f))
    else out.push(t)
  }
  return out
}

async function runGolden(wf: ReturnType<typeof loadWorkflow>, g: Golden): Promise<string[]> {
  const problems: string[] = []
  let t0 = Date.parse('2026-01-01T00:00:00Z')
  const mk = (e: Golden['events'][number], i: number): Event => {
    const ts = new Date(t0 + i * 1000).toISOString()
    const draft = { id: `g${i + 1}`, type: e.type, data: e.data, ts }
    return { ...draft, key: e.key ?? g.key ?? safeKey(wf.def, draft) }
  }
  let state: RunState
  let commands: Command[] = []
  let produced: Event[] = []
  if ((g.mode ?? 'replay') === 'replay') {
    const events = g.events.map(mk)
    const key = g.key ?? events[0]?.key ?? 'k'
    const r = replay(wf.def, key, events.map((e) => ({ ...e, key })), { roles: wf.roles, agents: wf.agents })
    state = r.state
    commands = r.steps.flatMap((s) => s.commands)
  } else {
    // Golden runs: memory store, fake worker, no triggers — the same engine, other adapters.
    const rt = createRuntime({ workflow: wf, store: 'memory', worker: new FakeWorker(wf.fixturesDir, g.fixtures ?? {}), port: false, cron: false, timerIntervalMs: 20 })
    const { store, engine } = rt
    await rt.start()
    const key = g.key ?? safeKey(wf.def, { ...g.events[0], id: 'g1', ts: new Date().toISOString() })
    for (const e of g.events) {
      store.append({ type: e.type, key: e.key ?? key, data: e.data })
      await engine.idle()
    }
    await rt.stop()
    state = engine.states.get(key) ?? { status: 'idle', history: [], vars: {} } as unknown as RunState
    const all = store.all()
    produced = all
    // Commands in run mode are derived by re-reducing the produced log.
    commands = replay(wf.def, key, all.filter((e) => !e.type.startsWith('timer.')).map((e) => ({ ...e, key })), { roles: wf.roles, agents: wf.agents }).steps.flatMap((s) => s.commands)
  }

  const ex = g.expect ?? {}
  if (ex.outcomes) {
    const got = state.history.map((h) => `${h.step}.${h.outcome}`)
    if (JSON.stringify(got) !== JSON.stringify(ex.outcomes)) problems.push(`outcomes\n      expected ${JSON.stringify(ex.outcomes)}\n      got      ${JSON.stringify(got)}`)
  }
  if (ex.status && state.status !== ex.status) problems.push(`status: expected ${ex.status}, got ${state.status}`)
  if (ex.vars) for (const [k, v] of Object.entries(ex.vars)) if (!partialMatch(state.vars[k], v)) problems.push(`vars.${k}: expected ${short(v)}, got ${short(state.vars[k])}`)
  if (ex.state && !partialMatch(state, ex.state)) problems.push(`state does not match ${short(ex.state)}`)
  if (ex.commands) {
    let i = 0
    for (const want of ex.commands) {
      while (i < commands.length && !partialMatch(commands[i], want)) i++
      if (i >= commands.length) { problems.push(`command not found (in order): ${short(want)}\n      produced: ${commands.map(describe).join(' | ') || '(none)'}`); break }
      i++
    }
  }
  if (ex.events) {
    if ((g.mode ?? 'replay') !== 'run') problems.push('expect.events needs mode: run')
    let i = 0
    for (const want of ex.events) {
      while (i < produced.length && !partialMatch(produced[i], want)) i++
      if (i >= produced.length) { problems.push(`event not found (in order): ${short(want)}\n      produced: ${produced.map((e) => e.type).join(' | ') || '(none)'}`); break }
      i++
    }
  }
  return problems
}

function safeKey(def: ReturnType<typeof loadWorkflow>['def'], ev: { id: string; type: string; data?: unknown; ts: string }): string {
  try { return keyFor(def, ev) } catch { return ev.id }
}

/** `want` ⊆ `got`, recursively; arrays must match element-wise. */
function partialMatch(got: unknown, want: unknown): boolean {
  if (want === null || typeof want !== 'object') return got === want || (typeof want === 'string' && typeof got === 'string' && want.startsWith('~') && got.includes(want.slice(1)))
  if (Array.isArray(want)) return Array.isArray(got) && want.length === got.length && want.every((w, i) => partialMatch(got[i], w))
  if (got === null || typeof got !== 'object') return false
  return Object.entries(want as Record<string, unknown>).every(([k, v]) => partialMatch((got as Record<string, unknown>)[k], v))
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined
}

// ---------------------------------------------------------------- main
const { cmd, args, flags } = parseArgs(process.argv.slice(2))
try {
  switch (cmd) {
    case 'lint': process.exit(cmdLint(need(args, 0, 'workflow file')) ? 0 : 1)
    case 'graph': await cmdGraph(need(args, 0, 'workflow file'), flags); break
    case 'design': process.exit((await (await import('./design.js')).cmdDesign(args, flags)) ? 0 : 1)
    case 'studio': await (await import('./studio.js')).cmdStudio(args[0], flags); break
    case 'mcp': await (await import('./mcp.js')).cmdMcp(); break
    case 'boards': process.exit((await (await import('./projects.js')).cmdBoards(args, flags)) ? 0 : 1)
    case 'projects': process.exit((await (await import('./projects.js')).cmdProjects(args, flags)) ? 0 : 1)
    case 'run': await cmdRun(need(args, 0, 'workflow file'), flags); break
    case 'emit': cmdEmit(need(args, 0, 'workflow file'), need(args, 1, 'event type'), flags); break
    case 'status': cmdStatus(need(args, 0, 'workflow file'), args[1], flags); break
    case 'agents': cmdAgents(need(args, 0, 'workflow file'), flags); break
    case 'memory': await cmdMemory(need(args, 0, 'workflow file'), args[1], flags); break
    case 'reflect': await cmdReflect(need(args, 0, 'workflow file'), flags); break
    case 'replay': cmdReplay(need(args, 0, 'workflow file'), args[1], flags); break
    case 'test': process.exit((await cmdTest(need(args, 0, 'workflow file'), args.slice(1))) ? 0 : 1)
    case 'help': case '--help': case '-h': console.log(HELP); break
    default: console.error(c.red(`unknown command "${cmd}"`)); console.log(HELP); process.exit(2)
  }
} catch (e) {
  console.error(c.red((e as Error).message))
  if (process.env.AWD_DEBUG) console.error((e as Error).stack)
  process.exit(1)
}
