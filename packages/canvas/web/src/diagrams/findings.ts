// Grammar findings without loading the file parser up front: the shared check (zod schemas + a YAML
// parser, ~60 kB gz) is imported only when a diagram panel asks for it; until then — and for the frame
// badge on the board — the web's reading of the drawn items stands in, or the last file result.
import { useEffect, useState } from 'react'
import type { Board, Item } from '../../../src/model'
import { esFindings, type Finding } from './es'

const cache = new Map<string, Finding[]>()
const cacheKey = (board: Board, frameId: string) => `${board.id}:${frameId}:${board.seq}`

/** Sync: the last file-based result for this board state, else the drawn-items reading. */
export function knownFindings(board: Board, frame: Item, level?: string, kind = 'event-storming'): Finding[] {
  return cache.get(cacheKey(board, frame.id)) ?? (kind === 'event-storming' ? esFindings(board, frame.id, level) : [])
}

/** Findings for a frame's panel: starts with `knownFindings`, then the file-based check once it loads. */
export function useFrameFindings(board: Board, frame: Item, key: string, level?: string, source?: string, kind = 'event-storming'): Finding[] {
  const [found, setFound] = useState<Finding[]>(() => knownFindings(board, frame, level, kind))
  useEffect(() => {
    let live = true
    setFound(knownFindings(board, frame, level, kind))
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
