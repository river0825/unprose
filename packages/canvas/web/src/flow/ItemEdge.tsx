import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, getStraightPath, useInternalNode, useReactFlow, type EdgeProps } from '@xyflow/react'
import { useMemo, useState } from 'react'
import type { Item } from '../../../src/model'
import { EditableText } from './EditableText'
import { useEdit } from './EditContext'
import { useWireFocus } from './wireFocus'
import { bend, bestLoop, bestTurn, bestTurnY, isHorizontal, type Side } from './route'
import { EDGE_LABEL, labelControl, labelLines, placeEdgeLabel, pointAlong } from '../../../src/edgeLabel'
import { floatingEnd, floatingEndTo, foldedPath, foldsOf } from '../../../src/wireGeometry'
import type { DsWirePlan } from './boardToFlow'
import { foldsKey, nearestRun, removeFold, roundFolds, runMiddles, snapFold, withFold } from './folds'
import { useBoxesNear } from './obstacleBoxes'
import { useReplay } from './replay'
import './wires.css'

type Point = { x: number; y: number }
type NodeBox = { x: number; y: number; w: number; h: number }
const centre = (b: NodeBox): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

type Port = { s?: number; t?: number; si?: number; ti?: number; sn?: number; tn?: number }
const portOf = (data: unknown): Port => ((data as { port?: Port } | undefined)?.port ?? {})
const shift = (x: number, y: number, side: string | undefined, d = 0): [number, number] => (side === 'left' || side === 'right' ? [x, y + d] : [x + d, y])

/**
 * An arrow item: smooth-step by default, or straight runs through the points the person folded it at (data.bend,
 * flow/folds.ts). On a selected wire a handle sits at each fold (drag to move, double-click to remove) and in the
 * middle of each run (drag to fold it there); dragging the label folds it where it is dropped; double-click edits the label.
 */
