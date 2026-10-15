// Board meta (the files snapshot, docs/studio.md §5) is set by a PATCH after a
// redraw and does not travel over the websocket. So re-read it: when the Files
// or Inspector view opens, and shortly after a redraw ("awd graph …", "awd design …",
// "design_draw …") made while the page is open (the PATCH follows the ops, hence the two
// delayed reads). Only the meta (GET …/meta): a big board is megabytes.
import { useEffect, useRef, useState } from 'react'
import type { Board, Change } from '../../../src/model'
import { api } from '../api'

const isRedraw = (note: string | undefined) => !!note && /^(awd graph|awd design|design_draw)\b/.test(note)

/** `changes`: newest first (store.ts). */
export function useFreshMeta(board: Board, changes: Array<Pick<Change, 'seq' | 'note'>>, viewKey: string): Board {
  const [meta, setMeta] = useState<{ id: string; meta: Board['meta'] } | null>(null)
  // a redraw already in the log when the board opened is in the meta read then
  const opened = useRef({ id: board.id, seq: board.seq })
  if (opened.current.id !== board.id) opened.current = { id: board.id, seq: board.seq }
  const newest = changes.find((c) => isRedraw(c.note))?.seq ?? 0
  const redrawn = newest > opened.current.seq ? newest : 0
  useEffect(() => {
    let live = true
    const read = () =>
      api
        .boardMeta(board.id)
        .then((b) => live && setMeta({ id: b.id, meta: b.meta ?? undefined }))
        .catch(() => undefined)
    void read()
    const timers = redrawn ? [window.setTimeout(read, 600), window.setTimeout(read, 2500)] : []
    return () => {
      live = false
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [board.id, redrawn, viewKey])
  return meta && meta.id === board.id && meta.meta ? { ...board, meta: meta.meta } : board
}
