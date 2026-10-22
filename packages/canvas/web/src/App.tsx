import { useEffect, useState } from 'react'
import { BoardList } from './BoardList'
import { BoardPage } from './BoardPage'
import { AgentsPage } from './AgentsPage'
import { AccessContext, accessApi, SIGNIN_EVENT, type AccessMe } from './access'
import { AccessCenter } from './components/AccessCenter'
import { SignIn } from './components/SignIn'
import { ReportHost } from './components/ReportIssue'

function usePath(): string {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const on = () => setPath(location.pathname)
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  return path
}

/** Who this page is (docs/canvas.md "Remote agents"); asked again whenever a request comes back 401. */
function useMe(): AccessMe | null {
  const [me, setMe] = useState<AccessMe | null>(null)
  useEffect(() => {
    const load = () => void accessApi.me().then(setMe)
    load()
    window.addEventListener(SIGNIN_EVENT, load)
    return () => window.removeEventListener(SIGNIN_EVENT, load)
  }, [])
  return me
}

export function App() {
  const path = usePath()
  const me = useMe()
  if (!me) return null
  if (me.remoteAuth && !me.signedIn) return <SignIn />
  const m = path.match(/^\/b\/([^/]+)\/?$/)
  const agents = /^\/agents\/?$/.test(path)
  return (
    <AccessContext.Provider value={me}>
      <AccessCenter hidden={agents} />
      {m ? <BoardPage key={m[1]} id={decodeURIComponent(m[1])} /> : agents ? <AgentsPage /> : <BoardList />}
      <ReportHost />
    </AccessContext.Provider>
  )
}
