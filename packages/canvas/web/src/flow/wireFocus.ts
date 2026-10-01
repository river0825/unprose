import { useStore, type ReactFlowState } from '@xyflow/react'

// Focus + context for wires: while boxes are selected, the wires that touch them are drawn strong and every
// other wire steps back, so one block's connections can be read out of a crossed graph. Hovering does
// nothing (wires lighting up under the pointer were distracting). Nothing is stored: it is a way of
// looking, not an edit.

/** Boxes whose selection does not focus wires: containers and comments. */
const NO_FOCUS = new Set(['frame', 'lane', 'comment'])

/** Selected boxes that focus wires, as a stable string (so edges re-render only when it changes). */
const selectedKey = (s: ReactFlowState) => {
  let k = ''
  for (const n of s.nodes) if (n.selected && !NO_FOCUS.has(n.type ?? '')) k += n.id + '\n'
  return k
}

/**
 * How a wire is shown right now: 'on' (it touches the selection), 'off' (something else is selected and
 * has wires of its own), or undefined (nothing selected — every wire drawn as usual).
 */
export function useWireFocus(source: string, target: string, selected: boolean | undefined): 'on' | 'off' | undefined {
  const sel = useStore(selectedKey)
  const focus = sel ? sel.split('\n').filter(Boolean) : []
  // a box with no wires of its own focuses nothing: selecting a lone note must not dim the board
  const focusHasWires = useStore((s) => focus.length > 0 && s.edges.some((e) => e.type === 'item' && (focus.includes(e.source) || focus.includes(e.target))))
  if (selected) return 'on'
  if (!focusHasWires) return undefined
  return focus.includes(source) || focus.includes(target) ? 'on' : 'off'
}
