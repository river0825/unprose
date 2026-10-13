// "Clickable" on a UI mock (docs/diagrams.md §6c), the pure half: which elements a click leads from, the tag each
// one carries (`→ <screen>`) and the side panel's list of them, by screen. Where a click goes is Play's answer
// (diagrams/uiPlay.ts buildPlay: a `goto`, a `flows` arrow drawn from the element, a card that leads somewhere) — never
// worked out again here, so the highlight and Play cannot disagree. Only the outermost element of a chain is tagged:
// what a card holds follows the card, so the card says where it goes and its badge and title do not repeat it.
// Pure, so node --test covers it.
import { diagramSpecOf, type Board, type Item } from '../../../src/model'
import { buildPlay, type PlayModel, type PlayScreen } from './uiPlay'

/** The tag on an element that leads somewhere. */
export interface ClickTag {
  /** the screen item a click leads to, and its name as drawn */
  to: string
  name: string
  /** what the tag reads: `→ <name>` */
  text: string
}

/** One row of the panel's list. */
export interface ClickRow {
  id: string
  /** the element's words (first line), else its id in the file, else its type */
  label: string
  to: string
  toName: string
}

export interface ClickGroup {
  screen: PlayScreen
  rows: ClickRow[]
}

const uiType = (it: Item | undefined) => (it?.type === 'ui' ? (it.data?.ui as { type?: string } | undefined)?.type : undefined)

const MAX_TAG = 24

/** The tag's words for a screen: its name as drawn (buildPlay falls back to its id), a long one cut short. */
export const tagText = (screen: PlayScreen) => `→ ${screen.name.length > MAX_TAG ? `${screen.name.slice(0, MAX_TAG - 1).trimEnd()}…` : screen.name}`

/**
 * The elements of one UI mock that carry a tag, by item id. An element that leads somewhere is tagged unless the
 * nearest element around it that leads somewhere leads to the same screen — then that one carries it. A goto to a
 * screen that does not exist leads nowhere (buildPlay has no entry), so it gets nothing.
 */
export function clickTags(board: Board, model: PlayModel): Map<string, ClickTag> {
  const names = new Map(model.screens.map((s) => [s.id, s]))
  const out = new Map<string, ClickTag>()
  for (const [id, to] of model.gotoOf) {
    const screen = names.get(to)
    if (!screen) continue
    let outer: string | undefined
    const seen = new Set([id])
    for (let p = board.items[board.items[id]?.parent ?? '']; p && uiType(p) && uiType(p) !== 'screen' && !seen.has(p.id); p = board.items[p.parent ?? '']) {
      seen.add(p.id)
      outer = model.gotoOf.get(p.id)
      if (outer) break
    }
    if (outer !== to) out.set(id, { to, name: screen.name, text: tagText(screen) })
  }
  return out
}

/** The UI-mock frames of the board (their ids), in board order. */
export function uiMockFrames(board: Board): string[] {
  return Object.values(board.items)
    .filter((it) => diagramSpecOf(it)?.kind === 'ui-mock')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.y - b.y || a.x - b.x)
    .map((it) => it.id)
}

/** Every tag on the board: the Clickable switch applies to every UI-mock frame at once. */
export function boardClickTags(board: Board): Map<string, ClickTag> {
  const out = new Map<string, ClickTag>()
  for (const frame of uiMockFrames(board)) for (const [id, tag] of clickTags(board, buildPlay(board, frame))) out.set(id, tag)
  return out
}

const MAX_LABEL = 48

/** How the panel names an element: its words, else its id in the file (`<screen>/<element>` → `<element>`), else its type. */
function labelOf(it: Item): string {
  const words = (it.text ?? '').split('\n')[0].trim()
  const element = typeof it.data?.element === 'string' ? it.data.element.split('/').pop() : undefined
  const t = words || element || uiType(it) || it.id
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1)}…` : t
}

/**
 * The panel's list: every tagged element, by screen in the frame's order, each screen's elements in reading order
 * (top to bottom, then left to right — a card before what it holds). Screens with nothing to click are left out.
 */
export function clickList(board: Board, model: PlayModel, tags: Map<string, ClickTag> = clickTags(board, model)): ClickGroup[] {
  const byScreen = new Map<string, Item[]>()
  for (const id of tags.keys()) {
    const it = board.items[id]
    const screen = model.screenOf.get(id)
    if (!it || !screen) continue
    const list = byScreen.get(screen) ?? []
    list.push(it)
    byScreen.set(screen, list)
  }
  const groups: ClickGroup[] = []
  for (const screen of model.screens) {
    const items = byScreen.get(screen.id)
    if (!items) continue
    items.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    groups.push({
      screen,
      rows: items.map((it) => {
        const t = tags.get(it.id)!
        return { id: it.id, label: labelOf(it), to: t.to, toName: t.name }
      }),
    })
  }
  return groups
}
