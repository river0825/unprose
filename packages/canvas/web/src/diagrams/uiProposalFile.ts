// The file side of a UI mock text proposal (docs/diagrams.md §6c): the design file with the element's new
// words. Its own module so the yaml parser is only loaded when a proposal is shown.
import { isScalar, parseDocument } from 'yaml'
import type { UiTextPending } from './uiProposal'

/** How a string is written in YAML: plain when that reads back the same, else double-quoted. */
export function yamlScalar(s: string): string {
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} _.,'()/&+-]*$/u.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^[-+]?(\d|\.\d)/.test(s) && !/\s$/.test(s) && !/: |\s#/.test(s)
  return plain ? s : JSON.stringify(s)
}

/**
 * The file with the element's words changed. The scalar is replaced where it stands (comments, flow style
 * and the rest of the file stay as they are); an element with no such key yet gets one.
 */
export function applyUiText(file: string, p: Pick<UiTextPending, 'path' | 'key' | 'after'>): string {
  const doc = parseDocument(file, { keepSourceTokens: true })
  const node = doc.getIn([...p.path, p.key], true)
  if (isScalar(node) && node.range) {
    const [start, end] = node.range
    return file.slice(0, start) + yamlScalar(p.after.text) + file.slice(end)
  }
  doc.setIn([...p.path, p.key], p.after.text)
  return String(doc)
}
