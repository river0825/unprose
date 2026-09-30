// "Copy as image": render the selected items — a frame with everything inside it, and the wires whose both
// ends are captured — to a PNG at 2× and put it on the clipboard; download it when the browser will not.
import { toBlob } from 'html-to-image'
import type { Board } from '../../../src/model'
import './capture.css'

const PAD = 24
const RATIO = 2

/** The ids to draw: the selection, every item inside a selected frame (at any depth), and the wires between them. */
export function captureIds(board: Board, selected: string[]): { nodes: Set<string>; edges: Set<string> } {
  const items = Object.values(board.items)
  const nodes = new Set(selected.filter((id) => board.items[id] && board.items[id].type !== 'arrow'))
  // children of captured containers, until nothing new is added
  for (let grew = true; grew; ) {
    grew = false
    for (const it of items) if (it.parent && nodes.has(it.parent) && !nodes.has(it.id) && it.type !== 'arrow') (nodes.add(it.id), (grew = true))
  }
  const edges = new Set<string>()
  for (const it of items) {
    if (it.type === 'arrow' && it.from && it.to && nodes.has(it.from) && nodes.has(it.to)) edges.add(it.id)
    // a comment's tether to the item it is about
    if (it.type === 'comment' && it.target && nodes.has(it.id) && nodes.has(it.target)) edges.add(`tether:${it.id}`)
  }
  return { nodes, edges }
}

export interface CaptureRequest {
  /** the `.react-flow` element */
  root: HTMLElement
  nodes: Set<string>
  edges: Set<string>
  /** selection bounds in flow coordinates */
  bounds: { x: number; y: number; width: number; height: number }
  fileName: string
}

/** Render the capture. Exported for tests; `copySelectionAsImage` is what the UI calls. */
export async function renderSelection(req: CaptureRequest): Promise<Blob> {
  const viewport = req.root.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewport) throw new Error('no canvas to capture')
  await document.fonts?.ready
  const width = Math.ceil(req.bounds.width + PAD * 2)
  const height = Math.ceil(req.bounds.height + PAD * 2)
  const background = getComputedStyle(req.root).getPropertyValue('--paper').trim() || getComputedStyle(document.body).backgroundColor
  req.root.classList.add('capturing')
  const restore = pinEdgeStyles(viewport, req)
  try {
    const blob = await toBlob(viewport, {
      width,
      height,
      pixelRatio: RATIO,
      backgroundColor: background,
      // draw the selection at the origin, unscaled, whatever the current pan/zoom
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${PAD - req.bounds.x}px, ${PAD - req.bounds.y}px) scale(1)` },
      filter: (node) => keep(node, req),
    })
    if (!blob) throw new Error('the browser returned no image')
    return blob
  } finally {
    restore()
    req.root.classList.remove('capturing')
  }
}

/**
 * The cloned SVG loses what CSS gives a wire (its stroke) and the edge's <svg> is only 300×150 with
 * overflow: visible — so for the capture, write the computed stroke onto each captured path as attributes
 * and size its <svg> to cover the selection; everything is put back afterwards.
 */
function pinEdgeStyles(viewport: HTMLElement, req: CaptureRequest): () => void {
  const undo: Array<() => void> = []
  for (const g of viewport.querySelectorAll<SVGGElement>('.react-flow__edge')) {
    if (!req.edges.has(g.getAttribute('data-id') ?? '')) continue
    const svg = g.ownerSVGElement
    if (svg) {
      const { width, height } = svg.style
      svg.style.width = `${Math.ceil(req.bounds.x + req.bounds.width + 100)}px`
      svg.style.height = `${Math.ceil(req.bounds.y + req.bounds.height + 100)}px`
      undo.push(() => ((svg.style.width = width), (svg.style.height = height)))
    }
    for (const path of g.querySelectorAll<SVGPathElement>('path.react-flow__edge-path')) {
      const cs = getComputedStyle(path)
      const before = { stroke: path.getAttribute('stroke'), width: path.getAttribute('stroke-width'), dash: path.getAttribute('stroke-dasharray'), fill: path.getAttribute('fill') }
      path.setAttribute('stroke', cs.stroke)
      path.setAttribute('stroke-width', cs.strokeWidth)
      if (cs.strokeDasharray && cs.strokeDasharray !== 'none') path.setAttribute('stroke-dasharray', cs.strokeDasharray)
      path.setAttribute('fill', 'none')
      undo.push(() => {
        for (const [attr, v] of [['stroke', before.stroke], ['stroke-width', before.width], ['stroke-dasharray', before.dash], ['fill', before.fill]] as const) {
          if (v === null) path.removeAttribute(attr)
          else path.setAttribute(attr, v)
        }
      })
    }
  }
  return () => undo.reverse().forEach((f) => f())
}

function keep(node: Node, req: CaptureRequest): boolean {
  if (!(node instanceof Element)) return true
  const el = node as HTMLElement
  const cl = el.classList
  if (cl.contains('react-flow__node')) return req.nodes.has(el.dataset.id ?? '')
  if (cl.contains('react-flow__edge')) return req.edges.has(el.dataset.id ?? '') || req.edges.has(el.getAttribute('data-id') ?? '')
  if (cl.contains('edge-label')) return req.edges.has(el.dataset.edgeId ?? '')
  if (cl.contains('react-flow__handle') || cl.contains('react-flow__resize-control') || cl.contains('edge-grip')) return false
  if (cl.contains('react-flow__connectionline')) return false
  if (cl.contains('frozen-headers')) return false // pinned header strips are a viewing aid, not part of the board
  return true
}

/**
 * Put the selection on the clipboard as image/png. The ClipboardItem gets a Promise<Blob> so the write
 * starts inside the user gesture (Safari requires that); any failure falls back to a download.
 */
export async function copySelectionAsImage(req: CaptureRequest): Promise<'copied' | 'downloaded'> {
  const blob = renderSelection(req)
  blob.catch(() => undefined) // handled below; keeps the promise from being reported as unhandled
  try {
    if (!window.isSecureContext || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('clipboard unavailable')
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return 'copied'
  } catch {
    download(await blob, req.fileName)
    return 'downloaded'
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** A filename-safe board title. */
export function imageFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'board'
  return `${base}-selection.png`
}
