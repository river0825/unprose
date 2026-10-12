// The file edit a draft annotation proposes (docs/canvas.md → "Annotations"): the design file with one more
// `annotations:` entry, every other line as it was. Apart from annotations.ts because it needs the yaml parser, which
// the web loads only when the person writes a draft (flow/annotationDraft.ts).
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

/** How a string is written in YAML: plain when that reads back the same, else double-quoted. */
export function yamlScalar(s: string): string {
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} _.,'()/&+-]*$/u.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^[-+]?(\d|\.\d)/.test(s) && !/\s$/.test(s) && !/: |\s#/.test(s)
  return plain ? s : JSON.stringify(s)
}

const splice = (file: string, start: number, end: number, text: string) => file.slice(0, start) + text + file.slice(end)
const lineStart = (file: string, pos: number) => file.lastIndexOf('\n', pos - 1) + 1
/** The position just after the line `end` finishes on (its newline included; one is added at the end of the file). */
function lineEndAfter(file: string, end: number): number {
  if (end > 0 && file[end - 1] === '\n') return end
  const n = file.indexOf('\n', end)
  return n < 0 ? file.length : n + 1
}

/**
 * The design file with one more annotation, every other line as it was: appended to the top-level `annotations:`
 * list where the file writes one (a block list: a new `- on: … / text: …` after its last entry, at its indentation;
 * an empty `annotations:` or `annotations: []` becomes a block list), else a new `annotations:` list at the end of the
 * file. Only a non-empty flow list (`[ … ]`) is rewritten through the yaml library, which may reflow the file.
 * Throws when the file is not a YAML map, or its `annotations` is not a list.
 */
export function addAnnotationToFile(file: string, entry: { on: string; text: string }): string {
  const doc = parseDocument(file, { keepSourceTokens: true })
  if (doc.errors.length) throw new Error(`the file is not valid YAML: ${doc.errors[0].message}`)
  const root = doc.contents
  if (root !== null && !isMap(root)) throw new Error('the file is not a YAML map')
  const lines = (pad: string) => `${pad}- on: ${yamlScalar(entry.on)}\n${pad}  text: ${yamlScalar(entry.text)}\n`
  const pair = isMap(root) ? root.items.find((p) => isScalar(p.key) && p.key.value === 'annotations') : undefined
  if (!pair) {
    const body = file.length && !file.endsWith('\n') ? `${file}\n` : file
    return `${body}annotations:\n${lines('  ')}`
  }
  const keyEnd = isScalar(pair.key) && pair.key.range ? pair.key.range[1] : undefined
  const value = pair.value
  // `annotations:` with nothing after it, or `annotations: []`: a block list right under the key
  const empty = value === null || (isScalar(value) && value.value === null) || (isSeq(value) && value.flow && value.items.length === 0)
  if (empty && keyEnd !== undefined) {
    const colon = file.indexOf(':', keyEnd)
    const end = value && value.range ? value.range[1] : colon + 1
    return splice(file, colon + 1, lineEndAfter(file, end), `\n${lines('  ')}`)
  }
  if (!isSeq(value)) throw new Error('`annotations` in the file is not a list')
  const first = value.items[0] as { range?: [number, number, number] } | undefined
  const last = value.items[value.items.length - 1] as { range?: [number, number, number] } | undefined
  if (!value.flow && first?.range && last?.range) {
    const start = first.range[0]
    const lead = file.slice(lineStart(file, start), start)
    if (/^ *- +$/.test(lead)) {
      const at = lineEndAfter(file, last.range[1])
      const head = at === file.length && !file.endsWith('\n') ? '\n' : ''
      return splice(file, at, at, head + lines(' '.repeat(lead.indexOf('-'))))
    }
  }
  doc.addIn(['annotations'], { on: entry.on, text: entry.text })
  return String(doc)
}
