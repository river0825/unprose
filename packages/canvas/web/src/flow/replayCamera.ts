// Where the replay of a domain story looks (docs/diagrams.md §6b "Replay"), the pure half: the zoom the story is
// told at, and per step where the view goes — or that it stays. Fitting the whole story made the names of a big
// story too small to read (a 3000 px story fits a laptop screen at ~0.4, its 13 px names at ~5 px), so the whole
// story is shown only when it can be read that way; otherwise the view follows the sentences at a zoom where the
// text can be read. Pure: rectangles in, a viewport out; ReplayBar.tsx measures and moves.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The part of the canvas pane the story is seen in (below the replay bar, inside a margin), in pane pixels. */
export interface Area {
  left: number
  top: number
  width: number
  height: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** Below this zoom the names (13 px) and verbs (12 px) of the pictograms come out under ~10 px: too small to read. */
export const READABLE_ZOOM = 0.8
/** The zoom a story is told at when nothing asks for less: the text at its own size. */
export const TELL_ZOOM = 1
/** Room around the whole story, and around a sentence, in screen pixels (inside the area's own margin). */
const STORY_PAD = 24
const STEP_PAD = 48

/** The zoom at which `r`, with `pad` screen pixels around it, just fits `area`. */
export function fitZoom(r: Rect, area: Area, pad: number): number {
  return Math.min(Math.max(1, area.width - 2 * pad) / Math.max(1, r.width), Math.max(1, area.height - 2 * pad) / Math.max(1, r.height))
}

/** The viewport that shows `r` in the middle of `area` at `zoom`. */
export function centred(r: Rect, area: Area, zoom: number): Viewport {
  return {
    x: area.left + (area.width - r.width * zoom) / 2 - r.x * zoom,
    y: area.top + (area.height - r.height * zoom) / 2 - r.y * zoom,
    zoom,
  }
}

/** True when all of `r` is inside `area` at viewport `v`. */
export function inView(r: Rect, v: Viewport, area: Area): boolean {
  const left = r.x * v.zoom + v.x
  const top = r.y * v.zoom + v.y
  return left >= area.left && top >= area.top && left + r.width * v.zoom <= area.left + area.width && top + r.height * v.zoom <= area.top + area.height
}

/**
 * The zoom the story is told at, and whether it starts on the whole story: the whole story when it can be read at
 * the zoom that fits it (as Egon.io shows it), else sentence by sentence at TELL_ZOOM.
 */
export function tellingZoom(story: Rect | undefined, area: Area): { zoom: number; whole: boolean } {
  const all = story ? fitZoom(story, area, STORY_PAD) : 0
  return story && all >= READABLE_ZOOM ? { zoom: Math.min(all, TELL_ZOOM), whole: true } : { zoom: TELL_ZOOM, whole: false }
}

/**
 * Where the view goes for a sentence whose pictograms take `r`, from viewport `v`; null to stay. It stays while the
 * sentence is in view and readable (or as small as the person chose), so the zoom does not pump between steps.
 * Else it centres the sentence at the telling zoom — less only when the sentence would not fit, so a long one is
 * still seen whole, and the next one comes back to the telling zoom.
 */
export function stepView(r: Rect, v: Viewport, area: Area, tell: number): Viewport | null {
  const zoom = Math.min(tell, fitZoom(r, area, STEP_PAD))
  if (inView(r, v, area) && v.zoom >= Math.min(zoom, READABLE_ZOOM) - 1e-3) return null
  return centred(r, area, zoom)
}

/** The telling zoom after the view was last set to `set` and is now at `now`: a zoom the person made is theirs to keep. */
export function keptZoom(tell: number, set: number | undefined, now: number): number {
  return set !== undefined && Math.abs(now - set) > 0.005 ? now : tell
}
