// The sign under the person's latest message (docs/studio.md §6): Sent, ✓✓ Seen,
// Agent is working…, Needs you in herdr, Could not start. Text first, colour second.
import type { Item } from '../../../src/model'
import { signFor, signText, type AgentSign } from '../inspector/status'

export function AgentStatus({ root, messages }: { root: Item; messages: Item[] }) {
  const sign = signFor(root, messages)
  return (
    <div className="agent-status-slot" aria-live="polite">
      {sign && <SignLine sign={sign} />}
    </div>
  )
}

export function SignLine({ sign, compact }: { sign: AgentSign; compact?: boolean }) {
  return (
    <span className={`agent-status s-${sign.kind}${compact ? ' compact' : ''}`}>
      {sign.kind === 'seen' && <span aria-hidden="true">✓✓ </span>}
      {sign.kind === 'sent' && <span aria-hidden="true">✓ </span>}
      {sign.kind === 'blocked' && <span aria-hidden="true">! </span>}
      {compact && sign.kind === 'working' ? 'working' : signText(sign)}
      {sign.kind === 'working' && (
        <span className="dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      )}
    </span>
  )
}
