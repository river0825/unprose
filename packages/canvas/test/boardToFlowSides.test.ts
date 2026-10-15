// boardToFlow keeps each wire's planned sides from the last pass while nothing in its planSides window changed
// (flow/boardToFlow.ts sidesMemo): after every edit — a move, an add, a delete, a resize, an item put back at the
// end of the board, a screen moved with its elements, an element that becomes a container — every wire must have
// the sides planSides gives it from scratch. And the grid that finds a wire's window (planWindows) finds the boxes a
// pass over all of them would, in the same order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, Item } from '../src/model.js'
import { boardToFlow, isContainer, planWindows } from '../web/src/flow/boardToFlow.js'
import { planSides, planWindow, type Box } from '../web/src/flow/route.js'

const now = '2026-10-15T00:00:00.000Z'
const item = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({ x: 0, y: 0, w: 160, h: 110, createdBy: 'agent', updatedBy: 'agent', updatedAt: now, ...p }) as Item

/** mulberry32: the same edits on every run. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] }
}

/** UI-mock screens full of elements, navigate arrows from elements to other screens, stickies wired to each other. */
function synthetic(r: ReturnType<typeof rng>): Board {
  const items: Item[] = []
  const screens: Item[] = []
  const elements: Item[] = []
  for (let s = 0; s < 6; s++) {
    const scr = item({ id: `s${s}`, type: 'ui', role: 'screen', x: (s % 3) * 800, y: Math.floor(s / 3) * 650, w: 640, h: 480, data: { ui: { type: 'screen', container: true } } })
    screens.push(scr)
    items.push(scr)
    for (let e = 0; e < 14; e++) {
      const el = item({ id: `s${s}e${e}`, type: 'ui', role: r.pick(['button', 'text', 'select']), parent: scr.id, x: scr.x + 20 + r.int(0, 12) * 40, y: scr.y + 40 + r.int(0, 10) * 36, w: r.pick([80, 120, 200]), h: r.pick([28, 32, 60]), data: { ui: { type: 'button' } } })
      elements.push(el)
      items.push(el)
    }
  }
  const stickies = Array.from({ length: 16 }, (_, i) => item({ id: `n${i}`, type: 'sticky', x: r.int(-400, 2600), y: r.int(-300, 1500) }))
  items.push(...stickies)
  // far out, so most windows are a small part of the board (found through boardToFlow's grid, not a pass over all)
  items.push(...Array.from({ length: 30 }, (_, i) => item({ id: `far${i}`, type: 'sticky', x: r.int(-8000, 8000), y: r.int(-8000, 8000) })))
  // over too many grid cells: tested against every window
  items.push(item({ id: 'huge', type: 'text', x: -1000, y: 1250, w: 4500, h: 2000 }))
  let w = 0
  for (let i = 0; i < 45; i++) {
    const el = r.pick(elements)
    const to = r.pick(screens.filter((s) => s.id !== el.parent))
    items.push(item({ id: `w${w++}`, type: 'arrow', role: 'navigate', from: el.id, to: to.id, w: 0, h: 0 }))
  }
  const ends = [...stickies, ...elements]
  for (let i = 0; i < 25; i++) items.push(item({ id: `w${w++}`, type: 'arrow', from: r.pick(ends).id, to: r.pick(ends).id, w: 0, h: 0 }))
  // sides the person chose, and a domain-story activity: never planned
  items.push(item({ id: `w${w++}`, type: 'arrow', from: stickies[0].id, to: stickies[1].id, w: 0, h: 0, data: { fromSide: 'top', toSide: 'top' } }))
  items.push(item({ id: `w${w++}`, type: 'arrow', from: stickies[2].id, to: stickies[3].id, w: 0, h: 0, data: { ds: 'activity' } }))
  return { id: 'b', title: 't', kind: 'freeform', seq: 1, items: Object.fromEntries(items.map((i) => [i.id, i])) } as unknown as Board
}

/** Every planned wire's sides from scratch, as boardToFlow would plan them without a memo. */
function fresh(board: Board): Map<string, [string, string]> {
  const all = Object.values(board.items)
  const boxes = all.filter((it) => it.type !== 'arrow' && it.type !== 'comment' && !isContainer(it)).map((it) => ({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h }))
  const out = new Map<string, [string, string]>()
  for (const it of all) {
    if (it.type !== 'arrow' || !it.from || !it.to || !board.items[it.from] || !board.items[it.to] || it.data?.ds || it.data?.fromSide) continue
    const [a, b] = [board.items[it.from], board.items[it.to]].map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h }))
    const p = planSides(a, b, boxes.filter((c) => c.id !== it.from && c.id !== it.to))
    out.set(it.id, [p.fromSide, p.toSide])
  }
  return out
}

function assertSides(board: Board, what: string) {
  const edges = new Map(boardToFlow(board, new Set(), new Set()).edges.map((e) => [e.id, [e.sourceHandle, e.targetHandle]]))
  const want = fresh(board)
  assert.ok(want.size > 40, 'the board has planned wires')
  for (const [id, sides] of want) assert.deepEqual(edges.get(id), sides, `${what}: wire ${id}`)
}

const set = (board: Board, it: Item): Board => ({ ...board, items: { ...board.items, [it.id]: it } })
const without = (board: Board, id: string): Board => {
  const items = { ...board.items }
  delete items[id]
  return { ...board, items }
}

