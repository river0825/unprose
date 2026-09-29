// WorkTracker adapter: a markdown file in the repo (`design/<key>.tasks.md`), so the work
// items diff and review like everything else. One `##` per card; the machine part sits in
// an HTML comment under the heading, the rest is the description.
//
//   # studio — tasks
//   <!-- columns: Backlog, Ready, In Progress, Done -->
//
//   ## Ask the AI about a selection
//   <!-- card: ask-ai · column: Ready · labels: web, studio -->
//   stories: studio-usm/select-items, studio-usm/ask-ai
//
//   The chat tab sends a discuss comment …

import type { CardDraft, TrackerCard, WorkTracker } from '../../ports/workTracker.js'

export const DEFAULT_COLUMNS = ['Backlog', 'Ready', 'In Progress', 'Done']

export interface TasksDoc { title: string; columns: string[]; cards: TrackerCard[] }

const META = /^<!--\s*card:\s*([^·]+?)\s*·\s*column:\s*([^·]+?)\s*(?:·\s*labels:\s*(.*?)\s*)?-->$/
const COLUMNS = /^<!--\s*columns:\s*(.*?)\s*-->$/
const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean)

/** Pure: markdown → cards. Headings without a card comment get an id from their title. */
export function parseTasks(md: string, fallbackTitle = 'tasks'): TasksDoc {
  const lines = md.split('\n')
  const doc: TasksDoc = { title: fallbackTitle, columns: [...DEFAULT_COLUMNS], cards: [] }
  let card: TrackerCard | undefined
  let body: string[] = []
  const flush = () => {
    if (!card) return
    const text = body.join('\n').trim()
    if (text) card.description = text
    doc.cards.push(card)
    card = undefined
    body = []
  }
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/)
    const h2 = line.match(/^##\s+(.+)$/)
    if (h1 && !card) { doc.title = h1[1].trim(); continue }
    if (h2) {
      flush()
      const title = h2[1].trim()
      card = { id: slug(title), title, column: doc.columns[0], stories: [] }
      continue
    }
    const cols = line.trim().match(COLUMNS)
    if (cols && !card) { doc.columns = list(cols[1]); continue }
    if (!card) continue
    const meta = line.trim().match(META)
    if (meta) {
      card.id = meta[1].trim()
      card.column = meta[2].trim()
      const labels = list(meta[3])
      if (labels.length) card.labels = labels
      continue
    }
    const stories = line.match(/^stories:\s*(.*)$/)
    if (stories && !body.some((b) => b.trim())) { card.stories = list(stories[1]); continue }
    body.push(line)
  }
  flush()
  return doc
}

/** Pure: cards → markdown (the inverse of parseTasks). */
export function renderTasks(doc: TasksDoc): string {
  const out = [`# ${doc.title}`, `<!-- columns: ${doc.columns.join(', ')} -->`, '']
  for (const c of doc.cards) {
    out.push(`## ${c.title}`, `<!-- card: ${c.id} · column: ${c.column}${c.labels?.length ? ` · labels: ${c.labels.join(', ')}` : ''} -->`)
    if (c.stories.length) out.push(`stories: ${c.stories.join(', ')}`)
    if (c.description) out.push('', c.description)
    out.push('')
  }
  return out.join('\n')
}

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'card'
}

export interface TextFileTrackerOptions {
  /** Absolute path of `design/<key>.tasks.md`. */
  file: string
  title?: string
  readFile: (file: string) => string | undefined
  writeFile: (file: string, text: string) => void
}

export class TextFileTracker implements WorkTracker {
  readonly name = 'text'
  constructor(private o: TextFileTrackerOptions) {}
  private load(): TasksDoc {
    const md = this.o.readFile(this.o.file)
    return md === undefined ? { title: this.o.title ?? 'tasks', columns: [...DEFAULT_COLUMNS], cards: [] } : parseTasks(md, this.o.title)
  }
  private save(doc: TasksDoc) { this.o.writeFile(this.o.file, renderTasks(doc)) }
  async columns() { return this.load().columns }
  async list() { return this.load().cards }
  async upsert(draft: CardDraft) {
    const doc = this.load()
    const was = doc.cards.find((c) => c.id === draft.id)
    if (draft.column && !doc.columns.includes(draft.column)) throw new Error(`unknown column "${draft.column}" (${doc.columns.join(', ')})`)
    if (was) {
      Object.assign(was, { title: draft.title, description: draft.description, labels: draft.labels, stories: draft.stories }, draft.column ? { column: draft.column } : {})
    } else doc.cards.push({ ...draft, column: draft.column ?? doc.columns[0] })
    this.save(doc)
    return { created: !was }
  }
  async move(cardId: string, column: string) {
    const doc = this.load()
    const card = doc.cards.find((c) => c.id === cardId)
    if (!card) throw new Error(`no card "${cardId}" in ${this.o.file}`)
    if (!doc.columns.includes(column)) throw new Error(`unknown column "${column}" (${doc.columns.join(', ')})`)
    card.column = column
    this.save(doc)
  }
}
