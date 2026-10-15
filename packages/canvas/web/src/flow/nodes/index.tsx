import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { useRef, useState, type ReactNode } from 'react'
import { ownLock, type ColorToken, type Item } from '../../../../src/model'
import { hiddenCountOf } from '../../../../src/hidden'
import type { ItemNode } from '../boardToFlow'
import { annotationOf, calloutOf, isAnnotationDraft, todoOf, type TodoMark } from '../../../../src/annotations'
import { CommentBadge, ThreadBody, ThreadReplies } from '../CommentThread'
import { EditableText } from '../EditableText'
import { useEdit } from '../EditContext'
import { PlayStoryButton } from '../../components/ReplayBar'
import { PlayMockButton } from '../../components/PlayBar'
import { ClickableButton } from '../../components/Clickable'
import { CheckOffField } from '../../components/CheckOff'
import { SCALES_FONT, fontOf } from '../font'
import { draftStatus } from '../annotationsView'
import { todoBy } from '../todoView'
import { DsIconNode } from './DsIconNode'
import { UiNode } from './UiNode'
import { CalloutPin, DraftGlyph, ItemMarksRow, withMarks } from './Marks'
import { WireBadges } from '../WireControls'

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left]

const colorVar = (c?: ColorToken) => `var(--c-${c ?? 'yellow'})`

/**
 * A container's border as four thin grab strips: with its title bar, the only parts of a frame, lane, column or screen
 * that take the pointer (its body lets a drag through to the canvas, which draws a selection box). docs/canvas.md
 */
export const Rims = () => (
  <>
    {(['t', 'r', 'b', 'l'] as const).map((s) => (
      <div key={s} className={`rim rim-${s} drag-handle`} aria-hidden="true" />
    ))}
  </>
)

/**
 * Shared chrome: agent-change wash, comment-attach click, double-click to edit, connection handles, resize handles, and
 * the annotation pins and TODO markers on the item's top-right corner (flow/nodes/Marks.tsx).
 */
export function Shell({
  item,
  pulse,
  className,
  children,
  handles = true,
  resizable = false,
  selected = false,
  style,
  onDouble,
  onClick,
  ownMarks = false,
}: {
  item: Item
  pulse: boolean
  className: string
  children: ReactNode
  handles?: boolean
  resizable?: boolean
  selected?: boolean
  style?: React.CSSProperties
  /** what a double-click does instead of editing the text */
  onDouble?: () => void
  /** what a click does (a UI mock element being played, flow/uiPlay.ts); the comment tool's attach comes first */
  onClick?: () => void
  /** the node draws its marks itself (a UI mock element, beside its callout pins) */
  ownMarks?: boolean
}) {
  const edit = useEdit()
  // a locked item (docs/diagrams.md "What a redraw keeps") is not dragged or resized until it is unlocked
  const locked = ownLock(item)
  const [liveH, setLiveH] = useState<number | null>(null)
  const font = SCALES_FONT.has(item.type) || item.fontSize ? { fontSize: (fontOf(item) * (liveH ?? item.h)) / Math.max(item.h, 1) } : undefined
  // long-press (touch) opens the item menu, like a right-click
  const press = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearPress = () => {
    if (press.current) clearTimeout(press.current)
    press.current = null
  }
  return (
    <>
    {resizable && (
      <NodeResizer
        isVisible={selected && edit.editingId !== item.id && !locked}
        minWidth={24}
        minHeight={20}
        onResize={(_, p) => setLiveH(p.height)}
        onResizeEnd={(_, p) => {
          setLiveH(null)
          edit.resize(item.id, p)
        }}
      />
    )}
    <div
      className={`item ${className} ${pulse ? 'pulse' : ''}`}
      style={{ ...style, ...font }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return
        clearPress()
        const { clientX, clientY } = e
        press.current = setTimeout(() => edit.openMenu(item.id, clientX, clientY), 500)
      }}
      onPointerUp={clearPress}
      onPointerMove={clearPress}
      onPointerCancel={clearPress}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (onDouble) onDouble()
        else edit.startEdit(item.id)
      }}
      onClick={(e) => {
        if (edit.attachTarget) {
          e.stopPropagation()
          edit.attachTarget(item.id)
        } else if (onClick) {
          e.stopPropagation()
          onClick()
        }
      }}
    >
      {handles && SIDES.map((side) => <Handle key={side} id={side} type="source" position={side} />)}
      <Tether />
      {item.type !== 'comment' && item.type !== 'arrow' && item.data?.pending ? <ProposedTag kind={(item.data.pending as { kind?: string }).kind} /> : null}
      {children}
      {locked ? <LockBadge frame={item.type === 'frame'} /> : null}
    </div>
    {/* a sibling of the box, so a box that clips its content does not cut them */}
    {ownMarks ? null : <ItemMarksRow />}
    </>
  )
}

