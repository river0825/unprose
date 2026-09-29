// Is `awd studio` running for this board? The canvas server supervises it (docs/studio.md §8b);
// this polls its status and offers start / stop. Several components may use it; each polls on its own.
import { useCallback, useEffect, useState } from 'react'

export interface StudioStatus {
  capable: boolean
  running: boolean
  pid?: number
  since?: string
  exitCode?: number | null
  log: string[]
  sessions?: { open: number; max: number; queued: number }
}

const EVERY_MS = 5000

export function useStudio(boardId: string | undefined, enabled = true) {
  const [status, setStatus] = useState<StudioStatus | undefined>()
  const [busy, setBusy] = useState<'start' | 'stop' | 'new-session' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!boardId) return
    try {
      const r = await fetch(`/api/boards/${encodeURIComponent(boardId)}/studio`)
      if (r.ok) setStatus((await r.json()) as StudioStatus)
    } catch {
      /* offline: keep the last status */
    }
  }, [boardId])

  useEffect(() => {
    if (!boardId || !enabled) return
    void refresh()
    const t = window.setInterval(() => void refresh(), EVERY_MS)
    return () => window.clearInterval(t)
  }, [boardId, enabled, refresh])

  const act = useCallback(
    async (action: 'start' | 'stop' | 'new-session') => {
      if (!boardId) return
      setBusy(action)
      setError(null)
      try {
        const r = await fetch(`/api/boards/${encodeURIComponent(boardId)}/studio`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        if (!r.ok) setError(`${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`)
      } catch (e) {
        setError(String(e))
      } finally {
        await refresh()
        setBusy(null)
      }
    },
    [boardId, refresh],
  )

  // new-session: drop this board's Claude session so the next chat starts fresh (docs/diagrams.md §8)
  return { status, busy, error, start: () => act('start'), stop: () => act('stop'), newSession: () => act('new-session') }
}
