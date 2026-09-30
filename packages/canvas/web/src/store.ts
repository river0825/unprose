import { useCallback, useEffect, useRef, useState } from 'react'
import type { Board, Change, Item, Op, WsMessage } from '../../src/model'
import { applyOps, isBookkeeping } from '../../src/model'
import { api, asArray, connectBoard } from './api'

export interface Toast {
  id: number
  text: string
  kind?: 'error' | 'info'
}

/** One entry on the undo/redo stack: the echoed change plus the note it was made with. */
interface StackEntry {
  change: Change
  label: string
}

export type FocusRequest = Extract<WsMessage, { type: 'focus' }>

export interface BoardStore {
  board: Board | null
  error: string | null
  connected: boolean
  /** true while an agent is blocked in canvas_wait on this board */
  agentWatching: boolean
  /** Set while the server cannot save this board (disk gone, permissions…); cleared when saving works again. */
  storageError: string | null
  /** The latest "look here" request (canvas_focus / POST /focus); null once gone to or dismissed. */
  focusRequest: FocusRequest | null
  clearFocus: () => void
  changes: Change[]
  toasts: Toast[]
  /** ids of items the agent touched recently, for the highlight wash */
  pulse: Set<string>
  /** Apply a user gesture: optimistic local update + POST. Undoable unless said otherwise. */
  commit: (ops: Op[], note: string, opts?: { undoable?: boolean }) => Promise<Change | undefined>
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** Send an empty 'handoff' change so a waiting agent wakes up now. */
  handoff: () => Promise<void>
  setTitle: (title: string) => Promise<void>
  toast: (text: string, kind?: Toast['kind']) => void
}

let toastSeq = 0

/**
 * The inverse of a change, derived from its `before` snapshot. Items the agent
 * has touched since are left alone (returned in `skipped`) so an undo never
 * silently overwrites the other side of the conversation.
 */
function invert(entry: Change, board: Board): { ops: Op[]; skipped: string[] } {
  const ops: Op[] = []
  const skipped: string[] = []
  // last op per id decides the kind of the inverse
  const last = new Map<string, Op>()
  for (const op of entry.ops) last.set(op.kind === 'add' ? op.item.id : op.id, op)
  for (const [id, op] of last) {
    const prev = entry.before[id]
    const cur = board.items[id]
    if (cur && cur.updatedBy === 'agent' && cur.updatedAt > entry.ts) {
      skipped.push(id)
      continue
    }
    if (op.kind === 'add' || prev === null || prev === undefined) {
      if (cur) ops.push({ kind: 'remove', id })
    } else if (op.kind === 'remove') {
      if (!cur) ops.push({ kind: 'add', item: prev })
    } else {
      if (!cur) continue
      const { id: _id, ...fields } = prev
      ops.push({ kind: 'update', id, patch: fields })
    }
  }
  return { ops, skipped }
}

/**
 * Board state: snapshot + change log, kept in sync over the websocket.
 * The user's own edits apply optimistically; the server's echoed change is
 * reconciled by seq so an out-of-order echo never double-applies.
 */
