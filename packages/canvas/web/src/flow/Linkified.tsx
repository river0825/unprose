// Text with clickable links: bare http(s) URLs (ASCII only, so a following 「，」 is not swallowed) and Markdown `[label](url)`. Only http, https and mailto
// become links (never javascript: or data:). A click opens a new tab and does not select, drag or start
// editing the item it sits on.
import type { ReactNode } from 'react'

const LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|((?:https?:\/\/|mailto:)[^\s<>"'`\u0080-\uffff]+[^\s<>"'`.,;:!?)\]}\u0080-\uffff])/g

/** Split text into plain strings and `{ label, href }` links — pure, so it can be tested. */
export function linkParts(text: string): Array<string | { label: string; href: string }> {
  const out: Array<string | { label: string; href: string }> = []
  let last = 0
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    out.push(m[2] ? { label: m[1], href: m[2] } : { label: m[3], href: m[3] })
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

export function Linkified({ text }: { text: string }): ReactNode {
  const parts = linkParts(text)
  if (parts.length === 1 && typeof parts[0] === 'string') return text
  return parts.map((p, i) =>
    typeof p === 'string' ? (
      p
    ) : (
      <a
        key={i}
        className="item-link nodrag nopan"
        href={p.href}
        target="_blank"
        rel="noopener noreferrer"
        title={p.href}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={stop}
        onDoubleClick={stop}
      >
        {p.label}
      </a>
    ),
  )
}
