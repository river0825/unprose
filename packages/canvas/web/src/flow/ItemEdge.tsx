import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, getStraightPath, useInternalNode, useReactFlow, useStore, type EdgeProps, type ReactFlowState } from '@xyflow/react'
import { useMemo, useRef, useState } from 'react'
import type { Item } from '../../../src/model'
import { EditableText } from './EditableText'
import { useEdit } from './EditContext'
import { useWireFocus } from './wireFocus'
import { bestLoop, bestTurn, freeLabelSpot, type Box } from './route'
import { isContainer } from './boardToFlow'
import './wires.css'

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

type Port = { s?: number; t?: number; si?: number; ti?: number; sn?: number; tn?: number }
const portOf = (data: unknown): Port => ((data as { port?: Port } | undefined)?.port ?? {})
const shift = (x: number, y: number, side: string | undefined, d = 0): [number, number] => (side === 'left' || side === 'right' ? [x, y + d] : [x + d, y])

const nodesOf = (s: ReactFlowState) => s.nodes
const lookupOf = (s: ReactFlowState) => s.nodeLookup

/** Every box a wire should not run through or put its label on: not containers, not comments. */
function useBoxes(): Array<Box & { id: string }> {
  const nodes = useStore(nodesOf) // re-route when any box moves
  const lookup = useStore(lookupOf)
  return useMemo(() => {
    const out: Array<Box & { id: string }> = []
    for (const n of lookup.values()) {
      const it = (n.data as { item?: Item } | undefined)?.item
      if (n.hidden || !it || it.type === 'comment' || isContainer(it)) continue
      out.push({ id: n.id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured?.width ?? n.width ?? it.w, h: n.measured?.height ?? n.height ?? it.h })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, lookup])
}

/** A polyline of axis-aligned runs with rounded corners. */
function roundedPath(pts: Point[], r = 8): string {
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
    const k = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2)
    const u = (p: Point, q: Point) => {
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1
      return { x: (q.x - p.x) / l, y: (q.y - p.y) / l }
    }
    const [ua, uc] = [u(b, a), u(b, c)]
    d += ` L ${b.x + ua.x * k},${b.y + ua.y * k} Q ${b.x},${b.y} ${b.x + uc.x * k},${b.y + uc.y * k}`
  }
  const z = pts[pts.length - 1]
  return `${d} L ${z.x},${z.y}`
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
  // Wires sharing a side are spread along it (boardToFlow spreadPorts), so they do not all meet in one point.
  const port = portOf(data)
  if (!ds) {
    ;[sourceX, sourceY] = shift(sourceX, sourceY, sourcePosition, port.s)
    ;[targetX, targetY] = shift(targetX, targetY, targetPosition, port.t)
  }
  // A long forward wire runs along its source's row and turns just before its target, in the gap in front
  // of it, instead of turning halfway — where a column of boxes usually stands. Wires into one side turn at
  // staggered distances so they do not cross each other on the way in.
  const forward = sourcePosition === 'right' && targetPosition === 'left'
  const late = !ds && forward && targetX - sourceX > 300
  const fromAbove = sourceY < targetY
  const allBoxes = useBoxes()
  const routeBoxes = useMemo(() => allBoxes.filter((b) => b.id !== source && b.id !== target), [allBoxes, source, target])
  const prefer = late ? targetX - 22 - 7 * (fromAbove ? (port.ti ?? 0) : (port.tn ?? 1) - 1 - (port.ti ?? 0)) : (sourceX + targetX) / 2
  // among the turns that cross the fewest boxes, the one nearest the preferred turn
  const turnAt = !ds && !bendOf(data) && forward && targetX - sourceX > 24 ? bestTurn(sourceX, sourceY, targetX, targetY, routeBoxes, prefer) : undefined
  // A loop under both boxes (a fix round going back): the one going furthest back runs outermost,
  // and it drops below any box in its way rather than through it.
  const loop = sourcePosition === 'bottom' && targetPosition === 'bottom'
  const boxOfNode = (n: typeof srcNode) => (n ? { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 } : undefined)
  const [srcBox, tgtBox] = [boxOfNode(srcNode), boxOfNode(tgtNode)]
  const chosen = loop && !ds && !bendOf(data) && srcBox && tgtBox ? bestLoop(srcBox, tgtBox, routeBoxes, 22 + 9 * ((port.sn ?? 1) - 1 - (port.si ?? 0)), port.s, port.t) : undefined
  if (chosen) [sourceX, sourceY, targetX, targetY] = [chosen.sx, chosen.sy, chosen.tx, chosen.ty]
  const loopY = chosen?.y
  const [stepPath, sx, sy] = ds
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : loopY !== undefined
    ? [roundedPath([{ x: sourceX, y: sourceY }, { x: sourceX, y: loopY }, { x: targetX, y: loopY }, { x: targetX, y: targetY }]), (sourceX + targetX) / 2, loopY]
    : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, centerX: turnAt, borderRadius: 8 })
  // the label sits on the wire's own run out of its source (or into its target), never on a box
  const labelText = typeof label === 'string' ? label : ''
  const lw = Math.min(220, labelText.length * 7.6 + 14)
  const lh = labelText.length * 7.6 + 14 > 220 ? 34 : 20
  const spot = !labelText
    ? undefined
    : turnAt !== undefined
    ? freeLabelSpot(sourceX + 4, turnAt - 4, sourceY, lw, lh, allBoxes) ?? freeLabelSpot(turnAt + 4, targetX - 4, targetY, lw, lh, allBoxes)
    : loopY !== undefined
    ? freeLabelSpot(targetX, sourceX, loopY, lw, lh, allBoxes)
    : undefined
  const [lx, ly] = spot ? [spot.x, spot.y] : [sx, sy]
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
  const focus = useWireFocus(source, target, selected)
  const quiet = (isTrace && !selected && !editing && !sourceSelected && !targetSelected) || (focus === 'off' && !editing)

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
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={16} style={style} className={focus ? `wire-focus-${focus}` : undefined} />
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
