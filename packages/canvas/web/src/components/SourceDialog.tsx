// The large source view (docs/studio.md §9): CodeMirror with syntax highlighting,
// the same line comments as the panel, and an Edit mode whose draft becomes an
// "apply this edit" request to the AI — nothing is written to disk from the web.
// Loaded on demand (React.lazy) so the board does not pay for the editor.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, GutterMarker, drawSelection, gutter, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Board, Item } from '../../../src/model'
import { anchoredOn, quoteOf, relocate, type Anchor, type TextSource } from '../inspector/anchor'
import { MODELS, type DiscussModel } from '../inspector/detail'
import { firstChange, sha1, unifiedDiff, type DiscussArg } from '../inspector/diff'
import { useModelChoice } from '../inspector/useModel'
import { Composer, Thread } from './TextView'
import '../source-dialog.css'

export interface SourceDialogProps {
  board: Board
  text: string
  src: TextSource
  label: string
  targetFor: (line: number) => string | undefined
  onAnchoredComment: (target: string, text: string, anchor: Anchor, discuss?: DiscussArg) => void
  onReply: (rootId: string, text: string) => void
  onClose: () => void
  /** put the cursor on this line when opening */
  focusLine?: number
}

/** The language for a path, else the file's `#!` line (the prompt is markdown). Each parser is its own chunk. */
async function languageFor(src: TextSource, text: string): Promise<Extension> {
  const ext = 'file' in src ? (src.file.split('.').pop()?.toLowerCase() ?? '') : 'md'
  const shebang = text.startsWith('#!') ? text.slice(0, text.indexOf('\n') >>> 0) : ''
  const shellMode = async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell)
  if (ext === 'yaml' || ext === 'yml') return (await import('@codemirror/lang-yaml')).yaml()
  if (ext === 'md' || ext === 'markdown') return (await import('@codemirror/lang-markdown')).markdown()
  if (ext === 'py' || /\bpython/.test(shebang)) return (await import('@codemirror/lang-python')).python()
  if (ext === 'json') return (await import('@codemirror/lang-json')).json()
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'tsx'].includes(ext) || /\bnode\b/.test(shebang))
    return (await import('@codemirror/lang-javascript')).javascript({ typescript: ext.includes('ts'), jsx: ext.endsWith('x') })
  if (['sh', 'bash', 'zsh'].includes(ext) || /\b(ba|z)?sh\b/.test(shebang)) return shellMode()
  return []
}

// Colours are CSS variables (source-dialog.css), so light/dark follow the app theme.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--hl-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.propertyName, t.definition(t.propertyName), t.attributeName], color: 'var(--hl-property)' },
  { tag: [t.variableName, t.special(t.variableName)], color: 'var(--hl-variable)' },
  { tag: [t.function(t.variableName), t.definition(t.function(t.variableName))], color: 'var(--hl-function)' },
  { tag: [t.meta, t.processingInstruction, t.typeName, t.className], color: 'var(--hl-meta)' },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: 'var(--ink)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--hl-property)', textDecoration: 'underline' },
  { tag: [t.monospace], color: 'var(--hl-string)' },
  { tag: [t.punctuation, t.separator, t.bracket], color: 'var(--ink-2)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--paper)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--chrome)', color: 'var(--ink-3)', borderRight: '1px solid var(--rule)' },
  '.cm-lineNumbers .cm-gutterElement': { cursor: 'pointer', padding: '0 8px 0 10px' },
  '.cm-activeLine': { backgroundColor: 'var(--sd-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--sd-active)', color: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--sd-selection) !important' },
  '.cm-searchMatch': { backgroundColor: 'var(--sd-match)', outline: '1px solid var(--rule-2)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--sd-match)' },
  '.cm-panels': { backgroundColor: 'var(--chrome)', color: 'var(--ink)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--rule)' },
  '.cm-textfield': { backgroundColor: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--rule)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--chrome-2)', color: 'var(--ink)', border: '1px solid var(--rule)' },
})

class CommentDot extends GutterMarker {
  toDOM() {
    const s = document.createElement('span')
    s.className = 'sd-dot'
    s.setAttribute('aria-hidden', 'true')
    s.textContent = '●'
    return s
  }
}
const dot = new CommentDot()

