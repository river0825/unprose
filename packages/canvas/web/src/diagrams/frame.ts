// Which diagram is an item in? (docs/diagrams.md §1) — the model's answer, plus web helpers: the
// frame item itself, a frame's members, and kind names.
import { diagramOf as modelDiagramOf, diagramSpecOf, type Board, type Item } from '../../../src/model'

export type DiagramKind = 'event-storming' | 'user-story-map' | 'kanban' | 'wireframe' | 'workflow' | 'domain-story' | 'user-journey'

export interface DiagramInfo {
  kind: DiagramKind | string
  key: string
  source?: string
  level?: string
  /** The frame item, when the diagram is a frame (absent for a legacy board-wide diagram). */
  frame?: Item
}

export function diagramData(it: Item | undefined): Omit<DiagramInfo, 'frame'> | undefined {
  const d = diagramSpecOf(it)
  return d ? { kind: d.kind, key: d.key, source: d.source, level: d.level } : undefined
}

/** The model's diagramOf (an arrow asks for its `from` end), with the frame item attached. */
export function diagramOf(board: Board, it: Item | undefined): DiagramInfo | undefined {
  const d = modelDiagramOf(board, it)
  return d ? { kind: d.kind, key: d.key, source: d.source, level: d.level, frame: d.frameId ? board.items[d.frameId] : undefined } : undefined
}

/** Items inside a frame (any depth), excluding comments and wires. */
export function membersOf(board: Board, frameId: string): Item[] {
  const inFrame = (it: Item): boolean => {
    let p = it.parent
    const seen = new Set<string>()
    while (p && !seen.has(p)) {
      if (p === frameId) return true
      seen.add(p)
      p = board.items[p]?.parent
    }
    return false
  }
  return Object.values(board.items).filter((it) => it.type !== 'arrow' && it.type !== 'comment' && inFrame(it))
}

export const isWorkflowScope = (board: Board, it: Item | undefined) => diagramOf(board, it)?.kind === 'workflow'

export const KIND_NAMES: Record<string, string> = {
  'event-storming': 'EventStorming',
  'user-story-map': 'Story map',
  kanban: 'Kanban',
  wireframe: 'Wireframe',
  workflow: 'Workflow',
  'domain-story': 'Domain story',
  'user-journey': 'User journey',
}
