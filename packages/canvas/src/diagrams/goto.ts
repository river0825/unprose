// "Go to…" — what the palette can jump to, and how a query ranks it. Pure, so the web palette and the
// tests share it: diagram frames first, then items, matched on their text, key, role and frame title.
import { diagramFrames, diagramOf, diagramSpecOf, type Board, type Item } from '../model.js'

export interface GotoTarget {
  /** item id to fit and select (a frame item for a diagram) */
  id: string
  kind: 'frame' | 'item'
  /** what the row shows */
  label: string
  /** the diagram kind (frames) or the item's role / type */
  badge: string
  /** frames: the diagram key; items: the title of the frame they sit in */
  detail?: string
}

const KIND_NAMES: Record<string, string> = {
  'event-storming': 'EventStorming',
  'user-story-map': 'Story map',
  'domain-story': 'Domain story',
  'user-journey': 'Journey',
  kanban: 'Kanban',
  wireframe: 'Wireframe',
  workflow: 'Workflow',
}

const firstLine = (s: string | undefined) => (s ?? '').split('\n')[0].trim()

/** Everything worth jumping to: diagram frames (title, kind, key), then items that have text. */
export function gotoTargets(board: Pick<Board, 'kind' | 'items'>): GotoTarget[] {
  const frames: GotoTarget[] = diagramFrames(board).map((f) => {
    const it = board.items[f.frameId]
    return { id: f.frameId, kind: 'frame', label: firstLine(it?.text) || f.key, badge: KIND_NAMES[f.kind] ?? f.kind, detail: f.key }
  })
  const items: GotoTarget[] = []
  for (const it of Object.values(board.items) as Item[]) {
    if (it.type === 'arrow' || it.type === 'comment' || diagramSpecOf(it)) continue
    const label = firstLine(it.text)
    if (!label) continue
    const d = diagramOf(board, it)
    const frameTitle = d?.frameId ? firstLine(board.items[d.frameId]?.text) || d.key : undefined
    items.push({ id: it.id, kind: 'item', label, badge: (it.role ?? it.type).replace(/-/g, ' '), ...(frameTitle ? { detail: frameTitle } : {}) })
  }
  frames.sort((a, b) => a.label.localeCompare(b.label))
  items.sort((a, b) => a.label.localeCompare(b.label))
  return [...frames, ...items]
}

/** How well `text` matches `q` (both lower-case): prefix > word start > substring > letters in order; 0 = no match. */
function score(text: string, q: string): number {
  if (!q) return 1
  if (text.startsWith(q)) return 100 - Math.min(text.length - q.length, 40) / 4
  const at = text.indexOf(q)
  if (at > 0) return (/[\s\-_/·(（「]/.test(text[at - 1]) ? 70 : 50) - Math.min(at, 40) / 4
  // letters in order (fuzzy): "stes" finds "studio-es"
  let i = 0
  for (const ch of text) if (ch === q[i]) i++
  return i === q.length ? 20 : 0
}

/** The targets matching `query`, best first (frames win ties), at most `limit`. Every word must match somewhere. */
export function rankTargets(targets: GotoTarget[], query: string, limit = 50): GotoTarget[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return targets.slice(0, limit)
  const scored: Array<{ t: GotoTarget; s: number }> = []
  for (const t of targets) {
    const fields = [t.label, t.detail ?? '', t.badge].map((f) => f.toLowerCase())
    let total = 0
    let ok = true
    for (const w of words) {
      const best = Math.max(score(fields[0], w) * 1.5, score(fields[1], w), score(fields[2], w) * 0.6)
      if (best <= 0) {
        ok = false
        break
      }
      total += best
    }
    if (ok) scored.push({ t, s: total + (t.kind === 'frame' ? 5 : 0) })
  }
  return scored.sort((a, b) => b.s - a.s || a.t.label.localeCompare(b.t.label)).slice(0, limit).map((x) => x.t)
}
