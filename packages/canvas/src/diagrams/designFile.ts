// A diagram file (`design/<name>.<kind>.yaml`, docs/diagrams.md §2) once its YAML is parsed: which diagram it
// is, its lint findings, and the pure parts of drawing it (the frame, growing it, story proposals). Shared by
// the CLI (`awd design …`, which reads files) and the canvas server's remote design tools (which get the
// file's text from a remote agent — docs/canvas.md "Remote agents"). No YAML here: callers parse.
import type { DiagramKind } from '../model.js'
import { annotationsIn, diagramKinds, render, unresolvedAnnotations } from '../templates/index.js'
import { contentSchemaFor, unknownContentFields } from './check.js'
import { checkDomainStory } from './domainStory.js'
import { attachUiFindings, isUiScreen, lintUiMock, uiGutterOf } from './uiMock.js'
import { checkEventStorming } from './grammar.js'
import type { StoryCandidate } from './proposeStories.js'
import type { BoardItem } from './redraw.js'

/** Filename kind → diagram kind. The filename keeps the short form readable: `studio.es.yaml`. */
export const KIND_ALIASES: Record<string, string> = {
  es: 'event-storming',
  'event-storming': 'event-storming',
  'story-map': 'user-story-map',
  usm: 'user-story-map',
  'user-story-map': 'user-story-map',
  kanban: 'kanban',
  wireframe: 'wireframe',
  'domain-story': 'domain-story',
  dst: 'domain-story',
  journey: 'user-journey',
  'user-journey': 'user-journey',
  ui: 'ui-mock',
  mockup: 'ui-mock',
  'ui-mock': 'ui-mock',
  workflow: 'workflow',
}

export interface DesignFile {
  /** Diagram key, unique on the board: `<name>-<kind alias>` ('studio-es'), or `key:` in the file. */
  key: string
  kind: string
  title?: string
  level?: string
  /** The template content: the file without `key` / `kind` / `title`. */
  content: Record<string, unknown>
}

/**
 * `design/studio.es.yaml` → key `studio-es`, kind `event-storming`. Two diagrams of one topic
 * (`studio.es.yaml`, `studio.story-map.yaml`) get different keys, so they can share a board.
 * Top-level `key:` / `kind:` / `title:` in the file win over the filename. `raw` is the parsed YAML.
 */
