// Runs a `script` step. Contract with the script:
//   env    AWD_EVENT (JSON) · AWD_KEY · AWD_STEP · AWD_ATTEMPT
//   stdin  { event, vars, key, step, attempt } as JSON
//   stdout last line that parses as JSON → { outcome, data }; nothing → done
//   exit   non-zero → <step>.failed with the stderr tail

import { spawn } from 'node:child_process'
import type { RunScriptCommand, ScriptResult, ScriptRunner } from '../../ports/scriptRunner.js'

export type { RunScriptCommand, ScriptResult }

/** The ScriptRunner adapter: `sh -c` in the workflow's directory. */
export const shellScriptRunner: ScriptRunner = (cmd, opts) => runScript(cmd, opts)

export async function runScript(cmd: RunScriptCommand, opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<ScriptResult> {
  const started = Date.now()
  const stdinObj = cmd.stdin as { event?: unknown }
  const env = {
    ...process.env,
    ...opts.env,
    ...cmd.env,
    AWD_EVENT: JSON.stringify(stdinObj?.event ?? null),
    AWD_KEY: cmd.key,
    AWD_STEP: cmd.step,
    AWD_ATTEMPT: String(cmd.attempt),
  }
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd.cmd], { cwd: cmd.cwd ?? opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    let timedOut = false
    const timer = cmd.timeout ? setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, cmd.timeout) : undefined
    const finish = (code: number | null, err?: Error) => {
      if (timer) clearTimeout(timer)
      const durationMs = Date.now() - started
      if (err) return resolve({ outcome: 'failed', data: { error: err.message }, stdout, stderr, code, durationMs })
      if (timedOut) return resolve({ outcome: 'timeout', data: { error: `killed after ${cmd.timeout}ms` }, stdout, stderr, code, durationMs })
      if (code !== 0) return resolve({ outcome: 'failed', data: { error: `exit ${code}`, stderr: stderr.slice(-2000), stdout: stdout.slice(-500) }, stdout, stderr, code, durationMs })
      const parsed = lastJsonLine(stdout)
      if (parsed && typeof parsed === 'object' && typeof (parsed as { outcome?: unknown }).outcome === 'string') {
        const p = parsed as { outcome: string; data?: unknown; reflect?: unknown }
        return resolve({ outcome: p.outcome, data: p.data ?? stripOutcome(p), reflect: p.reflect, stdout, stderr, code, durationMs })
      }
      resolve({ outcome: 'done', data: parsed ?? (stdout.trim() ? { stdout: stdout.trim().slice(-2000) } : undefined), stdout, stderr, code, durationMs })
    }
    child.on('error', (e) => finish(null, e))
    child.on('close', (code) => finish(code))
    child.stdin.on('error', () => { /* script closed stdin early — fine */ })
    child.stdin.end(JSON.stringify(cmd.stdin ?? null))
  })
}

function stripOutcome(p: Record<string, unknown>): Record<string, unknown> | undefined {
  const { outcome: _o, reflect: _r, ...rest } = p
  return Object.keys(rest).length ? rest : undefined
}

export function lastJsonLine(text: string): unknown {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{') && !lines[i].startsWith('[')) continue
    try { return JSON.parse(lines[i]) } catch { /* not this line */ }
  }
  return undefined
}
