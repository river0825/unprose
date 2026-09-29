// Header control for a workflow board: is studio (the Claude sessions behind "Ask AI") running?
// Off · Start / Starting… / On · 2/3 chats · New session · Stop / Stopped: <why> · Start. Shown on any
// board the canvas server may run studio for (docs/diagrams.md §8); hidden otherwise.
import { useStudio } from '../inspector/useStudio'

const lastLine = (log: string[]) => log.filter((l) => l.trim()).at(-1)?.replace(/^\[[^\]]*\]\s*/, '') ?? ''

export function StudioControl({ boardId }: { boardId: string }) {
  const { status, busy, error, start, stop, newSession } = useStudio(boardId)
  if (!status?.capable) return null
  const s = status.sessions
  const stoppedWhy = !status.running && status.exitCode != null ? lastLine(status.log) : ''
  const label = busy === 'start' ? 'Starting…' : busy === 'stop' ? 'Stopping…' : busy === 'new-session' ? 'New session…' : status.running ? 'Studio on' : stoppedWhy ? 'Studio stopped' : 'Studio off'
  return (
    <span className={`studio-ctl ${status.running ? 'on' : 'off'}`} role="status" title={[stoppedWhy, error, ...status.log.slice(-5)].filter(Boolean).join('\n')}>
      <span className={`dot ${status.running ? 'on' : 'off'}`} aria-hidden="true" />
      <span className="label">
        {label}
        {status.running && s ? ` · ${s.open}/${s.max} chats${s.queued ? `, ${s.queued} queued` : ''}` : ''}
      </span>
      {status.running ? (
        <>
          <button type="button" className="ghost small" disabled={busy !== null} onClick={() => void newSession()} title="Start this board's next chat in a fresh Claude session">
            New session
          </button>
          <button type="button" className="ghost small" disabled={busy !== null} onClick={() => void stop()}>
            Stop
          </button>
        </>
      ) : (
        <button type="button" className="ghost small" disabled={busy !== null} onClick={() => void start()}>
          Start
        </button>
      )}
    </span>
  )
}

/** Under a chat composer: say when nobody will answer, and offer to start studio. */
export function StudioHint({ boardId }: { boardId: string }) {
  const { status, busy, start } = useStudio(boardId)
  if (!status?.capable || status.running) return null
  return (
    <p className="studio-hint" role="status">
      Studio is off, so Ask AI will wait until it runs.{' '}
      <button type="button" className="link" disabled={busy !== null} onClick={() => void start()}>
        {busy === 'start' ? 'Starting…' : 'Start studio'}
      </button>
    </p>
  )
}
