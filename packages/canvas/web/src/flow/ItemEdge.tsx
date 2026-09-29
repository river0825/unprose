import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, getStraightPath, useInternalNode, useReactFlow, type EdgeProps } from '@xyflow/react'
import { useRef, useState } from 'react'
import type { Item } from '../../../src/model'
import { EditableText } from './EditableText'
import { useEdit } from './EditContext'

type Point = { x: number; y: number }

function bendOf(data: unknown): Point | undefined {
  const b = (data as { item?: Item } | undefined)?.item?.data?.bend as Partial<Point> | undefined
  return typeof b?.x === 'number' && typeof b.y === 'number' ? { x: b.x, y: b.y } : undefined
}

/** A quadratic curve from s to t that passes through p. */
const curveThrough = (s: Point, p: Point, t: Point) => `M ${s.x},${s.y} Q ${2 * p.x - (s.x + t.x) / 2},${2 * p.y - (s.y + t.y) / 2} ${t.x},${t.y}`

/**
 * An arrow item: smooth-step by default, or a curve through its one bend point.
 * The label (or, on a selected unlabelled wire, a grip) drags the bend; double-click edits the label.
 */
export function ItemEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, label, selected, data, style }: EdgeProps) {
  const edit = useEdit()
  const flow = useReactFlow()
  const [drag, setDrag] = useState<Point | null>(null)
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const editing = edit.editingId === id
  const text = typeof label === 'string' ? label : ''
  const point = drag ?? bendOf(data)
  const [stepPath, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const path = point ? curveThrough({ x: sourceX, y: sourceY }, point, { x: targetX, y: targetY }) : stepPath
  const at = point ?? { x: lx, y: ly }
  // a workflow wire changed on the board and not yet in the file (docs/studio.md §7)
  const pendingKind = ((data as { item?: Item } | undefined)?.item?.data?.pending as { kind?: string } | undefined)?.kind
  const tag = pendingKind ? (pendingKind === 'remove' ? 'remove?' : 'proposed') : ''
  // A trace joins two diagrams and often runs across a whole frame, so its label (and "proposed" tag)
  // would land on unrelated cards: show it only while the trace or one of its ends is selected.
  const isTrace = (data as { item?: Item } | undefined)?.item?.role === 'trace'
  const sourceSelected = useInternalNode(source)?.selected
  const targetSelected = useInternalNode(target)?.selected
  const quiet = isTrace && !selected && !editing && !sourceSelected && !targetSelected

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return
    e.stopPropagation()
    gesture.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return
    g.moved = true
    setDrag(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (g?.moved && drag) edit.bend(id, drag)
    setDrag(null)
  }
  const grip = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => ((gesture.current = null), setDrag(null)) }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={16} style={style} />
      {!quiet && (text || editing || selected || tag) && (
        <EdgeLabelRenderer>
          {text || editing || tag ? (
            <div
              className={`edge-label nodrag nopan ${(data as { item?: Item } | undefined)?.item?.role === 'trace' ? 'trace' : ''} ${selected ? 'selected' : ''} ${editing ? 'editing' : ''} ${drag ? 'dragging' : ''}`}
              style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
              title="Drag to reroute, double-click to edit"
              {...grip}
              onDoubleClick={(e) => {
                e.stopPropagation()
                edit.startEdit(id)
              }}
            >
              {tag && !editing ? <span className={`wire-tag ${pendingKind}`}>{tag}</span> : null}
              <EditableText text={text} editing={editing} onCommit={(t) => edit.commitLabel(id, t.trim())} onCancel={edit.cancelEdit} placeholder="Label" />
            </div>
          ) : (
            <div
              className="edge-grip nodrag nopan"
              role="button"
              aria-label="Drag to reroute the arrow"
              title="Drag to reroute, double-click to add a label"
              style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
              {...grip}
              onDoubleClick={(e) => {
                e.stopPropagation()
                edit.startEdit(id)
              }}
            />
          )}
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/** A comment thread → the item it is about: a faint dashed line, not a wire. */
export function TetherEdge({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  return <BaseEdge path={path} className="tether-path" interactionWidth={0} />
}

export const edgeTypes = { item: ItemEdge, tether: TetherEdge }
