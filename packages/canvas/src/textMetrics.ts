// Text metrics close to what the web's stylesheet draws (web/src/styles.css, kanban.css, flow/font.ts), without a
// browser: the font size, line height and padding of each item type, an estimate of how wide a line is in IBM Plex
// Sans, and greedy wrapping like `white-space: pre-wrap; overflow-wrap: anywhere`. Used by the server-side
// snapshot (to draw the text) and the layout check (to say a text is likely clipped). Estimates, not pixels.
import type { Item } from './model.js'

export interface TextBox {
  /** font size in px */
  font: number
  /** line height in px */
  lineHeight: number
  weight: number
  padTop: number
  padRight: number
  padBottom: number
  padLeft: number
  /** text is centred (actors, buttons) */
  center?: boolean
  /** the text is one line that never wraps (frame / lane / column titles) */
  nowrap?: boolean
}

/** The stylesheet's default size for an item (the same rule as web/src/flow/font.ts). */
export function defaultFont(it: Pick<Item, 'type' | 'role'>): number {
  if (it.type === 'text') return it.role === 'title' || it.role === 'heading' ? 22 : it.role === 'annotation' ? 12.5 : 15
  if (it.type === 'sticky' && it.role === 'actor') return 12.5
  if (it.type === 'card' && it.role === 'card') return 13.5
  return 13
}

export const fontOf = (it: Pick<Item, 'type' | 'role' | 'fontSize'>): number => it.fontSize ?? defaultFont(it)

/** How the web lays out an item's text (padding from styles.css). */
export function textBoxOf(it: Pick<Item, 'type' | 'role' | 'fontSize'>): TextBox {
  const font = fontOf(it)
  const lh = (k: number) => Math.round(font * k * 10) / 10
  switch (it.type) {
    case 'sticky':
      return { font, lineHeight: lh(1.3), weight: 500, padTop: 8, padRight: 10, padBottom: 14, padLeft: 10, center: it.role === 'actor' }
    case 'card':
      if (it.role === 'card') return { font, lineHeight: lh(1.3), weight: 500, padTop: 10, padRight: 12, padBottom: 10, padLeft: 12 }
      return { font, lineHeight: lh(1.3), weight: 500, padTop: 8, padRight: 9, padBottom: 14, padLeft: 11 }
    case 'text':
      // a domain-story annotation (inspector.css .ds-annotation): 4 px / 8 px padding inside a 2 px bracket on the left, top and bottom
      if (it.role === 'annotation') return { font, lineHeight: lh(1.5), weight: 400, padTop: 6, padRight: 8, padBottom: 6, padLeft: 10 }
      return { font, lineHeight: lh(1.5), weight: it.role === 'title' || it.role === 'heading' ? 600 : 400, padTop: 4, padRight: 6, padBottom: 4, padLeft: 6 }
    case 'frame':
    case 'lane':
      return { font: 13.5, lineHeight: 18, weight: 600, padTop: 8, padRight: 10, padBottom: 0, padLeft: 10, nowrap: true }
    case 'wireframe':
      if (it.role === 'heading') return { font: 17, lineHeight: 22, weight: 600, padTop: 2, padRight: 4, padBottom: 2, padLeft: 4 }
      if (it.role === 'button') return { font: 13, lineHeight: 17, weight: 500, padTop: 0, padRight: 6, padBottom: 0, padLeft: 6, center: true }
      return { font: 13, lineHeight: 19.5, weight: 400, padTop: 2, padRight: 8, padBottom: 2, padLeft: 8 }
    default:
      return { font, lineHeight: lh(1.4), weight: 400, padTop: 4, padRight: 6, padBottom: 4, padLeft: 6 }
  }
}

/** East Asian wide characters (CJK, kana, hangul, full-width forms, emoji): about 1em wide. */
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u

