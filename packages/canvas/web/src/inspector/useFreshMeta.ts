// Board meta (the files snapshot, docs/studio.md §5) is set by a PUT after a
// redraw and does not travel over the websocket. So re-read it: when the Files
// or Inspector view opens, and shortly after a change noted "awd graph …" or "awd design …"
// (the PUT follows the ops, hence the two delayed reads).
import { useEffect, useState } from 'react'
import type { Board, Change } from '../../../src/model'
import { api } from '../api'

export function useFreshMeta(board: Board, changes: Change[], viewKey: string): Board {
  const [meta, setMeta] = useState<{ id: string; meta: Board['meta'] } | null>(null)
  const redraws = changes.filter((c) => c.note?.startsWith('awd graph') || c.note?.startsWith('awd design')).length
  useEffect(() => {
    let live = true
    const read = () =>
      api
        .getBoard(board.id)
        .then((b) => live && setMeta({ id: b.id, meta: b.meta }))
        .catch(() => undefined)
    void read()
    const timers = redraws ? [window.setTimeout(read, 600), window.setTimeout(read, 2500)] : []
    return () => {
      live = false
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [board.id, redraws, viewKey])
  return meta && meta.id === board.id && meta.meta ? { ...board, meta: meta.meta } : board
}
