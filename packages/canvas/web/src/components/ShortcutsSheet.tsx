import { useEffect, useRef } from 'react'

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Add',
    rows: [
      ['Double-click empty paper', 'New sticky at the cursor'],
      ['S', 'Add sticky'],
      ['T', 'Add text'],
      ['F', 'Add frame'],
      ['C', 'Comment on an item'],
      [`${MOD} D`, 'Duplicate the selection'],
      [`${MOD} Shift C`, 'Copy the selection as an image (also in the right-click menu)'],
    ],
  },
  {
    title: 'Edit text',
    rows: [
      ['Double-click an item', 'Edit its text'],
      ['Enter on a selected item', 'Edit its text (an arrow: its label)'],
      ['Drag a corner of a selected item', 'Resize it; text scales with the height'],
      ['Drag an arrow end onto another item', 'Reconnect the arrow'],
      ['Click a folded comment', 'Open it (marks it read)'],
      ['Enter', 'Save'],
      ['Shift Enter', 'New line'],
      [`${MOD} Enter`, 'Save and add a sticky below'],
      ['Esc', 'Cancel'],
    ],
  },
  {
    title: 'Move and select',
    rows: [
      [`${MOD} K`, 'Go to a frame or item (also “Go to…” in the header)'],
      ['Drag on empty paper, or inside a frame, lane or column', 'Select everything the box touches (a frame only when the box holds all of it)'],
      ['Shift drag', 'Add what the box touches to the selection'],
      ['Drag a frame, lane or column by its title or border', 'Move it with everything inside'],
      [`Shift or ${MOD} click`, 'Add an item to the selection, or take it out'],
      ['Space drag, middle-button drag, two-finger scroll', 'Pan the board'],
      ['Arrow keys', 'Nudge the selection 10 px'],
      ['Shift Arrow keys', 'Nudge 50 px'],
      ['Right-click or long-press', 'Item menu (also Annotate… and Add TODO…)'],
      ['⌥ click', 'On a UI mock element a click leads from: do that click — the view goes to its screen (⌥ ← comes back); the item menu says Click → <screen>'],
      ['Shift F10', 'Item menu for the selected item'],
      ['Delete or Backspace', 'Delete the selection'],
    ],
  },
  {
    title: 'History and view',
    rows: [
      [`${MOD} Z`, 'Undo'],
      [`${MOD} Shift Z`, 'Redo'],
      ['1', 'Fit the whole board'],
      ['2', 'Bring the view to the selection (after a panel link moved it away)'],
      ['⌥ ← / ⌥ →', 'Back to where the view was before a jump (a panel link, a locate, ⌘K, a focus) / forward again'],
      ['W', 'Lines inside diagrams: all → selected only → none (also in the settings in the bottom-right corner)'],
      ['Shift+W', 'Traces between diagrams: all → faded → bundled → selected only → none'],
      ['Shift+N', 'Comments: all → folded into markers → none (a proposal that was applied folds into a ✓ by itself; click it to read)'],
      ['Shift+A', 'Annotations: numbered pins and cards → pins only (click one for its card) → none'],
      ['Shift+T', 'TODOs: open → all (done ones muted) → none'],
      ['Shift+G', 'Clickable: outline every UI mock element a click leads from, tagged with its screen (also on a UI mock’s header, beside Play) — on / off'],
      ['?', 'This list'],
    ],
  },
]

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus()
    }
  }, [onClose])
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-head">
          <h2 id="sheet-title">Keyboard shortcuts</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sheet-body">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
