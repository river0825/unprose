import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { useRef, useState, type ReactNode } from 'react'
import type { ColorToken, Item } from '../../../../src/model'
import type { ItemNode } from '../boardToFlow'
import { CommentBadge, ThreadBody } from '../CommentThread'
import { EditableText } from '../EditableText'
import { useEdit } from '../EditContext'
import { SCALES_FONT, fontOf } from '../font'
import { DsIconNode } from './DsIconNode'
import { UiNode } from './UiNode'
import { WireBadges } from '../WireControls'

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left]

const colorVar = (c?: ColorToken) => `var(--c-${c ?? 'yellow'})`

/** Shared chrome: agent-change wash, comment-attach click, double-click to edit, connection handles, resize handles. */
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
}) {
  const edit = useEdit()
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
        isVisible={selected && edit.editingId !== item.id}
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
        }
      }}
    >
      {handles && SIDES.map((side) => <Handle key={side} id={side} type="source" position={side} />)}
      <Tether />
      {item.type !== 'comment' && item.type !== 'arrow' && item.data?.pending ? <ProposedTag kind={(item.data.pending as { kind?: string }).kind} /> : null}
      {children}
    </div>
    </>
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
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className="frame" handles={false}>
      <div className="frame-title">
        {data.diagram ? (
          <span className={`dg-badge k-${data.diagram.kind}`} title={`${data.diagram.name} · key ${data.diagram.key}`}>
            {data.diagram.name}
          </span>
        ) : null}
        {edit.editingId === item.id ? <Text item={item} /> : item.text}
        {data.diagram?.findings ? (
          <span className="dg-findings-count" title={data.diagram.kind === 'ui-mock' ? 'awd design lint findings — select the frame to see them' : 'Grammar findings — select the frame to see them'}>
            {data.diagram.findings} to check
          </span>
        ) : null}
      </div>
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
        <div className="column-head">
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
      <div className="lane-title">{edit.editingId === item.id ? <Text item={item} /> : item.text}</div>
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
        <div className="wf-title">{item.text}</div>
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

export function CommentNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse, open, replies } = data
  const edit = useEdit()
  const messages = [item, ...replies]
  if (!open && !messages.some((m) => m.id === edit.editingId))
    return (
      <>
        <Tether />
        <CommentBadge messages={messages} pulse={pulse} />
      </>
    )
  return (
    <Shell item={item} pulse={pulse} selected={selected} resizable className={`comment ${item.createdBy}`} handles={false} style={{ minHeight: item.h }}>
      <ThreadBody messages={messages} />
    </Shell>
  )
}

export const nodeTypes = {
  dsIcon: DsIconNode,
  sticky: StickyNode,
  text: TextNode,
  frame: FrameNode,
  lane: LaneNode,
  card: CardNode,
  wireframe: WireframeNode,
  ui: UiNode,
  comment: CommentNode,
  // arrows are edges; a stray arrow item with missing endpoints renders as a sticky so it is visible
  arrow: StickyNode,
}
