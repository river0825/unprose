// Direct Claude API adapter using structured outputs. Needs ANTHROPIC_API_KEY
// (or an `ant auth login` profile — the SDK picks it up by itself).

import Anthropic from '@anthropic-ai/sdk'
import type { WorkerRuntime, WorkerRequest, WorkerResult } from '../../ports/workerRuntime.js'
import { MODEL_ALIASES } from '../../application/prompting.js'

export interface AnthropicWorkerOptions {
  client?: Anthropic
  defaultModel?: string
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export class AnthropicWorker implements WorkerRuntime {
  readonly name = 'anthropic'
  private client: Anthropic
  constructor(private opts: AnthropicWorkerOptions = {}) {
    this.client = opts.client ?? new Anthropic()
  }

  async run(req: WorkerRequest): Promise<WorkerResult> {
    const alias = req.model ?? this.opts.defaultModel ?? 'opus'
    const model = MODEL_ALIASES[alias] ?? alias
    const started = Date.now()
    // Structured outputs ask for `additionalProperties: false`; add it where the author left it out.
    const schema = strictify(req.outputSchema)

    const effort = (req.effort as AnthropicWorkerOptions['effort']) ?? this.opts.effort
    // Server tools the agent named (`web_search`) run on Anthropic's side; anything else is a
    // Claude Code tool name and has no meaning here.
    const tools = (req.tools ?? []).includes('web_search') ? [{ type: 'web_search_20260209' as const, name: 'web_search' as const }] : undefined
    const stream = this.client.messages.stream(
      {
        model,
        max_tokens: this.opts.maxTokens ?? 16000,
        thinking: { type: 'adaptive' },
        system: req.system,
        messages: [{ role: 'user', content: '## Input\n```json\n' + JSON.stringify(req.input, null, 2) + '\n```' }],
        ...(tools ? { tools } : {}),
        output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) },
      },
      req.timeout ? { timeout: req.timeout } : undefined,
    )
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new Error(`model refused: ${message.stop_details?.explanation ?? 'no explanation'}`)
    if (message.stop_reason === 'max_tokens') throw new Error('model hit max_tokens before finishing the JSON')
    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    let output: Record<string, unknown>
    try { output = JSON.parse(text) } catch { throw new Error(`model output is not JSON: ${text.slice(0, 300)}`) }
    return {
      output,
      raw: message,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, durationMs: Date.now() - started },
    }
  }
}

function strictify(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(walk)
    if (!s || typeof s !== 'object') return s
    const o = { ...(s as Record<string, unknown>) }
    if (o.type === 'object' && o.properties && o.additionalProperties === undefined) o.additionalProperties = false
    for (const k of ['properties', 'items', 'anyOf', 'oneOf', 'allOf']) if (k in o) o[k] = k === 'properties' ? Object.fromEntries(Object.entries(o[k] as Record<string, unknown>).map(([n, v]) => [n, walk(v)])) : walk(o[k])
    return o
  }
  return walk(schema) as Record<string, unknown>
}
