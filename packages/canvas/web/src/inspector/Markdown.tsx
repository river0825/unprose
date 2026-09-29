// A tiny markdown renderer for agent personas: headings, lists, quotes, fenced
// code, paragraphs; inline code, bold, italic, links. It builds React elements,
// never HTML strings, so nothing in the text can inject markup.
import type { ReactNode } from 'react'

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'code'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'quote'; text: string }
  | { t: 'p'; text: string }

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(/^\s*(```|~~~)/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++
      out.push({ t: 'code', text: body.join('\n') })
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      out.push({ t: 'h', level: h[1].length, text: h[2].replace(/\s+#+\s*$/, '') })
      i++
      continue
    }
    const listKind = (l: string) => (/^\s*[-*+]\s+/.test(l) ? 'ul' : /^\s*\d+[.)]\s+/.test(l) ? 'ol' : undefined)
    const lk = listKind(line)
    if (lk) {
      const items: string[] = []
      while (i < lines.length && lines[i].trim()) {
        if (listKind(lines[i]) === lk) items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))
        else if (items.length) items[items.length - 1] += ` ${lines[i].trim()}` // continuation line
        else break
        i++
      }
      out.push({ t: lk, items })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push({ t: 'quote', text: body.join(' ') })
      continue
    }
    const body: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>)/.test(lines[i]) && !listKind(lines[i])) body.push(lines[i++].trim())
    out.push({ t: 'p', text: body.join(' ') })
  }
  return out
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/

export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let n = 0
  while (rest) {
    const m = rest.match(INLINE)
    if (!m || m.index === undefined) {
      out.push(rest)
      break
    }
    if (m.index) out.push(rest.slice(0, m.index))
    const tok = m[0]
    const k = `${key}-${n++}`
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>)
    else if (m[3]) out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>)
    else {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) ?? []
      out.push(
        /^https?:\/\//.test(href ?? '') ? (
          <a key={k} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          <span key={k}>{label}</span>
        ),
      )
    }
    rest = rest.slice(m.index + tok.length)
  }
  return out
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseBlocks(text).map((b, i) => {
        const k = `b${i}`
        switch (b.t) {
          case 'h': {
            // Persona headings sit under the panel's own h3s, so they start at h4.
            const Tag = (b.level <= 1 ? 'h4' : b.level === 2 ? 'h5' : 'h6') as 'h4' | 'h5' | 'h6'
            return <Tag key={k}>{inline(b.text, k)}</Tag>
          }
          case 'code':
            return (
              <pre key={k} className="md-code">
                <code>{b.text}</code>
              </pre>
            )
          case 'ul':
          case 'ol': {
            const Tag = b.t
            return (
              <Tag key={k}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </Tag>
            )
          }
          case 'quote':
            return <blockquote key={k}>{inline(b.text, k)}</blockquote>
          default:
            return <p key={k}>{inline(b.text, k)}</p>
        }
      })}
    </div>
  )
}
