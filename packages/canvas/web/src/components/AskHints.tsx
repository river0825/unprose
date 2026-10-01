// "Ask your agent": what Unprose can do, as sentences to paste into the agent (the list is askHints.ts).
// AskPanel sits on the board list; EmptyBoardHint is centred on a board with no items yet. The board hint
// lives outside the React Flow viewport, so "Copy as image" never captures it, and only the card itself
// takes pointer events, so panning and zooming the empty board still work around it.
import { useEffect, useRef, useState } from 'react'
import { ASK_HINTS, HELP_HINT, promptParts, type AskHint } from '../askHints'
import './ask-hints.css'

/** Write text to the clipboard; falls back to a hidden textarea where the async API is missing (plain http). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className={`ask-copy ${state}`}
      aria-label={state === 'idle' ? label : undefined}
      onClick={async (e) => {
        e.stopPropagation()
        const ok = await copyText(text)
        setState(ok ? 'copied' : 'failed')
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setState('idle'), 1600)
      }}
    >
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy'}</span>
    </button>
  )
}

function Prompt({ text }: { text: string }) {
  return (
    <q className="ask-prompt">
      {promptParts(text).map((p, i) =>
        p.slot ? (
          <span key={i} className="ask-slot" title="Replace with your own">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </q>
  )
}

function Row({ h, short }: { h: AskHint; short?: boolean }) {
  return (
    <li className="ask-row">
      <div className="ask-what">
        <span className="ask-title">{h.title}</span>
        {!short && <span className="ask-desc">{h.what}</span>}
      </div>
      <div className="ask-line">
        <Prompt text={h.prompt} />
        <CopyButton text={h.prompt} label={`Copy the ${h.title} prompt`} />
      </div>
      {!short && <code className="ask-cmd">{h.command}</code>}
    </li>
  )
}

const OPEN_KEY = 'awd.askHints.open'
const rememberedOpen = (): boolean => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

/** The board list's panel; open unless this viewer closed it (always open when there are no boards). */
export function AskPanel({ forceOpen }: { forceOpen?: boolean }) {
  const [open, setOpen] = useState(rememberedOpen)
  return (
    <details
      className="ask-panel"
      open={forceOpen || open}
      onToggle={(e) => {
        if (forceOpen) return
        const now = (e.currentTarget as HTMLDetailsElement).open
        setOpen(now)
        try {
          localStorage.setItem(OPEN_KEY, now ? '1' : '0')
        } catch {
          /* private window: not remembered */
        }
      }}
    >
      <summary>
        <span className="ask-heading">Ask your agent</span>
        <span className="ask-sub">Paste a sentence into Claude Code, Codex or any agent with the Unprose tools; it draws here.</span>
      </summary>
      <ul className="ask-list">
        {[...ASK_HINTS, HELP_HINT].map((h) => (
          <Row key={h.id} h={h} />
        ))}
      </ul>
      <p className="ask-foot">
        The <code>/unprose:…</code> commands are Claude Code slash commands from the Unprose plugin; other agents take the
        sentence as it is.
      </p>
    </details>
  )
}

/** Centred on an empty board; gone as soon as the board has an item. */
export function EmptyBoardHint() {
  return (
    <div className="ask-empty-wrap">
      <section className="ask-empty" aria-labelledby="ask-empty-title">
        <h2 id="ask-empty-title" className="ask-heading">
          This board is empty
        </h2>
        <p className="ask-sub">Ask your agent to draw on it, for example:</p>
        <ul className="ask-list">
          {ASK_HINTS.map((h) => (
            <Row key={h.id} h={h} short />
          ))}
        </ul>
        <p className="ask-foot">
          Or add stickies from the rail. In Claude Code: <code>{HELP_HINT.command}</code>
        </p>
      </section>
    </div>
  )
}
