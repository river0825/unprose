// Connect notifications on every page (docs/canvas.md "Remote agents"): the server socket `/ws` tells pages
// that may approve about each pending request; newest on top, top-right.
import { useEffect, useState } from 'react'
import { ACCESS_CHANGED_EVENT, connectServer, useAccess, type AccessRequestView } from '../access'
import { RequestCard } from './RequestCard'
import '../access.css'

/** Pending requests, kept live from the server socket (also used by the agents page). */
export function usePendingRequests(enabled: boolean): AccessRequestView[] {
  const [requests, setRequests] = useState<AccessRequestView[]>([])
  useEffect(() => {
    if (!enabled) return
    return connectServer((m) => {
      if (m.type === 'access-request') setRequests((rs) => [m.request, ...rs.filter((r) => r.id !== m.request.id)])
      else if (m.type === 'access-resolved') setRequests((rs) => rs.filter((r) => r.id !== m.id))
      else if (m.type === 'access-changed') window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT))
    })
  }, [enabled])
  return requests
}

export function AccessCenter({ hidden }: { hidden?: boolean }) {
  const me = useAccess()
  const requests = usePendingRequests(me.canApprove && !hidden)
  const [later, setLater] = useState<Set<string>>(new Set())
  if (hidden || !me.canApprove) return null
  const shown = requests.filter((r) => !later.has(r.id))
  if (!shown.length) return null
  return (
    <div className="access-stack" aria-label="Connect requests">
      {shown.map((r) => (
        <RequestCard key={r.id} request={r} oneClick={me.oneClick} onLater={() => setLater((s) => new Set(s).add(r.id))} />
      ))}
    </div>
  )
}
