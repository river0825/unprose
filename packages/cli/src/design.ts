// `awd design draw | lint | propose-stories` — diagrams backed by files (docs/diagrams.md).
// A diagram frame on the canvas is a projection of `design/<name>.<kind>.yaml`; the file is the
// truth, the board keeps where the person put things, and proposals stay proposals until the
// file explains them (the workflow board's rules, scoped to one frame).

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { checkDomainStory, checkEventStorming, contentSchemaFor, fromEgon, proposeFromDomainStory, proposeStories, toEgon, unknownContentFields, type StoryCandidate } from '@awd/canvas/diagrams'
import { lint as lintWorkflow, toGraph } from '@awd/core'
import { loadWorkflow } from '@awd/runtime'
import { planRedraw, placedByUser, repoRoot, withDetails } from './graphCanvas.js'

type Flags = Record<string, string | boolean>
const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined)

// ── the file ─────────────────────────────────────────────────────────────────

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
 * Top-level `key:` / `kind:` / `title:` in the file win over the filename.
 */
export function parseDesignFile(file: string, text: string): DesignFile {
  let raw: Record<string, unknown>
  try {
    raw = (YAML.parse(text) ?? {}) as Record<string, unknown>
  } catch (err) {
    const line = (err as { linePos?: Array<{ line: number }> }).linePos?.[0]?.line
    const hint = yamlCommentHint(text, line)
    throw new Error(`${file}: ${(err as Error).message}${hint ? `\n${hint}` : ''}`)
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: expected a YAML mapping`)
  const base = path.basename(file).replace(/\.ya?ml$/i, '')
  const dot = base.lastIndexOf('.')
  const name = dot > 0 ? base.slice(0, dot) : base
  const alias = dot > 0 ? base.slice(dot + 1) : undefined
  // A workflow file is the runner's own format: its `key:` is the run key template and `name:` its
  // name, so the diagram key comes from the filename and the drawing from the workflow projection.
  if (alias === 'workflow' || (!raw.kind && !alias && Array.isArray(raw.steps) === false && raw.steps && typeof raw.steps === 'object')) {
    const key = `${name}-workflow`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    return { key, kind: 'workflow', title: typeof raw.name === 'string' ? raw.name : undefined, content: raw }
  }
  const kind = typeof raw.kind === 'string' ? raw.kind : alias ? KIND_ALIASES[alias] : undefined
  if (!kind) throw new Error(`${file}: which diagram is this? name it <name>.<kind>.yaml (${Object.keys(KIND_ALIASES).join(', ')}) or set kind:`)
  const derived = alias && !name.endsWith(`-${alias}`) ? `${name}-${alias}` : name
  const key = typeof raw.key === 'string' ? raw.key : derived.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(key)) throw new Error(`${file}: diagram key "${key}" must be lower-case letters, digits and dashes`)
  const { key: _k, kind: _kind, title, ...content } = raw
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

// ── lint ─────────────────────────────────────────────────────────────────────

export interface DesignFinding {
  severity: 'error' | 'warning' | 'info'
  message: string
  element?: string
  /** Book page behind an EventStorming rule. */
  page?: string
}

/** Schema errors (the file will not draw) and, for EventStorming, the book's grammar (docs/diagrams.md §3). */
export function lintDesign(d: DesignFile, file?: string): DesignFinding[] {
  if (d.kind === 'workflow') {
    if (!file) return [{ severity: 'info', message: 'workflow: lint it with awd lint <file>' }]
    const r = lintWorkflow(loadWorkflow(file).def)
    return [...r.errors.map((e) => ({ severity: 'error' as const, message: `${e.where}: ${e.message}` })), ...r.warnings.map((w) => ({ severity: 'warning' as const, message: `${w.where}: ${w.message}` }))]
  }
  const schema = contentSchemaFor(d.kind)
  if (!schema) return [{ severity: 'info', message: `${d.kind}: no schema for this kind — the canvas validates it on draw` }]
  // a field the schema does not know would be dropped silently on draw: say so (river0825/unprose#8)
  const unknown: DesignFinding[] = unknownContentFields(d.kind, d.content).map((u) => ({ severity: 'warning', message: `unknown field \`${u.field}\` at ${u.path} — it is not part of ${d.kind} and will be ignored` }))
  const parsed = schema.safeParse(d.content)
  if (!parsed.success) return [...parsed.error.issues.map((i) => ({ severity: 'error' as const, message: `${i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '') || '(root)'}: ${i.message}` })), ...unknown]
  if (d.kind === 'domain-story') return [...unknown, ...checkDomainStory(d.content as never).map((f) => ({ severity: f.severity, message: f.message, element: f.element, page: f.page }))]
  if (d.kind !== 'event-storming') return unknown
  return [...unknown, ...checkEventStorming(d.content as never).map((f) => ({ severity: f.severity, message: f.message, element: f.element, page: f.page }))]
}

