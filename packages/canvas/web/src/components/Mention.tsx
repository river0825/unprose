// @mentions (docs/canvas.md "Several agents on one board"): typing "@" in a comment box offers the agents the board
// knows (connected tokens / OAuth clients, agents seen here, studio); a mention sends the thread to that agent. In a
// message the mention shows as a chip, and a routed message says who talks to whom ("codex-b → claude-a").
import { useMemo, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react'
import type { Item } from '../../../src/model'
import { displayName, LOCAL_AGENT, sameAgent } from '../../../src/routing'
import { useBoardSettings } from './BoardAgents'
import './agents.css'

/** The "@query" being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret)
  const m = /(^|[\s(])@([\p{L}\p{N}_.-]*)$/u.exec(before)
  return m ? { start: caret - m[2].length - 1, query: m[2] } : undefined
}

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { boardId: string; value: string; onValue: (v: string) => void }

/** A textarea with @mention autocomplete. Arrow keys pick, Enter / Tab insert, Escape closes. */
export function MentionTextarea({ boardId, value, onValue, onKeyDown, ...rest }: Props) {
  const settings = useBoardSettings(boardId)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [q, setQ] = useState<{ start: number; query: string } | undefined>()
  const [pick, setPick] = useState(0)
  const options = useMemo(() => {
    if (!q) return []
    const agents = settings?.agents ?? [{ name: LOCAL_AGENT, label: 'studio', watching: false, holder: false }]
    const want = q.query.toLowerCase()
    return agents.filter((a) => a.label.toLowerCase().startsWith(want) || a.name.toLowerCase().startsWith(want) || (want.length > 1 && a.label.toLowerCase().includes(want))).slice(0, 8)
  }, [q, settings])
  const open = options.length > 0
  const listId = `mention-list-${boardId}`
  const insert = (label: string) => {
    if (!q) return
    const token = label.includes(' ') ? label : label
    const next = `${value.slice(0, q.start)}@${token} ${value.slice(q.start + 1 + q.query.length)}`
    onValue(next)
    setQ(undefined)
    const caret = q.start + token.length + 2
    requestAnimationFrame(() => ref.current?.setSelectionRange(caret, caret))
  }
  const track = (el: HTMLTextAreaElement) => {
    setQ(mentionQuery(el.value, el.selectionStart ?? el.value.length))
    setPick(0)
  }
  return (
    <span className="mention-box">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${pick}` : undefined}
        onChange={(e) => {
          onValue(e.target.value)
          track(e.target)
        }}
        onClick={(e) => track(e.currentTarget)}
        onBlur={(e) => {
          rest.onBlur?.(e)
          window.setTimeout(() => setQ(undefined), 150)
        }}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
              return
            }
            if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
              e.preventDefault()
              insert(options[pick].label)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setQ(undefined)
              return
            }
          }
          onKeyDown?.(e)
        }}
      />
      {open && (
        <ul className="mention-menu" id={listId} role="listbox" aria-label="Agents on this board">
          {options.map((a, i) => (
            <li
              key={a.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === pick}
              className={i === pick ? 'on' : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                insert(a.label)
              }}
            >
              <span className="mention-chip">@{a.label}</span>
              <span className="muted">{[a.name === LOCAL_AGENT ? 'this machine' : '', a.holder ? 'holds files' : '', a.watching ? 'here' : ''].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}

/** A message's text with its @mention shown as a chip. */
export function MentionText({ text, mention }: { text: string; mention?: string }) {
  if (!mention) return <>{text}</>
  const labels = [displayName(mention), mention].filter((v, i, all) => all.indexOf(v) === i)
  const re = new RegExp(`@(${labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}_-])`, 'giu')
  const out: Array<string | { chip: string }> = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    out.push({ chip: m[0] })
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return (
    <>
      {out.map((p, i) => (typeof p === 'string' ? p : <span key={i} className="mention-chip">{p.chip}</span>))}
    </>
  )
}

/** "codex-b → claude-a" for a message the canvas routed by a mention; undefined otherwise. */
export function routeLabel(m: Item): { from: string; to: string[] } | undefined {
  const to = m.data?.to
  if (m.data?.route !== 'mention' || !Array.isArray(to) || !to.length) return undefined
  const from = m.createdBy === 'agent' ? displayName(typeof m.data?.by === 'string' ? m.data.by : LOCAL_AGENT) : 'You'
  return { from, to: (to as string[]).filter((n) => !sameAgent(n, from)).map(displayName) }
}

/** An agent message in a mention thread, between agents (no person in it). */
export const isAgentTalk = (m: Item) => m.createdBy === 'agent' && (m.data?.route === 'mention' || m.data?.route === 'paused')