/** The lock badge: this item (a frame: everything in it) keeps its place through redraws and the kanban layout. */
function LockBadge({ frame }: { frame: boolean }) {
  const what = frame ? 'Layout locked: redraws and the kanban layout keep this frame and everything in it where it is' : 'Position locked: redraws and the kanban layout keep it here'
  return (
    <span className="lock-badge" role="img" aria-label={what} title={`${what} — right-click → Unlock`}>
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
        <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  )
}

/** "proposed" on an item the file does not have yet; a removal says so. */
function ProposedTag({ kind }: { kind?: string }) {
  if (kind === 'remove')
    return (
      <span className="node-tag remove" aria-label="proposed for removal, still in the file">
        remove · proposed
      </span>
    )
  return (
    <span className="node-tag" aria-label="proposed, not in the file yet">
      proposed
    </span>
  )
}

function Text({ item, className, placeholder }: { item: Item; className?: string; placeholder?: string }) {
  const edit = useEdit()
  return (
    <EditableText
      text={item.text ?? ''}
      editing={edit.editingId === item.id}
      onCommit={(t) => edit.commitText(item.id, t)}
      onCancel={edit.cancelEdit}
      className={className}
      placeholder={placeholder}
    />
  )
}

/** Role is told in text as well as colour. */
function RoleLabel({ role }: { role?: string }) {
  return role ? <span className="role-label">{role.replace(/-/g, ' ')}</span> : null
}

/** A workflow script block: the file its command runs (or none for an inline command). */
export function scriptOf(item: Item): { file?: string } | undefined {
  const d = item.data?.detail as { kind?: string; file?: unknown } | undefined
  return d?.kind === 'script' ? { file: typeof d.file === 'string' ? d.file : undefined } : undefined
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/** On a script block: open its source (view, then Edit in the dialog). A double-click on the block does the same. */
function ScriptButton({ item, file }: { item: Item; file?: string }) {
  const edit = useEdit()
  const name = file?.split('/').pop() ?? 'command'
  return (
    <button
      type="button"
      className="node-source nodrag nopan"
      title={file ? `View or edit ${file}` : 'View or edit the command'}
      aria-label={file ? `View or edit ${file}` : 'View or edit the command'}
      onPointerDown={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation()
        edit.openSource(item.id, 'view')
      }}
    >
      <span aria-hidden="true">‹/›</span> {name}
    </button>
  )
}

export function StickyNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse } = data
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className={`sticky ${item.role ?? ''}`} style={{ ['--sticky-bg' as string]: colorVar(item.color) }}>
      <Text item={item} placeholder="Write here" />
      {item.role !== 'actor' && <RoleLabel role={item.role} />}
    </Shell>
  )
}

export function TextNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse } = data
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className={`text-item ${item.role ?? ''}`} handles={false}>
      <Text item={item} placeholder="Text" />
    </Shell>
  )
}

