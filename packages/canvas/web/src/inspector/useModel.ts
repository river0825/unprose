// The model a viewer last asked with — a per-viewer convenience, so it lives in
// localStorage (and quietly falls back to opus when storage is unavailable).
import { useState } from 'react'
import { MODELS, type DiscussModel } from './detail'

const MODEL_KEY = 'awd.inspector.model'

export function useModelChoice(): [DiscussModel, (m: DiscussModel) => void] {
  const [model, setModel] = useState<DiscussModel>(() => {
    try {
      const m = localStorage.getItem(MODEL_KEY)
      return (MODELS as readonly string[]).includes(m ?? '') ? (m as DiscussModel) : 'opus'
    } catch {
      return 'opus'
    }
  })
  const pick = (m: DiscussModel) => {
    setModel(m)
    try {
      localStorage.setItem(MODEL_KEY, m)
    } catch {
      /* per-viewer convenience only */
    }
  }
  return [model, pick]
}
