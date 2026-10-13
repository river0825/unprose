// "Clickable" on a UI mock (docs/diagrams.md §6c): this viewer's switch — on a UI-mock frame's header beside Play,
// and in the frame's side panel, Shift+G on the board — and the panel's list of what leads where, by screen. The
// switch applies to every UI mock on the board; the state is in flow/clickableView.ts, where a click leads in
// diagrams/uiPlay.ts (the same answer Play follows).
import { useMemo } from 'react'
import type { Board } from '../../../src/model'
import { buildPlay } from '../diagrams/uiPlay'
import { clickList } from '../diagrams/uiClickable'
import { clickable, useClickable } from '../flow/clickableView'
import { PanelLink } from '../inspector/panelNav'

const TIP = 'Outline every element a click leads from (a goto, a flow), tagged with the screen it goes to — on every UI mock on this board, for you only (Shift+G)'

// an arrow pointer: "a click here"
const POINTER = 'M6 3.5l12.5 7.6-5.6 1.4 3.2 5.9-2.4 1.3-3.2-5.9L6.5 18z'

/** The switch on a UI-mock frame's header, beside Play: pressed while it is on. */
export function ClickableButton() {
  const on = useClickable()
  return (
    <button
      type="button"
      // `replay-play`: the header's control look, and Copy as image leaves it out (flow/copyImage.ts)
      className="ghost replay-play clickable-toggle nodrag"
      aria-pressed={on}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        clickable.set(!on)
      }}
      title={TIP}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <path d={POINTER} />
      </svg>
      Clickable
    </button>
  )
}

/** The same switch in the frame's side panel. */
export function ClickableToggle() {
  const on = useClickable()
  return (
    <label className="dg-freeze" title={TIP}>
      <input type="checkbox" checked={on} onChange={(e) => clickable.set(e.target.checked)} />
      Show clickable <span className="muted">— where each click leads, on every UI mock (Shift+G)</span>
    </label>
  )
}

/**
 * "Clickable (n)": every element that leads to another screen, by screen — the ones the switch tags. A click moves the
 * board to the element and flashes it, as the Checks list does; › opens its details.
 */
export function ClickableList({ board, frameId, onSelect }: { board: Board; frameId: string; onSelect: (id: string) => void }) {
  const groups = useMemo(() => clickList(board, buildPlay(board, frameId)), [board, frameId])
  const n = groups.reduce((sum, g) => sum + g.rows.length, 0)
  return (
    <section className="insp-sec ui-click-list" aria-label="Clickable elements">
      <h3>
        Clickable <span className="muted">({n})</span>
      </h3>
      {n ? (
        groups.map((g) => (
          <div key={g.screen.id} className="ui-click-group">
            <h4>{g.screen.name}</h4>
            <ul className="dg-findings">
              {g.rows.map((r) => (
                <li key={r.id}>
                  <PanelLink id={r.id} name={r.label} className="link dg-finding" onSelect={onSelect}>
                    {r.label}
                  </PanelLink>{' '}
                  <span className="muted">→ {r.toName}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p className="muted">Nothing on these screens leads to another one: give an element a goto, or start a flows entry from it.</p>
      )}
    </section>
  )
}
