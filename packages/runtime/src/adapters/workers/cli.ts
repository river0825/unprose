// Generic headless runner for any CLI agent that can print its answer:
// `codex exec --json -`, `opencode run --format json`, or anything you name.
// The prompt goes in on stdin (or as the last argument), the answer is the
// last JSON object the tool printed — validated by the executor afterwards.

import { spawn } from 'node:child_process'
import type { WorkerRuntime, WorkerRequest, WorkerResult } from '../../ports/workerRuntime.js'
import { renderPrompt, extractJsonAnswer } from '../../application/prompting.js'
import { template } from '@awd/core'

export interface CliRunnerConfig {
  /** Shell command; templated with { agent, model, step, key }. `-` at the end means "prompt on stdin". */
  command?: string
  /** Named presets so a user can say `preset: codex` instead of remembering flags. */
  preset?: 'codex' | 'opencode'
  cwd?: string
  timeoutMs?: number
  /** Feed the prompt on stdin (default true; false appends it as the last argument). */
  stdin?: boolean
}

export const CLI_PRESETS: Record<string, Required<Pick<CliRunnerConfig, 'command' | 'stdin'>>> = {
  // codex: JSONL events; `-` reads the prompt from stdin; read-only sandbox by default.
  codex: { command: 'codex exec --json -s read-only{{ model ? " -m " + model : "" }} -', stdin: true },
  // opencode: JSONL events; the message is a positional argument.
  opencode: { command: 'opencode run --format json{{ model ? " -m " + model : "" }}', stdin: false },
}

export interface CliWorkerOptions {
  cwd?: string
  /** Injected for tests. */
  exec?: (cmd: string, stdin: string | undefined, opts: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string; code: number | null }>
}

export class CliWorker implements WorkerRuntime {
  readonly name = 'cli'
  constructor(private opts: CliWorkerOptions = {}) {}

  async run(req: WorkerRequest): Promise<WorkerResult> {
    const cfg = (req.runnerConfig ?? {}) as CliRunnerConfig
    const preset = cfg.preset ? CLI_PRESETS[cfg.preset] : undefined
    if (cfg.preset && !preset) throw new Error(`unknown cli preset "${cfg.preset}" (${Object.keys(CLI_PRESETS).join('|')})`)
    const commandTpl = cfg.command ?? preset?.command
    if (!commandTpl) throw new Error(`agent ${req.agent ?? req.step}: runner cli needs cli.command or cli.preset`)
    const scope = { agent: req.agent, model: req.model, step: req.step, key: req.key }
    let command = String(template(commandTpl, scope))
    const useStdin = cfg.stdin ?? preset?.stdin ?? true
    // The system prompt has no slot of its own on a generic CLI: it rides in front of the user turn.
    const prompt = renderPrompt(req, true)
    if (!useStdin) command += ' ' + shellQuote(prompt)
    const started = Date.now()
    const exec = this.opts.exec ?? execShell
    const { stdout, stderr, code } = await exec(command, useStdin ? prompt : undefined, { cwd: cfg.cwd ?? this.opts.cwd, timeout: cfg.timeoutMs ?? req.timeout })
    if (code !== 0) throw new Error(`cli agent exited ${code}: ${stderr.slice(-1500) || stdout.slice(-1500)}`)
    const output = extractJsonAnswer(stdout)
    if (!output) throw new Error(`cli agent printed no JSON answer: ${stdout.slice(-800)}`)
    return { output, raw: stdout.slice(-4000), usage: { durationMs: Date.now() - started, ...usageFrom(stdout) } }
  }
}

function usageFrom(stdout: string): { inputTokens?: number; outputTokens?: number } {
  // codex: turn.completed.usage · opencode: step_finish.part.tokens
  for (const line of stdout.split('\n').reverse()) {
    if (!line.trim().startsWith('{')) continue
    try {
      const ev = JSON.parse(line)
      const u = ev.usage ?? ev.part?.tokens
      if (u && typeof u === 'object') return { inputTokens: u.input_tokens ?? u.input, outputTokens: u.output_tokens ?? u.output }
    } catch { /* keep looking */ }
  }
  return {}
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function execShell(cmd: string, stdin: string | undefined, opts: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', cmd], { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = opts.timeout ? setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out after ${opts.timeout}ms`)) }, opts.timeout) : undefined
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e) })
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ stdout, stderr, code }) })
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}
