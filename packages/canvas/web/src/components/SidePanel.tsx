import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Author, Board, Change, Item, Op } from '../../../src/model'
import { isContainer } from '../flow/boardToFlow'
import { detailOf, type DiscussModel } from '../inspector/detail'
import { Links } from './Links'
import { WireProposal } from './WireProposal'
import { isFlowWire, type Pending } from '../inspector/pending'
import { BlockInspector } from './BlockInspector'
import { FilesView, type FileNav } from './FilesView'
import { SelectionChat } from './SelectionChat'
import { AllChats, chatsNeedingYou } from './AllChats'
import { filesOf, type Anchor } from '../inspector/anchor'
import { useFreshMeta } from '../inspector/useFreshMeta'
import { timeAgo } from '../time'
import type { DiscussArg } from '../inspector/diff'
import { DiagramElementPanel, DiagramFramePanel } from './DiagramInspector'
import { UiMockPanel } from './UiMockPanel'
import { isUiElement } from '../diagrams/uiProposal'
import type { EditRequest } from '../inspector/diff'
import { diagramData, diagramOf } from '../diagrams/frame'
import { Linkified } from '../flow/Linkified'
import { PanelNavContext, type PanelNav } from '../inspector/panelNav'
import { BoardContextPanel } from './BoardAgents'
import { BoardHandover } from './Handover'
import { handoverStamp } from '../inspector/handover'
import { MentionText, MentionTextarea } from './Mention'
import { itemLink } from '../itemLink'
import { copyText } from '../clipboard'
import { isAnnotationDraft, calloutOf, todoOf } from '../../../src/annotations'
import { BoardTodos } from './TodoList'
import { ItemMarks, type ItemMarksActions } from './ItemMarks'

interface Props {
  board: Board
  changes: Change[]
  selectedId: string | null
  /** the whole selection (the Chat tab is about all of it) */
  selectedIds: string[]
  /** "open this block's source" from the canvas: shows the Inspector, which opens the large view */
  sourceRequest?: { id: string; mode: 'view' | 'edit'; n: number } | null
  onComment: (targetId: string, text: string) => void
  /** chat with the selection: a comment marked `data.discuss = { model, about }` (docs/studio.md §2b) */
  onChat: (ids: string[], text: string, model: DiscussModel) => void
  /** a follow-up in a chat: a plain comment on its root */
  onReply: (rootId: string, text: string) => void
  /** a comment on lines of a file or prompt (docs/studio.md §5); `discuss` also asks the AI */
  onAnchoredComment: (target: string, text: string, anchor: Anchor, discuss?: DiscussArg) => void
  /** save the selected item's text (an arrow's label) */
  onEditText: (id: string, text: string) => void
  onSelect: (id: string | null) => void
  onMoveToContainer: (id: string, containerId: string | null) => void
  /** fit the view to these items (used by "locate" on agent batches) */
  onLocate: (ids: string[]) => void
  onToast: (text: string) => void
  /** a flow wire's proposal → a chat request carrying it (docs/studio.md §7) */
  onWireChat: (ids: string[], text: string, model: DiscussModel, proposal: Pending) => void
  onUndoWire: (id: string) => void
  /** a UI mock text proposal → a chat request carrying the diff to the file (docs/diagrams.md §6c) */
  onEditChat: (ids: string[], text: string, model: DiscussModel, edit: EditRequest) => void
  onUndoUiText: (id: string) => void
  /** a UI mock change made in the panel (a proposed new element); `select` = the item to select after */
  onUiOps?: (ops: Op[], label: string, select?: string) => void
  onPickWireEvent: (id: string, event: string) => void
  /** drop a proposed (pending) item, e.g. a story the agent proposed (docs/diagrams.md §4) */
  onDismiss: (id: string) => void
  /** the board items a link under the pointer (or keyboard focus) points at; [] when none */
  onHoverItems?: (ids: string[]) => void
  /** show items on the board (move there, flash) without selecting them — a click on a Connected / Wiring link */
  onReveal?: (ids: string[]) => void
  /** annotations and TODOs (docs/canvas.md → "Notes"): write one on an item (a TODO also about the whole board: null) */
  onAnnotate: (itemId: string, text: string) => void
  onAddTodo: (itemId: string | null, text: string, ask?: string) => void
  onCheckTodo: (id: string, answer?: string) => void
  onReopenTodo: (id: string) => void
  /** go to an annotation's, a draft's or a TODO's card on the board */
  onShowMark: (cardId: string) => void
}

