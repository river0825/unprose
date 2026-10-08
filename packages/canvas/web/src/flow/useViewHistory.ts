// The view history (flow/viewHistory.ts) on React Flow's viewport: mark() before a jump, back() / forward() on ⌥← / ⌥→.
import { useCallback, useMemo, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { emptyHistory, goBack, goForward, pushView, type ViewHistory } from './viewHistory'

export function useViewHistory() {
  const flow = useReactFlow()
  const h = useRef<ViewHistory>(emptyHistory())
  /** call right before moving the view somewhere else */
  const mark = useCallback(() => {
    h.current = pushView(h.current, flow.getViewport())
  }, [flow])
  const back = useCallback(() => {
    const r = goBack(h.current, flow.getViewport())
    if (!r) return false
    h.current = r.next
    void flow.setViewport(r.to, { duration: 300 })
    return true
  }, [flow])
  const forward = useCallback(() => {
    const r = goForward(h.current, flow.getViewport())
    if (!r) return false
    h.current = r.next
    void flow.setViewport(r.to, { duration: 300 })
    return true
  }, [flow])
  return useMemo(() => ({ mark, back, forward }), [mark, back, forward])
}