/** A gutter with a dot on every line a comment covers. */
function commentGutter(lines: Set<number>): Extension {
  return gutter({
    class: 'sd-cgutter',
    lineMarker: (view, block) => (lines.has(view.state.doc.lineAt(block.from).number) ? dot : null),
    initialSpacer: () => dot,
  })
}

/** Clicking a line number selects that line; shift-click extends from the selection's anchor. */
const lineSelect = lineNumbers({
  domEventHandlers: {
    mousedown(view, block, event) {
      const doc = view.state.doc
      const line = doc.lineAt(block.from)
      const anchorPos = (event as MouseEvent).shiftKey ? view.state.selection.main.anchor : line.from
      const anchorLine = doc.lineAt(anchorPos)
      const down = anchorLine.from <= line.from
      view.dispatch({ selection: { anchor: down ? anchorLine.from : anchorLine.to, head: down ? line.to : line.from } })
      view.focus()
      return true
    },
  },
})

type Lines = { from: number; to: number }
function selectedLines(state: EditorState): Lines {
  const { from, to } = state.selection.main
  const a = state.doc.lineAt(from).number
  let b = state.doc.lineAt(to).number
  if (b > a && state.doc.lineAt(to).from === to) b-- // a selection ending at a line start ends on the line before
  return { from: a, to: b }
}

interface Draft {
  baseText: string
  text: string
}
const draftKey = (board: Board, src: TextSource) => `awd.sourceDraft:${board.id}:${'file' in src ? src.file : `prompt:${src.block}`}`
function loadDraft(key: string): Draft | undefined {
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null
    return d && typeof d.text === 'string' && typeof d.baseText === 'string' ? d : undefined
  } catch {
    return undefined
  }
}
function saveDraft(key: string, d: Draft | undefined) {
  try {
    if (d) localStorage.setItem(key, JSON.stringify(d))
    else localStorage.removeItem(key)
  } catch {
    /* private window: the draft lives only while the dialog is open */
  }
}

