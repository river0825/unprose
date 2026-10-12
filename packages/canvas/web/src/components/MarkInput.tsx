// "Annotate…" and "Add TODO…" from an item's menu (docs/canvas.md → "Notes"): a small field at the pointer. An
// annotation says what the item is for — a draft for the holder of the files when the item is drawn from one, else a
// numbered card on the board; a TODO is something still to be confirmed with someone else (and who), and wakes nobody.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import '../annotations.css'

export interface MarkInputState {
  kind: 'annotate' | 'todo'
  /** the item it is about; none = a TODO about the whole board */
  itemId?: string
  x: number
  y: number
}

/** The text field of an annotation or a TODO, with what happens to it said under it; reused in the panel. */
export function MarkFields({ kind, hint, onSubmit, onCancel, autoFocus = true, submitLabel }: { kind: 'annotate' | 'todo'; hint?: string; onSubmit: (text: string, ask?: string) => void; onCancel: () => void; autoFocus?: boolean; submitLabel?: string }) {
  const [text, setText] = useState('')
  const [ask, setAsk] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  const submit = () => {
    if (!text.trim()) return
    onSubmit(text.trim(), kind === 'todo' ? ask.trim() || undefined : undefined)
    setText('')
    setAsk('')
  }
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault()
      submit()
    }
  }
  return (
    <div className="mark-fields" data-no-board-keys>
      <textarea
        ref={ref}
        rows={2}
        aria-label={kind === 'annotate' ? 'Annotation' : 'TODO'}
        placeholder={kind === 'annotate' ? 'What is it for? Why is it there?' : 'What still has to be confirmed?'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      {kind === 'todo' ? <input type="text" aria-label="Ask whom (optional)" placeholder="Ask whom? (optional — PM, the backend team)" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={keys} /> : null}
      {hint ? <p className="mark-hint">{hint}</p> : null}
      <div className="mark-actions">
        <button type="button" className="ghost small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary small" disabled={!text.trim()} onClick={submit}>
          {submitLabel ?? (kind === 'annotate' ? 'Annotate' : 'Add TODO')}
        </button>
      </div>
    </div>
  )
}

/** The field at the pointer, kept on screen; Escape or a click elsewhere closes it. */
export function MarkInput({ state, title, hint, onSubmit, onClose }: { state: MarkInputState; title: string; hint?: string; onSubmit: (text: string, ask?: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: state.x, y: state.y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.max(8, Math.min(state.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(state.y, window.innerHeight - r.height - 8)) })
  }, [state.x, state.y])
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [onClose])
  return (
    <div ref={ref} className="mark-input" role="dialog" aria-label={title} style={{ left: pos.x, top: pos.y }}>
      <div className="mark-title">{title}</div>
      <MarkFields
        kind={state.kind}
        hint={hint}
        onCancel={onClose}
        onSubmit={(text, ask) => {
          onSubmit(text, ask)
          onClose()
        }}
      />
    </div>
  )
}