export function FrameNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse } = data
  const edit = useEdit()
  // a hidden frame is drawn collapsed to this strip: what it holds is not drawn (docs/canvas.md "Hiding a frame")
  const hidden = hiddenCountOf(item)
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable={hidden === undefined} className={hidden === undefined ? 'frame' : 'frame frame-hidden'} handles={false}>
      <Rims />
      <div className="frame-title drag-handle">
        {data.diagram ? (
          <span className={`dg-badge k-${data.diagram.kind}`} title={`${data.diagram.name} · key ${data.diagram.key}`}>
            {data.diagram.name}
          </span>
        ) : null}
        {edit.editingId === item.id ? <Text item={item} /> : item.text}
        {hidden === undefined && data.diagram?.findings ? (
          <span className="dg-findings-count" title={data.diagram.kind === 'ui-mock' ? 'awd design lint findings — select the frame to see them' : 'Grammar findings — select the frame to see them'}>
            {data.diagram.findings} to check
          </span>
        ) : null}
        {/* a hidden frame's story or screens are not drawn: nothing to play */}
        {hidden === undefined && data.diagram?.kind === 'domain-story' ? <PlayStoryButton frameId={item.id} compact /> : null}
        {hidden === undefined && data.diagram?.kind === 'ui-mock' ? (
          <>
            <PlayMockButton frameId={item.id} compact />
            <ClickableButton />
          </>
        ) : null}
      </div>
      {hidden !== undefined ? (
        <div className="frame-hidden-bar drag-handle">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" />
            <path d="M3 13L13 3" />
          </svg>
          <span>
            {hidden.toLocaleString('en')} {hidden === 1 ? 'item' : 'items'} hidden
          </span>
          <button
            type="button"
            // `replay-play`: the header's control look, and Copy as image leaves it out (flow/copyImage.ts)
            className="ghost replay-play frame-show nodrag"
            onPointerDown={stop}
            onDoubleClick={stop}
            onClick={(e) => {
              e.stopPropagation()
              edit.setHidden?.(item.id, false)
            }}
            title="Draw what this frame holds again (for everyone on the board)"
          >
            Show
          </button>
        </div>
      ) : null}
    </Shell>
  )
}

export function LaneNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse } = data
  const edit = useEdit()
  if (item.role === 'column') {
    // kanban column: header with the card count against its WIP limit (text, never colour alone)
    const count = data.childCount ?? 0
    const wip = typeof item.data?.wip === 'number' ? (item.data.wip as number) : undefined
    const over = wip !== undefined && count > wip
    return (
      <Shell item={item} pulse={pulse} selected={selected} resizable className="lane column" handles={false}>
        <Rims />
        <div className="column-head drag-handle">
          <span className="name">{edit.editingId === item.id ? <Text item={item} /> : item.text}</span>
          <span className={`count ${over ? 'over' : ''}`} title={wip !== undefined ? `${count} of ${wip} allowed` : `${count} cards`}>
            {wip !== undefined ? `${count}/${wip}${over ? ' over' : ''}` : count}
          </span>
        </div>
      </Shell>
    )
  }
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className="lane" handles={false}>
      <Rims />
      <div className="lane-title drag-handle">{edit.editingId === item.id ? <Text item={item} /> : item.text}</div>
    </Shell>
  )
}

export function CardNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse } = data
  const accent = item.color ? colorVar(item.color) : undefined
  const edit = useEdit()
  if (item.role === 'card') {
    // kanban card: title, then labels / assignee / size as plain text badges
    const labels = Array.isArray(item.data?.labels) ? (item.data.labels as unknown[]).filter((l): l is string => typeof l === 'string') : []
    const size = typeof item.data?.size === 'string' ? (item.data.size as string) : undefined
    const assignee = typeof item.data?.assignee === 'string' ? (item.data.assignee as string) : undefined
    return (
      <Shell item={item} pulse={pulse} selected={selected} resizable className="card kanban">
        <Text item={item} placeholder="Card title" />
        {(labels.length > 0 || size || assignee) && (
          <div className="meta">
            {labels.map((l) => (
              <span key={l} className={`chip ${/^risk:(high|highest)$/i.test(l) ? 'risk-high' : ''}`}>
                {l}
              </span>
            ))}
            {assignee && <span className="assignee">{assignee}</span>}
            {size && <span className="size">{size}</span>}
          </div>
        )}
      </Shell>
    )
  }
  // a workflow script block: its source opens from the ‹/› chip or a double-click
  const script = scriptOf(item)
  return (
    <Shell
      item={item}
      pulse={pulse}
      selected={selected}
      resizable
      className={accent && item.color !== 'white' ? 'card tinted' : 'card'}
      style={accent ? { ['--card-accent' as string]: accent } : undefined}
      onDouble={script ? () => edit.openSource(item.id, 'view') : undefined}
    >
      <Text item={item} placeholder="Write here" />
      {script && <ScriptButton item={item} file={script.file} />}
      <RoleLabel role={item.role} />
      <WireBadges badges={data.wireBadges} />
    </Shell>
  )
}