/** The ids a panel link points at: any element marked \`data-item-link="<id> <id>…"\` (one handler for every list). */
function linkIds(target: EventTarget | null): string[] {
  const el = target instanceof Element ? target.closest<HTMLElement>('[data-item-link]') : null
  return el?.dataset.itemLink?.split(' ').filter(Boolean) ?? []
}

/** Shown by the Event section already, or drawing detail: not repeated as raw data rows. */
const WIRE_KEYS = new Set(['event', 'pending', 'fromSide', 'toSide', 'bend'])
/** Shown by the diagram panels (frame spec, proposal, traces): not repeated as raw data rows. */
const DIAGRAM_KEYS = new Set(['diagram', 'pending', 'trace', 'traces', 'icon', 'ui', 'element'])

const who = (a: Author) => (a === 'agent' ? 'Agent' : 'You')

function describeOp(op: Op, board: Board, change: Change): string {
  const name = (id: string) => {
    const it = board.items[id] ?? change.before[id]
    const t = it?.text?.trim()
    return t ? `'${t.length > 40 ? `${t.slice(0, 40)}…` : t}'` : `${it?.type ?? 'item'} ${id.slice(0, 8)}`
  }
  if (op.kind === 'add') return `added ${op.item.type}${op.item.role ? ` (${op.item.role})` : ''} ${name(op.item.id)}`
  if (op.kind === 'remove') return `removed ${name(op.id)}`
  const keys = Object.keys(op.patch)
  const moved = keys.includes('x') || keys.includes('y')
  const rest = keys.filter((k) => !['x', 'y', 'updatedBy', 'updatedAt'].includes(k))
  const parts = []
  if (moved) parts.push('moved')
  if (rest.length) parts.push(`changed ${rest.join(', ')}`)
  return `${parts.join(' and ') || 'touched'} ${name(op.id)}`
}

const idsOf = (c: Change) => [...new Set(c.ops.map((o) => (o.kind === 'add' ? o.item.id : o.id)))]

type Filter = 'all' | 'agent' | 'user'