test('boardToFlow: after every edit each wire has the sides planSides gives it from scratch', () => {
  const r = rng(7)
  let board = synthetic(r)
  assertSides(board, 'first pass')
  assertSides(board, 'the same board again')
  let added = 0
  for (let step = 0; step < 300; step++) {
    const boxes = Object.values(board.items).filter((it) => it.type !== 'arrow')
    const it = r.pick(boxes)
    const kind = r.pick(['move', 'move', 'move', 'nudge', 'add', 'delete', 'resize', 'taller', 'reinsert', 'text', 'screen', 'container', 'nothing'] as const)
    if (kind === 'move') board = set(board, { ...it, x: it.x + r.int(-300, 300), y: it.y + r.int(-300, 300) })
    // a px or two: right at the edge of a window or of a box's shrink
    else if (kind === 'nudge') board = set(board, { ...it, [r.pick(['x', 'y'] as const)]: it[r.pick(['x', 'y'] as const)] + r.pick([-2, -1, 1, 2, 200, -200]) })
    else if (kind === 'add') board = set(board, item({ id: `add${added++}`, type: 'sticky', x: r.int(-400, 2600), y: r.int(-300, 1500), w: r.pick([40, 160]), h: r.pick([30, 110]) }))
    else if (kind === 'delete' && boxes.length > 60) board = without(board, it.id)
    // a box over many grid cells is tested against every window
    else if (kind === 'resize') board = set(board, { ...it, w: r.pick([0, 4, 40, 300, 3000]), h: r.pick([0, 4, 30, 200, 3000]) })
    // the same box, now last on the board: planSides' ties go to the first box, so the order matters
    else if (kind === 'taller') board = set(board, { ...it, h: it.h + r.pick([-2, 2, 40, 300]) })
    else if (kind === 'reinsert') board = set(without(board, it.id), it)
    else if (kind === 'text') board = set(board, { ...it, text: `edit ${step}` })
    else if (kind === 'screen') {
      const id = `s${r.int(0, 5)}`
      const [dx, dy] = [r.int(-150, 150), r.int(-150, 150)]
      for (const m of Object.values(board.items)) if (m.id === id || m.parent === id) board = set(board, { ...m, x: m.x + dx, y: m.y + dy })
    } else if (kind === 'container' && it.type === 'ui' && it.role !== 'screen') {
      const ui = (it.data?.ui ?? {}) as { container?: boolean }
      board = set(board, { ...it, data: { ...it.data, ui: { ...ui, container: !ui.container } } })
    }
    assertSides(board, `step ${step} (${kind} ${it.id})`)
  }
})

test('boardToFlow: a move far from a wire keeps its sides, a move into its way changes them', () => {
  const a = item({ id: 'a', type: 'sticky', x: 0, y: 0 })
  const b = item({ id: 'b', type: 'sticky', x: 500, y: 0 })
  const c = item({ id: 'c', type: 'sticky', x: 3000, y: 3000 })
  const w = item({ id: 'w', type: 'arrow', from: 'a', to: 'b', w: 0, h: 0 })
  let board = { id: 'b', title: 't', kind: 'freeform', seq: 1, items: { a, b, c, w } } as unknown as Board
  const sides = () => {
    const e = boardToFlow(board, new Set(), new Set()).edges.find((x) => x.id === 'w')!
    return [e.sourceHandle, e.targetHandle]
  }
  assert.deepEqual(sides(), ['right', 'left'])
  board = set(board, { ...c, x: 3100 })
  assert.deepEqual(sides(), ['right', 'left'])
  // a wall between a and b, from far above to far below: the facing route crosses it, so the wire takes other sides
  board = set(board, { ...c, x: 250, y: -150, w: 60, h: 420 })
  const p = planSides({ x: 0, y: 0, w: 160, h: 110 }, { x: 500, y: 0, w: 160, h: 110 }, [{ x: 250, y: -150, w: 60, h: 420 }])
  assert.notDeepEqual([p.fromSide, p.toSide], ['right', 'left'])
  assert.deepEqual(sides(), [p.fromSide, p.toSide])
})

test('planWindows: the boxes in the window around two boxes, in board order, as a pass over all of them finds', () => {
  const r = rng(8)
  const odd = [NaN, Infinity, -Infinity, 3e8, -3e8, 1e300]
  for (let round = 0; round < 60; round++) {
    const spread = r.pick([500, 4000, 40000])
    const all: Array<Box & { id: string }> = Array.from({ length: r.int(0, 400) }, (_, i) => ({
      id: `c${i}`,
      x: r.int(-spread, spread),
      y: r.int(-spread, spread),
      // mostly small, some over many cells, some of no size or a negative one
      w: r.pick([0, 10, 120, 255, 256, 257, 600, 5000, -40]),
      h: r.pick([0, 10, 60, 256, 3000, -40]),
    }))
    for (const c of all) if (r.next() < 0.02) c[r.pick(['x', 'y', 'w', 'h'] as const)] = r.pick(odd)
    // boxes right on the cell lines
    for (const c of all) if (r.next() < 0.2) c.x = Math.round(c.x / 256) * 256 + r.pick([0, -1, 1])
    const find = planWindows(all)
    for (let q = 0; q < 50; q++) {
      const end = (): Box => (all.length && r.next() < 0.5 ? { ...r.pick(all) } : { x: r.int(-spread, spread), y: r.int(-spread, spread), w: r.pick([0, 40, 160, 2000]), h: r.pick([0, 30, 110]) })
      const [a, b] = [end(), end()]
      // a window edge on a cell line, too
      if (r.next() < 0.2) a.x = Math.round(a.x / 256) * 256 + 200 + r.pick([0, -1, 1])
      const { has } = planWindow(a, b)
      assert.deepEqual(find(a, b).map((c) => c.id), all.filter((c) => has(c)).map((c) => c.id), JSON.stringify({ a, b }))
    }
  }
})
