// Links in the side panel to other board items (Connected, Wiring, traces): a click shows the item on the
// board — the view moves there and it flashes — but the panel stays on what you were reading; the small ›
// beside it opens that item's details. Without a provider (tests, older callers) a click selects, as before.
import { createContext, useContext, type ReactNode } from 'react'

export interface PanelNav {
  /** move the board to these items and flash them; the selection and the panel stay */
  reveal: (ids: string[]) => void
  /** select the item: the panel switches to its details */
  open: (id: string) => void
}

export const PanelNavContext = createContext<PanelNav | null>(null)

export function PanelLink({ id, name, className, onSelect, children }: { id: string; name: string; className: string; onSelect: (id: string) => void; children: ReactNode }) {
  const nav = useContext(PanelNavContext)
  if (!nav)
    return (
      <button type="button" className={className} data-item-link={id} onClick={() => onSelect(id)} title={`Select ${name}`}>
        {children}
      </button>
    )
  return (
    <span className="panel-link">
      <button type="button" className={className} data-item-link={id} onClick={() => nav.reveal([id])} title={`Show ${name} on the board`}>
        {children}
      </button>
      <button type="button" className="panel-link-open" data-item-link={id} onClick={() => nav.open(id)} title={`Open the details of ${name}`} aria-label={`Open the details of ${name}`}>
        ›
      </button>
    </span>
  )
}
