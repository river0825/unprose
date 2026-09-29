// "A2A without A2A": drive an interactive coding agent (codex, claude,
// opencode, gemini …) that lives in a herdr pane. awd never talks to the
// model — it writes a mailbox file, sends ONE prompt through herdr, waits for
// the agent to go idle/done, and reads the answer file back. The pane stays
// open on purpose: the person can watch, and a `blocked` dialog is theirs to
// answer, never ours.

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { WorkerRuntime, WorkerRequest, WorkerResult } from './types.js'
import { jsonFromText } from './types.js'

export interface HerdrRunnerConfig {
  /** herdr agent kind: codex | claude | opencode | gemini | … */
  kind: string
  /** Live agent name to reuse; default `awd-<agent>`. */
  name?: string
  cwd?: string
  /** How long one prompt may take (default 15 min). */
  timeoutMs?: number
}

export type HerdrExec = (args: string[]) => Promise<{ stdout: string; stderr: string; code: number | null }>

export interface HerdrWorkerOptions {
  bin?: string
  /** Where mailboxes live (default <cwd>/.awd/mail). */
  mailDir?: string
  cwd?: string
  /** Injected for tests: fake `herdr` responses. */
  exec?: HerdrExec
  /** How often to look for the answer file (ms). */
  pollMs?: number
  /** Pause after a freshly started agent reports ready, before the first prompt (ms). */
  settleMs?: number
  /** How often to ask herdr for the agent's state while waiting for the answer file (ms). */
  stateEveryMs?: number
  /** How long an idle/done agent may stay silent before we give up on the file (ms). */
  idleGraceMs?: number
}

interface HerdrAgentRow { agent: string; agent_status: string; name?: string; pane_id: string; cwd?: string }

export class HerdrWorker implements WorkerRuntime {
  readonly name = 'herdr'
  private exec: HerdrExec
  constructor(private opts: HerdrWorkerOptions = {}) {
    this.exec = opts.exec ?? ((args) => herdrExec(opts.bin ?? 'herdr', args))
  }

  async run(req: WorkerRequest): Promise<WorkerResult> {
    const cfg = req.runnerConfig as HerdrRunnerConfig | undefined
    if (!cfg?.kind) throw new Error(`agent ${req.agent ?? req.step}: runner herdr needs herdr.kind`)
    const agentName = cfg.name ?? `awd-${(req.agent ?? req.step).replace(/[^a-z0-9_-]/g, '-')}`.slice(0, 32)
    const cwd = cfg.cwd ?? this.opts.cwd ?? process.cwd()
    const timeoutMs = cfg.timeoutMs ?? 15 * 60_000
    const started = Date.now()

    // (a) a live agent to talk to — reuse one that is ready, else start one in a fresh pane.
    await this.ensureAgent(agentName, cfg.kind, cwd)

    // (b) the mailbox: input in, answer out. The file is the contract, not the terminal text.
    const mailDir = this.opts.mailDir ?? path.join(cwd, '.awd', 'mail')
    fs.mkdirSync(mailDir, { recursive: true })
    const id = (req.commandId ?? `${req.key}-${req.step}-${Date.now()}`).replace(/[^A-Za-z0-9_.-]/g, '_')
    const inFile = path.join(mailDir, `${id}.in.json`)
    const outFile = path.join(mailDir, `${id}.out.json`)
    fs.writeFileSync(inFile, JSON.stringify({ step: req.step, key: req.key, system: req.system ?? null, input: req.input, outputSchema: req.outputSchema }, null, 2))
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile)
    const prompt = buildPrompt(req, inFile, outFile)

    // (c) submit the prompt — submission only; we do not wait on the agent's
    // lifecycle, because the answer file is the contract, not the TUI state.
    const r = await this.exec(['agent', 'prompt', agentName, prompt])
    const submitState = stateOf(r)
    if (submitState === 'blocked' || submitState === 'agent_blocked') throw new Error(`agent_blocked: ${agentName} is waiting for a human in its herdr pane — answer it there; a retry re-prompts`)
    if (r.code !== 0) throw new Error(`herdr agent prompt failed (${submitState ?? r.code}): ${(r.stderr || r.stdout).slice(-600)}`)