export function cmdDesignLint(file: string): boolean {
  const d = parseDesignFile(file, fs.readFileSync(file, 'utf8'))
  const findings = lintDesign(d, file)
  const errors = findings.filter((f) => f.severity === 'error')
  for (const f of findings) console.log(`${f.severity === 'error' ? '✖' : f.severity === 'warning' ? '⚠' : '·'} ${f.element ? `${f.element}: ` : ''}${f.message}${f.page ? `  (${f.page})` : ''}`)
  console.log(`${errors.length ? '✖' : '✔'} ${path.basename(file)} (${d.kind}, key ${d.key}): ${errors.length} error(s), ${findings.length - errors.length} note(s)`)
  return errors.length === 0
}

// ── the canvas ───────────────────────────────────────────────────────────────

type BoardItem = { id: string; type: string; parent?: string; x?: number; y?: number; w?: number; h?: number; from?: string; to?: string; text?: string; data?: Record<string, unknown>; [k: string]: unknown }
type Board = { id: string; title: string; kind: string; items: Record<string, BoardItem>; meta?: Record<string, unknown> }

function canvasApi(base: string) {
  return async <T,>(method: string, p: string, body?: unknown): Promise<T> => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${(await res.text()).slice(0, 300)}`)
    return res.json() as Promise<T>
  }
}
type Api = ReturnType<typeof canvasApi>

/** `title:<title>` (created as a freeform board when missing) or a board id. */
async function resolveBoard(api: Api, ref: string): Promise<Board> {
  if (ref.startsWith('title:')) {
    const title = ref.slice(6).trim()
    const { boards } = await api<{ boards: Array<{ id: string; title: string }> }>('GET', '/api/boards')
    const hit = boards.find((b) => b.title === title)
    const id = hit?.id ?? (await api<{ board: { id: string } }>('POST', '/api/boards', { title, kind: 'freeform' })).board.id
    return (await api<{ board: Board }>('GET', `/api/boards/${id}`)).board
  }
  return (await api<{ board: Board }>('GET', `/api/boards/${encodeURIComponent(ref)}`)).board
}

/** The diagram frame keyed `key` on the board. */
export function frameOf(board: Pick<Board, 'items'>, key: string): BoardItem | undefined {
  return Object.values(board.items).find((it) => it.type === 'frame' && (it.data?.diagram as { key?: string } | undefined)?.key === key)
}

export interface DrawOptions { board: string; canvas?: string; /** where a NEW frame goes (board coordinates); an existing frame stays where it is */ at?: { x: number; y: number } }

/** Draw or refresh one diagram frame from its file (docs/diagrams.md §2). */
export interface UnresolvedTrace { item: string; trace: { from: string; rel: string }; reason: string }

export async function drawDesign(file: string, opts: DrawOptions): Promise<{ base: string; boardId: string; seq: number; key: string; unresolvedTraces: UnresolvedTrace[] }> {
  const base = (opts.canvas || process.env.AWD_CANVAS_URL || 'http://localhost:4400').replace(/\/$/, '')
  const api = canvasApi(base)
  const abs = path.resolve(file)
  const text = fs.readFileSync(abs, 'utf8')
  const d = parseDesignFile(abs, text)
  const root = repoRoot(path.dirname(abs))
  const source = path.relative(root, abs)
  const board = await resolveBoard(api, opts.board)
  // A workflow is drawn with the runner's own projection (graph + block details); the files behind it
  // (agent prompts, scripts) go into the snapshot so the Inspector and Files tab can show them.
  const wf = d.kind === 'workflow' ? withDetails(toGraph(loadWorkflow(abs).def), abs) : undefined
  const { items: drawn, unresolvedTraces = [] } = await api<{ items: BoardItem[]; unresolvedTraces?: UnresolvedTrace[] }>('POST', `/api/boards/${board.id}/template`, {
    kind: d.kind,
    content: wf ? wf.graph : d.content,
    frame: { key: d.key, title: d.title, source, level: d.level, ...(opts.at ? { at: opts.at } : {}) },
  })
  const current = (await api<{ board: Board }>('GET', `/api/boards/${board.id}`)).board
  const { changes } = await api<{ changes: Array<{ ops: Array<{ kind: string; id?: string; patch?: Record<string, unknown> }> }> }>('GET', `/api/boards/${board.id}/changes?since=0&author=user`)
  const frame = drawn.find((it) => it.type === 'frame' && (it.data?.diagram as { key?: string } | undefined)?.key === d.key) ?? frameOf(current, d.key)
  const placed = placedByUser(changes)
  const ops = planRedraw(current.items, drawn, placed, { prefix: `${d.key}.`, keep: new Set(frame ? [frame.id] : []) })
  const grow = frame && current.items[frame.id] ? growFrame(current.items[frame.id], drawn, placed) : undefined
  if (grow) ops.push(grow)
  const { seq } = await api<{ seq: number }>('POST', `/api/boards/${board.id}/ops`, { author: 'agent', ops, note: `awd design draw: ${source}` })
  // PUT replaces meta whole: keep every other key, and every other diagram's entry.
  const diagrams = { ...((current.meta?.diagrams as Record<string, unknown> | undefined) ?? {}), [d.key]: { kind: d.kind, source, files: wf?.files?.files ?? { [source]: text } } }
  await api('PUT', `/api/boards/${board.id}`, { meta: { ...current.meta, project: { root }, diagrams } })
  return { base, boardId: board.id, seq, key: d.key, unresolvedTraces }
}

/** "N trace(s) not drawn" lines for a draw, so a link to a missing target is not lost silently (river0825/unprose#6). */
export function unresolvedReport(list: UnresolvedTrace[]): string[] {
  if (!list.length) return []
  const why = (u: UnresolvedTrace) => (u.reason === 'bad-ref' ? 'not a <diagram key>/<element id> ref' : 'target not found on the board')
  return [`⚠ ${list.length} trace(s) not drawn:`, ...list.map((u) => `  ${u.item} —${u.trace.rel}→ ${u.trace.from}: ${why(u)}`)]
}

// ── proposals: stories from EventStorming (docs/diagrams.md §4) ─────────────────

const CARD_W = 180
const CARD_H = 96
const GAP = 16
const PAD = 24

/** Where a board item for an EventStorming element lives: `<esKey>.<role>.<element id>`, or `data.element`. */
function esItemFor(board: Pick<Board, 'items'>, esKey: string, element: string): BoardItem | undefined {
  return Object.values(board.items).find((it) => it.id.startsWith(`${esKey}.`) && it.type !== 'arrow' && it.type !== 'comment' && (it.data?.element === element || it.id.endsWith(`.${element}`)))
}

/**
 * Pure: the ops that put story candidates on the story-map frame as pending cards (dashed on the
 * board), each with a pending 來自 trace wire from its EventStorming element. Nothing is written
 * to the story-map file — the person accepts, the studio session writes it, the redraw settles it.
 */
export function proposalOps(board: Pick<Board, 'items'>, candidates: StoryCandidate[], usmKey: string, esKey: string, now = new Date().toISOString()) {
  const frame = frameOf(board, usmKey)
  if (!frame) throw new Error(`no story-map frame keyed "${usmKey}" on this board — draw the story map first (awd design draw <file>)`)
  const already = new Set(Object.values(board.items).map((it) => (it.data?.pending as { trace?: { from: string } } | undefined)?.trace?.from).filter(Boolean))
  const fresh = candidates.filter((c) => !already.has(c.traces[0]?.from))
  const children = Object.values(board.items).filter((it) => it.parent === frame.id)
  const fx = frame.x ?? 0
  const fy = frame.y ?? 0
  const bottom = Math.max(fy + PAD, ...children.map((c) => (c.y ?? 0) + (c.h ?? 0)))
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
  if (fresh.length && need > (frame.h ?? 0)) ops.push({ kind: 'update', id: frame.id, patch: { h: need } })
  const right = fx + PAD + fresh.length * (CARD_W + GAP) + PAD - fx
  if (fresh.length && right > (frame.w ?? 0)) ops.push({ kind: 'update', id: frame.id, patch: { w: right } })
  return { ops, proposed: fresh.length, skipped: candidates.length - fresh.length }
}

export async function proposeStoriesToBoard(esFile: string, usmFile: string, opts: DrawOptions) {
  const base = (opts.canvas || process.env.AWD_CANVAS_URL || 'http://localhost:4400').replace(/\/$/, '')
  const api = canvasApi(base)
  const es = parseDesignFile(esFile, fs.readFileSync(esFile, 'utf8'))
  const usm = parseDesignFile(usmFile, fs.readFileSync(usmFile, 'utf8'))
  if (es.kind !== 'event-storming' && es.kind !== 'domain-story') throw new Error(`${esFile} is a ${es.kind} diagram — propose stories from EventStorming or a domain story`)
  if (usm.kind !== 'user-story-map') throw new Error(`${usmFile} is a ${usm.kind} diagram, not a story map`)
  const { candidates } =
    es.kind === 'domain-story'
      ? proposeFromDomainStory(es.content as never, { dsKey: es.key, storyName: es.title ?? es.key, existing: usm.content as never })
      : proposeStories(es.content as never, { esKey: es.key, existing: usm.content as never })
  const board = await resolveBoard(api, opts.board)
  const { ops, proposed, skipped } = proposalOps(board, candidates, usm.key, es.key)
  const seq = ops.length ? (await api<{ seq: number }>('POST', `/api/boards/${board.id}/ops`, { author: 'agent', ops, note: `awd design propose-stories: ${proposed} from ${es.key}` })).seq : undefined
  return { base, boardId: board.id, proposed, skipped, candidates: candidates.length, seq }
}

// ── the command ──────────────────────────────────────────────────────────────

export async function cmdDesign(args: string[], flags: Flags): Promise<boolean> {
  const [sub, file] = args
  const boardRef = str(flags.board)
  const canvas = str(flags.canvas)
  if (sub === 'lint') {
    if (!file) throw new Error('usage: awd design lint <design/<name>.<kind>.yaml>')
    return cmdDesignLint(file)
  }
  if (sub === 'draw') {
    if (!file || !boardRef) throw new Error('usage: awd design draw <file> --board <id | title:…> [--canvas URL] [--at x,y]')
    const findings = lintDesign(parseDesignFile(file, fs.readFileSync(file, 'utf8')), file)
    const errors = findings.filter((f) => f.severity === 'error')
    if (errors.length) {
      for (const e of errors) console.error(`✖ ${e.message}`)
      return false
    }
    for (const w of findings.filter((f) => f.severity === 'warning' && f.message.startsWith('unknown field'))) console.warn(`⚠ ${w.message}`)
    const at = str(flags.at)?.split(',').map(Number)
    const r = await drawDesign(file, { board: boardRef, canvas, ...(at && at.length === 2 && at.every(Number.isFinite) ? { at: { x: at[0], y: at[1] } } : {}) })
    console.log(`✔ ${path.basename(file)} → frame ${r.key} on ${r.base}/b/${r.boardId} (seq ${r.seq}; ${findings.filter((f) => f.severity !== 'error').length} note(s) — awd design lint ${file})`)
    for (const line of unresolvedReport(r.unresolvedTraces)) console.warn(line)
    return true
  }
  if (sub === 'propose-stories') {
    const into = str(flags.into)
    if (!file || !into || !boardRef) throw new Error('usage: awd design propose-stories <es file> --into <story map file> --board <id | title:…> [--canvas URL]')
    const r = await proposeStoriesToBoard(file, into, { board: boardRef, canvas })
    console.log(`✔ ${r.proposed} story proposal(s) on ${r.base}/b/${r.boardId}${r.skipped ? ` (${r.skipped} already proposed)` : ''}${r.candidates === 0 ? ' — nothing new: every command already has a story' : ''}. Accept them in a chat; the story-map file is not written until then.`)
    return true
  }
  if (sub === 'import-egon') {
    const out = str(flags.out)
    if (!file || !out) throw new Error('usage: awd design import-egon <story.egn> --out design/<name>.domain-story.yaml')
    const r = importEgonFile(file, out)
    for (const w of r.warnings) console.warn(`⚠ ${w}`)
    console.log(`✔ ${path.basename(file)} → ${out} (${r.sentences} sentence(s)); draw it with awd design draw ${out} --board …`)
    return cmdDesignLint(out)
  }
  if (sub === 'export-egon') {
    const out = str(flags.out)
    if (!file || !out) throw new Error('usage: awd design export-egon <design/<name>.domain-story.yaml> --out <story.egn>')
    exportEgonFile(file, out)
    console.log(`✔ ${path.basename(file)} → ${out}; open it in Egon.io (https://egon.io) with Import`)
    return true
  }
  throw new Error('usage: awd design draw|lint|propose-stories|import-egon|export-egon … (docs/diagrams.md)')
}

