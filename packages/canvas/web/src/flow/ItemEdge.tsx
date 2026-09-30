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

/** Where the line from box a's centre towards box b's centre leaves box a (plus a small gap). */
function floatingEnd(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): Point {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  if (!dx && !dy) return ca
  const hw = a.w / 2 + 6
  const hh = a.h / 2 + 6
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return { x: ca.x + dx * t, y: ca.y + dy * t }
}

/** A quadratic curve from s to t that passes through p. */
const curveThrough = (s: Point, p: Point, t: Point) => `M ${s.x},${s.y} Q ${2 * p.x - (s.x + t.x) / 2},${2 * p.y - (s.y + t.y) / 2} ${t.x},${t.y}`

/**
 * An arrow item: smooth-step by default, or a curve through its one bend point.
 * The label (or, on a selected unlabelled wire, a grip) drags the bend; double-click edits the label.
 */
export function ItemEdge(props: EdgeProps) {
  const { id, source, target, sourcePosition, targetPosition, markerEnd, label, selected, data, style } = props
  let { sourceX, sourceY, targetX, targetY } = props
  const edit = useEdit()
  const flow = useReactFlow()
  const [drag, setDrag] = useState<Point | null>(null)
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const editing = edit.editingId === id
  const text = typeof label === 'string' ? label : ''
  const point = drag ?? bendOf(data)
  const own = (data as { item?: Item } | undefined)?.item
  // A domain-story activity is a straight arrow with its sequence number in a circle at its origin (§6b).
  // It floats: aimed from centre to centre and cut at each pictogram's box, so arrows leaving one actor
  // spread around it (as in Egon.io) instead of bunching at one side's handle.
  const ds = Boolean(own?.data?.ds)
  const seq = ds && typeof own?.data?.seq === 'number' ? (own.data.seq as number) : undefined
  const srcNode = useInternalNode(source)
  const tgtNode = useInternalNode(target)
  if (ds && srcNode && tgtNode) {
    const box = (n: typeof srcNode) => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 })
    const [f, g] = [floatingEnd(box(srcNode), box(tgtNode)), floatingEnd(box(tgtNode), box(srcNode))]
    ;[sourceX, sourceY, targetX, targetY] = [f.x, f.y, g.x, g.y]
  }
  const [stepPath, lx, ly] = ds ? getStraightPath({ sourceX, sourceY, targetX, targetY }) : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const path = point ? curveThrough({ x: sourceX, y: sourceY }, point, { x: targetX, y: targetY }) : stepPath
  // the circle sits a little along the line, clear of the actor icon and its name
  const len = Math.hypot(targetX - sourceX, targetY - sourceY) || 1
  const along = Math.min(24, len / 3)
  const seqAt = { x: sourceX + ((targetX - sourceX) / len) * along, y: sourceY + ((targetY - sourceY) / len) * along }
  // A domain-story verb sits beside its line (as in Egon.io), past the number circle, so neither covers the other.
  const dsVerbAt = () => {
    const ux = (targetX - sourceX) / len
    const uy = (targetY - sourceY) / len
    let nx = -uy
    let ny = ux
    if (ny > 0 || (ny === 0 && nx > 0)) [nx, ny] = [-nx, -ny] // the side facing up (or left on a vertical line)
    const t = Math.max(len / 2, Math.min(len - 20, along + 44))
    return { x: sourceX + ux * t + nx * 13, y: sourceY + uy * t + ny * 13 }
  }
  const at = point ?? (ds && own?.role === 'activity' ? dsVerbAt() : { x: lx, y: ly })
  // a workflow wire changed on the board and not yet in the file (docs/studio.md §7)
  const pendingKind = ((data as { item?: Item } | undefined)?.item?.data?.pending as { kind?: string } | undefined)?.kind
  const tag = pendingKind ? (pendingKind === 'remove' ? 'remove?' : 'proposed') : ''
  // A trace joins two diagrams and often runs across a whole frame, so its label (and "proposed" tag)
  // would land on unrelated cards: show it only while the trace or one of its ends is selected.
  const isTrace = (data as { item?: Item } | undefined)?.item?.role === 'trace'
  const sourceSelected = srcNode?.selected
  const targetSelected = tgtNode?.selected
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
      {seq !== undefined && (
        <EdgeLabelRenderer>
          <div className="ds-seq nodrag nopan" aria-label={`activity ${seq}`} style={{ transform: `translate(-50%, -50%) translate(${seqAt.x}px, ${seqAt.y}px)` }}>
            {seq}
          </div>
        </EdgeLabelRenderer>
      )}
      {!quiet && (text || editing || selected || tag) && (
        <EdgeLabelRenderer>
          {text || editing || tag ? (
            <div
              data-edge-id={id}
              className={`edge-label nodrag nopan ${ds ? 'ds-verb' : ''} ${(data as { item?: Item } | undefined)?.item?.role === 'trace' ? 'trace' : ''} ${selected ? 'selected' : ''} ${editing ? 'editing' : ''} ${drag ? 'dragging' : ''}`}
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
