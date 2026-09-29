// AgentChannel adapter: herdr's socket CLI. Every control command returns JSON;
// ids come from those responses, never guessed.

import { execFile } from 'node:child_process'
import type { AgentChannel, AgentRow } from '../../ports/agentChannel.js'

export interface ExecResult { stdout: string; stderr: string; code: number | null }
export type Exec = (args: string[]) => Promise<ExecResult>

export function herdrExec(bin: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : err ? 1 : 0
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? (err?.message ?? '')), code })
    })
  })
}

export class HerdrChannel implements AgentChannel {
  private exec: Exec
  constructor(bin = 'herdr', exec?: Exec) {
    this.exec = exec ?? ((args) => herdrExec(bin, args))
  }

  async list(): Promise<AgentRow[]> {
    const r = await this.exec(['agent', 'list'])
    return parse(r.stdout)?.result?.agents ?? []
  }

  async start(name: string, kind: string, paneId: string, args: string[] = []): Promise<void> {
    const r = await this.exec(['agent', 'start', name, '--kind', kind, '--pane', paneId, ...(args.length ? ['--', ...args] : [])])
    if (r.code !== 0) throw new Error(`herdr agent start ${name} (${kind}) failed: ${(r.stderr || r.stdout).slice(-600)}`)
  }

  async prompt(name: string, text: string) {
    const r = await this.exec(['agent', 'prompt', name, text])
    const j = parse(r.stdout)
    const state = j?.result?.agent?.agent_status ?? j?.result?.state ?? j?.error?.code
    return { ok: r.code === 0, state, detail: r.code === 0 ? undefined : (r.stderr || r.stdout).slice(-600) }
  }

  async get(name: string): Promise<AgentRow | undefined> {
    const r = await this.exec(['agent', 'get', name])
    return parse(r.stdout)?.result?.agent
  }

  async read(name: string, lines = 40): Promise<string> {
    const r = await this.exec(['agent', 'read', name, '--lines', String(lines), '--format', 'text'])
    return r.stdout
  }

  async wait(name: string, until: string[], timeoutMs: number): Promise<string | undefined> {
    const r = await this.exec(['agent', 'wait', name, ...until.flatMap((u) => ['--until', u]), '--timeout', String(timeoutMs)])
    const j = parse(r.stdout)
    return j?.result?.agent?.agent_status ?? j?.result?.state
  }

  async openPane(cwd: string): Promise<string | undefined> {
    const split = await this.exec(['pane', 'split', '--direction', 'right', '--cwd', cwd, '--no-focus'])
    const pane = parse(split.stdout)?.result?.pane?.pane_id
    if (typeof pane === 'string') return pane
    const tab = await this.exec(['tab', 'create', '--cwd', cwd])
    const root = parse(tab.stdout)?.result?.root_pane?.pane_id
    return typeof root === 'string' ? root : undefined
  }

  async openTab(cwd: string, label: string): Promise<string | undefined> {
    const tab = await this.exec(['tab', 'create', '--cwd', cwd, '--label', label])
    const root = parse(tab.stdout)?.result?.root_pane?.pane_id
    return typeof root === 'string' ? root : undefined
  }

  async splitPane(paneId: string, cwd: string): Promise<string | undefined> {
    const r = await this.exec(['pane', 'split', paneId, '--direction', 'right', '--cwd', cwd, '--no-focus'])
    const pane = parse(r.stdout)?.result?.pane?.pane_id
    return typeof pane === 'string' ? pane : undefined
  }

  async closePane(paneId: string): Promise<void> {
    const r = await this.exec(['pane', 'close', paneId])
    const code = (parse(r.stdout) ?? parse(r.stderr))?.error?.code // herdr prints errors on stderr
    // already gone (the person closed it) is fine
    if (r.code !== 0 && code !== 'pane_not_found') throw new Error(`herdr pane close ${paneId} failed: ${(r.stderr || r.stdout).slice(-400)}`)
  }
}

/**
 * Bridge for the herdr worker, which drives the channel through raw
 * `herdr …` argument lists: turn an AgentChannel back into that `exec` shape.
 * Lets a FakeAgentChannel stand in for the real multiplexer.
 */
export function channelExec(channel: AgentChannel): Exec {
  const json = (v: unknown): ExecResult => ({ stdout: JSON.stringify(v), stderr: '', code: 0 })
  return async (args) => {
    const [group, cmd, ...rest] = args
    if (group === 'agent' && cmd === 'list') return json({ result: { agents: await channel.list() } })
    if (group === 'agent' && cmd === 'start') {
      const kind = rest[rest.indexOf('--kind') + 1]
      const pane = rest[rest.indexOf('--pane') + 1]
      await channel.start(rest[0], kind, pane)
      return json({ result: { agent: { name: rest[0], pane_id: pane } } })
    }
    if (group === 'agent' && cmd === 'prompt') {
      const r = await channel.prompt(rest[0], rest[1])
      if (!r.ok) return { stdout: JSON.stringify({ error: { code: r.state ?? 'error' } }), stderr: r.detail ?? '', code: 1 }
      return json({ result: { type: 'agent_prompted', agent: { agent_status: r.state } } })
    }
    if (group === 'agent' && cmd === 'get') return json({ result: { agent: await channel.get(rest[0]) } })
    if (group === 'agent' && cmd === 'read') return { stdout: await channel.read(rest[0], Number(rest[rest.indexOf('--lines') + 1]) || 40), stderr: '', code: 0 }
    if (group === 'agent' && cmd === 'wait') {
      const until = rest.filter((_, i) => rest[i - 1] === '--until')
      const timeout = Number(rest[rest.indexOf('--timeout') + 1]) || 60_000
      return json({ result: { state: await channel.wait(rest[0], until, timeout) } })
    }
    if (group === 'pane' && cmd === 'split') {
      const cwd = rest[rest.indexOf('--cwd') + 1]
      const pane = await channel.openPane(cwd)
      return pane ? json({ result: { pane: { pane_id: pane } } }) : { stdout: '', stderr: 'no pane', code: 1 }
    }
    if (group === 'tab' && cmd === 'create') return { stdout: '', stderr: 'openPane already tried a tab', code: 1 }
    throw new Error(`channelExec: unsupported herdr call ${args.join(' ')}`)
  }
}

function parse(stdout: string): Record<string, any> | undefined {
  try { return JSON.parse(stdout) } catch { return undefined }
}