/** Width of one character in em, for IBM Plex Sans (an average per class; bold is a little wider). */
function charEm(ch: string): number {
  if (WIDE.test(ch)) return 1
  if (ch === ' ') return 0.26
  if (/[iljtfrI.,:;'|!()[\]{}`]/.test(ch)) return 0.3
  if (/[mwMW@%]/.test(ch)) return 0.85
  if (/[A-Z]/.test(ch)) return 0.64
  if (/[0-9]/.test(ch)) return 0.56
  return 0.53
}

/** Estimated width of a line of text in px. */
export function measure(text: string, font: number, weight = 400): number {
  let em = 0
  for (const ch of text) em += charEm(ch)
  return em * font * (weight >= 600 ? 1.05 : weight >= 500 ? 1.02 : 1)
}

/** Break `text` into lines no wider than `width` px (pre-wrap: newlines kept; words wrap; long words and CJK break anywhere). */
export function wrap(text: string, width: number, font: number, weight = 400): string[] {
  const out: string[] = []
  const w = Math.max(width, font) // at least one character per line
  for (const para of text.replace(/\r\n/g, '\n').split('\n')) {
    // tokens: a run of non-space Latin, a single wide character, or a run of spaces
    const tokens = para.match(/[ \t]+|[^\sᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]+|./gu) ?? ['']
    let line = ''
    for (const tok of tokens) {
      const next = line + tok
      if (measure(next.trimEnd(), font, weight) <= w || line === '') {
        if (measure(tok, font, weight) > w && line === '') {
          // a word longer than the line: break it character by character
          for (const ch of tok) {
            if (measure(line + ch, font, weight) > w && line) (out.push(line), (line = ''))
            line += ch
          }
          continue
        }
        line = next
        continue
      }
      out.push(line.trimEnd())
      line = /^\s+$/.test(tok) ? '' : tok
      if (measure(line, font, weight) > w) {
        const long = line
        line = ''
        for (const ch of long) {
          if (measure(line + ch, font, weight) > w && line) (out.push(line), (line = ''))
          line += ch
        }
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

/** How an item's text fits its box: the lines it wraps to, how many fit, and whether some are cut off. */
export function fitText(it: Pick<Item, 'type' | 'role' | 'fontSize' | 'w' | 'h' | 'text'>): { box: TextBox; lines: string[]; fits: number; clipped: boolean; needH: number; innerW: number } {
  const box = textBoxOf(it)
  const innerW = Math.max(1, it.w - box.padLeft - box.padRight)
  const text = it.text ?? ''
  const lines = box.nowrap ? [text.split('\n')[0] ?? ''] : wrap(text, innerW, box.font, box.weight)
  const innerH = Math.max(0, it.h - box.padTop - box.padBottom)
  // a line counts as shown when most of its glyphs (60% of the font size, centred in the line box) are visible
  const glyph = (box.lineHeight - box.font) / 2 + 0.6 * box.font
  const fits = innerH + 0.5 < glyph ? 0 : Math.floor((innerH + 0.5 - glyph) / box.lineHeight) + 1
  const needH = Math.ceil(lines.length * box.lineHeight + box.padTop + box.padBottom)
  const clipped = text.trim() !== '' && (box.nowrap ? measure(lines[0], box.font, box.weight) > innerW + 1 : lines.length > fits)
  return { box, lines, fits, clipped, needH, innerW }
}

/**
 * The box a text needs: as wide as its longest line (between `minW` and `maxW`), wrapping within `maxW`, and as tall as
 * its wrapped lines (at least `minH`). For items sized from their text, e.g. a domain-story annotation.
 */
export function sizeToText(it: Pick<Item, 'type' | 'role' | 'fontSize'>, text: string, o: { minW: number; maxW: number; minH?: number }): { w: number; h: number } {
  const box = textBoxOf(it)
  const padX = box.padLeft + box.padRight
  const longest = Math.max(0, ...text.replace(/\r\n/g, '\n').split('\n').map((l) => measure(l, box.font, box.weight)))
  // a little slack: the page's font is a bit wider or narrower than the estimate
  const w = Math.ceil(Math.min(o.maxW, Math.max(o.minW, longest + padX + 6)))
  const { needH } = fitText({ ...it, w, h: 0, text })
  return { w, h: Math.max(o.minH ?? 0, needH + 4) }
}
