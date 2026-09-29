import { useEffect, useState } from 'react'
import { BoardList } from './BoardList'
import { BoardPage } from './BoardPage'

function usePath(): string {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const on = () => setPath(location.pathname)
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  return path
}

export function App() {
  const path = usePath()
  const m = path.match(/^\/b\/([^/]+)\/?$/)
  if (m) return <BoardPage key={m[1]} id={decodeURIComponent(m[1])} />
  return <BoardList />
}
