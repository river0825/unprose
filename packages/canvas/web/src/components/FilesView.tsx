// The files behind the workflow (docs/studio.md §5): a list, and the chosen file
// with line numbers to comment on. A snapshot from the last redraw — the repo's
// files stay the truth; the agent edits them, the board redraws.
import type { Board } from '../../../src/model'
import { anchoredOn, filesOf, ownerOf, truncatedOf, type Anchor } from '../inspector/anchor'
import { TextView } from './TextView'
import '../inspector.css'
import type { DiscussArg } from '../inspector/diff'

export interface FileNav {
  path?: string
  line?: number
  range?: { start: number; end: number }
}

interface Props {
  board: Board
  nav: FileNav
  onNav: (nav: FileNav) => void
  onAnchoredComment: (target: string, text: string, anchor: Anchor, discuss?: DiscussArg) => void
  onReply: (rootId: string, text: string) => void
}

export function FilesView({ board, nav, onNav, onAnchoredComment, onReply }: Props) {
  const files = filesOf(board)
  const paths = Object.keys(files).sort(byWorkflowFirst(board))
  const truncated = new Set(truncatedOf(board))
  const path = nav.path && files[nav.path] !== undefined ? nav.path : paths[0]
  if (!path) return <p className="muted">No files on this board yet. Redraw it with awd graph --canvas.</p>
  const text = files[path]

  return (
    <div className="files">
      <label className="files-pick">
        <span>File</span>
        <select value={path} onChange={(e) => onNav({ path: e.target.value })}>
          {paths.map((p) => {
            const n = anchoredOn(board, { file: p }).length
            return (
              <option key={p} value={p}>
                {p}
                {n ? ` · ${n} comment${n === 1 ? '' : 's'}` : ''}
              </option>
            )
          })}
        </select>
      </label>
      {nav.range && nav.path === path && (
        <p className="files-range muted">
          Lines {nav.range.start}–{nav.range.end}{' '}
          <button type="button" className="link small" onClick={() => onNav({ path, line: nav.line })}>
            show the whole file
          </button>
        </p>
      )}
      {truncated.has(path) && <p className="muted insp-hint">This file is cut at 100 000 characters on the board.</p>}
      <TextView
        key={path}
        board={board}
        text={text}
        src={{ file: path }}
        label={path}
        range={nav.path === path ? nav.range : undefined}
        focusLine={nav.path === path ? nav.line : undefined}
        targetFor={(line) => ownerOf(board, path, line)}
        onAnchoredComment={onAnchoredComment}
        onReply={onReply}
      />
    </div>
  )
}

/** The workflow file first, then the rest by path. */
function byWorkflowFirst(board: Board) {
  const wf = (board.meta?.workflow as { file?: string } | undefined)?.file ?? ''
  const isWf = (p: string) => (wf && wf.endsWith(p) ? 0 : /workflow\.ya?ml$/.test(p) ? 0 : 1)
  return (a: string, b: string) => isWf(a) - isWf(b) || a.localeCompare(b)
}