export default function SourceDialog({ board, text, src, label, targetFor, onAnchoredComment, onReply, onClose, focusLine }: SourceDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const opener = useRef<Element | null>(null)
  const readOnly = useRef(new Compartment())
  const dots = useRef(new Compartment())
  const language = useRef(new Compartment())
  const key = draftKey(board, src)
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(false)
  const [draft, setDraft] = useState<Draft | undefined>(() => loadDraft(key))
  const [sel, setSel] = useState<Lines>({ from: focusLine ?? 1, to: focusLine ?? 1 })
  const [composing, setComposing] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const title = `${label}${'file' in src ? '' : ' (prompt)'}`

  // Open as a modal (the page behind is inert: focus stays inside); give focus back on close.
  useEffect(() => {
    opener.current = document.activeElement
    dialog.current?.showModal()
    return () => {
      const el = opener.current as HTMLElement | null
      el?.focus?.()
    }
  }, [])

  // The editor: created once; mode, doc and comment dots change through transactions.
  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineSelect,
          dots.current.of(commentGutter(new Set())),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          language.current.of([]),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          readOnly.current.of(EditorState.readOnly.of(true)),
          EditorView.contentAttributes.of({ 'aria-label': `${title} source` }),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) setSel(selectedLines(u.state))
            if (u.docChanged && editingRef.current) {
              const now = u.state.doc.toString()
              setDraft((d) => {
                const baseText = d?.baseText ?? text
                const next = now === baseText ? undefined : { baseText, text: now }
                saveDraft(key, next)
                return next
              })
            }
          }),
        ],
      }),
    })
    view.current = v
    if (focusLine && focusLine <= v.state.doc.lines) {
      const line = v.state.doc.line(focusLine)
      v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    }
    v.focus()
    let alive = true
    void languageFor(src, text).then((lang) => alive && v.dispatch({ effects: language.current.reconfigure(lang) }))
    return () => {
      alive = false
      v.destroy()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = editing ? (draft?.text ?? text) : text
  const shownLines = useMemo(() => shown.split('\n'), [shown])

  // Comments on this text, placed where their quote is now (in the draft while editing).
  const { placed, outdated, marked } = useMemo(() => {
    const placed: Array<{ item: Item; line: number; endLine: number }> = []
    const outdated: Array<{ item: Item; anchor: Anchor }> = []
    const marked = new Set<number>()
    for (const c of anchoredOn(board, src)) {
      const where = relocate(shownLines, c.anchor)
      if (!where) outdated.push(c)
      else {
        placed.push({ item: c.item, ...where })
        for (let n = where.line; n <= where.endLine; n++) marked.add(n)
      }
    }
    placed.sort((a, b) => a.line - b.line)
    return { placed, outdated, marked }
  }, [board, src, shownLines])

  useEffect(() => {
    view.current?.dispatch({ effects: dots.current.reconfigure(commentGutter(marked)) })
  }, [marked])

  const setMode = (edit: boolean) => {
    const v = view.current
    if (!v) return
    editingRef.current = false // the doc swap below is not the person's edit
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: edit ? (draft?.text ?? text) : text },
      effects: readOnly.current.reconfigure(edit ? [] : EditorState.readOnly.of(true)),
    })
    editingRef.current = edit
    setEditing(edit)
    setComposing(false)
    setSent(null)
    v.focus()
  }

  const jump = (line: number, endLine = line) => {
    const v = view.current
    if (!v) return
    const a = v.state.doc.line(Math.min(line, v.state.doc.lines))
    const b = v.state.doc.line(Math.min(endLine, v.state.doc.lines))
    v.dispatch({ selection: { anchor: a.from, head: b.to }, effects: EditorView.scrollIntoView(a.from, { y: 'center' }) })
    v.focus()
  }

  const target = targetFor(sel.from)
  const selText = sel.from === sel.to ? `Line ${sel.from}` : `Lines ${sel.from}–${sel.to}`
  const comment = (body: string, model?: DiscussModel) => {
    if (!target) return
    const anchor: Anchor = { ...('file' in src ? { file: src.file } : { doc: src.doc }), line: sel.from, ...(sel.to !== sel.from ? { endLine: sel.to } : {}), quote: quoteOf(text, sel.from, sel.to) }
    onAnchoredComment(target, body, anchor, model ? { model } : undefined)
    setComposing(false)
    view.current?.focus()
  }

  const discard = () => {
    saveDraft(key, undefined)
    setDraft(undefined)
    const v = view.current
    if (v && editing) {
      editingRef.current = false
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
      editingRef.current = true
    }
  }

  const askToApply = async (note: string, model: DiscussModel) => {
    if (!draft) return
    const change = firstChange(draft.baseText, draft.text)
    if (!change) return
    const owner = targetFor(change.line)
    if (!owner) return
    const path = 'file' in src ? src.file : 'prompt'
    const edit = { ...('file' in src ? { file: src.file } : { doc: src.doc }), base: await sha1(draft.baseText), diff: unifiedDiff(draft.baseText, draft.text, path) }
    const anchor: Anchor = {
      ...('file' in src ? { file: src.file } : { doc: src.doc }),
      line: change.line,
      ...(change.endLine !== change.line ? { endLine: change.endLine } : {}),
      quote: quoteOf(draft.baseText, change.line, change.endLine),
    }
    onAnchoredComment(owner, note.trim() || `Please review and apply this edit to ${path}.`, anchor, { model, edit })
    saveDraft(key, undefined)
    setDraft(undefined)
    setMode(false)
    setSent(`Sent to the AI (${model}). It will review the edit with you in the thread, then apply it to the file.`)
  }

  return (
    <dialog
      ref={dialog}
      className="sd"
      aria-labelledby="sd-title"
      data-no-board-keys
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="sd-head">
        <h2 id="sd-title" className="mono">
          {title}
        </h2>
        <div className="sd-modes" role="group" aria-label="Mode">
          <button type="button" aria-pressed={!editing} onClick={() => editing && setMode(false)}>
            Read
          </button>
          <button type="button" aria-pressed={editing} onClick={() => !editing && setMode(true)}>
            Edit{draft ? ' •' : ''}
          </button>
        </div>
        <button type="button" className="ghost small" onClick={() => view.current && openSearchPanel(view.current)} title="Search (⌘F)">
          Search
        </button>
        <button type="button" className="ghost small" onClick={onClose} aria-label="Close source view">
          Close
        </button>
      </header>
      <div className="sd-body">
        <div ref={host} className="sd-editor" />
        <aside className="sd-side" aria-label={editing ? 'Your edit' : 'Comments'}>
          {editing ? (
            <EditSide draft={draft} text={text} path={'file' in src ? src.file : 'prompt'} canSend={Boolean(draft && targetFor(firstChange(draft.baseText, draft.text)?.line ?? 1))} onAsk={askToApply} onDiscard={discard} />
          ) : (
            <>
              {sent && (
                <p className="sd-sent" role="status">
                  {sent}
                </p>
              )}
              <div className="sd-selbar">
                <span>{selText}</span>
                <button type="button" className="small" disabled={!target} onClick={() => setComposing(true)}>
                  Comment…
                </button>
              </div>
              {composing && <Composer selText={selText} disabled={!target} onSend={comment} onCancel={() => setComposing(false)} />}
              {draft && (
                <p className="muted insp-hint">
                  You have an unsent edit.{' '}
                  <button type="button" className="link small" onClick={() => setMode(true)}>
                    Open it
                  </button>
                </p>
              )}
              <h3>
                Comments <span className="muted">({placed.length + outdated.length})</span>
              </h3>
              {placed.length === 0 && outdated.length === 0 && <p className="muted">No comments on this text yet. Select lines (click a line number, shift-click for more) to add one.</p>}
              {placed.map((c) => (
                <div key={c.item.id} className="sd-thread">
                  <button type="button" className="link mono sd-where" onClick={() => jump(c.line, c.endLine)}>
                    {c.line === c.endLine ? `L${c.line}` : `L${c.line}–${c.endLine}`}
                  </button>
                  <Thread board={board} root={c.item} onReply={onReply} />
                </div>
              ))}
              {outdated.length > 0 && (
                <section className="tv-outdated" aria-label="Outdated comments">
                  <h4>Outdated — the text they were about changed</h4>
                  {outdated.map(({ item, anchor }) => (
                    <div key={item.id}>
                      <pre className="tv-quote mono">{anchor.quote}</pre>
                      <Thread board={board} root={item} onReply={onReply} />
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </aside>
      </div>
    </dialog>
  )
}

function EditSide({ draft, text, path, canSend, onAsk, onDiscard }: { draft?: Draft; text: string; path: string; canSend: boolean; onAsk: (note: string, model: DiscussModel) => void; onDiscard: () => void }) {
  const [note, setNote] = useState('')
  const [model, pickModel] = useModelChoice()
  const diff = draft ? unifiedDiff(draft.baseText, draft.text, path) : ''
  const stale = draft && draft.baseText !== text
  const counts = diff.split('\n').reduce((n, l) => ({ add: n.add + (l.startsWith('+') && !l.startsWith('+++') ? 1 : 0), del: n.del + (l.startsWith('-') && !l.startsWith('---') ? 1 : 0) }), { add: 0, del: 0 })
  return (
    <div className="sd-edit">
      <p className="muted insp-hint">Edits stay in this browser until you send them. The AI reviews the change with you, then applies it to the file — nothing is saved from here.</p>
      {stale && <p className="sd-warn">The file changed on the board since you started this edit. The AI will see the diff against the text you edited.</p>}
      {!draft ? (
        <p className="muted">No changes yet — type in the editor.</p>
      ) : (
        <>
          <h3>
            Your change <span className="muted">+{counts.add} −{counts.del}</span>
          </h3>
          <pre className="sd-diff mono" aria-label="Diff of your change">
            {diff
              .split('\n')
              .slice(2)
              .map((l, i) => (
                <span key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>
                  {l || ' '}
                  {'\n'}
                </span>
              ))}
          </pre>
        </>
      )}
      <form
        className="sd-ask"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSend) onAsk(note, model)
        }}
      >
        <label>
          <span>Note for the AI (optional)</span>
          <textarea
            rows={3}
            value={note}
            placeholder="Why this change, or what to watch out for"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) {
                e.preventDefault()
                onAsk(note, model)
              }
            }}
          />
        </label>
        <div className="insp-send">
          <button type="button" className="ghost small" disabled={!draft} onClick={onDiscard}>
            Discard
          </button>
          <label className="insp-model">
            <span>Model</span>
            <select value={model} onChange={(e) => pickModel(e.target.value as DiscussModel)}>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary small" disabled={!canSend}>
            Ask AI to apply
          </button>
        </div>
        <p className="muted insp-hint">⌘ Enter sends.</p>
      </form>
    </div>
  )
}
