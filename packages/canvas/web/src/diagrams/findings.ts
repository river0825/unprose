// Grammar findings without loading the file parser up front: the shared check (zod schemas + a YAML
// parser, ~60 kB gz) is imported only when a diagram panel asks for it; until then — and for the frame
// badge on the board — the web's reading of the drawn items stands in, or the last file result.
import { useEffect, useState } from 'react'
import type { Board, Item } from '../../../src/model'
import { esFindings, type Finding } from './es'
import { uiFindings } from './uiFindings'

/** Kinds whose frames show findings: the badge on the frame, the list in its panel. */
export const FINDING_KINDS = new Set(['event-storming', 'domain-story', 'ui-mock'])

const cache = new Map<string, Finding[]>()
const cacheKey = (board: Board, frameId: string) => `${board.id}:${frameId}:${board.seq}`

/** Sync: the last file-based result for this board state, else the drawn-items reading. */
export function knownFindings(board: Board, frame: Item, level?: string, kind = 'event-storming'): Finding[] {
  // a UI mock's findings are on its drawn items already (the drawing ran `awd design lint`'s check)
  if (kind === 'ui-mock') return uiFindings(board, frame.id)
  return cache.get(cacheKey(board, frame.id)) ?? (kind === 'event-storming' ? esFindings(board, frame.id, level) : [])
}

/** Findings for a frame's panel: starts with `knownFindings`, then the file-based check once it loads. */
export function useFrameFindings(board: Board, frame: Item, key: string, level?: string, source?: string, kind = 'event-storming'): Finding[] {
  const [found, setFound] = useState<Finding[]>(() => knownFindings(board, frame, level, kind))
  useEffect(() => {
    let live = true
    setFound(knownFindings(board, frame, level, kind))
    if (kind === 'ui-mock') return
    void import('./content').then(({ frameFindings }) => {
      const f = frameFindings(board, frame, key, level, source, kind)
      cache.set(cacheKey(board, frame.id), f)
      if (live) setFound(f)
    })
    return () => {
      live = false
    }
  }, [board, frame, key, level, source, kind])
  return found
}

/** How many findings the frame's badge shows; undefined for kinds that have none. */
export function findingCount(board: Board, frame: Item, level: string | undefined, kind: string): number | undefined {
  return FINDING_KINDS.has(kind) ? knownFindings(board, frame, level, kind).length : undefined
}