export function useBoard(id: string): BoardStore {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [agentWatching, setAgentWatching] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [changes, setChanges] = useState<Change[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pulse, setPulse] = useState<Set<string>>(new Set())
  const [undoStack, setUndoStack] = useState<StackEntry[]>([])
  const [redoStack, setRedoStack] = useState<StackEntry[]>([])
  // seq of the latest change we have folded in; refs so ws handlers see fresh values
  const seqRef = useRef(0)
  const boardRef = useRef<Board | null>(null)
  boardRef.current = board
  const undoRef = useRef(undoStack)
  undoRef.current = undoStack
  const redoRef = useRef(redoStack)
  redoRef.current = redoStack

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const t = { id: ++toastSeq, text, kind }
    setToasts((ts) => [...ts, t])
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 3200)
  }, [])

  const pulseItems = useCallback((ids: string[]) => {
    if (!ids.length) return
    setPulse((p) => new Set([...p, ...ids]))
    setTimeout(() => setPulse((p) => {
      const n = new Set(p)
      ids.forEach((i) => n.delete(i))
      return n
    }), 1200)
  }, [])

  const foldChange = useCallback(
    (change: Change) => {
      if (change.seq <= seqRef.current) return
      seqRef.current = change.seq
      setBoard((b) => {
        if (!b) return b
        const { board: next } = applyOps(b, change.ops, change.author, change.ts)
        return { ...next, seq: change.seq }
      })
      if (isBookkeeping(change)) return
      setChanges((cs) => [change, ...cs].slice(0, 300))
      if (change.author === 'agent') {
        const ids = change.ops.map((o) => (o.kind === 'add' ? o.item.id : o.id))
        const n = new Set(ids).size
        if (n) toast(`Agent changed ${n} item${n === 1 ? '' : 's'}${change.note ? `: ${change.note}` : ''}`)
        pulseItems(ids)
      }
    },
    [toast, pulseItems],
  )

  useEffect(() => {
    let cancelled = false
    seqRef.current = 0
    setBoard(null)
    setChanges([])
    setError(null)
    setUndoStack([])
    setRedoStack([])
    Promise.all([api.getBoard(id), api.changes(id, 0).catch(() => [] as Change[])])
      .then(([b, cs]) => {
        if (cancelled) return
        const list = asArray(cs, 'changes')
        seqRef.current = b.seq
        setBoard(b)
        setChanges(list.filter((c) => !isBookkeeping(c)).sort((a, z) => z.seq - a.seq).slice(0, 300))
      })
      .catch((e: Error) => !cancelled && setError(e.message))

    const stop = connectBoard(id, {
      onStatus: (open) => {
        setConnected(open)
        if (!open) setAgentWatching(false)
      },
      onMessage: (m: WsMessage) => {
        if (cancelled) return
        if (m.type === 'hello') {
          // reconnect: adopt the server snapshot if it is ahead of us
          if (m.board.seq > seqRef.current) {
            seqRef.current = m.board.seq
            setBoard(m.board)
            api.changes(id, 0).then((cs) => {
              if (cancelled) return
              setChanges(asArray(cs, 'changes').filter((c) => !isBookkeeping(c)).sort((a, z) => z.seq - a.seq).slice(0, 300))
            }).catch(() => undefined)
          }
        } else if (m.type === 'change') {
          foldChange(m.change)
        } else if (m.type === 'presence') {
          if (m.author === 'agent') setAgentWatching(Boolean(m.watching))
        } else if (m.type === 'focus') {
          setFocusRequest(m) // only the latest one is kept
        } else if (m.type === 'update') {
          // the canvas is upgrading itself (docs/canvas.md "Updating"); the page reconnects on its own
          if (m.phase === 'restarting') toast(`The canvas is restarting on ${m.version ? `v${m.version}` : 'a new version'} — it reconnects by itself`)
          else if (m.phase === 'failed') toast(`Upgrade failed: ${m.message}`, 'error')
        } else if (m.type === 'storage') {
          setStorageError(m.ok ? null : m.message)
          toast(m.ok ? m.message : `Changes are not being saved: ${m.message}`, m.ok ? 'info' : 'error')
        }
      },
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [id, foldChange, toast])

  const post = useCallback(
    async (ops: Op[], note: string): Promise<Change | undefined> => {
      const cur = boardRef.current
      if (!cur) return undefined
      // optimistic apply; seq stays put until the server echoes
      if (ops.length) setBoard((b) => (b ? applyOps(b, ops, 'user').board : b))
      try {
        const res = await api.postOps(id, ops, note)
        if (res.change) foldChange(res.change)
        return res.change
      } catch (e) {
        toast(`Could not save: ${(e as Error).message}`, 'error')
        // resync from the server rather than guess
        api.getBoard(id).then((b) => {
          seqRef.current = b.seq
          setBoard(b)
        }).catch(() => undefined)
        return undefined
      }
    },
    [id, foldChange, toast],
  )

  const commit = useCallback(
    async (ops: Op[], note: string, opts?: { undoable?: boolean }) => {
      if (!ops.length) return undefined
      const change = await post(ops, note)
      if (change && opts?.undoable !== false) {
        setUndoStack((s) => [...s, { change, label: note }].slice(-100))
        setRedoStack([])
      }
      return change
    },
    [post],
  )

  const reverse = useCallback(
    async (from: 'undo' | 'redo') => {
      const stack = from === 'undo' ? undoRef.current : redoRef.current
      const entry = stack[stack.length - 1]
      const cur = boardRef.current
      if (!entry || !cur) return
      const { ops, skipped } = invert(entry.change, cur)
      if (skipped.length) toast(`Skipped ${skipped.length} item${skipped.length === 1 ? '' : 's'}: the agent changed ${skipped.length === 1 ? 'it' : 'them'} since`)
      const setFrom = from === 'undo' ? setUndoStack : setRedoStack
      const setTo = from === 'undo' ? setRedoStack : setUndoStack
      setFrom((s) => s.slice(0, -1))
      if (!ops.length) return
      const change = await post(ops, `${from}: ${entry.label}`)
      if (change) setTo((s) => [...s, { change, label: entry.label }].slice(-100))
    },
    [post, toast],
  )

  const undo = useCallback(() => void reverse('undo'), [reverse])
  const redo = useCallback(() => void reverse('redo'), [reverse])

  const handoff = useCallback(async () => {
    await post([], 'handoff')
  }, [post])

  const setTitle = useCallback(
    async (title: string) => {
      const t = title.trim()
      if (!t) return
      try {
        const b = await api.updateBoard(id, { title: t })
        setBoard((cur) => (cur ? { ...cur, title: b.title } : cur))
      } catch (e) {
        toast(`Could not rename: ${(e as Error).message}`, 'error')
      }
    },
    [id, toast],
  )

  return {
    board,
    error,
    connected,
    agentWatching,
    storageError,
    focusRequest,
    clearFocus: () => setFocusRequest(null),
    changes,
    toasts,
    pulse,
    commit,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    handoff,
    setTitle,
    toast,
  }
}

export function itemsOf(board: Board | null): Item[] {
  return board ? Object.values(board.items) : []
}
