import { useCallback, useEffect, useState } from 'react'

function read(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const ids: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : [])
  } catch {
    return new Set()
  }
}

function write(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]))
  } catch {
    // per-viewer preference only; losing it is harmless
  }
}

/** A set of ids remembered in this browser (per key), e.g. which comments are expanded. */
export function useStoredSet(key: string): [Set<string>, (id: string, on: boolean) => void] {
  const [set, setSet] = useState(() => read(key))
  useEffect(() => setSet(read(key)), [key])
  const toggle = useCallback(
    (id: string, on: boolean) =>
      setSet((prev) => {
        if (prev.has(id) === on) return prev
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        write(key, next)
        return next
      }),
    [key],
  )
  return [set, toggle]
}