    // (d) poll for the answer file while watching the agent: a `blocked` dialog is
    // the person's to answer; an agent that went quiet without writing the file failed.
    const poll = this.opts.pollMs ?? 500
    const stateEvery = this.opts.stateEveryMs ?? 2000
    const idleGraceMs = this.opts.idleGraceMs ?? 20_000
    const deadline = Date.now() + timeoutMs
    let nextStateCheck = Date.now() + stateEvery
    let idleSince: number | undefined
    let state: string | undefined
    while (Date.now() < deadline) {
      const output = this.readAnswer(outFile)
      if (output) return { output, raw: { agent: agentName, inFile, outFile, state }, usage: { durationMs: Date.now() - started } }
      if (Date.now() >= nextStateCheck) {
        nextStateCheck = Date.now() + stateEvery
        state = await this.exec(['agent', 'get', agentName]).then(stateOf).catch(() => undefined)
        if (state === 'blocked') throw new Error(`agent_blocked: ${agentName} is waiting for a human in its herdr pane — answer it there; a retry re-prompts`)
        if (state === 'idle' || state === 'done') {
          idleSince ??= Date.now()
          if (Date.now() - idleSince > idleGraceMs) break
        } else idleSince = undefined
      }
      await new Promise((res) => setTimeout(res, poll))
    }
    const tail = await this.exec(['agent', 'read', agentName, '--lines', '40']).then((x) => x.stdout.slice(-1200)).catch(() => '')
    throw new Error(`herdr agent ${agentName} ${state === 'idle' || state === 'done' ? 'finished' : 'timed out'} without a valid ${path.basename(outFile)}; pane tail:\n${tail}`)
  }

  private readAnswer(file: string): Record<string, unknown> | undefined {
    if (!fs.existsSync(file)) return undefined
    return jsonFromText(fs.readFileSync(file, 'utf8')) ?? undefined
  }

  private async ensureAgent(name: string, kind: string, cwd: string): Promise<void> {
    const list = await this.exec(['agent', 'list'])
    const rows = parseAgents(list.stdout)
    const mine = rows.find((a) => a.name === name)
    if (mine) {
      if (mine.agent_status === 'blocked') throw new Error(`agent_blocked: ${name} is blocked in pane ${mine.pane_id} — resolve it there`)
      if (mine.agent_status === 'working') throw new Error(`agent_busy: ${name} is still working in pane ${mine.pane_id}`)
      return // idle / done / unknown: ready enough for a prompt
    }
    // No agent with that name: open a pane beside the caller (or a new tab) and start one.
    let paneId: string | undefined
    const split = await this.exec(['pane', 'split', '--direction', 'right', '--cwd', cwd, '--no-focus'])
    paneId = idFrom(split.stdout, ['result', 'pane', 'pane_id'])
    if (!paneId) {
      const tab = await this.exec(['tab', 'create', '--cwd', cwd])
      paneId = idFrom(tab.stdout, ['result', 'root_pane', 'pane_id'])
    }
    if (!paneId) throw new Error(`could not open a herdr pane for ${name}: ${(split.stderr || split.stdout).slice(-400)}`)
    const start = await this.exec(['agent', 'start', name, '--kind', kind, '--pane', paneId])
    if (start.code !== 0) throw new Error(`herdr agent start ${name} (${kind}) failed: ${(start.stderr || start.stdout).slice(-600)}`)
    // `agent start` returns when herdr *detects* the agent, which can be before its
    // input box accepts text (codex shows a banner first) — a prompt sent then is
    // lost. Wait for the agent to report itself interactive, then let the TUI settle.
    await this.exec(['agent', 'wait', name, '--until', 'idle', '--until', 'done', '--timeout', '60000']).catch(() => undefined)
    const until = Date.now() + 30_000
    while (Date.now() < until) {
      const got = await this.exec(['agent', 'get', name])
      if (readyOf(got)) break
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 500))
    }
    await new Promise((r) => setTimeout(r, this.opts.settleMs ?? 1500))
  }


}

/**
 * One line on purpose: a newline inside the pasted text can be taken as Enter by
 * a TUI and submit half a prompt. The long parts (system prompt, input, schema)
 * live in the mailbox file the agent is told to read.
 */
function buildPrompt(req: WorkerRequest, inFile: string, outFile: string): string {
  return [
    `You are step "${req.step}" (key ${req.key}) of an automated workflow.`,
    `Read ${inFile} — it has your instructions ("system"), the input, and the output schema.`,
    'Do the work it describes.',
    `Then write your final answer as a single JSON object matching that schema to ${outFile} (nothing else in that file) and reply with the single word DONE.`,
  ].join(' ')
}

function readyOf(r: { stdout: string }): boolean {
  try {
    const j = JSON.parse(r.stdout)
    const a = j.result?.agent ?? j.result ?? j
    const status = a.agent_status ?? a.status
    return a.interactive_ready === true && (status === 'idle' || status === 'done' || status === undefined)
  } catch { return false }
}

function stateOf(r: { stdout: string }): string | undefined {
  try {
    const j = JSON.parse(r.stdout)
    const res = j.result ?? j
    // `agent get` / `agent prompt` nest the row under result.agent; `agent wait` reports state.
    return res.agent?.agent_status ?? res.state ?? res.status ?? res.agent_status ?? j.error?.code
  } catch { return undefined }
}

function parseAgents(stdout: string): HerdrAgentRow[] {
  try { return (JSON.parse(stdout).result?.agents ?? []) as HerdrAgentRow[] } catch { return [] }
}

function idFrom(stdout: string, pathKeys: string[]): string | undefined {
  try {
    let v: unknown = JSON.parse(stdout)
    for (const k of pathKeys) v = (v as Record<string, unknown> | undefined)?.[k]
    return typeof v === 'string' ? v : undefined
  } catch { return undefined }
}

export function herdrExec(bin: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? (err as unknown as { code: number }).code : err ? 1 : 0
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code })
    })
  })
}
