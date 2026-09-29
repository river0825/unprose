// Runs an agent through the local `claude` CLI in headless mode. Uses whatever
// login the user already has — no API key needed. Aliases (opus/sonnet) pass
// straight through; the CLI resolves them. The agent's system prompt is
// appended to Claude Code's own (`--append-system-prompt`) so tool use keeps
// working; `tools` becomes `--allowedTools`, `effort` becomes `--effort`.

import { spawn } from 'node:child_process'
import type { WorkerRuntime, WorkerRequest, WorkerResult } from '../../ports/workerRuntime.js'
import { renderPrompt } from '../../application/prompting.js'

export interface ClaudeCodeOptions {
  bin?: string
  cwd?: string
  /** Extra flags, e.g. ['--allowedTools', 'Read,Grep']. */
  args?: string[]
  permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
  defaultModel?: string
}

export interface ClaudeCodeRunnerConfig {
  permissionMode?: ClaudeCodeOptions['permissionMode']
  /** Working directory for this call — a card's git worktree, typically. */
  cwd?: string
  addDirs?: string[]
}

/** Tells the model where it is, and that the main checkout is off limits. */
export function workdirNote(cwd: string): string {
  return `Working directory: ${cwd}\nEvery file you read or change lives under that directory (it is this card's own git worktree). Never edit files outside it and never touch the main checkout.`
}

export class ClaudeCodeWorker implements WorkerRuntime {
  readonly name = 'claude-code'
  constructor(private opts: ClaudeCodeOptions = {}) {}

  async run(req: WorkerRequest): Promise<WorkerResult> {
    // Per-agent `claudeCode: { permissionMode, cwd, addDirs }` (already templated by the reducer).
    const cfg = (req.runnerConfig ?? {}) as ClaudeCodeRunnerConfig
    const cwd = cfg.cwd || this.opts.cwd
    const system = [req.system, cwd ? workdirNote(cwd) : undefined].filter((s) => s && s.trim()).join('\n\n') || undefined
    const args = [
      '-p', '--output-format', 'json',
      '--json-schema', JSON.stringify(req.outputSchema),
      '--model', req.model ?? this.opts.defaultModel ?? 'sonnet',
      '--permission-mode', cfg.permissionMode ?? this.opts.permissionMode ?? 'default',
      ...(system ? ['--append-system-prompt', system] : []),
      ...(req.tools?.length ? ['--allowedTools', ...req.tools] : []),
      ...(req.effort ? ['--effort', req.effort] : []),
      ...(cfg.addDirs ?? []).flatMap((d) => ['--add-dir', d]),
      // `maxTurns` has no flag in this claude version; it is honoured by the anthropic runner only.
      ...(this.opts.args ?? []),
    ]
    const started = Date.now()
    const { stdout, stderr, code } = await runProcess(this.opts.bin ?? 'claude', args, renderPrompt(req, false), req.timeout, cwd)
    if (code !== 0) throw new Error(`claude exited ${code}: ${stderr.slice(-2000) || stdout.slice(-2000)}`)
    const envelope = parseEnvelope(stdout)
    if (envelope.is_error) throw new Error(`claude reported an error (${envelope.subtype ?? '?'}): ${String(envelope.result ?? '').slice(0, 500)}`)
    const output = extractOutput(envelope)
    if (!output) throw new Error(`claude returned no structured output: ${stdout.slice(0, 500)}`)
    const usage = envelope.usage as Record<string, number> | undefined
    return {
      output,
      raw: envelope,
      usage: {
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        costUsd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : undefined,
        durationMs: Date.now() - started,
      },
    }
  }
}

function parseEnvelope(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim()
  try { return JSON.parse(trimmed) } catch { /* fallthrough */ }
  // stream-ish output: last JSON line wins
  const lines = trimmed.split('\n').filter((l) => l.trim().startsWith('{'))
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]) } catch { /* keep looking */ }
  }
  throw new Error(`claude output is not JSON: ${trimmed.slice(0, 300)}`)
}

function extractOutput(envelope: Record<string, unknown>): Record<string, unknown> | undefined {
  if (envelope.structured_output && typeof envelope.structured_output === 'object') return envelope.structured_output as Record<string, unknown>
  const result = envelope.result
  if (typeof result === 'object' && result !== null) return result as Record<string, unknown>
  if (typeof result === 'string') {
    const m = /\{[\s\S]*\}/.exec(result.replace(/```(?:json)?/g, ''))
    if (m) { try { return JSON.parse(m[0]) } catch { /* not JSON */ } }
  }
  return undefined
}

export function runProcess(bin: string, args: string[], stdin: string, timeout?: number, cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = timeout ? setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out after ${timeout}ms`)) }, timeout) : undefined
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e) })
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ stdout, stderr, code }) })
    child.stdin.end(stdin)
  })
}
