// Pure prompt/answer helpers shared by every worker adapter: model aliases,
// the user-turn layout, and "find the JSON in whatever the tool printed".
// No IO here — adapters do the talking, this decides what to say and read.

import type { WorkerRequest } from '../ports/workerRuntime.js'

export const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5-1',
}

/** The user turn: input + schema. `includeSystem` inlines the system prompt for runners with no system slot. */
export function renderPrompt(req: WorkerRequest, includeSystem = true): string {
  const lines = []
  if (includeSystem && req.system) lines.push(req.system.trim(), '')
  lines.push('## Input', '```json', JSON.stringify(req.input, null, 2), '```', '')
  lines.push('## Output', 'Reply with a single JSON object matching this schema (no prose around it):', '```json', JSON.stringify(req.outputSchema, null, 2), '```')
  return lines.join('\n')
}

/**
 * Find the answer in whatever a CLI agent printed: JSONL event streams
 * (codex `item.completed`/`agent_message`, opencode `text` parts, Claude Code
 * `result`), a ```json fence, or the last bare {...} object.
 */
export function extractJsonAnswer(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const texts: string[] = []
  let sawEvents = false
  for (const line of lines) {
    if (!line.startsWith('{')) continue
    let ev: Record<string, unknown>
    try { ev = JSON.parse(line) } catch { continue }
    const item = ev.item as Record<string, unknown> | undefined
    const part = ev.part as Record<string, unknown> | undefined
    if (ev.structured_output && typeof ev.structured_output === 'object') return ev.structured_output as Record<string, unknown>
    if (item && item.type === 'agent_message' && typeof item.text === 'string') { texts.push(item.text); sawEvents = true; continue }
    if (ev.type === 'text' && part && typeof part.text === 'string') { texts.push(part.text); sawEvents = true; continue }
    if (ev.type === 'result' && typeof ev.result === 'string') { texts.push(ev.result); sawEvents = true; continue }
    if (typeof ev.type !== 'string' && 'outcome' in ev) return ev // a bare answer line
  }
  const haystack = sawEvents ? texts.join('\n') : stdout
  return jsonFromText(haystack)
}

export function jsonFromText(text: string): Record<string, unknown> | undefined {
  const fence = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim()).reverse()
  for (const f of fence) { try { const v = JSON.parse(f); if (v && typeof v === 'object') return v } catch { /* next */ } }
  // last balanced {...} in the text
  let depth = 0, start = -1
  const spans: Array<[number, number]> = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') { if (depth === 0) start = i; depth++ }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { spans.push([start, i + 1]); start = -1 } if (depth < 0) depth = 0 }
  }
  for (const [a, b] of spans.reverse()) { try { const v = JSON.parse(text.slice(a, b)); if (v && typeof v === 'object') return v } catch { /* next */ } }
  return undefined
}
