// Checking a TODO off (docs/canvas.md → "Notes"): a small field for what was found out. With an answer it is posted in
// the TODO's thread and goes to the board's Answered by agent; without one nobody is told. Used on the TODO card on
// the board and in the panel's TODO list.
import { useEffect, useRef, useState } from 'react'
import '../annotations.css'

export function CheckOffField({ answeredBy, onDone, onCancel, compact = false }: { answeredBy?: string; onDone: (answer: string | undefined) => void; onCancel: () => void; compact?: boolean }) {
  const [answer, setAnswer] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const done = () => onDone(answer.trim() || undefined)
  const to = answeredBy ?? 'the agents on this board'
  return (
    <div className={`checkoff nodrag nopan nowheel ${compact ? 'compact' : ''}`} data-no-board-keys onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <label className="checkoff-label">
        What did you find out? <span className="muted">(optional — sent to {to})</span>
        <textarea
          ref={ref}
          rows={2}
          value={answer}
          placeholder="e.g. PM: three tries, then the account locks"
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              done()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
      </label>
      <div className="checkoff-actions">
        <button type="button" className="ghost small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary small" onClick={done} title={answer.trim() ? `Check it off and send the answer to ${to}` : 'Check it off without telling anyone'}>
          {answer.trim() ? 'Check off and send' : 'Check off'}
        </button>
      </div>
    </div>
  )
}
