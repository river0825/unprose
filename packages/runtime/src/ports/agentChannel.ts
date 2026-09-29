// Port: AgentChannel — talking to an *interactive* coding agent that lives in a
// terminal pane (herdr today; tmux / zellij / a web IDE tomorrow). This is the
// seam the herdr worker drives; it is exactly the set of calls that worker makes.

export interface AgentRow {
  /** Agent kind: codex | claude | opencode | … */
  agent: string
  /** idle | working | blocked | done | unknown */
  agent_status: string
  name?: string
  pane_id: string
  cwd?: string
  interactive_ready?: boolean
}

export interface AgentChannel {
  /** Every live agent the multiplexer knows about. */
  list(): Promise<AgentRow[]>
  /** Start an agent of `kind` in an existing shell pane and name it; `args` go to the agent's own CLI. */
  start(name: string, kind: string, paneId: string, args?: string[]): Promise<void>
  /** Submit one prompt (text + Enter); returns the agent's state right after submission. */
  prompt(name: string, text: string): Promise<{ state?: string; ok: boolean; detail?: string }>
  /** Current lifecycle state of a named agent. */
  get(name: string): Promise<AgentRow | undefined>
  /** Recent terminal text of the agent's pane. */
  read(name: string, lines?: number): Promise<string>
  /** Block until the agent reaches one of the states (or timeout). */
  wait(name: string, until: string[], timeoutMs: number): Promise<string | undefined>
  /** Open a new pane beside the caller (or a new tab); returns its id. */
  openPane(cwd: string): Promise<string | undefined>
  /** Open a new tab with that label; returns its root pane id. */
  openTab(cwd: string, label: string): Promise<string | undefined>
  /** Split `paneId` (a new pane in the same tab, without taking focus); returns the new pane's id. */
  splitPane(paneId: string, cwd: string): Promise<string | undefined>
  /** Close a pane (and whatever runs in it). Closing a tab's last pane closes the tab. */
  closePane(paneId: string): Promise<void>
}