export function WireframeNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse } = data
  const role = item.role ?? 'box'
  const label: Record<string, string> = { image: 'Image', input: item.text ? '' : 'Input' }
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className={`wf ${role}`} handles={role !== 'screen'}>
      {role === 'screen' ? (
        <>
          <Rims />
          <div className="wf-title drag-handle">{item.text}</div>
        </>
      ) : role === 'nav' ? (
        (item.text ?? 'Home, About').split(/\s*[·|,]\s*/).map((t, i) => <span key={i}>{t}</span>)
      ) : (
        <Text item={item} placeholder={label[role] ?? ''} />
      )}
    </Shell>
  )
}

/** Anchor for the line from a comment thread to the item it is about. */
const Tether = () => <Handle id="tether" type="source" position={Position.Top} isConnectable={false} className="tether-handle" />

/**
 * An annotation card (docs/canvas.md → "Notes"; a UI mock's callout, docs/diagrams.md §6c): what pin `n` on an item is
 * about — the same numbered circle, then the text. An explanation, not a thread: no author line, no reply box. The file
 * holds the text, so nothing is edited in place (a double-click does nothing) — except an annotation written on the
 * board only, which has no file. Pointing at it outlines its pin.
 */
function CalloutCard({ item, n, pulse, selected }: { item: Item; n: number; pulse: boolean; selected: boolean }) {
  const edit = useEdit()
  const own = annotationOf(item)?.board === true
  const hover = (on: boolean) => edit.hoverMark?.(item.id, on, 'card')
  return (
    <Shell item={item} pulse={pulse} selected={selected} className={`callout-card ${own ? 'on-board' : ''}`} handles={false} style={{ minHeight: item.h }} onDouble={own ? undefined : () => undefined}>
      <div className="callout" onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
        <CalloutPin n={n} />
        {own ? <Text item={item} className="callout-text" placeholder="What is it for?" /> : <p className="callout-text">{item.text}</p>}
      </div>
    </Shell>
  )
}

/**
 * The person's draft annotation (src/annotations.ts), waiting for the holder of the files: the annotation card's
 * family, dashed — a ✎ instead of a number, the text, and where the discussion stands. A click opens its thread, where
 * the holder answers (and the person replies). Settled, it is not drawn: the card drawn from the file replaces it.
 */
function DraftCard({ item, replies, pulse, selected }: { item: Item; replies: Item[]; pulse: boolean; selected: boolean }) {
  const edit = useEdit()
  const hover = (on: boolean) => edit.hoverMark?.(item.id, on, 'card')
  const status = draftStatus(replies, edit.holderOf?.(item.id))
  const open = () => edit.setCommentOpen(item.id, true)
  return (
    <Shell item={item} pulse={pulse} selected={selected} className="callout-card draft-card" handles={false} style={{ minHeight: item.h }} onDouble={open}>
      {/* the click goes on to the node too, so the opened thread is selected and drawn above its neighbours */}
      <div className="callout" title="Your annotation, proposed to the holder of the files — click to open the thread" onClick={() => {
          if (!edit.attachTarget) open()
        }} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
        <span className="ui-pin draft" role="img" aria-label="Draft annotation">
          <DraftGlyph />
        </span>
        <p className="callout-text">{item.text}</p>
        <p className="draft-status">{status}</p>
      </div>
    </Shell>
  )
}

/** A draft opened to its thread: what it is, then the discussion with the holder and the reply box. */
function DraftThread({ item, replies, pulse, selected }: { item: Item; replies: Item[]; pulse: boolean; selected: boolean }) {
  const edit = useEdit()
  const holder = edit.holderOf?.(item.id)
  const withEdit = Boolean((item.data?.discuss as { edit?: unknown } | undefined)?.edit)
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className="comment user draft-thread" handles={false} style={{ minHeight: item.h }} onDouble={() => undefined}>
      <div className="draft-head">
        <span className="ui-pin draft" aria-hidden="true">
          <DraftGlyph />
        </span>
        Draft annotation · for {holder ?? 'the holder of the files'}
      </div>
      {withEdit ? null : <p className="draft-note">No diff with it: {holder ?? 'the holder'} writes it into the file by hand.</p>}
      <ThreadBody messages={[item, ...replies]} />
    </Shell>
  )
}

/**
 * A TODO (src/annotations.ts): something still to be confirmed with someone else — a checkbox, the text, who to ask,
 * the agent that opened it, its replies. Ticking it asks what was found out (CheckOffField); done, it is muted with
 * its answer, and a tick reopens it. Opened, its thread is under it.
 */
