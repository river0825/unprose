// The one place the panel says what an item is joined to (inspector/links.ts): the lines inside its own diagram
// (a workflow's wires, with their events, come first), the traces to other diagrams, and the lines a person drew
// on the board that are in no file. For a line itself: what it joins. A click shows the other end on the board;
// › opens it.
import type { ReactNode } from 'react'
import type { Board, Item } from '../../../src/model'
import { PanelLink } from '../inspector/panelNav'
import { KIND_WORDS, linkKind, lineLabel, linksOf, type LinkRow } from '../inspector/links'
import { REL_NAMES, relOf } from '../diagrams/traces'
import { diagramOf } from '../diagrams/frame'

const nameOf = (it: Item | undefined) => {
  const t = it?.text?.split('\n')[0].trim()
  return t || (it ? it.type : 'missing item')
}

function NodeButton({ board, id, onSelect }: { board: Board; id: string | undefined; onSelect: (id: string) => void }) {
  const it = id ? board.items[id] : undefined
  if (!it) return <span className="muted">{id ? 'missing item' : 'nothing'}</span>
  return (
    <PanelLink id={it.id} name={nameOf(it)} className="conn-node" onSelect={onSelect}>
      <span className={`conn-dot c-${it.color ?? 'grey'}`} aria-hidden="true" />
      {nameOf(it)}
      {it.role && it.role !== 'card' ? <span className="conn-role">{it.role.replace(/-/g, ' ')}</span> : null}
    </PanelLink>
  )
}

function Row({ board, row, onSelect }: { board: Board; row: LinkRow; onSelect: (id: string) => void }) {
  const word = KIND_WORDS[row.kind]
  const label = row.kind === 'trace' ? (row.rel ? REL_NAMES[row.rel] : row.label || 'trace') : row.label
  return (
    <li>
      <span className="conn-head">
        <span className="conn-arrow" aria-hidden="true">
          {row.dir === 'out' ? '→' : '←'}
        </span>
        <span className="sr">{row.dir === 'out' ? 'goes to' : 'comes from'}</span>
        <NodeButton board={board} id={row.other?.id} onSelect={onSelect} />
      </span>
      <span className="conn-tail">
        {label ? <span className={row.kind === 'trace' ? 'insp-chip' : 'conn-label'}>{label}</span> : null}
        {row.kind === 'trace' && row.otherDiagram ? <span className="wire-note">{row.otherDiagram}</span> : null}
        <PanelLink id={row.line.id} name={`the ${word}${label ? ` ${label}` : ''}`} className="link conn-wire" onSelect={onSelect}>
          {word}
        </PanelLink>
      </span>
    </li>
  )
}

/**
 * For a line: what it joins, named by what it is. For any other item: its links in three groups.
 * `wiring` is a workflow block's Listens to / Emits (BlockInspector), shown first in its group — the flow wires
 * it already lists are left out of the rows below it.
 */
export function Links({ board, item, onSelect, wiring }: { board: Board; item: Item; onSelect: (id: string) => void; wiring?: ReactNode }) {
  if (item.type === 'arrow') {
    const kind = linkKind(board, item)
    const label = lineLabel(item)
    return (
      <section className="conn" aria-label="What this line joins">
        <h3>{kind === 'wire' ? 'Wire' : kind === 'trace' ? 'Trace' : kind === 'arrow' ? 'Arrow' : 'Link'}</h3>
        <div className="conn-pair">
          <NodeButton board={board} id={item.from} onSelect={onSelect} />
          <span className="conn-arrow" aria-label="to">
            →{label ? <span className="conn-label">{kind === 'trace' ? (REL_NAMES[relOf(item)!] ?? label) : label}</span> : null}
          </span>
          <NodeButton board={board} id={item.to} onSelect={onSelect} />
        </div>
        {kind === 'link' && (diagramOf(board, item.from ? board.items[item.from] : undefined) || diagramOf(board, item.to ? board.items[item.to] : undefined)) ? (
          <p className="muted conn-note">Drawn on the board; in no file. Ask the agent to make it a trace, or a wire, if it should last.</p>
        ) : null}
      </section>
    )
  }
  const links = linksOf(board, item)
  const inDiagram = wiring ? links.inDiagram.filter((r) => r.kind !== 'wire') : links.inDiagram
  if (!wiring && !inDiagram.length && !links.across.length && !links.drawn.length) return null
  const group = (title: string, rows: LinkRow[], head?: ReactNode, note?: ReactNode) =>
    head || rows.length ? (
      <>
        <h4>
          {title} {rows.length ? <span className="muted">({rows.length})</span> : null}
        </h4>
        {head}
        {rows.length ? (
          <ul className="conn-list">
            {rows.map((r) => (
              <Row key={r.line.id} board={board} row={r} onSelect={onSelect} />
            ))}
          </ul>
        ) : null}
        {note}
      </>
    ) : null
  return (
    <section className="conn" aria-label="Links">
      <h3>Links</h3>
      {group(links.diagram ? `In this ${links.diagram.toLowerCase()}` : 'On this board', inDiagram, wiring)}
      {group('Across diagrams', links.across)}
      {group('Drawn on the board', links.drawn, undefined, links.diagram ? <p className="muted conn-note">In no file: a note to discuss, not yet a trace.</p> : undefined)}
    </section>
  )
}
