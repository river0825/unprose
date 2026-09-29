import { useEffect, useRef, useState } from 'react'

interface Props {
  text: string
  editing: boolean
  onCommit: (text: string, andContinue?: boolean) => void
  onCancel: () => void
  className?: string
  placeholder?: string
}

/**
 * Inline text that turns into a textarea while editing.
 * Enter saves, Shift+Enter newline, ⌘/Ctrl+Enter saves and continues below, Escape cancels.
 */
export function EditableText({ text, editing, onCommit, onCancel, className, placeholder }: Props) {
  const [draft, setDraft] = useState(text)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(text)
      requestAnimationFrame(() => {
        ref.current?.focus()
        ref.current?.select()
      })
    }
  }, [editing, text])

  if (!editing) {
    return (
      <div className={`text ${className ?? ''}`}>
        {text || <span className="placeholder">{placeholder ?? ''}</span>}
      </div>
    )
  }
  return (
    <textarea
      ref={ref}
      className="edit nodrag nowheel"
      aria-label="Edit text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          onCommit(draft, true)
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onCommit(draft)
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}