export function SidePanel({ board: liveBoard, changes, selectedId, selectedIds, sourceRequest, onComment, onChat, onReply, onAnchoredComment, onEditText, onSelect, onMoveToContainer, onLocate, onToast, onWireChat, onUndoWire, onEditChat, onUndoUiText, onUiOps, onPickWireEvent, onDismiss, onHoverItems, onReveal, onAnnotate, onAddTodo, onCheckTodo, onReopenTodo, onShowMark }: Props) {
  const [tab, setTab] = useState<'feed' | 'item' | 'chat' | 'chats' | 'files'>('feed')
  const [nav, setNav] = useState<FileNav>({})
  // Items come live over the websocket; meta (the files snapshot) is re-read — see useFreshMeta. A handover's steps
  // arrive over the websocket and change the holders, so each one re-reads it too.
  const board = useFreshMeta(liveBoard, changes, `${tab}|${handoverStamp(liveBoard.meta)}`)
  const hasFiles = Object.keys(filesOf(board)).length > 0
  const [filter, setFilter] = useState<Filter>('all')
  const [draft, setDraft] = useState('')
  const selected = selectedId ? board.items[selectedId] : undefined
  // The Chat tab is always there: with nothing selected it is about the whole board.
  // A tab whose subject went away falls back: Selected → Chat; Files without files → Changes.
  const activeTab = tab === 'item' && !selected ? 'chat' : tab === 'files' && !hasFiles ? 'feed' : tab
  const detail = detailOf(selected)
  // Picking a workflow block means "tell me about it": open the Inspector. Picking a wire means
  // "what does this join?": open Selected, which lists both ends.
  const isBlock = Boolean(detail)
  const isWire = selected?.type === 'arrow'
  // a diagram frame (or an element in an EventStorming / story-map / domain-story frame) opens Selected too
  const selectedDiagram = diagramFrameOf(selected)
  const inFrame = selected && selected.type !== 'comment' ? diagramOf(board, selected) : undefined
  // only inside a diagram frame: legacy diagram boards keep their old tab behaviour
  const inDiagram = Boolean(inFrame?.frame && ['event-storming', 'user-story-map', 'domain-story', 'ui-mock'].includes(inFrame.kind))
  useEffect(() => {
    if (isBlock || isWire || selectedDiagram || inDiagram) setTab('item')
  }, [selectedId, isBlock, isWire, Boolean(selectedDiagram), inDiagram])
  useEffect(() => {
    if (sourceRequest) setTab('item')
  }, [sourceRequest?.n])

  // the conversations about it: its annotations and TODOs are listed in their own section
  const comments = selected
    ? Object.values(board.items)
        .filter((i) => i.type === 'comment' && i.target === selected.id && calloutOf(i) === undefined && !isAnnotationDraft(i) && !todoOf(i))
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    : []
  const todoActions = useMemo(() => ({ onShow: onShowMark, onCheck: onCheckTodo, onReopen: onReopenTodo }), [onShowMark, onCheckTodo, onReopenTodo])
  // an item (not a comment or a wire) carries annotations and TODOs: listed in its panel, with the two ways to add one
  const markable = selected && selected.type !== 'comment' && selected.type !== 'arrow' ? selected : undefined
  const marksActions: ItemMarksActions | undefined = markable
    ? { ...todoActions, onAnnotate: (text) => onAnnotate(markable.id, text), onAddTodo: (text, ask) => onAddTodo(markable.id, text, ask) }
    : undefined
  const marksPanel = markable && marksActions ? <ItemMarks key={markable.id} board={liveBoard} item={markable} actions={marksActions} /> : undefined

  const visible = changes.filter((c) => filter === 'all' || c.author === filter)
  const needYou = useMemo(() => chatsNeedingYou(board), [board])

  // Connected / Wiring links: a click shows the item on the board, › opens it (inspector/panelNav.tsx)
  const panelNav = useMemo<PanelNav | null>(() => (onReveal ? { reveal: onReveal, open: (id) => onSelect(id) } : null), [onReveal, onSelect])

  return (
    <PanelNavContext.Provider value={panelNav}>
    <aside
      id="board-panel"
      className="panel"
      aria-label="Board panel"
      onPointerOver={(e) => onHoverItems?.(linkIds(e.target))}
      onPointerLeave={() => onHoverItems?.([])}
      onFocus={(e) => onHoverItems?.(linkIds(e.target))}
      onBlur={() => onHoverItems?.([])}
    >
      <BoardContextPanel board={board} onToast={onToast} />
      <BoardHandover board={board} onLocate={onLocate} onToast={onToast} />
      <BoardTodos board={liveBoard} actions={todoActions} onAdd={(text, ask) => onAddTodo(null, text, ask)} />
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={activeTab === 'feed'} onClick={() => setTab('feed')}>
          Changes
        </button>
        <button role="tab" aria-selected={activeTab === 'item'} onClick={() => setTab('item')} disabled={!selected}>
          {selected ? (detail ? 'Inspector' : 'Selected') : selectedIds.length > 1 ? `${selectedIds.length} selected` : 'Select an item'}
        </button>
        <button role="tab" aria-selected={activeTab === 'chat'} onClick={() => setTab('chat')} title={selectedIds.length ? 'Chat about the selection' : 'Chat about this board'}>
          Chat
        </button>
        <button role="tab" aria-selected={activeTab === 'chats'} onClick={() => setTab('chats')} title="Every chat on this board">
          Chats{needYou ? <span className="tab-badge" aria-label={`${needYou} unread`}>{needYou}</span> : null}
        </button>
        {hasFiles && (
          <button role="tab" aria-selected={activeTab === 'files'} onClick={() => setTab('files')}>
            Files
          </button>
        )}
      </div>
      <div className="panel-body">
        {activeTab === 'item' && selectedIds.length ? (
          // a link in the panel moves the view away while the selection stays here: this brings the view back (also 2)
          <div className="panel-locate">
            <button type="button" className="link" data-item-link={selectedIds.join(' ')} onClick={() => onLocate(selectedIds)} title="Bring the view to the selection (2); ⌥← goes back to where the view was">
              ⌖ show on the board
            </button>
          </div>
        ) : null}
        {activeTab === 'chats' ? (
          <AllChats board={board} onLocate={onLocate} onReply={onReply} />
        ) : activeTab === 'feed' ? (
          <>
            <div className="filter" role="group" aria-label="Show changes by">
              {(['all', 'agent', 'user'] as Filter[]).map((f) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f === 'agent' ? 'Agent' : 'You'}
                </button>
              ))}
            </div>
            {visible.length === 0 ? (
              <p className="muted">{changes.length === 0 ? 'Nothing has changed yet. Move something, or wait for the agent.' : 'No changes from this side yet.'}</p>
            ) : (
              <ul className="feed">
                {visible.map((c) => {
                  const ids = idsOf(c).filter((i) => board.items[i])
                  return (
                    <li key={c.seq} className={c.author}>
                      <div className="row">
                        <span className="who">{c.by ?? who(c.author)}</span>
                        <span className="mono">{c.seq}</span>
                        <span style={{ marginLeft: 'auto' }}>{timeAgo(c.ts)}</span>
                      </div>
                      {c.note === 'handoff' ? (
                        <div className="note">Handed to the agent</div>
                      ) : c.author === 'agent' && ids.length ? (
                        <div className="note">
                          Agent changed {ids.length} item{ids.length === 1 ? '' : 's'}
                          {c.note ? `: ${c.note}` : ''}{' '}
                          <button type="button" className="link" data-item-link={ids.join(' ')} onClick={() => onLocate(ids)}>
                            locate
                          </button>
                        </div>
                      ) : (
                        c.note && <div className="note">{c.note}</div>
                      )}
                      {c.ops.length > 0 && (
                        <details>
                          <summary>
                            {c.ops.length} change{c.ops.length === 1 ? '' : 's'}
                          </summary>
                          <ul className="ops">
                            {c.ops.map((op, i) => {
                              const id = op.kind === 'add' ? op.item.id : op.id
                              const exists = Boolean(board.items[id])
                              return (
                                <li key={i}>
                                  <button
                                    type="button"
                                    disabled={!exists}
                                    data-item-link={exists ? id : undefined}
                                    onClick={() => {
                                      onSelect(id)
                                      setTab('item')
                                    }}
                                  >
                                    {describeOp(op, board, c)}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </details>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : activeTab === 'files' ? (
          <FilesView board={board} nav={nav} onNav={setNav} onAnchoredComment={onAnchoredComment} onReply={onReply} />
        ) : activeTab === 'chat' ? (
          <SelectionChat board={board} selectedIds={selectedIds} onChat={onChat} onReply={onReply} onSelect={(id) => onSelect(id)} onLocate={onLocate} />
        ) : selected && detail ? (
          <BlockInspector
            key={selected.id}
            board={board}
            item={selected}
            detail={detail}
            onSelect={(id) => onSelect(id)}
            onOpenChat={() => setTab('chat')}
            onToast={onToast}
            onOpenFile={(path, at) => {
              setNav({ path, line: at?.line, range: at?.range })
              setTab('files')
            }}
            onAnchoredComment={onAnchoredComment}
            onReply={onReply}
            sourceRequest={sourceRequest?.id === selected.id ? sourceRequest : undefined}
            marks={marksPanel}
          />
        ) : selected ? (
          <ItemDetail
            board={board}
            item={selected}
            comments={comments}
            draft={draft}
            setDraft={setDraft}
            onMoveToContainer={onMoveToContainer}
            onToast={onToast}
            onEditText={onEditText}
            onSelect={onSelect}
            marksPanel={marksPanel}
            diagramPanel={
              selectedDiagram ? (
                <DiagramFramePanel
                  board={board}
                  diagram={selectedDiagram}
                  onSelect={(id) => onSelect(id)}
                  onOpenFile={(path) => {
                    setNav({ path })
                    setTab('files')
                  }}
                />
              ) : isUiElement(selected) ? (
                <>
                  <UiMockPanel
                    board={board}
                    item={selected}
                    onEditChat={onEditChat}
                    onUndo={onUndoUiText}
                    onOps={onUiOps}
                    onOpenFile={(path) => {
                      setNav({ path })
                      setTab('files')
                    }}
                  />
                  {/* its trace links; the text proposal is shown above */}
                  <DiagramElementPanel board={board} item={{ ...selected, data: { ...selected.data, pending: undefined } }} onSelect={(id) => onSelect(id)} onProposalChat={onWireChat} onDismiss={onDismiss} />
                </>
              ) : (
                <DiagramElementPanel board={board} item={selected} onSelect={(id) => onSelect(id)} onProposalChat={onWireChat} onDismiss={onDismiss} onUndo={onUndoWire} />
              )
            }
            wirePanel={
              isFlowWire(board, selected) ? (
                <WireProposal
                  board={board}
                  item={selected}
                  onSelect={(id) => onSelect(id)}
                  onOpenFile={(path, line) => {
                    setNav({ path, line })
                    setTab('files')
                  }}
                  onWireChat={onWireChat}
                  onUndo={onUndoWire}
                  onPickEvent={onPickWireEvent}
                />
              ) : undefined
            }
            onSubmit={() => {
              const t = draft.trim()
              if (!t) return
              onComment(selected.id, t)
              setDraft('')
            }}
          />
        ) : null}
      </div>
    </aside>
    </PanelNavContext.Provider>
  )
}

function ItemDetail({
  board,
  item,
  comments,
  draft,
  setDraft,
  onSubmit,
  onMoveToContainer,
  onToast,
  onEditText,
  onSelect,
  wirePanel,
  diagramPanel,
  marksPanel,
}: {
  board: Board
  item: Item
  comments: Item[]
  onSelect: (id: string) => void
  /** its annotations and TODOs (components/ItemMarks.tsx) */
  marksPanel?: ReactNode
  /** the Event / proposal section of a workflow flow wire */
  wirePanel?: ReactNode
  /** a diagram frame, or an element inside one (docs/diagrams.md) */
  diagramPanel?: ReactNode
  draft: string
  setDraft: (s: string) => void
  onSubmit: () => void
  onMoveToContainer: (id: string, containerId: string | null) => void
  onToast: (text: string) => void
  onEditText: (id: string, text: string) => void
}) {
  const data = item.data ?? {}
  const containers = Object.values(board.items).filter((i) => isContainer(i) && i.id !== item.id)
  const canMove = !isContainer(item) && item.type !== 'arrow' && item.type !== 'ui' && containers.length > 0
  const copyLink = () => {
    // a diagram frame opens by its stable key (?frame=), anything else by its item id (?focus=) — the item menu's too
    const url = itemLink(board, item, location.origin)
    void copyText(url).then((ok) => onToast(ok ? 'Link copied' : `Copy this link: ${url}`))
  }
  return (
    <div>
      <div className="selected-head">
        <TextField key={item.id} label={item.type === 'arrow' ? 'Arrow label' : 'Text'} value={(item.type === 'arrow' ? (item.label ?? item.text) : item.text) ?? ''} onSave={(t) => onEditText(item.id, t)} />
        <button type="button" className="ghost small" onClick={copyLink}>
          Copy link
        </button>
      </div>
      {diagramPanel}
      {wirePanel ?? <Links board={board} item={item} onSelect={onSelect} />}
      <dl className="kv">
        <dt>Type</dt>
        <dd>
          {item.type}
          {item.role ? `, ${item.role.replace(/-/g, ' ')}` : ''}
        </dd>
        {item.color && (
          <>
            <dt>Colour</dt>
            <dd>{item.color.replace(/-/g, ' ')}</dd>
          </>
        )}
        {item.type !== 'arrow' && (
          <>
            <dt>Position</dt>
            <dd className="mono">
              {Math.round(item.x)}, {Math.round(item.y)} ({Math.round(item.w)} by {Math.round(item.h)})
            </dd>
          </>
        )}
        <dt>Changed</dt>
        <dd>
          {who(item.updatedBy)}, {timeAgo(item.updatedAt)}
          {item.updatedBy !== item.createdBy ? ` (added by ${who(item.createdBy).toLowerCase()})` : ''}
        </dd>
        <dt>Id</dt>
        <dd className="mono">{item.id}</dd>
        {Object.entries(data).filter(([k]) => !(wirePanel && WIRE_KEYS.has(k)) && !(diagramPanel && DIAGRAM_KEYS.has(k))).map(([k, v]) => (
          <DataRow key={k} k={k} v={v} />
        ))}
      </dl>

      {canMove && (
        <div className="field">
          <label htmlFor="move-to">Move to lane or frame</label>
          <select id="move-to" value={item.parent ?? ''} onChange={(e) => onMoveToContainer(item.id, e.target.value || null)}>
            <option value="">None (loose on the board)</option>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.text || c.type}
              </option>
            ))}
          </select>
        </div>
      )}

      {marksPanel}

      <h3>Comments</h3>
      {comments.length === 0 ? (
        <p className="muted">No comments on this item.</p>
      ) : (
        <ul className="thread">
          {comments.map((c) => (
            <li key={c.id} className={c.createdBy}>
              <div className="who">
                {who(c.createdBy)}, {timeAgo(c.updatedAt)}
              </div>
              <div>
                <MentionText text={c.text ?? ''} mention={typeof c.data?.mention === 'string' ? c.data.mention : undefined} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <label htmlFor="comment-draft">Add a comment for the agent</label>
        <MentionTextarea
          boardId={board.id}
          id="comment-draft"
          value={draft}
          placeholder="What should change here? (@ to ask one agent)"
          onValue={setDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
          }}
        />
        <div className="actions">
          <span className="muted">⌘ Enter to send</span>
          <button className="primary" type="submit" disabled={!draft.trim()}>
            Add comment
          </button>
        </div>
      </form>
    </div>
  )
}

/** The selected item's text, editable in place: blur or ⌘Enter saves, Escape reverts. */
function TextField({ label, value, onSave }: { label: string; value: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const save = () => {
    if (draft !== value) onSave(draft)
  }
  return (
    <textarea
      className="selected-title"
      aria-label={label}
      value={draft}
      placeholder="No text"
      rows={Math.min(6, Math.max(1, draft.split('\n').length))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setDraft(value)
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          save()
        }
      }}
    />
  )
}

function DataRow({ k, v }: { k: string; v: unknown }) {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return (
    <>
      <dt>{k}</dt>
      <dd className={typeof v === 'string' ? '' : 'mono'}>{typeof v === 'string' ? <Linkified text={s} /> : s}</dd>
    </>
  )
}

/** The selected item as a diagram frame, when it is one. */
function diagramFrameOf(it: Item | undefined) {
  const d = diagramData(it)
  return d && it ? { ...d, frame: it } : undefined
}
