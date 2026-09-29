// AgentChannel adapter for tests: a scripted "agent" that answers a prompt by
// calling `onPrompt` (which usually writes the mailbox answer file).

import type { AgentChannel, AgentRow } from '../../ports/agentChannel.js'

export interface FakeAgentChannelOptions {
  /** Agents that already exist when the channel is created. */
  agents?: AgentRow[]
  /** Called on every prompt; return the state to report (default 'working'). */
  onPrompt?: (name: string, text: string) => Promise<string | void> | string | void
  /** What `get` reports after a prompt (default 'done'). */
  stateAfterPrompt?: string
}

export class FakeAgentChannel implements AgentChannel {
  readonly calls: string[][] = []
  private agents: AgentRow[]
  private panes = 0
  constructor(private opts: FakeAgentChannelOptions = {}) {
    this.agents = [...(opts.agents ?? [])]
  }

  async list() { this.calls.push(['list']); return this.agents.slice() }
  async start(name: string, kind: string, paneId: string, args: string[] = []) {
    this.calls.push(['start', name, kind, paneId, ...args])
    this.agents.push({ agent: kind, agent_status: 'idle', name, pane_id: paneId, interactive_ready: true })
  }
  async prompt(name: string, text: string) {
    this.calls.push(['prompt', name, text])
    const row = this.agents.find((a) => a.name === name)
    if (row?.agent_status === 'blocked') return { ok: false, state: 'agent_blocked' as const }
    const state = (await this.opts.onPrompt?.(name, text)) ?? 'working'
    if (row) row.agent_status = this.opts.stateAfterPrompt ?? 'done'
    return { ok: true, state: String(state) }
  }
  async get(name: string) { this.calls.push(['get', name]); return this.agents.find((a) => a.name === name) }
  async read(name: string) { this.calls.push(['read', name]); return `(fake pane of ${name})` }
  async wait(name: string, until: string[]) { this.calls.push(['wait', name, ...until]); return this.agents.find((a) => a.name === name)?.agent_status }
  async openPane(cwd: string) { this.calls.push(['openPane', cwd]); return `fake:p${++this.panes}` }
  async openTab(cwd: string, label: string) { this.calls.push(['openTab', cwd, label]); return `fake:p${++this.panes}` }
  async splitPane(paneId: string, cwd: string) { this.calls.push(['splitPane', paneId, cwd]); return `fake:p${++this.panes}` }
  /** Closing a pane ends the agent in it, like herdr. */
  async closePane(paneId: string) { this.calls.push(['closePane', paneId]); this.agents = this.agents.filter((a) => a.pane_id !== paneId) }
  /** Test hook: the person closed the pane by hand. */
  dropPane(paneId: string) { this.agents = this.agents.filter((a) => a.pane_id !== paneId) }
  /** Test hook: flip an agent into a state (e.g. 'blocked'). */
  setState(name: string, state: string) { const row = this.agents.find((a) => a.name === name); if (row) row.agent_status = state }
}
