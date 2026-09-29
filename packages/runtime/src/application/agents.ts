// Merging agent definitions from their three sources — the yaml `agents:`
// block, `agents/<id>.md` files, and legacy `roles/<id>.md` prompts. Pure:
// the file contents are handed in already read (adapters/fs/workflowLoader).

import YAML from 'yaml'
import { parseAgent, type WorkflowDefinition, type AgentDef, type ResolvedAgent } from '@awd/core'

export interface AgentFile {
  def: AgentDef
  body: string
}

export interface AgentSources {
  /** `agents/<id>.md` parsed: frontmatter → def, markdown body → prompt. */
  files?: Record<string, AgentFile>
  /** `roles/<id>.md` legacy prompts. */
  roles?: Record<string, string>
  /** Resolves `file:` references inside an agent definition (relative to the workflow). */
  readFile?: (relative: string) => string | undefined
}

/**
 * The yaml wins on conflicts. The prompt comes from, in order: `system`,
 * `file`, the .md body, `roles/<id>.md`.
 */
export function mergeAgents(def: WorkflowDefinition, sources: AgentSources = {}): Record<string, ResolvedAgent> {
  const fromFiles = sources.files ?? {}
  const roles = sources.roles ?? {}
  const ids = new Set([...Object.keys(fromFiles), ...Object.keys(def.agents ?? {})])
  const out: Record<string, ResolvedAgent> = {}
  for (const id of ids) {
    const file = fromFiles[id]
    const yaml = def.agents?.[id]
    const merged: AgentDef = { ...(file?.def ?? {}), ...(yaml ?? {}), id }
    // objects nested one level (cli / herdr) merge too, so a file can carry defaults
    if (file?.def.cli || yaml?.cli) merged.cli = { ...(file?.def.cli ?? {}), ...(yaml?.cli ?? {}) }
    if (file?.def.herdr || yaml?.herdr) merged.herdr = { ...(file?.def.herdr ?? { kind: '' }), ...(yaml?.herdr ?? {}) } as AgentDef['herdr']
    let system = merged.system
    if (system === undefined && merged.file) {
      const text = sources.readFile?.(merged.file)
      if (text === undefined) throw new Error(`agents.${id}.file: ${merged.file} not found`)
      system = text
    }
    if (system === undefined && file?.body?.trim()) system = file.body
    if (system === undefined && roles[id]) system = roles[id]
    out[id] = { ...merged, system }
  }
  return out
}

/** `agents/<id>.md` text → { def (from frontmatter), body }. Claude Code agent files say `name:`; ours is the file name. */
export function parseAgentFile(id: string, text: string): AgentFile {
  const { data, body } = splitFrontmatter(text)
  const raw = { ...data }
  delete raw.name
  return { def: parseAgent(id, raw), body }
}

export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { data: {}, body: text }
  const data = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>
  return { data: typeof data === 'object' && data ? data : {}, body: m[2] }
}
