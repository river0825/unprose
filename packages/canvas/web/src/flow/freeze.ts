// Per-viewer "Freeze headers" preference for a diagram frame: on unless this viewer turned it off.
// Stored in localStorage (keyed by board and diagram key); a window event keeps every reader in sync.
import { useCallback, useEffect, useState } from 'react'

const storageKey = (boardId: string, key: string) => `awd.freeze.${boardId}.${key}`
const EVENT = 'awd-freeze-change'

export function isFrozen(boardId: string, key: string): boolean {
  try {
    return localStorage.getItem(storageKey(boardId, key)) !== '0'
  } catch {
    return true
  }
}

export function setFrozen(boardId: string, key: string, on: boolean) {
  try {
    if (on) localStorage.removeItem(storageKey(boardId, key))
    else localStorage.setItem(storageKey(boardId, key), '0')
  } catch {
    /* private window: the choice just is not remembered */
  }
  window.dispatchEvent(new Event(EVENT))
}

/** Re-render when any freeze preference changes; returns a counter to use as a memo dependency. */
export function useFreezeVersion(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const bump = () => setN((v) => v + 1)
    window.addEventListener(EVENT, bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener(EVENT, bump)
      window.removeEventListener('storage', bump)
    }
  }, [])
  return n
}

export function useFrozen(boardId: string, key: string): [boolean, (on: boolean) => void] {
  useFreezeVersion()
  const on = isFrozen(boardId, key)
  const set = useCallback((v: boolean) => setFrozen(boardId, key, v), [boardId, key])
  return [on, set]
}
