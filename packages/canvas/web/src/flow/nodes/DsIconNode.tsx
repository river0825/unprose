// Domain Storytelling pictograms: an actor or a work object is an icon with its name under it — no box
// (docs/diagrams.md §6b). The icons are drawn here as simple line SVGs (our own, Apache-2.0 like the rest
// of the code; Egon.io's GPL icon set is not used). Unknown kinds fall back to person / document.
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { createElement, type ReactNode } from 'react'
import type { ItemNode } from '../boardToFlow'
import { EditableText } from '../EditableText'
import { useEdit } from '../EditContext'
import { dsGlyphTransform, parseDsIcon } from '../../../../src/diagrams/dsIcons'
import { ItemMarksRow } from './Marks'

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left]

const ICONS: Record<string, ReactNode> = {
  person: (
    <>
      <circle cx="12" cy="7.2" r="3.6" />
      <path d="M4.6 20.2c0-4.1 3.3-7.2 7.4-7.2s7.4 3.1 7.4 7.2z" />
    </>
  ),
  group: (
    <>
      <circle cx="8.3" cy="8" r="2.8" />
      <circle cx="15.7" cy="8" r="2.8" />
      <path d="M2.8 19.4c0-3.3 2.4-5.8 5.5-5.8s5.5 2.5 5.5 5.8z" />
      <path d="M13.9 13.8c.6-.1 1.2-.2 1.8-.2 3.1 0 5.5 2.5 5.5 5.8h-6.4" />
    </>
  ),
  system: (
    <>
      <rect x="4" y="4.8" width="16" height="11" rx="1.4" />
      <path d="M2 19.2h20" />
      <path d="M9.5 19.2l.6-3.4h3.8l.6 3.4" />
    </>
  ),
  document: (
    <>
      <path d="M6.5 2.8h7.6l4.4 4.4v14h-12z" />
      <path d="M14 2.8v4.5h4.5" />
      <path d="M9 12h6.5M9 15.5h6.5" />
    </>
  ),
  thing: (
    <>
      <path d="M12 2.8l8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z" />
      <path d="M3.9 7.4l8.1 4.6 8.2-4.6M12 12v9.2" />
    </>
  ),
  digital: (
    <>
      <ellipse cx="12" cy="5.6" rx="7" ry="2.6" />
      <path d="M5 5.6v12.8c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V5.6" />
      <path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
    </>
  ),
  folder: <path d="M3 6.6c0-.9.7-1.6 1.6-1.6h4.6l2.1 2.3h8.1c.9 0 1.6.7 1.6 1.6v9.3c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6z" />,
  call: <path d="M6.7 3.4l2.8.5 1.1 3.4-1.9 1.5a12.2 12.2 0 0 0 6.5 6.5l1.5-1.9 3.4 1.1.5 2.8c.2 1-.6 1.9-1.6 1.9A16.6 16.6 0 0 1 4.8 5c0-1 .9-1.8 1.9-1.6z" />,
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <path d="M3.6 6.4l8.4 6.4 8.4-6.4" />
    </>
  ),
  conversation: <path d="M4 4.8h16v11.4H10l-4.6 3.8v-3.8H4z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8v6" />
      <circle cx="12" cy="7.6" r=".4" />
    </>
  ),
}
ICONS.message = ICONS.email
ICONS.information = ICONS.info

export function dsIcon(kind: string | undefined, fallback: 'person' | 'document'): ReactNode {
  return ICONS[kind ?? ''] ?? ICONS[fallback]
}

/** An icon the story file brings (`icons:`): only its plain shapes are drawn, never its markup (dsIcons.ts). */
function ownIcon(svg: unknown): ReactNode | undefined {
  const glyph = parseDsIcon(svg)
  if (!glyph) return undefined
  const shapes = glyph.shapes.map((s, i) => createElement(s.tag, { key: i, ...s.attrs }))
  const transform = dsGlyphTransform(glyph)
  return transform ? <g transform={transform}>{shapes}</g> : <>{shapes}</>
}

function Icon({ kind, own, fallback, size }: { kind?: string; own?: unknown; fallback: 'person' | 'document'; size: number }) {
  return (
    <svg className="ds-glyph" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {ownIcon(own) ?? dsIcon(kind, fallback)}
    </svg>
  )
}

/** The legend's activity: a short arrow with the number circle at its origin and a verb. */
function ActivitySample() {
  return (
    <svg className="ds-activity-sample" viewBox="0 0 120 30" width="120" height="30" aria-hidden="true">
      <line x1="4" y1="15" x2="108" y2="15" stroke="currentColor" strokeWidth="1.6" />
      <path d="M108 10l9 5-9 5z" fill="currentColor" />
      <circle cx="26" cy="15" r="10" fill="var(--paper)" stroke="currentColor" strokeWidth="1.6" />
      <text x="26" y="19.5" textAnchor="middle" fontSize="12" fill="currentColor" fontFamily="var(--font-ui)">1</text>
      <text x="72" y="10" textAnchor="middle" fontSize="11" fill="currentColor" fontFamily="var(--font-ui)">verb</text>
    </svg>
  )
}

export function DsIconNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse } = data
  const edit = useEdit()
  const ds = String(item.data?.ds ?? '')
  const kind = typeof item.data?.kind === 'string' ? (item.data.kind as string) : undefined
  const isActor = ds === 'actor' || ds === 'legend-actor'
  const legend = ds.startsWith('legend-')
  return (
    <div
      className={`item ds-icon ${isActor ? 'ds-actor' : 'ds-object'} ${legend ? 'ds-legend' : ''} ${selected ? 'is-selected' : ''} ${pulse ? 'pulse' : ''}`}
      title={typeof item.data?.sentence === 'string' ? item.data.sentence : undefined}
      onDoubleClick={(e) => {
        if (legend) return
        e.stopPropagation()
        edit.startEdit(item.id)
      }}
    >
      {!legend && SIDES.map((side) => <Handle key={side} id={side} type="source" position={side} />)}
      {ds === 'legend-activity' ? <ActivitySample /> : <Icon kind={kind} own={item.data?.icon} fallback={isActor ? 'person' : 'document'} size={legend ? 36 : 52} />}
      {item.data?.pending ? <span className="node-tag" aria-label="proposed, not in the file yet">proposed</span> : null}
      <div className="ds-name">
        <EditableText text={item.text ?? ''} editing={edit.editingId === item.id} onCommit={(t) => edit.commitText(item.id, t)} onCancel={edit.cancelEdit} placeholder="Name" />
      </div>
      <ItemMarksRow />
    </div>
  )
}
