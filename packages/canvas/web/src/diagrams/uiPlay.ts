// Playing a UI mock (docs/diagrams.md §6c "Play"), the pure half: which screens a UI-mock frame holds, where a
// click on an element leads (its `goto`, or a `flows` arrow drawn from it), and what the person has done so far
// — the screen they are on, the way back, the select that is open, what they typed, what they toggled, which
// tab they picked. Nothing here touches the board: a board and a frame in, a model out; the state is this
// viewer's alone and the web only applies it. Pure, so node --test covers it.
import type { Board, Item } from '../../../src/model'

export interface PlayScreen {
  /** the screen's board item id */
  id: string
  /** the screen id in the file (`data.element`) */
  element: string
  name: string
}

export interface PlayModel {
  frameId: string
  /** the frame's screens in board order (the first is where play starts) */
  screens: PlayScreen[]
  /** element item id → the screen item id a click leads to */
  gotoOf: Map<string, string>
  /** every item of the frame (screens and elements) → the screen item it belongs to */
  screenOf: Map<string, string>
  /** navigate arrows of the frame */
  arrows: string[]
}

export interface PlayState {
  frameId: string
  /** the screen item on view */
  screen: string
  /** the screens left behind, oldest first (Back pops the last) */
  history: string[]
  /** the select whose options are open */
  open?: string
  /** input / textarea / search item → what was typed */
  typed: Record<string, string>
  /** select item → the option picked */
  picked: Record<string, string>
  /** checkbox / radio / toggle item → on or off */
  checked: Record<string, boolean>
  /** tabs item → the active tab's index */
  tab: Record<string, number>
}

const uiOf = (it: Item | undefined) => (it?.type === 'ui' ? (it.data?.ui as { type?: string; goto?: string } | undefined) : undefined)
const elementOf = (it: Item | undefined) => (typeof it?.data?.element === 'string' ? it.data.element : undefined)

/** The screen (item id) an item is or sits in, walking up through cards and sections; undefined outside a screen. */
function screenItemOf(board: Board, it: Item): string | undefined {
  let cur: Item | undefined = it
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (uiOf(cur)?.type === 'screen') return cur.id
    cur = cur.parent ? board.items[cur.parent] : undefined
  }
  return undefined
}

function inFrame(board: Board, it: Item, frameId: string): boolean {
  let p = it.parent
  const seen = new Set<string>()
  while (p && !seen.has(p)) {
    if (p === frameId) return true
    seen.add(p)
    p = board.items[p]?.parent
  }
  return false
}

/** The screens and goto links of the UI mock in frame `frameId`. */
export function buildPlay(board: Board, frameId: string): PlayModel {
  const all = Object.values(board.items)
  const members = all.filter((it) => it.type === 'ui' && inFrame(board, it, frameId))
  const screens: PlayScreen[] = members
    .filter((it) => uiOf(it)?.type === 'screen')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.x - b.x)
    .map((it) => ({ id: it.id, element: elementOf(it) ?? it.id, name: (it.text ?? '').split('\n')[0] || elementOf(it) || it.id }))
  const byElement = new Map(screens.map((s) => [s.element, s.id]))
  const screenOf = new Map<string, string>()
  for (const it of members) {
    const s = screenItemOf(board, it)
    if (s) screenOf.set(it.id, s)
  }
  // a comment about an element (a `note`, a thread) belongs with that element's screen; a reply follows its root
  for (const c of all) {
    if (c.type !== 'comment') continue
    let t: Item | undefined = c.target ? board.items[c.target] : undefined
    const seen = new Set<string>()
    while (t?.type === 'comment' && !seen.has(t.id)) {
      seen.add(t.id)
      t = t.target ? board.items[t.target] : undefined
    }
    const s = t && screenOf.get(t.id)
    if (s) screenOf.set(c.id, s)
  }
  const gotoOf = new Map<string, string>()
  for (const it of members) {
    const to = uiOf(it)?.goto
    const target = to ? byElement.get(to) : undefined
    if (target && uiOf(it)?.type !== 'screen') gotoOf.set(it.id, target)
  }
  // a `flows` entry drawn from an element (not from a whole screen) leads there too, unless the element says otherwise
  const arrows: string[] = []
  for (const a of all) {
    if (a.type !== 'arrow' || a.role !== 'navigate' || !a.from || !a.to) continue
    if (!screenOf.has(a.from) || !byElement.has(elementOf(board.items[a.to]) ?? '')) continue
    arrows.push(a.id)
    if (uiOf(board.items[a.from])?.type !== 'screen' && !gotoOf.has(a.from)) gotoOf.set(a.from, a.to)
  }
  // a card (section, navbar) that leads somewhere takes the click anywhere on it: what it holds inherits the goto,
  // except an element with a job of its own (a field, a select, a toggle, tabs — they are operated, not followed)
  for (const it of members) {
    if (gotoOf.has(it.id) || OPERATED.has(uiOf(it)?.type ?? '')) continue
    for (let p = it.parent ? board.items[it.parent] : undefined; p && uiOf(p) && uiOf(p)?.type !== 'screen'; p = p.parent ? board.items[p.parent] : undefined) {
      const to = gotoOf.get(p.id)
      if (to) {
        gotoOf.set(it.id, to)
        break
      }
    }
  }
  return { frameId, screens, gotoOf, screenOf, arrows }
}

