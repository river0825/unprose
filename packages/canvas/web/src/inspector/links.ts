// Every line on the board is one arrow (from, to, label, role); what differs is where it comes from and what it
// means, and the panel names that difference once, in one place (components/Links.tsx):
//   wire  — a workflow's event line (docs/studio.md §7): the file's listens / emits, drawn; dragging one is a proposal
//   trace — a line between two diagrams (docs/diagrams.md §2): the file's `traces:`, dotted, never flow
//   arrow — a line inside a diagram, drawn from its file (an activity, a command → system, a timeline)
//   link  — a line a person drew on the board: no role, in no file
// Pure: the grouping is tested without the DOM.
import type { Board, Item } from '../../../src/model'
import { diagramOf, KIND_NAMES } from '../diagrams/frame'
import { relOf, type TraceRel } from '../diagrams/traces'
import { eventOf, isFlowWire } from './pending'

export type LinkKind = 'wire' | 'trace' | 'arrow' | 'link'

export function linkKind(board: Board, a: Item): LinkKind {
  if (a.role === 'trace') return 'trace'
  if (isFlowWire(board, a)) return 'wire'
  return a.role ? 'arrow' : 'link'
}

/** What a line says on the board: its label, else its event, else its role as words. */
export function lineLabel(a: Item): string {
  const text = (a.label ?? a.text)?.trim()
  if (text) return text
  const e = eventOf(a)
  if (e) return e.event
  return a.role && a.role !== 'flow' ? a.role.replace(/-/g, ' ') : ''
}

export interface LinkRow {
  line: Item
  kind: LinkKind
  /** 'out': the line leaves this item; 'in': it arrives */
  dir: 'in' | 'out'
  other: Item | undefined
  label: string
  rel?: TraceRel
  /** the other end's diagram, named, when it is in one */
  otherDiagram?: string
}

export interface Links {
  /** lines inside the item's own diagram, or a workflow's wires (also the hand-drawn ones between two workflow steps) */
  inDiagram: LinkRow[]
  /** traces to other diagrams */
  across: LinkRow[]
  /** lines a person drew on the board, in no file */
  drawn: LinkRow[]
  /** the item's own diagram, named, when it is in one */
  diagram?: string
}

export const EMPTY_LINKS: Links = { inDiagram: [], across: [], drawn: [] }

export function linksOf(board: Board, item: Item): Links {
  const out: Links = { inDiagram: [], across: [], drawn: [] }
  const own = diagramOf(board, item)
  if (own) out.diagram = KIND_NAMES[own.kind] ?? own.kind
  for (const a of Object.values(board.items)) {
    if (a.type !== 'arrow') continue
    const dir = a.from === item.id ? 'out' : a.to === item.id ? 'in' : undefined
    if (!dir || (a.from === item.id && a.to === item.id)) continue
    const kind = linkKind(board, a)
    const other = dir === 'out' ? (a.to ? board.items[a.to] : undefined) : a.from ? board.items[a.from] : undefined
    const od = other ? diagramOf(board, other) : undefined
    const row: LinkRow = {
      line: a,
      kind,
      dir,
      other,
      label: lineLabel(a),
      otherDiagram: od ? (KIND_NAMES[od.kind] ?? od.kind) : undefined,
    }
    if (kind === 'trace') out.across.push({ ...row, rel: relOf(a) })
    else if (kind === 'link') out.drawn.push(row)
    else out.inDiagram.push(row)
  }
  return out
}

export const KIND_WORDS: Record<LinkKind, string> = {
  wire: 'wire',
  trace: 'trace',
  arrow: 'arrow',
  link: 'link',
}
