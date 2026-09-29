// The block detail a workflow board item carries in `data.detail` (docs/studio.md §1).
// A snapshot written by `awd graph --canvas`; the Inspector only reads it.
import type { Board, Item } from '../../../src/model'

export interface DetailCommon {
  source?: { workflow: string; line?: number }
  listens?: string[]
  emits?: string[]
}

export type BlockDetail = DetailCommon &
  (
    | { kind: 'agent'; file?: string; persona?: string; frontmatter?: Record<string, unknown>; steps?: string[] }
    | {
        kind: 'ai'
        agent?: string
        role?: string
        model?: string
        file?: string
        prompt?: string
        input?: Record<string, unknown>
        output?: Record<string, unknown>
        outcomes?: string[]
      }
    | { kind: 'script'; run?: string; file?: string; code?: string; truncated?: boolean }
    | {
        kind: 'gate' | 'human'
        rules?: Array<{ outcome: string; when: string; terminal: boolean }>
        resumeOn?: string[]
        timeout?: string
        plain?: string[]
      }
    | { kind: 'trigger'; on?: string; emit?: string; config?: Record<string, unknown> }
  )

export type BlockKind = BlockDetail['kind']

const KINDS = new Set<string>(['agent', 'ai', 'script', 'gate', 'human', 'trigger'])

/** The item's block detail, when it is a workflow block with one. */
export function detailOf(item: Item | undefined): BlockDetail | undefined {
  const d = item?.data?.detail
  if (!d || typeof d !== 'object') return undefined
  const kind = (d as { kind?: unknown }).kind
  return typeof kind === 'string' && KINDS.has(kind) ? (d as BlockDetail) : undefined
}

export const MODELS = ['opus', 'sonnet', 'fable', 'haiku'] as const
export type DiscussModel = (typeof MODELS)[number]

/** What a comment's `data.discuss` asked for, if it is a discussion request (§2). */
export function discussOf(item: Item): { model?: string } | undefined {
  const d = item.data?.discuss
  return d && typeof d === 'object' ? (d as { model?: string }) : undefined
}

/** The card of agent `id` on this board. */
export function agentItem(board: Board, id: string): Item | undefined {
  return Object.values(board.items).find((i) => i.role === 'agent' && i.data?.agent === id)
}

/** The card of workflow step `id` on this board. */
export function stepItem(board: Board, id: string): Item | undefined {
  return Object.values(board.items).find((i) => i.type !== 'arrow' && i.data?.nodeId === id)
}

export const KIND_LABEL: Record<BlockKind, string> = {
  agent: 'Agent',
  ai: 'AI step',
  script: 'Script step',
  gate: 'Gate',
  human: 'Human step',
  trigger: 'Trigger',
}

export const SUGGESTED_ASKS: Record<BlockKind, string[]> = {
  agent: ['Sharpen this persona — what is vague or contradictory?', 'Which tools does this agent really need?', 'What should it remember between runs?'],
  ai: ['Tighten this prompt.', 'Is the output schema enough for the next step?', 'When would this step fail, and what happens then?'],
  gate: ['Explain when this blocks a run.', 'Should this gate have a timeout?', 'What happens on each outcome?'],
  human: ['Explain when this waits for a person, and for how long.', 'What happens if nobody answers?', 'Is the resume condition too loose?'],
  script: ['What can go wrong here?', 'Make this script safe to retry.', 'Explain what this script does, step by step.'],
  trigger: ['What exactly starts a run here?', 'Add a filter so fewer runs start.', 'Which data does the first step get?'],
}