/** Elements that do something of their own while playing, so a click on them never follows their container's goto. */
const OPERATED = new Set(['input', 'textarea', 'select', 'search', 'checkbox', 'radio', 'toggle', 'tabs'])

/** True when the frame holds a UI mock with at least one screen. */
export function canPlay(board: Board, frameId: string): boolean {
  return buildPlay(board, frameId).screens.length > 0
}

/** Play asked for on a frame, before the page has looked at the board: no screen yet (`reconcilePlay` picks the first). */
export function emptyPlay(frameId: string): PlayState {
  return { frameId, screen: '', history: [], typed: {}, picked: {}, checked: {}, tab: {} }
}

/** Where play starts: the first screen, untouched. */
export function startPlay(model: PlayModel): PlayState | undefined {
  const first = model.screens[0]
  if (!first) return undefined
  return { ...emptyPlay(model.frameId), screen: first.id }
}

/** The screen a click on `id` leads to, if any. */
export function gotoTarget(model: PlayModel, id: string): string | undefined {
  return model.gotoOf.get(id)
}

/** Follow a goto: the current screen goes on the way back; nothing happens when already there. */
export function playGoto(s: PlayState, screen: string): PlayState {
  if (screen === s.screen) return { ...s, open: undefined }
  return { ...s, screen, history: [...s.history, s.screen], open: undefined }
}

/** Back: to the screen left last; at the start it does nothing. */
export function playBack(s: PlayState): PlayState {
  if (!s.history.length) return s
  return { ...s, screen: s.history[s.history.length - 1], history: s.history.slice(0, -1), open: undefined }
}

/** Restart: the first screen, everything typed, picked and toggled forgotten. */
export function playRestart(model: PlayModel, s: PlayState): PlayState {
  return startPlay(model) ?? s
}

/** Open a select's options (closing any other), or close them. */
export function playOpen(s: PlayState, id: string | undefined): PlayState {
  return { ...s, open: s.open === id ? undefined : id }
}

/** Pick a select's option: it closes. */
export function playPick(s: PlayState, id: string, option: string): PlayState {
  return { ...s, picked: { ...s.picked, [id]: option }, open: undefined }
}

export function playType(s: PlayState, id: string, text: string): PlayState {
  return { ...s, typed: { ...s.typed, [id]: text } }
}

/** Toggle a checkbox / toggle; `was` is what the file says when it has not been touched yet. */
export function playToggle(s: PlayState, id: string, was: boolean): PlayState {
  const now = id in s.checked ? s.checked[id] : was
  return { ...s, checked: { ...s.checked, [id]: !now } }
}

export function playTab(s: PlayState, id: string, index: number): PlayState {
  return { ...s, tab: { ...s.tab, [id]: index } }
}

/** A redraw can lose the screen on view (or the whole mock): back to one that exists, else nothing to play. */
export function reconcilePlay(model: PlayModel, s: PlayState): PlayState | undefined {
  const ids = new Set(model.screens.map((x) => x.id))
  if (!ids.size) return undefined
  const history = s.history.filter((h) => ids.has(h))
  if (ids.has(s.screen)) return history.length === s.history.length ? s : { ...s, history }
  const back = history.pop()
  return { ...s, screen: back ?? model.screens[0].id, history, open: undefined }
}

export type PlayStatus = 'current' | 'other'

/** Every item of the frame: on the screen on view (`current`) or on another screen (`other`); arrows are `other`. */
export function playStatuses(model: PlayModel, s: PlayState): Map<string, PlayStatus> {
  const out = new Map<string, PlayStatus>()
  for (const [id, screen] of model.screenOf) out.set(id, screen === s.screen ? 'current' : 'other')
  for (const a of model.arrows) out.set(a, 'other')
  return out
}

/** The screen on view, by name — what the Play bar shows. */
export function currentScreen(model: PlayModel, s: PlayState): PlayScreen | undefined {
  return model.screens.find((x) => x.id === s.screen)
}