function TodoCard({ item, todo, open, replies, pulse, selected }: { item: Item; todo: TodoMark; open: boolean; replies: Item[]; pulse: boolean; selected: boolean }) {
  const edit = useEdit()
  const [asking, setAsking] = useState(false)
  const done = todo.state === 'done'
  const by = todoBy(item)
  const hover = (on: boolean) => edit.hoverMark?.(item.id, on, 'card')
  const n = replies.length
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className={`todo-card ${done ? 'done' : ''}`} handles={false} style={{ minHeight: item.h }}>
      <div className="todo-row" onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          className="todo-check nodrag nopan"
          aria-label={done ? 'Done — reopen this TODO' : 'Check this TODO off'}
          title={done ? `Done${todo.doneBy ? ` (${todo.doneBy === 'person' ? 'you' : todo.doneBy})` : ''} — click to reopen` : 'Check it off'}
          onPointerDown={stop}
          onMouseDown={stop}
          onDoubleClick={stop}
          // the click goes on to the node: the card is selected, so its field is drawn above its neighbours
          onClick={() => {
            if (done) edit.reopenTodo?.(item.id)
            else setAsking((a) => !a)
          }}
        >
          {done ? (
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          ) : null}
        </button>
        <div className="todo-main">
          <Text item={item} className="todo-text" placeholder="What still has to be confirmed?" />
          <div className="todo-meta">
            <span className="todo-tag">TODO</span>
            {todo.ask ? <span>ask: {todo.ask}</span> : null}
            {by ? <span>by {by}</span> : null}
            <button
              type="button"
              className="todo-replies nodrag nopan"
              aria-expanded={open}
              onPointerDown={stop}
              onDoubleClick={stop}
              onClick={(e) => {
                e.stopPropagation()
                edit.setCommentOpen(item.id, !open)
              }}
            >
              {open ? 'fold' : n ? `${n} ${n === 1 ? 'reply' : 'replies'}` : 'reply'}
            </button>
          </div>
          {done && todo.answer ? <p className="todo-answer">✓ {todo.answer}</p> : null}
        </div>
      </div>
      {asking && !done ? (
        <CheckOffField
          compact
          answeredBy={edit.answeredBy?.()}
          onCancel={() => setAsking(false)}
          onDone={(answer) => {
            setAsking(false)
            edit.checkTodo?.(item.id, answer)
          }}
        />
      ) : null}
      {open ? (
        <div className="todo-thread comment">
          <ThreadReplies root={item} replies={replies} />
        </div>
      ) : null}
    </Shell>
  )
}

export function CommentNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse, open, done, replies } = data
  const edit = useEdit()
  const callout = calloutOf(item)
  if (callout !== undefined) return <CalloutCard item={item} n={callout} pulse={pulse} selected={Boolean(selected)} />
  const messages = [item, ...replies]
  if (isAnnotationDraft(item))
    return open || messages.some((m) => m.id === edit.editingId) ? <DraftThread item={item} replies={replies} pulse={pulse} selected={Boolean(selected)} /> : <DraftCard item={item} replies={replies} pulse={pulse} selected={Boolean(selected)} />
  const todo = todoOf(item)
  if (todo) return <TodoCard item={item} todo={todo} open={open || replies.some((m) => m.id === edit.editingId)} replies={replies} pulse={pulse} selected={Boolean(selected)} />
  if (!open && !messages.some((m) => m.id === edit.editingId))
    return (
      <>
        <Tether />
        <CommentBadge messages={messages} pulse={pulse} done={done} />
      </>
    )
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className={`comment ${item.createdBy}`} handles={false} style={{ minHeight: item.h }}>
      <ThreadBody messages={messages} />
    </Shell>
  )
}

// every kind of item can carry annotation pins and TODO markers (its node data `marks`); a comment never does
export const nodeTypes = {
  dsIcon: withMarks(DsIconNode),
  sticky: withMarks(StickyNode),
  text: withMarks(TextNode),
  frame: withMarks(FrameNode),
  lane: withMarks(LaneNode),
  card: withMarks(CardNode),
  wireframe: withMarks(WireframeNode),
  ui: withMarks(UiNode),
  comment: CommentNode,
  // arrows are edges; a stray arrow item with missing endpoints renders as a sticky so it is visible
  arrow: StickyNode,
}