/**
 * A frame the person never resized grows to hold what was drawn (a longer timeline must not be squeezed
 * against the old edge); it never shrinks, and a frame the person moved or resized keeps their geometry.
 */
export function growFrame(frame: BoardItem, drawn: BoardItem[], placed: Set<string>, pad = 20): { kind: 'update'; id: string; patch: { w: number; h: number } } | undefined {
  if (placed.has(frame.id)) return undefined
  const boxes = drawn.filter((it) => it.type !== 'arrow' && it.parent === frame.id)
  if (!boxes.length) return undefined
  const [fx, fy, fw, fh] = [frame.x ?? 0, frame.y ?? 0, frame.w ?? 0, frame.h ?? 0]
  const w = Math.max(fw, ...boxes.map((b) => (b.x ?? 0) + (b.w ?? 0) + pad - fx))
  const h = Math.max(fh, ...boxes.map((b) => (b.y ?? 0) + (b.h ?? 0) + pad - fy))
  return w > fw || h > fh ? { kind: 'update', id: frame.id, patch: { w, h } } : undefined
}

// ── Egon.io interop (docs/diagrams.md §6b) ──────────────────────────────────

/** Read an Egon.io story (`.egn`, or `.egn.svg` with the story embedded) and write it as a domain-story file. */
export function importEgonFile(file: string, out: string): { sentences: number; warnings: string[] } {
  let text = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.svg')) {
    // Egon embeds the story as <DST>…</DST> in a hidden, XML-escaped <text> (older files: in a comment)
    const unescaped = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    const m = unescaped.match(/<DST>([\s\S]*?)<\/DST>/)
    if (!m) throw new Error(`${file}: no embedded domain story (<DST>) in this SVG`)
    text = m[1].replace(/<!--|-->/g, '')
  }
  const r = fromEgon(JSON.parse(text))
  const header = [`# Imported from Egon.io (${path.basename(file)}) by awd design import-egon.`, ...(r.description ? [`# ${r.description.replace(/\n/g, ' ')}`] : [])].join('\n')
  const body = YAML.stringify({ ...(r.title ? { title: r.title } : {}), ...r.content }, { lineWidth: 0 })
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, `${header}\n${body}`)
  return { sentences: (r.content.sentences ?? []).length, warnings: r.warnings }
}

/** Write a domain-story file as an Egon.io `.egn` story. */
export function exportEgonFile(file: string, out: string): void {
  const d = parseDesignFile(file, fs.readFileSync(file, 'utf8'))
  if (d.kind !== 'domain-story') throw new Error(`${file} is a ${d.kind} diagram, not a domain story`)
  fs.writeFileSync(out, JSON.stringify(toEgon(d.content as never, { title: d.title ?? d.key }), null, 2))
}
