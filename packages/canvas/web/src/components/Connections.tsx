// What a wire joins, or what an item is wired to — in the panel, so a link hidden
// behind other items on the board can still be followed. Clicking a node selects it.
import type { Board, Item } from '../../../src/model'

const nameOf = (it: Item | undefined) => {
  const t = it?.text?.split('\n')[0].trim()
  return t || (it ? it.type : 'missing item')
}
const wireName = (a: Item) => (a.label ?? a.text)?.trim() || (a.role && a.role !== 'flow' ? a.role : '')

function NodeButton({ board, id, onSelect }: { board: Board; id: string | undefined; onSelect: (id: string) => void }) {
  const it = id ? board.items[id] : undefined
  if (!it) return <span className="muted">{id ? 'missing item' : 'nothing'}</span>
  return (
    <button type="button" className="conn-node" data-item-link={it.id} onClick={() => onSelect(it.id)} title={`Select ${nameOf(it)}`}>
      <span className={`conn-dot c-${it.color ?? 'grey'}`} aria-hidden="true" />
      {nameOf(it)}
      {it.role && it.role !== 'card' ? <span className="conn-role">{it.role.replace(/-/g, ' ')}</span> : null}
    </button>
  )
}

/** For an arrow: From → To. For any other item: the wires coming in and going out. */
export function Connections({ board, item, onSelect }: { board: Board; item: Item; onSelect: (id: string) => void }) {
  if (item.type === 'arrow') {
    const label = wireName(item)
    return (
      <section className="conn" aria-label="Connected items">
        <h3>Connects</h3>
        <div className="conn-pair">
          <NodeButton board={board} id={item.from} onSelect={onSelect} />
          <span className="conn-arrow" aria-label="to">
            →{label ? <span className="conn-label">{label}</span> : null}
          </span>
          <NodeButton board={board} id={item.to} onSelect={onSelect} />
        </div>
      </section>
    )
  }
  const arrows = Object.values(board.items).filter((a) => a.type === 'arrow' && (a.from === item.id || a.to === item.id))
  if (!arrows.length) return null
  const incoming = arrows.filter((a) => a.to === item.id)
  const outgoing = arrows.filter((a) => a.from === item.id && a.to !== item.id)
  const list = (title: string, wires: Item[], other: (a: Item) => string | undefined) =>
    wires.length ? (
      <>
        <h4>
          {title} <span className="muted">({wires.length})</span>
        </h4>
        <ul className="conn-list">
          {wires.map((a) => (
            <li key={a.id}>
              <NodeButton board={board} id={other(a)} onSelect={onSelect} />
              {wireName(a) ? <span className="conn-label">{wireName(a)}</span> : null}
              <button type="button" className="link conn-wire" data-item-link={a.id} onClick={() => onSelect(a.id)} aria-label={`Select the wire ${wireName(a) || ''}`}>
                wire
              </button>
            </li>
          ))}
        </ul>
      </>
    ) : null
  return (
    <section className="conn" aria-label="Connected items">
      <h3>Connected</h3>
      {list('Comes from', incoming, (a) => a.from)}
      {list('Goes to', outgoing, (a) => a.to)}
    </section>
  )
}
