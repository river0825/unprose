// Loading a workflow from disk: the yaml, its `agents/*.md`, its legacy
// `roles/*.md`, and where its event log lives. The *merge* is pure and lives
// in application/agents.ts; this file only reads files.

import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflow, type WorkflowDefinition, type ResolvedAgent } from '@awd/core'
import { mergeAgents, parseAgentFile, type AgentFile } from '../../application/agents.js'

export interface LoadedWorkflow {
  def: WorkflowDefinition
  file: string
  dir: string
  roles: Record<string, string>
  /** Agents with their system prompt text resolved. */
  agents: Record<string, ResolvedAgent>
  /** Default `.awd/<name>` next to the workflow file. */
  storeDir: string
  fixturesDir?: string
}

export function loadWorkflow(file: string, opts: { storeDir?: string } = {}): LoadedWorkflow {
  const abs = path.resolve(file)
  const dir = path.dirname(abs)
  const def = parseWorkflow(fs.readFileSync(abs, 'utf8'))
  const roles = readPromptDir(path.join(dir, 'roles'))
  const agents = resolveAgents(def, dir, roles)
  // The reducer reads def.agents when no resolved map is passed; keep both in sync.
  def.agents = agents
  const fixturesDir = path.join(dir, 'fixtures', 'ai')
  return {
    def, file: abs, dir, roles, agents,
    storeDir: opts.storeDir ? path.resolve(opts.storeDir) : path.join(dir, '.awd', def.name),
    fixturesDir: fs.existsSync(fixturesDir) ? fixturesDir : undefined,
  }
}

/** Merge `agents:` with `agents/<id>.md` and `roles/<id>.md` next to the workflow. */
export function resolveAgents(def: WorkflowDefinition, dir: string, roles: Record<string, string> = {}): Record<string, ResolvedAgent> {
  return mergeAgents(def, {
    files: readAgentFiles(path.join(dir, 'agents')),
    roles,
    readFile: (rel) => {
      const p = path.resolve(dir, rel)
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined
    },
  })
}

/** `agents/<id>.md` → { def (from frontmatter), body }. */
export function readAgentFiles(dir: string): Record<string, AgentFile> {
  const out: Record<string, AgentFile> = {}
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    out[f.slice(0, -3)] = parseAgentFile(f.slice(0, -3), fs.readFileSync(path.join(dir, f), 'utf8'))
  }
  return out
}

function readPromptDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.md') || f.endsWith('.txt')) out[f.replace(/\.(md|txt)$/, '')] = fs.readFileSync(path.join(dir, f), 'utf8')
  }
  return out
}
