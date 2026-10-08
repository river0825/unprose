// The file side of a UI mock proposal (docs/diagrams.md §6c): the design file as it would read with the
// proposal applied — new words, a removed element, a new element. Edits are made in the text itself, so
// comments, flow style and every other line stay exactly as they are; only a shape we cannot edit in place
// falls back to the yaml library (which keeps comments but may reflow the file). Its own module so the yaml
// parser is only loaded when a proposal is shown.
import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml'
import { locateUi, normalizeUiMock, type UiMockContent, type UiModel } from '../../../src/diagrams/uiMock'
import type { UiAddPending, UiPath, UiPending, UiTextPending } from './uiProposal'

/** How a string is written in YAML: plain when that reads back the same, else double-quoted. */
export function yamlScalar(s: string): string {
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} _.,'()/&+-]*$/u.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^[-+]?(\d|\.\d)/.test(s) && !/\s$/.test(s) && !/: |\s#/.test(s)
  return plain ? s : JSON.stringify(s)
}

const splice = (file: string, start: number, end: number, text: string) => file.slice(0, start) + text + file.slice(end)
const lineStart = (file: string, pos: number) => file.lastIndexOf('\n', pos - 1) + 1
/** The position just after the line `end` finishes on (its newline included). */
function lineEndAfter(file: string, end: number): number {
  if (end > 0 && file[end - 1] === '\n') return end
  const n = file.indexOf('\n', end)
  return n < 0 ? file.length : n + 1
}
/** The column of the `- ` that starts a block sequence item, or undefined when the item does not start its line that way. */
function dashColumn(file: string, nodeStart: number): number | undefined {
  const ls = lineStart(file, nodeStart)
  const lead = file.slice(ls, nodeStart)
  return /^ *- +$/.test(lead) ? lead.indexOf('-') : undefined
}

const parse = (file: string) => parseDocument(file, { keepSourceTokens: true })

/**
 * The file with the element's words changed. The scalar is replaced where it stands (comments, flow style
 * and the rest of the file stay as they are); an element with no such key yet gets one.
 */
export function applyUiText(file: string, p: { path: UiPath; key: string | number; after: { text: string } }): string {
  const doc = parse(file)
  const node = doc.getIn([...p.path, p.key], true)
  if (isScalar(node) && node.range) {
    const [start, end] = node.range
    // a number stays a number when the new words are one (a table cell `42` → `43`)
    const text = typeof node.value === 'number' && /^-?\d+(\.\d+)?$/.test(p.after.text) ? p.after.text : yamlScalar(p.after.text)
    return splice(file, start, end, text)
  }
  doc.setIn([...p.path, p.key], p.after.text)
  return String(doc)
}

/** A list item's words: the item itself when it is a plain string, else its `text`. */
function applyItemText(file: string, elPath: UiPath, i: number, text: string): string {
  const node = parse(file).getIn([...elPath, 'items', i], true)
  if (isMap(node)) return applyUiText(file, { path: [...elPath, 'items', i], key: 'text', after: { text } })
  return applyUiText(file, { path: [...elPath, 'items'], key: i, after: { text } })
}

/** A table cell: in `rows[r]` when the row is a list of cells, in `rows[r].cells` when it carries a `note`. */
function applyRowText(file: string, elPath: UiPath, r: number, c: number, after: { text: string }): string {
  const node = parse(file).getIn([...elPath, 'rows', r], true)
  if (isMap(node)) return applyUiText(file, { path: [...elPath, 'rows', r, 'cells'], key: c, after })
  return applyUiText(file, { path: [...elPath, 'rows', r], key: c, after })
}

/** The new element as one line: `{ type: button, id: new-button, text: New button }`. */
export function uiNodeLine(node: UiAddPending['node']): string {
  return `{ type: ${node.type}, id: ${yamlScalar(node.id)}, text: ${yamlScalar(node.text)} }`
}

