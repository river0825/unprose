// A diagram frame's content, read from the board's snapshot of its file (docs/diagrams.md §2), and
// its grammar findings: the shared check (canvas/src/diagrams/grammar) on the file when the board has
// it, else the web's reading of the drawn items.
import { parse } from 'yaml'
import type { Board, Item } from '../../../src/model'
import { checkEventStorming } from '../../../src/diagrams/grammar'
import { esFindings, type Finding } from './es'
import { membersOf } from './frame'

interface DiagramMeta { source?: string; files?: Record<string, string>; content?: unknown }

const parsed = new Map<string, unknown>()

/** The frame's content: `meta.diagrams[key].content` if the board carries it, else its file parsed. */
export function diagramContent(board: Board, key: string, source?: string): unknown {
  const all = board.meta?.diagrams as Record<string, DiagramMeta> | undefined
  const d = all?.[key]
  if (d?.content && typeof d.content === 'object') return d.content
  const file = source ?? d?.source
  const text = file ? d?.files?.[file] : undefined
  if (!text) return undefined
  if (!parsed.has(text)) {
    try {
      parsed.set(text, parse(text))
    } catch {
      parsed.set(text, undefined)
    }
  }
  return parsed.get(text)
}

/** Board item that draws file element `element` inside the frame: id `<key>.<role>.<element>` (or data.element). */
export function itemOfElement(board: Board, frameId: string, element: string | undefined): Item | undefined {
  if (!element) return undefined
  return membersOf(board, frameId).find((it) => it.data?.element === element || it.id.endsWith(`.${element}`))
}

/** Grammar findings for an EventStorming frame. */
export function frameFindings(board: Board, frame: Item, key: string, level?: string, source?: string): Finding[] {
  const content = diagramContent(board, key, source)
  if (content && typeof content === 'object') {
    try {
      return checkEventStorming(content as Parameters<typeof checkEventStorming>[0])
        .filter((f) => f.severity === 'warning' || f.rule === 'open-hotspots')
        .map((f) => ({ elementId: itemOfElement(board, frame.id, f.element)?.id ?? frame.id, message: f.message, page: f.page }))
    } catch {
      /* content the check cannot read: fall back to the drawn items */
    }
  }
  return esFindings(board, frame.id, level)
}