export function designFromObject(file: string, raw: unknown): DesignFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: expected a YAML mapping`)
  const r = raw as Record<string, unknown>
  const base = (file.split(/[\\/]/).pop() ?? file).replace(/\.ya?ml$/i, '')
  const dot = base.lastIndexOf('.')
  const name = dot > 0 ? base.slice(0, dot) : base
  const alias = dot > 0 ? base.slice(dot + 1) : undefined
  // A workflow file is the runner's own format: its `key:` is the run key template and `name:` its
  // name, so the diagram key comes from the filename and the drawing from the workflow projection.
  if (alias === 'workflow' || (!r.kind && !alias && Array.isArray(r.steps) === false && r.steps && typeof r.steps === 'object')) {
    const key = `${name}-workflow`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    return { key, kind: 'workflow', title: typeof r.name === 'string' ? r.name : undefined, content: r }
  }
  const kind = typeof r.kind === 'string' ? (KIND_ALIASES[r.kind] ?? r.kind) : alias ? KIND_ALIASES[alias] : undefined
  if (!kind) throw new Error(`${file}: which diagram is this? name it <name>.<kind>.yaml (${Object.keys(KIND_ALIASES).join(', ')}) or set kind:`)
  const derived = alias && !name.endsWith(`-${alias}`) ? `${name}-${alias}` : name
  const key = typeof r.key === 'string' ? r.key : derived.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(key)) throw new Error(`${file}: diagram key "${key}" must be lower-case letters, digits and dashes`)
  const { key: _k, kind: _kind, title, ...content } = r
  const level = typeof content.level === 'string' ? content.level : undefined
  return { key, kind, title: typeof title === 'string' ? title : undefined, level, content }
}

/**
 * A `#` after a space starts a YAML comment — inside a flow sequence (`labels: [PR #1113, issue #1112]`)
 * that drops the closing `]` and the parse error only points at a caret. Find such a line at or before
 * the failing one and say why (river0825/unprose#9).
 */
export function yamlCommentHint(text: string, failingLine?: number): string | undefined {
  const lines = text.split('\n')
  const last = Math.min(lines.length, failingLine ?? lines.length)
  for (let i = last - 1; i >= Math.max(0, last - 20); i--) {
    // strip quoted strings, then look for an unclosed [ followed by ' #'
    const bare = lines[i].replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, '""')
    const open = bare.indexOf('[')
    const hash = open >= 0 ? bare.slice(open).search(/\s#/) : -1
    // the `]` that should close it sits after the # — i.e. inside the comment
    if (hash > 0 && !bare.slice(open, open + hash).includes(']')) {
      return `hint: line ${i + 1} has an unquoted "#" inside [ … ] — a "#" after a space starts a YAML comment, so the rest of the line is dropped. Quote values containing # (e.g. "PR #1113").`
    }
  }
  return undefined
}

export interface DesignFinding {
  severity: 'error' | 'warning' | 'info'
  message: string
  element?: string
  /** Book page behind an EventStorming rule. */
  page?: string
}

/**
 * The items the server drew, with what the file as written adds: a UI mock's lint findings on its elements
 * (docs/diagrams.md §6c) — the server drew from the parsed content, which has lost the fields the schema does
 * not know. Every other kind: the items as they are.
 */
export function withDesignFindings<T extends { id: string; type: string; data?: Record<string, unknown> }>(d: DesignFile, drawn: T[]): T[] {
  return d.kind === 'ui-mock' ? attachUiFindings(drawn, d.content as never) : drawn
}

/** Schema errors (the file will not draw) and the grammar of the kinds that have one. Not for workflows (the CLI lints those). */
export function lintDesignContent(d: DesignFile): DesignFinding[] {
  const schema = contentSchemaFor(d.kind)
  if (!schema) return [{ severity: 'info', message: `${d.kind}: no schema for this kind — the canvas validates it on draw` }]
  // a field the schema does not know would be dropped silently on draw: say so (river0825/unprose#8)
  const unknown: DesignFinding[] = unknownContentFields(d.kind, d.content).map((u) => ({ severity: 'warning', message: `unknown field \`${u.field}\` at ${u.path} — it is not part of ${d.kind} and will be ignored` }))
  const parsed = schema.safeParse(d.content)
  if (!parsed.success) return [...parsed.error.issues.map((i) => ({ severity: 'error' as const, message: `${i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '') || '(root)'}: ${i.message}` })), ...unknown]
  if (d.kind === 'domain-story') return [...unknown, ...checkDomainStory(d.content as never).map((f) => ({ severity: f.severity, message: f.message, element: f.element, page: f.page }))]
  const notes = annotationFindings(d.kind, parsed.data, d.key)
  // the board shows the same findings on the frame (lintUiMock includes the unknown fields)
  if (d.kind === 'ui-mock') return [...lintUiMock(d.content as never).map((f) => ({ severity: f.severity, message: f.message, element: f.element })), ...notes]
  if (d.kind !== 'event-storming') return [...unknown, ...notes]
  return [...unknown, ...checkEventStorming(d.content as never).map((f) => ({ severity: f.severity, message: f.message, element: f.element, page: f.page })), ...notes]
}

/**
 * An annotation whose `on` names nothing in the drawing is an error (docs/diagrams.md "Annotations"): the draw leaves
 * its card out. `content` is drawn with the diagram key as the scope, so `on` written as an id inside the diagram resolves
 * as it does on the board. A workflow's content is its graph (`awd graph --json`, with the file's `annotations`).
 */
export function annotationFindings(kind: string, content: unknown, key: string): DesignFinding[] {
  if (!annotationsIn(content).length || !(diagramKinds as string[]).includes(kind)) return []
  let items: ReturnType<typeof render>
  try {
    items = render(kind as DiagramKind, content, { scope: key, now: '1970-01-01T00:00:00.000Z' })
  } catch {
    return [] // it does not draw: the schema findings say why
  }
  return unresolvedAnnotations(kind as DiagramKind, content, items, key)
}

/** One finding as a line: `✖ element: message  (page)`. */
export function findingLine(f: DesignFinding): string {
  return `${f.severity === 'error' ? '✖' : f.severity === 'warning' ? '⚠' : '·'} ${f.element ? `${f.element}: ` : ''}${f.message}${f.page ? `  (${f.page})` : ''}`
}

/** The diagram frame keyed `key` on the board. */
export function frameOf(board: { items: Record<string, BoardItem> }, key: string): BoardItem | undefined {
  return Object.values(board.items).find((it) => it.type === 'frame' && (it.data?.diagram as { key?: string } | undefined)?.key === key)
}

/**
 * A frame the person never resized grows to hold what was drawn (a longer timeline must not be squeezed
 * against the old edge); it never shrinks, and a frame the person moved or resized keeps their geometry.
 */
export function growFrame(frame: BoardItem, drawn: BoardItem[], placed: Set<string>, pad = 20): { kind: 'update'; id: string; patch: { w: number; h: number } } | undefined {
  if (placed.has(frame.id)) return undefined
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  // a UI-mock screen's gutter (its notes and threads) counts as part of the drawing
  const boxes = drawn.filter((it) => it.type !== 'arrow' && it.parent === frame.id).flatMap((it) => (isUiScreen(it) ? [it, { ...it, ...uiGutterOf({ x: num(it.x), y: num(it.y), w: num(it.w), h: num(it.h) }) }] : [it]))
  if (!boxes.length) return undefined
  const [fx, fy, fw, fh] = [num(frame.x), num(frame.y), num(frame.w), num(frame.h)]
  const w = Math.max(fw, ...boxes.map((b) => num(b.x) + num(b.w) + pad - fx))
  const h = Math.max(fh, ...boxes.map((b) => num(b.y) + num(b.h) + pad - fy))
  return w > fw || h > fh ? { kind: 'update', id: frame.id, patch: { w, h } } : undefined
}

// ── proposals: stories from EventStorming (docs/diagrams.md §4) ─────────────────

const CARD_W = 180
const CARD_H = 96
const GAP = 16
const PAD = 24

/** Where a board item for an EventStorming element lives: `<esKey>.<role>.<element id>`, or `data.element`. */
function esItemFor(board: { items: Record<string, BoardItem> }, esKey: string, element: string): BoardItem | undefined {
  return Object.values(board.items).find((it) => it.id.startsWith(`${esKey}.`) && it.type !== 'arrow' && it.type !== 'comment' && (it.data?.element === element || it.id.endsWith(`.${element}`)))
}

/**
 * Pure: the ops that put story candidates on the story-map frame as pending cards (dashed on the
 * board), each with a pending 來自 trace wire from its EventStorming element. Nothing is written
 * to the story-map file — the person accepts, the studio session writes it, the redraw settles it.
 */
export function proposalOps(board: { items: Record<string, BoardItem> }, candidates: StoryCandidate[], usmKey: string, esKey: string, now = new Date().toISOString()) {
  const frame = frameOf(board, usmKey)
  if (!frame) throw new Error(`no story-map frame keyed "${usmKey}" on this board — draw the story map first (awd design draw <file>)`)
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  const already = new Set(Object.values(board.items).map((it) => (it.data?.pending as { trace?: { from: string } } | undefined)?.trace?.from).filter(Boolean))
  const fresh = candidates.filter((c) => !already.has(c.traces[0]?.from))
  const children = Object.values(board.items).filter((it) => it.parent === frame.id)
  const fx = num(frame.x)
  const fy = num(frame.y)
  const bottom = Math.max(fy + PAD, ...children.map((c) => num(c.y) + num(c.h)))
  const y = bottom + GAP * 2
  const stamp = { createdBy: 'agent', updatedBy: 'agent', updatedAt: now }
  const ops: Array<Record<string, unknown>> = []
  fresh.forEach((c, i) => {
    const id = `${usmKey}.proposed.${c.id}`
    const trace = c.traces[0]
    ops.push({
      kind: 'add',
      item: {
        id, type: 'card', role: 'story', color: 'white', parent: frame.id,
        x: fx + PAD + i * (CARD_W + GAP), y, w: CARD_W, h: CARD_H,
        text: c.text,
        data: {
          pending: { kind: 'add', trace, story: { id: c.id, text: c.text, acceptance: c.acceptance, traces: c.traces }, activity: c.activity, step: c.step, by: 'agent', at: now },
          traces: c.traces,
          acceptance: c.acceptance,
        },
        ...stamp,
      },
    })
    const src = trace && esItemFor(board, esKey, c.source.id)
    if (src) {
      ops.push({ kind: 'add', item: { id: `${id}.trace`, type: 'arrow', role: 'trace', from: src.id, to: id, label: '來自', x: 0, y: 0, w: 0, h: 0, data: { pending: { kind: 'add', trace } }, ...stamp } })
    }
  })
  const need = y + CARD_H + PAD - fy
  if (fresh.length && need > num(frame.h)) ops.push({ kind: 'update', id: frame.id, patch: { h: need } })
  const right = fx + PAD + fresh.length * (CARD_W + GAP) + PAD - fx
  if (fresh.length && right > num(frame.w)) ops.push({ kind: 'update', id: frame.id, patch: { w: right } })
  return { ops, proposed: fresh.length, skipped: candidates.length - fresh.length }
}
