import { useStore, type ReactFlowState } from '@xyflow/react'
import { useSyncExternalStore } from 'react'

// Focus + context for wires: while the pointer rests on a box, or boxes are selected, the wires that
// touch them are drawn strong and every other wire steps back, so one block's connections can be read
// out of a crossed graph. Nothing is stored: it is a way of looking, not an edit.

/** Boxes whose hover/selection does not focus wires: containers and comments. */
const NO_FOCUS = new Set(['frame', 'lane', 'comment'])

let hovered: string | null = null
const listeners = new Set<() => void>()
let installed = false
let timer: ReturnType<typeof setTimeout> | undefined

function set(id: string | null) {
  if (id === hovered) return
  hovered = id
  listeners.forEach((l) => l())
}

function install() {
  if (installed || typeof document === 'undefined') return
  installed = true
  // one listener for the whole page; a short delay on leaving so sweeping across the board does not flicker
  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element | null)?.closest?.('.react-flow__node') as HTMLElement | null
    const id = el && ![...NO_FOCUS].some((t) => el.classList.contains(`react-flow__node-${t}`)) && !(e as PointerEvent).buttons ? el.dataset.id ?? null : null
    clearTimeout(timer)
    if (id) set(id)
    else timer = setTimeout(() => set(null), 120)
  })
}

function subscribe(l: () => void) {
  install()
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const useHovered = () => useSyncExternalStore(subscribe, () => hovered, () => null)

/** Selected boxes that focus wires, as a stable string (so edges re-render only when it changes). */
const selectedKey = (s: ReactFlowState) => {
  let k = ''
  for (const n of s.nodes) if (n.selected && !NO_FOCUS.has(n.type ?? '')) k += n.id + '\n'
  return k
}

/**
 * How a wire is shown right now: 'on' (it touches the focus), 'off' (something else is in focus and
 * has wires of its own), or undefined (no focus — every wire drawn as usual).
 */
export function useWireFocus(source: string, target: string, selected: boolean | undefined): 'on' | 'off' | undefined {
  const hover = useHovered()
  const sel = useStore(selectedKey)
  const focus = sel ? sel.split('\n').filter(Boolean) : hover ? [hover] : []
  // a box with no wires of its own focuses nothing: hovering a lone note must not dim the board
  const focusHasWires = useStore((s) => focus.length > 0 && s.edges.some((e) => e.type === 'item' && (focus.includes(e.source) || focus.includes(e.target))))
  if (selected) return 'on'
  if (!focusHasWires) return undefined
  return focus.includes(source) || focus.includes(target) ? 'on' : 'off'
}
