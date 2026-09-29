// "Has the agent read this / is it working on it?" (docs/studio.md §6), the pure
// half: one sign for a thread, from the chat root's `data.agentState` and the
// person's latest message's `data.seenBy`.
import { agentStateOf, seenBy, type Item } from '../../../src/model'

export type AgentSign =
  | { kind: 'sent' }
  | { kind: 'seen' }
  | { kind: 'working' }
  | { kind: 'blocked'; tab?: string }
  | { kind: 'failed' }

/**
 * The sign under the person's latest message in a thread (`messages`: root
 * first, oldest first), or undefined when there is nothing to say — no message
 * of theirs, or the agent answered and is idle again.
 */
export function signFor(root: Item, messages: Item[]): AgentSign | undefined {
  const lastMine = messages.map((m) => m.createdBy).lastIndexOf('user')
  if (lastMine < 0) return undefined
  const answered = messages.slice(lastMine + 1).some((m) => m.createdBy === 'agent' && m.text?.trim())
  const st = agentStateOf(root)
  if (st?.state === 'starting' || st?.state === 'working') return { kind: 'working' }
  if (st?.state === 'blocked') return { kind: 'blocked', tab: st.tab }
  if (st?.state === 'failed' && !answered) return { kind: 'failed' }
  if (answered) return undefined
  return seenBy(messages[lastMine]).includes('agent') ? { kind: 'seen' } : { kind: 'sent' }
}

/** Is the agent busy with this thread right now (for a small badge on a folded chat)? */
export function isBusy(sign: AgentSign | undefined): boolean {
  return sign?.kind === 'working' || sign?.kind === 'blocked'
}

export function signText(s: AgentSign): string {
  switch (s.kind) {
    case 'sent':
      return 'Sent'
    case 'seen':
      return 'Seen by agent'
    case 'working':
      return 'Agent is working'
    case 'blocked':
      return s.tab ? `Needs you in herdr tab "${s.tab}"` : 'Needs you in its herdr tab'
    case 'failed':
      return 'Could not start — see the agent comment'
  }
}