export function ItemEdge(props: EdgeProps) {
  const { id, source, target, sourcePosition, targetPosition, markerEnd, label, selected, data, style } = props
  let { sourceX, sourceY, targetX, targetY } = props
  const edit = useEdit()
  const flow = useReactFlow()
  // the folds while a handle (or the label) is dragged: a live preview, committed once on drop
  const [live, setLive] = useState<Point[] | null>(null)
  // a label shown only as a dot (no free spot beside the wire): hovering the dot shows the whole label
  const [reveal, setReveal] = useState(false)
  const editing = edit.editingId === id
  const text = typeof label === 'string' ? label : ''
  const own = (data as { item?: Item } | undefined)?.item
  // A domain-story activity is a straight arrow with its sequence number in a circle at its origin (§6b).
  // It floats: aimed from centre to centre and cut at each pictogram's box, so arrows leaving one actor
  // spread around it (as in Egon.io) instead of bunching at one side's handle.
  const ds = Boolean(own?.data?.ds)
  const seq = ds && typeof own?.data?.seq === 'number' ? (own.data.seq as number) : undefined
  const srcNode = useInternalNode(source)
  const tgtNode = useInternalNode(target)
  const boxOfNode = (n: typeof srcNode): NodeBox | undefined => (n ? { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 } : undefined)
  const [srcBox, tgtBox] = [boxOfNode(srcNode), boxOfNode(tgtNode)]
  // the folds the person made (data.bend)
  const saved = useMemo(() => foldsOf(own?.data), [own?.data])
  // A domain story's numbers and verbs — and the detour that keeps a line off a pictogram — are placed for the whole
  // board (boardToFlow planDsWires), so they keep off each other; while its ends and folds are what that plan was made
  // for it is used as is, else (mid-drag) placed live for this wire alone.
  const dsPlan = (data as { dsPlan?: DsWirePlan } | undefined)?.dsPlan
  const near = (a: NodeBox | undefined, b: NodeBox) => !!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5
  const planned = ds && dsPlan && !live && near(srcBox, dsPlan.from) && near(tgtBox, dsPlan.to) && dsPlan.folds === foldsKey(saved) ? dsPlan : undefined
  // where the wire is folded: being dragged, else as planned (a domain story: the person's folds or the board's detour), else the person's
  const drawnVia = planned?.via ?? saved
  const via = live ?? drawnVia
  const folded = via.length > 0 && !!srcBox && !!tgtBox
  if (folded) {
    // a folded wire floats: each end aimed at its neighbouring fold and cut at the box
    const [f, g] = [floatingEndTo(srcBox!, via[0]), floatingEndTo(tgtBox!, via[via.length - 1])]
    ;[sourceX, sourceY, targetX, targetY] = [f.x, f.y, g.x, g.y]
  } else if (ds && srcBox && tgtBox) {
    const [f, g] = [floatingEnd(srcBox, tgtBox), floatingEnd(tgtBox, srcBox)]
    ;[sourceX, sourceY, targetX, targetY] = [f.x, f.y, g.x, g.y]
  }
  // Wires sharing a side are spread along it (boardToFlow spreadPorts), so they do not all meet in one point.
  const port = portOf(data)
  if (!ds && !folded) {
    ;[sourceX, sourceY] = shift(sourceX, sourceY, sourcePosition, port.s)
    ;[targetX, targetY] = shift(targetX, targetY, targetPosition, port.t)
  }
  // A long forward wire runs along its source's row and turns just before its target, in the gap in front
  // of it, instead of turning halfway — where a column of boxes usually stands. Wires into one side turn at
  // staggered distances so they do not cross each other on the way in.
  const forward = sourcePosition === 'right' && targetPosition === 'left'
  const late = !ds && forward && targetX - sourceX > 300
  const fromAbove = sourceY < targetY
  // the boxes this wire can meet (flow/obstacleBoxes.ts): the same list again while none of them has moved
  const xs = [sourceX, targetX, ...(folded ? via.map((p) => p.x) : [])]
  const ys = [sourceY, targetY, ...(folded ? via.map((p) => p.y) : [])]
  const allBoxes = useBoxesNear(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
  const routeBoxes = useMemo(() => allBoxes.filter((b) => b.id !== source && b.id !== target), [allBoxes, source, target])
  const prefer = late ? targetX - 22 - 7 * (fromAbove ? (port.ti ?? 0) : (port.tn ?? 1) - 1 - (port.ti ?? 0)) : (sourceX + targetX) / 2
  const free = !ds && !folded
  // among the turns that cross the fewest boxes, the one nearest the preferred turn (a backward
  // left → right wire, which planSides picks to stay clear of boxes, turns the same way mirrored)
  const backward = sourcePosition === 'left' && targetPosition === 'right'
  const turning = free && ((forward && targetX - sourceX > 24) || (backward && sourceX - targetX > 24))
  const turnAt = useMemo(() => (turning ? bestTurn(sourceX, sourceY, targetX, targetY, routeBoxes, prefer) : undefined), [turning, sourceX, sourceY, targetX, targetY, routeBoxes, prefer])
  // a vertical wire (bottom → top, top → bottom) makes its horizontal run in the best gap too
  const vertical = free && ((sourcePosition === 'bottom' && targetPosition === 'top' && targetY - sourceY > 24) || (sourcePosition === 'top' && targetPosition === 'bottom' && sourceY - targetY > 24))
  const turnY = useMemo(() => (vertical ? bestTurnY(sourceX, sourceY, targetX, targetY, routeBoxes, (sourceY + targetY) / 2) : undefined), [vertical, sourceX, sourceY, targetX, targetY, routeBoxes])
  // one side into a perpendicular one (right → top …): a single bend
  const corner = free && isHorizontal(sourcePosition) !== isHorizontal(targetPosition) ? bend({ x: sourceX, y: sourceY }, sourcePosition as Side, { x: targetX, y: targetY }, targetPosition as Side) : undefined
  // A loop under (or over) both boxes (a fix round going back): the one going furthest back runs outermost,
  // and it drops below any box in its way rather than through it.
  const loop = (sourcePosition === 'bottom' && targetPosition === 'bottom') || (sourcePosition === 'top' && targetPosition === 'top')
  const looping = loop && free && !!srcBox && !!tgtBox
  const loopMin = 22 + 9 * ((port.sn ?? 1) - 1 - (port.si ?? 0))
  const chosen = useMemo(
    () => (looping ? bestLoop(srcBox!, tgtBox!, routeBoxes, loopMin, port.s, port.t) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [looping, srcBox?.x, srcBox?.y, srcBox?.w, srcBox?.h, tgtBox?.x, tgtBox?.y, tgtBox?.w, tgtBox?.h, routeBoxes, loopMin, port.s, port.t],
  )
  if (chosen) [sourceX, sourceY, targetX, targetY] = [chosen.sx, chosen.sy, chosen.tx, chosen.ty]
  const loopY = chosen?.y
  // The wire's runs, as points: the path is drawn from them and the label is placed along them.
  const S = { x: sourceX, y: sourceY }
  const T = { x: targetX, y: targetY }
  const runs: Point[] = folded
    ? [S, ...via, T]
    : ds
    ? [S, T]
    : loopY !== undefined
    ? [S, { x: sourceX, y: loopY }, { x: targetX, y: loopY }, T]
    : turnAt !== undefined
    ? [S, { x: turnAt, y: sourceY }, { x: turnAt, y: targetY }, T]
    : turnY !== undefined
    ? [S, { x: sourceX, y: turnY }, { x: targetX, y: turnY }, T]
    : corner
    ? corner
    : isHorizontal(sourcePosition) && isHorizontal(targetPosition)
    ? [S, { x: (sourceX + targetX) / 2, y: sourceY }, { x: (sourceX + targetX) / 2, y: targetY }, T]
    : !isHorizontal(sourcePosition) && !isHorizontal(targetPosition)
    ? [S, { x: sourceX, y: (sourceY + targetY) / 2 }, { x: targetX, y: (sourceY + targetY) / 2 }, T]
    : [S, { x: targetX, y: sourceY }, T]
  const [path] = folded
    ? [foldedPath(runs, ds ? 4 : 8)]
    : ds
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : loopY !== undefined || (backward && turnAt !== undefined) || turnY !== undefined || corner
    ? [foldedPath(runs, 8)]
    : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, centerX: turnAt, borderRadius: 8 })
  // the circle sits a little along the first run, clear of the actor icon and its name
  const first = runs[1] ?? T
  const len = Math.hypot(first.x - sourceX, first.y - sourceY) || 1
  const along = Math.min(24, len / 3)
  const seqAt = planned?.seq ?? { x: sourceX + ((first.x - sourceX) / len) * along, y: sourceY + ((first.y - sourceY) / len) * along }
  // A domain-story verb sits beside its first run (as in Egon.io), past the number circle, so neither covers the other.
  const dsVerbAt = () => {
    const ux = (first.x - sourceX) / len
    const uy = (first.y - sourceY) / len
    let nx = -uy
    let ny = ux
    if (ny > 0 || (ny === 0 && nx > 0)) [nx, ny] = [-nx, -ny] // the side facing up (or left on a vertical line)
    const t = Math.max(len / 2, Math.min(len - 20, along + 44))
    return { x: sourceX + ux * t + nx * 13, y: sourceY + uy * t + ny * 13 }
  }
  // The label (edgeLabel.ts, the same rule as the snapshot): smaller than card text, never on a card — along the
  // runs, then beside the line, wrapped / cut with … (full text in the tooltip), else only a dot that shows it on
  // hover or selection. `data.label: { at, short }` steers it.
  const labelText = typeof label === 'string' ? label : ''
  const font = ds && own?.role !== 'annotation-link' ? EDGE_LABEL.dsFont : EDGE_LABEL.font
  const ctl = labelControl(own?.data)
  const auto = useMemo(
    () => (labelText && !planned ? placeEdgeLabel(labelText, runs, allBoxes, { font, at: ctl.at, short: ctl.short, prefer: ds && own?.role === 'activity' ? [dsVerbAt()] : undefined }) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labelText, JSON.stringify(runs), allBoxes, font, ctl.at, ctl.short, ds, !!planned],
  )
  const placed = planned && labelText ? planned.label : auto
  const whole = useMemo(() => (labelText ? labelLines(labelText, EDGE_LABEL.maxW, font).lines : []), [labelText, font])
  const at = placed ? { x: placed.x, y: placed.y } : pointAlong(runs, 0.5)
  // a workflow wire changed on the board and not yet in the file (docs/studio.md §7)
  const pendingKind = ((data as { item?: Item } | undefined)?.item?.data?.pending as { kind?: string } | undefined)?.kind
  const tag = pendingKind ? (pendingKind === 'remove' ? 'remove?' : 'proposed') : ''
  // A trace joins two diagrams and often runs across a whole frame, so its label (and "proposed" tag)
  // would land on unrelated cards: show it only while the trace or one of its ends is selected.
  const isTrace = (data as { item?: Item } | undefined)?.item?.role === 'trace'
  const sourceSelected = srcNode?.selected
  const targetSelected = tgtNode?.selected
  const focus = useWireFocus(source, target, selected)
  const bundle = !!(data as { bundle?: unknown } | undefined)?.bundle
  const quiet = (isTrace && !bundle && !selected && !editing && !sourceSelected && !targetSelected) || (focus === 'off' && !editing)
  // a domain story being replayed: the current sentence's number and verb stand out, what is still to come is faint (flow/replay.ts)
  const replayed = (data as { replay?: string } | undefined)?.replay
  const rc = replayed ? ` replay-${replayed}` : ''

  // what the label shows: the placed lines, the whole label while it is selected or hovered from its dot
  const shortened = !!placed && placed.mode !== 'full'
  const revealed = shortened && !editing && (selected || reveal || !!live)
  const dotOnly = placed?.mode === 'dot' && !editing && !selected && !reveal && !live && !tag
  const shown = !placed ? whole.join('\n') || text : revealed ? whole.join('\n') : placed.lines.join('\n')

  // Folding by hand (flow/folds.ts). A gesture listens on the window, so handles may come and go under the pointer
  // while it runs (a new fold adds a run); the pure parts say where the fold goes in and where it lands.
  // A domain story being replayed is not edited (its items cannot be dragged while it plays).
  const replaying = useReplay() !== null && ds
  const fold = (e: React.PointerEvent, base: Point[], k: number, insert: boolean) => {
    if (e.button !== 0 || editing || replaying) return
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY }
    const from = flow.screenToFlowPosition(start)
    const ends = [srcBox && centre(srcBox), tgtBox && centre(tgtBox)]
    const tol = 8 / (flow.getZoom() || 1)
    const runsAtStart = runs
    let k2 = k
    let moved = false
    let last: Point[] | null = null
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return
      moved = true
      const p = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      // the label: into the run nearest to where the drag started
      if (k2 < 0) k2 = nearestRun(runsAtStart, from)
      const list = withFold(base, k2, p, insert)
      const prev = k2 === 0 ? ends[0] : list[k2 - 1]
      const next = k2 === list.length - 1 ? ends[1] : list[k2 + 1]
      last = withFold(list, k2, snapFold(p, prev, next, tol), false)
      setLive(last)
    }
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (ev.type === 'pointerup' && moved && last) edit.bend(id, roundFolds(last))
      setLive(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const grip = { onPointerDown: (e: React.PointerEvent) => fold(e, drawnVia, -1, true) }
  // the fold handles: on a selected wire, not while its label is edited (nor its story replayed)
  const handles = !!selected && !editing && !replaying && !!srcBox && !!tgtBox

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={16} style={style} className={focus ? `wire-focus-${focus}` : undefined} />
      {seq !== undefined && (
        <EdgeLabelRenderer>
          <div className={`ds-seq nodrag nopan${rc}`} aria-label={`activity ${seq}`} style={{ transform: `translate(-50%, -50%) translate(${seqAt.x}px, ${seqAt.y}px)` }}>
            {seq}
          </div>
        </EdgeLabelRenderer>
      )}
      {handles && (
        <EdgeLabelRenderer>
          {via.map((f, k) => (
            <div
              key={`fold-${k}`}
              className="edge-grip wire-fold nodrag nopan"
              role="button"
              aria-label={`Fold ${k + 1} of the line: drag to move it, double-click to remove it`}
              title="Drag to move this fold, double-click to remove it"
              style={{ transform: `translate(-50%, -50%) translate(${f.x}px, ${f.y}px)` }}
              onPointerDown={(e) => fold(e, drawnVia, k, false)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                edit.bend(id, roundFolds(removeFold(drawnVia, k)))
              }}
            />
          ))}
          {!live &&
            runMiddles(runs).map(({ i, x, y }) => (
              <div
                key={`run-${i}`}
                className="edge-grip wire-fold-add nodrag nopan"
                role="button"
                aria-label="Drag to fold the line here"
                title={text ? 'Drag to fold the line here' : 'Drag to fold the line here, double-click to add a label'}
                style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
                onPointerDown={(e) => fold(e, drawnVia, i, true)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (!text) edit.startEdit(id)
                }}
              />
            ))}
        </EdgeLabelRenderer>
      )}
      {!quiet && (text || editing || (selected && !handles) || tag) && (
        <EdgeLabelRenderer>
          {dotOnly ? (
            <div
              data-edge-id={id}
              className={`edge-label-dot nodrag nopan${rc}`}
              role="button"
              aria-label={`Wire label: ${text}`}
              title={`${text} — no room beside the wire; hover or select to read, double-click to edit`}
              style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
              {...grip}
              onPointerEnter={() => setReveal(true)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                edit.startEdit(id)
              }}
            />
          ) : text || editing || tag ? (
            <div
              data-edge-id={id}
              className={`edge-label nodrag nopan${rc} ${ds ? 'ds-verb' : ''} ${(data as { item?: Item } | undefined)?.item?.role === 'trace' ? 'trace' : ''} ${selected ? 'selected' : ''} ${editing ? 'editing' : ''} ${live ? 'dragging' : ''} ${revealed ? 'revealed' : ''}`}
              style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
              title={shortened ? `${text}\n— drag to fold the line there, double-click to edit` : 'Drag to fold the line there, double-click to edit'}
              onPointerLeave={() => setReveal(false)}
              {...grip}
              onDoubleClick={(e) => {
                e.stopPropagation()
                edit.startEdit(id)
              }}
            >
              {tag && !editing ? <span className={`wire-tag ${pendingKind}`}>{tag}</span> : null}
              <EditableText text={editing ? text : shown} editing={editing} onCommit={(t) => edit.commitLabel(id, t.trim())} onCancel={edit.cancelEdit} placeholder="Label" />
            </div>
          ) : (
            <div
              className="edge-grip nodrag nopan"
              role="button"
              aria-label="Drag to fold the line here"
              title="Drag to fold the line here, double-click to add a label"
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