/** The file with `line` (a flow mapping) inserted into the list at `listPath`, at `index` (default: the end). */
export function insertUiNode(file: string, listPath: UiPath, line: string, index?: number): string {
  const doc = parse(file)
  const seq = doc.getIn(listPath, true)
  if (isSeq(seq) && seq.range) {
    const items = seq.items as Array<{ range?: [number, number, number] }>
    const i = index === undefined ? items.length : Math.max(0, Math.min(index, items.length))
    if (seq.flow) {
      if (!items.length) {
        const open = file.indexOf('[', seq.range[0])
        if (open >= 0) return splice(file, open + 1, open + 1, line)
      } else if (i === 0 && items[0].range) return splice(file, items[0].range[0], items[0].range[0], `${line}, `)
      else if (items[i - 1]?.range) return splice(file, items[i - 1].range![1], items[i - 1].range![1], `, ${line}`)
    } else if (items.length) {
      const ref = items[Math.min(i, items.length - 1)]
      const col = ref.range ? dashColumn(file, ref.range[0]) : undefined
      if (ref.range && col !== undefined) {
        const entry = `${' '.repeat(col)}- ${line}\n`
        if (i < items.length) {
          const ls = lineStart(file, ref.range[0])
          return splice(file, ls, ls, entry)
        }
        const at = lineEndAfter(file, ref.range[1])
        return splice(file, at, at, `${at === file.length && !file.endsWith('\n') ? '\n' : ''}${entry}`)
      }
    }
  } else if (seq === undefined || seq === null) {
    // no list yet: the parent gets one
    const parent = doc.getIn(listPath.slice(0, -1), true)
    const key = String(listPath[listPath.length - 1])
    if (isMap(parent) && parent.range && !parent.items.some((p) => isScalar(p.key) && p.key.value === key)) {
      if (parent.flow) {
        const close = file.lastIndexOf('}', parent.range[1])
        if (close > parent.range[0]) {
          let at = close
          while (at > 0 && /\s/.test(file[at - 1])) at--
          return splice(file, at, at, `, ${key}: [${line}]`)
        }
      } else {
        const first = parent.items[0]?.key as { range?: [number, number, number] } | undefined
        if (first?.range) {
          const pad = ' '.repeat(first.range[0] - lineStart(file, first.range[0]))
          const at = lineEndAfter(file, parent.range[1])
          return splice(file, at, at, `${at === file.length && !file.endsWith('\n') ? '\n' : ''}${pad}${key}:\n${pad}  - ${line}\n`)
        }
      }
    }
  }
  // a shape we do not edit in place: let the yaml library write it
  return fallback(doc, (d) => {
    const node = d.createNode(parseDocument(line).toJS())
    const list = d.getIn(listPath)
    if (isSeq(list)) list.items.splice(index ?? list.items.length, 0, node)
    else d.setIn(listPath, d.createNode([parseDocument(line).toJS()]))
  })
}

/** The file without the list item at `path` (its whole lines); an emptied list reads `[]`. */
export function removeUiNode(file: string, path: UiPath): string {
  const doc = parse(file)
  const listPath = path.slice(0, -1)
  const i = Number(path[path.length - 1])
  const seq = doc.getIn(listPath, true)
  if (isSeq(seq) && seq.range) {
    const items = seq.items as Array<{ range?: [number, number, number] }>
    const it = items[i]
    if (it?.range) {
      if (seq.flow) {
        if (items.length === 1) return splice(file, it.range[0], it.range[1], '')
        if (i > 0 && items[i - 1].range) return splice(file, items[i - 1].range![1], it.range[1], '')
        if (items[1]?.range) return splice(file, it.range[0], items[1].range[0], '')
      } else if (dashColumn(file, it.range[0]) !== undefined) {
        const ls = lineStart(file, it.range[0])
        const le = lineEndAfter(file, it.range[1])
        if (items.length > 1) return splice(file, ls, le, '')
        // the last one: `children:` would be left empty (null) — write `children: []`
        const parent = doc.getIn(listPath.slice(0, -1), true)
        const pair = isMap(parent) ? parent.items.find((p) => isScalar(p.key) && p.key.value === listPath[listPath.length - 1]) : undefined
        const keyEnd = pair && isScalar(pair.key) ? pair.key.range?.[1] : undefined
        const colon = keyEnd !== undefined ? file.indexOf(':', keyEnd) : -1
        if (colon >= 0 && colon < ls) return splice(splice(file, ls, le, ''), colon + 1, colon + 1, ' []')
      }
    }
  }
  return fallback(doc, (d) => {
    d.deleteIn(path)
  })
}

function fallback(doc: Document, edit: (d: Document) => void): string {
  edit(doc)
  return String(doc)
}

/** The file read as a UI mock (the ids the board uses), or undefined when it does not parse. */
function modelOf(file: string): UiModel | undefined {
  try {
    return normalizeUiMock(parseDocument(file).toJS() as UiMockContent)
  } catch {
    return undefined
  }
}

/**
 * The file with a proposal applied. The element is found by its board id (`<screen>/<element>`) in the file
 * as it is now — so a proposal made before another one was applied still lands on the right element — and by
 * the place recorded with the proposal when the file cannot be read that way.
 */
export function applyUiPending(file: string, p: UiPending, element?: string): string {
  const model = modelOf(file)
  const where = (ref: string | undefined, recorded: UiPath) => (ref && model ? locateUi(model, ref) : undefined) ?? recorded
  if (p.kind === 'text') return applyTextPending(file, p, where(element, p.path))
  if (p.kind === 'remove') return removeUiNode(file, where(element, p.path))
  const line = uiNodeLine(p.node)
  if (p.after) {
    const at = where(p.after.element, p.after.path)
    return insertUiNode(file, at.slice(0, -1), line, Number(at[at.length - 1]) + 1)
  }
  const parent = p.parent ? where(p.parent.element, p.parent.path) : p.path.slice(0, -2)
  return insertUiNode(file, [...parent, parent.length === 2 && parent[0] === 'screens' ? 'body' : 'children'], line)
}

function applyTextPending(file: string, p: UiTextPending, path: UiPath): string {
  if (p.sub?.[0] === 'rows') return applyRowText(file, path, Number(p.sub[1]), Number(p.sub[2]), p.after)
  if (p.sub?.[0] === 'items') return applyItemText(file, path, Number(p.sub[1]), p.after.text)
  return applyUiText(file, { path, key: p.key, after: p.after })
}
