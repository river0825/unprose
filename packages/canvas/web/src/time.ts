/** "3 min ago" style relative time. */
export function timeAgo(ts: string): string {
  const d = Date.now() - new Date(ts).getTime()
  if (!Number.isFinite(d) || d < 0) return ''
  const s = Math.round(d / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  const days = Math.round(h / 24)
  if (days < 14) return `${days} d ago`
  return new Date(ts).toLocaleDateString()
}
