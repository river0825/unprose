// Live connection to an awd runtime: SSE first, polling as the fallback.
import { useEffect, useRef, useState } from 'react'
import type { RunEvent, RunState } from './model'

export interface RuntimeFeed {
  connected: boolean
  mode: 'sse' | 'poll' | 'offline'
  workflow?: string
  runs: RunState[]
  events: RunEvent[]
}

const MAX_EVENTS = 400

export function useRuntime(statusUrl: string | undefined): RuntimeFeed {
  const [feed, setFeed] = useState<RuntimeFeed>({ connected: false, mode: 'offline', runs: [], events: [] })
  const runsRef = useRef(new Map<string, RunState>())

  useEffect(() => {
    if (!statusUrl) return
    let closed = false
    let es: EventSource | undefined
    let pollTimer: number | undefined
    const runs = runsRef.current
    runs.clear()

    const publish = (patch: Partial<RuntimeFeed>) => {
      if (closed) return
      setFeed((f) => ({ ...f, ...patch, runs: [...runs.values()] }))
    }
    const foldEvent = (ev: RunEvent) => {
      setFeed((f) => (f.events.some((e) => e.id === ev.id) ? f : { ...f, events: [...f.events, ev].slice(-MAX_EVENTS), runs: [...runs.values()] }))
    }

    const startPolling = () => {
      if (pollTimer) return
      let since = 0
      const tick = async () => {
        try {
          const st = await fetch(`${statusUrl}/api/status`).then((r) => r.json() as Promise<{ workflow: string; runs: RunState[] }>)
          runs.clear()
          for (const r of st.runs) runs.set(r.key, r)
          const evs = await fetch(`${statusUrl}/api/events?since=${since}`).then((r) => r.json() as Promise<RunEvent[]>)
          since += evs.length
          setFeed((f) => ({ ...f, connected: true, mode: 'poll', workflow: st.workflow, runs: [...runs.values()], events: [...f.events, ...evs].slice(-MAX_EVENTS) }))
        } catch {
          publish({ connected: false, mode: 'offline' })
        }
        if (!closed) pollTimer = window.setTimeout(tick, 2000)
      }
      void tick()
    }

    try {
      es = new EventSource(`${statusUrl}/api/stream`)
      es.addEventListener('snapshot', (e) => {
        const snap = JSON.parse((e as MessageEvent).data) as { workflow: string; runs: RunState[]; events: RunEvent[] }
        runs.clear()
        for (const r of snap.runs) runs.set(r.key, r)
        setFeed({ connected: true, mode: 'sse', workflow: snap.workflow, runs: [...runs.values()], events: snap.events.slice(-MAX_EVENTS) })
      })
      es.addEventListener('event', (e) => foldEvent(JSON.parse((e as MessageEvent).data) as RunEvent))
      es.addEventListener('state', (e) => {
        const { key, state } = JSON.parse((e as MessageEvent).data) as { key: string; state: RunState }
        runs.set(key, state)
        publish({ connected: true, mode: 'sse' })
      })
      es.onerror = () => {
        // EventSource retries by itself; after the first failure start polling too so the board never goes blank.
        if (es && es.readyState === EventSource.CLOSED) { es.close(); es = undefined; startPolling() }
        else publish({ connected: false })
      }
    } catch {
      startPolling()
    }

    return () => {
      closed = true
      es?.close()
      if (pollTimer) window.clearTimeout(pollTimer)
    }
  }, [statusUrl])

  return feed
}
